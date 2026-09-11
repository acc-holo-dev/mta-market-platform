-- Integration test suite for the real-server harness.
--
-- Installed by other/server/mta_server.py as the resource "sdkintegration".
-- Every scenario reports its own marker line, which the harness parses from
-- the server console log:
--
--     SCENARIO <name>: PASS | FAIL           (one marker per scenario)
--     INTEGRATION_RESULT: PASS | FAIL (...)  (per-generation summary)
--
-- The harness choreographs three generations of this resource through the
-- server console:
--
--   generation 1  auto-start      function-level scenarios + stale-gen arming
--            -> INTEGRATION: STOP_NOW     harness: stop sdkintegration
--   generation 2  stop + start    resource stop/start + stale windows
--            -> INTEGRATION: RESTART_NOW  harness: restart sdkintegration
--   generation 3  after restart   restart scenarios, multiple timers,
--                                 shutdown worker, final result
--            -> INTEGRATION: RUN_COMPLETE
--
-- Stale objects (async tasks, module-timer callbacks) armed before a
-- stop/restart must NEVER fire afterwards: the harness fails the whole run
-- if any negative marker (STALE_TASK_DELIVERED*, OLD_CALLBACK_FIRED*,
-- STALE_COLLISION_FIRED, SHOULD_NEVER_FIRE) appears anywhere in the log.

local MARK = "INTEGRATION:"
local failures = {}

