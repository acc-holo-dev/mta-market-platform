-- Timer handles: after()/every() semantics via samples,
-- cancellation, and resource ownership.

-- after: one-shot
FIRED = 0
local ok, id = pcall(sample_after, 30, function() FIRED = FIRED + 1 end)
test_assert(ok and id > 0, "sample_after returns a timer id")
test_assert(sample_timer_valid(id) == true, "scheduled timer is valid")
test_pump(150)
test_assert(FIRED == 1, "after() fired exactly once")
test_assert(sample_timer_valid(id) == false, "one-shot timer invalid after firing")

-- cancel before firing
FIRED = 0
local ok2, id2 = pcall(sample_after, 60, function() FIRED = FIRED + 1 end)
test_assert(ok2 and id2 > 0, "second timer scheduled")
test_assert(sample_after_cancel(id2) == true, "scheduled timer cancels")
test_assert(sample_timer_valid(id2) == false, "cancelled timer is invalid")
test_assert(sample_after_cancel(id2) == false, "cancelling twice reports false")
test_pump(150)
test_assert(FIRED == 0, "cancelled timer never fired")

-- every: repeats until cancelled
TICKS = 0
local ok3, id3 = pcall(sample_every, 10, function() TICKS = TICKS + 1 end)
test_assert(ok3 and id3 > 0, "repeating timer scheduled")
test_pump(130)
local ticks_at_cancel = TICKS
test_assert(ticks_at_cancel >= 3, "every() repeats (got " .. tostring(ticks_at_cancel) .. " ticks)")
test_assert(sample_timer_valid(id3) == true, "repeating timer stays valid")
sample_after_cancel(id3)
test_pump(80)
test_assert(TICKS == ticks_at_cancel, "cancelled every() stops firing")

-- resource stop invalidates owned timers
FIRED = 0
local ok4, id4 = pcall(sample_after, 100, function() FIRED = FIRED + 100 end)
test_assert(ok4 and id4 > 0, "timer scheduled before the stop")
test_resource_stop()
test_assert(sample_timer_valid(id4) == false, "resource stop invalidates owned timers")
test_pump(200)
test_assert(FIRED == 0, "stopped resource's timer never fired")
test_resource_start()

-- module functions still work after the cycle
test_assert(sample_add(2, 3) == 5, "module functions work after the stop/start cycle")