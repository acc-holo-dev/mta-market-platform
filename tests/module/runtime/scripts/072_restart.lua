-- Stale-generation restart regression.
--
-- Callbacks, an async task and timers are created in one VM generation,
-- then the resource restarts into a REAL fresh VM (fresh registry, fresh
-- luaL_ref space). The stale objects must be fully unable to reach the new
-- VM.
--
-- The collision is engineered exactly: in each fresh VM the first callback
-- receives luaL_ref index 1, so the generation-3 callback occupies the SAME
-- registry index that the queued generation-2 completion still carries.

-- ===== generation 2: a fresh VM; bind callbacks and queue work
test_resource_restart()

local ok = test_fresh_vm_dostring([[
GEN_A = {}
function gen_a_async(sum) table.insert(GEN_A, "async:" .. tostring(sum)) end
sample_async_add(1, 2, gen_a_async)   -- first luaL_ref in this VM: index 1
sample_timer(5, 0, function(tick) table.insert(GEN_A, "timer:" .. tostring(tick)) end)
sample_timer(7, 0, function(tick) table.insert(GEN_A, "timer:" .. tostring(tick)) end)
]])
test_assert(ok, "generation-2 VM chunk runs")

-- ===== restart: generation 3 in another fresh VM; same ref index 1
test_resource_restart()

ok = test_fresh_vm_dostring([[
GEN_B = {}
function gen_b_async(sum) table.insert(GEN_B, "async:" .. tostring(sum)) end
sample_async_add(10, 20, gen_b_async)   -- ref index 1 again: the collision case
sample_timer(1, 2, function(tick) table.insert(GEN_B, "timer:" .. tostring(tick)) end)
sample_timer(2, 2, function(tick) table.insert(GEN_B, "timer:" .. tostring(tick)) end)
]])
test_assert(ok, "generation-3 VM chunk runs")

test_pump(120)

-- the fresh VM received exactly its own completions
local log = test_fresh_vm_get("GEN_B")
test_assert(type(log) == "table" and #log >= 1, "generation-3 VM log exists")

local delivered_async = false
local stale_async = false
local timer_ticks = 0
for _, value in ipairs(log) do
    if value == "async:30" then
        delivered_async = true
    elseif value == "async:3" then
        stale_async = true -- the generation-2 task's result (1 + 2)
    elseif type(value) == "string" and string.find(value, "timer:", 1, true) == 1 then
        timer_ticks = timer_ticks + 1
    end
end

test_assert(delivered_async, "generation-3 async completion delivered in the fresh VM")
test_assert(not stale_async, "stale generation-2 completion never fired in the fresh VM")
test_assert(timer_ticks >= 2, "generation-3 timers fire (multiple timers after restart)")

-- end the generation (cancels the fresh VM's timers, invalidates its
-- callbacks) and reattach the harness resource VM to the script VM so the
-- later scripts keep running against the VM they run in
test_resource_stop()
test_resource_restore()

-- the restored VM is a new generation: everything still works from here
test_assert(sample_add(2, 3) == 5, "module functions work after the restart cycle")