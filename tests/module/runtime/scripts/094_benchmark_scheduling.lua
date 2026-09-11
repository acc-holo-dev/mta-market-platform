-- Benchmark (informational; timings only printed, sanity values asserted):
-- async task scheduling and timer scheduling (source/sdk/runtime/scheduler.cpp
-- through the async samples). Tasks go through sample_async_add and are
-- delivered on DoPulse; one-shot timers are scheduled with sample_after and
-- fire on a pump after their delay. The end-to-end measurements take the wall
-- time (os.clock) around posting AND full delivery: results are pumped in
-- small slices until every completion has fired, with a bounded wait so the
-- script always terminates (the same waiting pattern as 030/080). A separate
-- measurement covers pure timer scheduling without firing (those timers are
-- cancelled again right away).

-- sanity: one async result and one timer fire, delivered through the pump
local result = nil
sample_async_add(2, 3, function(sum) result = sum end)
test_pump(60)
test_assert(result == 5, "async result delivered through DoPulse")

local sanity_fires = 0
sample_after(5, function() sanity_fires = sanity_fires + 1 end)
test_pump(150)
test_assert(sanity_fires == 1, "one-shot timer fired exactly once")

local function report(label, ops, elapsed)
    print(string.format("benchmark: %-46s %9d ops in %7.3f s = %12.0f ops/s",
                        label, ops, elapsed, ops / elapsed))
end

-- (a) async tasks: post 2000 tasks per round, then pump until every
-- completion has fired; the wall time spans posting + full delivery.
local batch = 2000
local rounds = 6
local done = 0
collectgarbage("collect")
local start = os.clock()
local posted = 0.0
for _ = 1, rounds do
    local goal = done + batch
    local post_start = os.clock()
    for i = 1, batch do
        sample_async_add(i, 1, function() done = done + 1 end)
    end
    posted = posted + (os.clock() - post_start)
    -- deliver this batch before posting the next one (bounded wait)
    local guard = os.clock() + 4.0
    while done < goal and os.clock() < guard do
        test_pump(5)
    end
end
local elapsed = os.clock() - start
local total = batch * rounds
test_assert(done == total,
    "every posted async task delivered its completion (got " .. done .. "/" .. total .. ")")
report("async scheduling: post+deliver (2000 x 6)", total, elapsed)
print(string.format("benchmark: derived enqueue rate ~ %.0f tasks/s (posting only)",
                    total / posted))

-- (b) timers: schedule 200 one-shot timers (1 ms) per round, then pump until
-- every one has fired.
local tbatch = 200
local trounds = 8
local fired = 0
collectgarbage("collect")
local tstart = os.clock()
for _ = 1, trounds do
    local goal = fired + tbatch
    for _ = 1, tbatch do
        sample_after(1, function() fired = fired + 1 end)
    end
    local guard = os.clock() + 4.0
    while fired < goal and os.clock() < guard do
        test_pump(5)
    end
end
local telapsed = os.clock() - tstart
local ttotal = tbatch * trounds
test_assert(fired == ttotal,
    "every scheduled one-shot timer fired (got " .. fired .. "/" .. ttotal .. ")")
report("timer scheduling: after+fire (200 x 8)", ttotal, telapsed)

-- (c) scheduling only: 1000 timers that never fire during the run (1 s delay),
-- measured for the pure scheduling cost and cancelled again right away.
local tonly = 1000
local only_ids = {}
for i = 1, tonly do only_ids[i] = false end
collectgarbage("collect")
local sstart = os.clock()
for i = 1, tonly do
    only_ids[i] = sample_after(1000, function() end)
end
local selapsed = os.clock() - sstart
report("timer scheduling: schedule only (1000)", tonly, selapsed)
local cancelled = 0
for i = 1, tonly do
    if sample_after_cancel(only_ids[i]) then cancelled = cancelled + 1 end
end
test_assert(cancelled == tonly,
    "every schedule-only timer was cancelled again (got " .. cancelled .. "/" .. tonly .. ")")