local function check(name, condition)
    if condition then
        outputServerLog(MARK .. " SCENARIO " .. name .. ": PASS")
    else
        failures[#failures + 1] = name
        outputServerLog(MARK .. " SCENARIO " .. name .. ": FAIL")
    end
end

local function result_tag()
    if #failures == 0 then
        return "INTEGRATION_RESULT: PASS"
    end
    return "INTEGRATION_RESULT: FAIL (" .. table.concat(failures, ", ") .. ")"
end

local function write_file(name, content)
    local handle = fileCreate(name)
    if handle then
        fileWrite(handle, content)
        fileClose(handle)
    end
end

local function read_file(name)
    local handle = fileOpen(name)
    if not handle then
        return nil
    end
    local content = fileRead(handle, 256)
    fileClose(handle)
    return content
end

-- Generation detection via the marker files each generation leaves behind:
-- generation 1 leaves sdk_gen1_done.txt (+ its stop marker), generation 2
-- leaves sdk_gen2_done.txt (+ its stop marker). A fresh VM with both files
-- present is generation 3.
local gen1Done = fileExists("sdk_gen1_done.txt")
local gen1StopOk = fileExists("sdk_gen1_stop_ok.txt")
local gen2Done = fileExists("sdk_gen2_done.txt")
local gen2StopOk = fileExists("sdk_gen2_stop_ok.txt")
local generation = 1
if gen1Done then
    generation = 2
end
if gen2Done then
    generation = 3
end

-- ===========================================================================
-- generation 1 (auto-start): function-level scenarios + stale-gen arming
-- ===========================================================================
if generation == 1 then
    check("module load",
        type(sample_add) == "function"
        and type(counter_create) == "function"
        and type(sample_async_add) == "function")
    check("function registration",
        type(sample_task_run) == "function"
        and type(sample_timer) == "function"
        and type(sample_after) == "function"
        and type(sample_timer_valid) == "function"
        and type(sample_resource_name) == "function"
        and type(sample_resource_find) == "function")

    local minimum, maximum = sample_minmax(3, 9)
    check("return values",
        sample_add(2, 3) == 5
        and sample_greet("Bob") == "hello, Bob"
        and minimum == 3 and maximum == 9)
    check("argument validation",
        select(1, pcall(sample_add, "x", {})) == false
        and select(1, pcall(counter_create)) == false
        and select(1, pcall(sample_task_run, 100, 1, 2, "not a function")) == false)

    -- STAGE 0 DRM SPIKE on the real server: encrypted Lua SOURCE payload
    -- (byte-complement "cipher", hex-encoded) decrypted and executed by the
    -- native module INSIDE THIS resource VM.
    local function encrypt_real(source)
        local bytes = {}
        for i = 1, #source do
            bytes[#bytes + 1] = string.format("%02x", 255 - string.byte(source, i))
        end
        return table.concat(bytes)
    end

    local drm_ok, drm_err = spike_drm_load(
        encrypt_real('spike_drm_source_real = "source ran on real server"'))
    check("drm source payload",
        drm_ok == true and spike_drm_source_real == "source ran on real server")

    -- STAGE 0 DRM SPIKE: encrypted BYTECODE payload, produced offline by
    -- the build pipeline (spike_luac + MTA-format dumper). The runtime
    -- cannot dump bytecode (WITH_STRING_DUMP off) but loads it fine.
    local drm_bytecode_hex =
        "e4b38a9eaefffefbfbfbf7ffbaffffffbfbbc5a3b996939aa3bb9a899a93908f9a8da3af8d90959a" ..
        "9c8ba3acbbb4a3928b9ed2988a9e8d9bd292909b8a939aa39d8a96939ba38f8d908b9a9c8b9a9bcdd1" ..
        "938a9efffffffffffffffffffffffdfdfcfffffffebffffff8ffffffe1ff7ffffdfffffffbe9ffffff" ..
        "8c8f96949aa09b8d92a08d9a9e93a0929e8d949a8dfffbe3ffffff9d868b9a9c909b9adf8d9e91df90" ..
        "91df8d9a9e93df8c9a8d899a8dfffffffffffcfffffffefffffffefffffffeffffffffffffffffffffff"
    local bc_ok, bc_err = spike_drm_load(drm_bytecode_hex)
    check("drm bytecode payload",
        bc_ok == true and spike_drm_real_marker == "bytecode ran on real server")


    local counter = counter_create(7)
    check("userdata", counter ~= nil and counter:get() == 7 and counter:add(3) == 10)
    check("userdata validation", select(1, pcall(counter.set, counter, {})) == false)

    -- Per-resource state: the witness resource (sdkintegration2) must
    -- independently start from 1 -- checked there at its own start.
    sample_session_hit()
    sample_session_hit()

    -- timer / async task / callback are armed now and verified in the
    -- deterministic 800 ms settle window below.
    local timerTicks = 0
    sample_timer(50, 3, function() timerTicks = timerTicks + 1 end)

    local completionResult = nil
    local completionTask = sample_task_run(100, 10, 20, function(sum) completionResult = sum end)

    local callbackResult = nil
    sample_async_add(1, 2, function(sum) callbackResult = sum end)

    -- stale-gen arming (generation 1): a stale async task (8 s) and a stale
    -- module-timer callback (10 s) that must never fire after the harness
    -- stops and starts this resource.
    sample_task_run(8000, 0, 0, function()
        outputServerLog("STALE_TASK_DELIVERED_G1")
    end)
    local staleCallbackTimer = sample_timer(10000, 1, function()
        outputServerLog("OLD_CALLBACK_FIRED_G1")
    end)

    -- The stop event must reach this VM cleanly; the next generation
    -- verifies the marker file.
    addEventHandler("onResourceStop", resourceRoot, function()
        write_file("sdk_gen1_stop_ok.txt", "generation 1 stopped cleanly")
    end)

    setTimer(function()
        check("timer", timerTicks >= 3)
        check("async task", type(completionTask) == "number" and completionTask > 0)
        check("async completion", completionResult == 30)
        check("callback", callbackResult == 3)
        check("multiple resources",
            sample_resource_find("sdkintegration2") == true
            and sample_resource_name() == "sdkintegration")

        write_file("sdk_gen1_done.txt",
            "userdata=" .. tostring(counter:get())
            .. ";stale_timer=" .. tostring(staleCallbackTimer))
        outputServerLog(MARK .. " generation 1 done (userdata="
            .. tostring(counter:get())
            .. ", stale_timer=" .. tostring(staleCallbackTimer) .. ")")
        outputServerLog(result_tag())
        outputServerLog(MARK .. " STOP_NOW")
    end, 800, 1)
    return
end

-- ===========================================================================
-- generation 2 (after harness stop + start): regression cycle 1, resource
-- stop/start, userdata invalidation, stale windows
-- ===========================================================================
if generation == 2 then
    -- ---- resource stop and resource start as dedicated scenarios ----
    -- (not the implicit stop inside a restart): generation 1's
    -- onResourceStop handler wrote its marker during the stop.
    check("resource stop", gen1Done and gen1StopOk)
    check("resource start",
        sample_resource_name() == "sdkintegration"
        and type(sample_add) == "function"
        and type(counter_create) == "function")

    -- userdata invalidation across the generation boundary: the
    -- previous generation's userdata value (10) must not leak into this
    -- one, and its timer handle must be dead here (per-VM handle maps).
    local previous = read_file("sdk_gen1_done.txt") or ""
    local staleTimerId = tonumber(string.match(previous, "stale_timer=([%-%d]+)"))

    -- The FIRST module callback of this fresh VM occupies the luaL_ref slot
    -- a stale delivery from generation 1 would collide with.
    -- It must only ever fire from its own 45 s timer -- which never happens:
    -- the resource restarts long before that.
    local sentinel = sample_after(45000, function()
        outputServerLog("STALE_COLLISION_FIRED")
    end)

    local counter = counter_create(5)
    local oldTimerDead = false
    if staleTimerId then
        oldTimerDead = sample_timer_valid(staleTimerId) == false
    end
    check("userdata invalidation",
        counter ~= nil
        and counter:get() == 5
        and counter:get() ~= 10
        and staleTimerId ~= nil
        and oldTimerDead
        and sample_timer_valid(sentinel) == true)

    fileDelete("sdk_gen1_done.txt")
    fileDelete("sdk_gen1_stop_ok.txt")

    addEventHandler("onResourceStop", resourceRoot, function()
        write_file("sdk_gen2_stop_ok.txt", "generation 2 stopped cleanly")
    end)

    setTimer(function()
        -- The generation-1 stale windows (8 s task, 10 s callback) have
        -- elapsed inside THIS generation without a delivery; the harness
        -- verifies the absence of STALE_TASK_DELIVERED*/OLD_CALLBACK_FIRED*
        -- in the whole log.
        check("old async task after restart", gen1Done)
        check("old callback after restart", gen1Done)
        check("stale generation regression (33)", gen1Done and gen1StopOk)

        -- stale-gen arming (generation 2, right before the console restart)
        sample_task_run(8000, 0, 0, function()
            outputServerLog("STALE_TASK_DELIVERED_G2")
        end)
        sample_timer(10000, 1, function()
            outputServerLog("OLD_CALLBACK_FIRED_G2")
        end)

        write_file("sdk_gen2_done.txt",
            "userdata=" .. tostring(counter:get())
            .. ";stale_timer=" .. tostring(sentinel))
        outputServerLog(result_tag())
        outputServerLog(MARK .. " RESTART_NOW")
    end, 10500, 1)
    return
end

-- ===========================================================================
-- generation 3 (after the console restart): restart scenarios, multiple
-- timers after restart, shutdown worker, final result
-- ===========================================================================
local previous = read_file("sdk_gen2_done.txt") or ""
local staleTimerId = tonumber(string.match(previous, "stale_timer=([%-%d]+)"))

-- First module callback of this fresh VM: the collision sentinel again
-- (the same luaL_ref slot generation 2's first callback occupied).
local sentinel = sample_after(45000, function()
    outputServerLog("STALE_COLLISION_FIRED")
end)

-- resource restart (console restart = stop + start of the same
-- resource; generation 2 stopped cleanly and this VM is fresh).
check("resource restart",
    gen2Done and gen2StopOk
    and sample_resource_name() == "sdkintegration"
    and type(sample_add) == "function")

-- userdata invalidation, now one stop/start AND one restart away from
-- the original object.
local counter = counter_create(2)
local oldTimerDead = false
if staleTimerId then
    oldTimerDead = sample_timer_valid(staleTimerId) == false
end
check("userdata invalidation",
    counter ~= nil
    and counter:get() == 2
    and counter:get() ~= 5
    and staleTimerId ~= nil
    and oldTimerDead
    and sample_timer_valid(sentinel) == true)

fileDelete("sdk_gen2_done.txt")
fileDelete("sdk_gen2_stop_ok.txt")

-- multiple timers after restart -- three fresh timers, each must fire
-- twice inside this generation.
local ticks1, ticks2, ticks3 = 0, 0, 0
sample_timer(60, 2, function() ticks1 = ticks1 + 1 end)
sample_timer(120, 2, function() ticks2 = ticks2 + 1 end)
sample_timer(180, 2, function() ticks3 = ticks3 + 1 end)

-- shutdown with active workers: a 60 s task stays pending when the
-- harness stops the server; the module must cancel it cleanly and never
-- let it fire (harness-side negative check).
sample_task_run(60000, 0, 0, function()
    outputServerLog("SHOULD_NEVER_FIRE")
end)
outputServerLog(MARK .. " shutdown worker armed (60 s pending at shutdown)")

setTimer(function()
    check("multiple timers after restart",
        ticks1 >= 2 and ticks2 >= 2 and ticks3 >= 2)
end, 600, 1)

setTimer(function()
    -- The generation-2 stale windows (8 s task, 10 s callback) have elapsed
    -- inside THIS generation; the harness verified no delivery markers.
    check("old async task after restart", gen2Done)
    check("old callback after restart", gen2Done)
    check("stale generation regression (33)", gen2Done and gen2StopOk)

    outputServerLog(result_tag())
    outputServerLog(MARK .. " RUN_COMPLETE")
end, 13000, 1)