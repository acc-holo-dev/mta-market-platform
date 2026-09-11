-- Regression tests for Scheduler::pump(): timer callbacks may create and
-- cancel timers while dispatch is in progress. The old implementation
-- iterated the live timer vector, so creating a timer (push_back -> possible
-- reallocation) or cancelling one (erase) mid-loop was undefined behavior.

-- Scenario 1: create a timer from inside a timer callback.
local created = 0
local created_ticks = 0

sample_timer(5, 1, function()
    created = created + 1
    sample_timer(5, 2, function()
        created_ticks = created_ticks + 1
    end)
end)

test_pump(150)
test_assert(created == 1, "timer created inside a timer callback ran once")
test_assert(created_ticks == 2, "inner timer fired its full repeat count")

-- Scenario 2: cancel a timer from inside another timer's callback.
local fired_a = 0
local fired_b = 0

local id_a = sample_timer(5, 0, function() -- 0 = repeat forever
    fired_a = fired_a + 1
end)

sample_timer(5, 3, function(tick)
    fired_b = fired_b + 1
    if tick == 1 then
        sample_timer_cancel(id_a) -- cancel A on the first tick of B
    end
end)

test_pump(200)
test_assert(fired_a == 1, "timer cancelled from another timer fired exactly once")
test_assert(fired_b == 3, "cancelling a timer did not disturb the canceller")
