-- Async delivery: worker threads + DoPulse pump + callbacks + timers.

local result = nil
sample_async_add(2, 3, function(sum) result = sum end)
test_assert(result == nil, "callback has not fired before pumping")
test_pump(60)
test_assert(result == 5, "async result delivered through the callback")

local ticks = {}
local timer_id = sample_timer(5, 3, function(tick) ticks[#ticks + 1] = tick end)
test_assert(type(timer_id) == "number" and timer_id > 0, "sample_timer returns an id")
test_pump(150)
test_assert(#ticks == 3, "timer fired exactly three times")
test_assert(ticks[1] == 1 and ticks[2] == 2 and ticks[3] == 3, "tick numbers 1..3")

-- Infinite timer that gets cancelled.
local fires = 0
local cancel_id = sample_timer(5, 0, function() fires = fires + 1 end)
test_pump(40)
test_assert(fires > 0, "infinite timer fires")
test_assert(sample_timer_cancel(cancel_id), "cancel returns true")
local after_cancel = fires
test_pump(40)
test_assert(fires == after_cancel, "no fires after cancellation")
