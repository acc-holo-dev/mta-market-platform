-- Benchmark (informational; timings only printed, sanity values asserted):
-- callback bookkeeping (source/sdk/runtime/callback.cpp). The three costs a
-- Lua function reference incurs, each measured in isolation:
--   bench_callback_hold(fn)     -- registration: luaL_ref + per-resource
--                                  tracking bookkeeping
--   bench_callback_call(id, ..) -- invocation: dead-ref lookup, generation
--                                  check, registry fetch (lua_rawgeti), pcall
--   bench_callback_release(id)  -- release: untracking + luaL_unref
-- The callbacks fire synchronously into the calling VM -- the same delivery
-- path the scheduler uses on DoPulse, without the scheduling noise around it.

-- sanity: register -> invoke -> release, plus dead-id behavior
local id = bench_callback_hold(function(a, b) CHECK = a + b end)
test_assert(type(id) == "number" and id > 0, "bench_callback_hold returns an id")
CHECK = nil
test_assert(bench_callback_call(id, 2, 3) == true, "bench_callback_call runs the callback")
test_assert(CHECK == 5, "the callback received its arguments")
test_assert(bench_callback_release(id) == true, "bench_callback_release releases a held callback")
test_assert(bench_callback_call(id) == false, "calling a released callback reports false")
test_assert(bench_callback_release(id) == false, "releasing a callback twice reports false")
test_assert(bench_callback_call(424242) == false, "calling an unknown id reports false")

local function measure(label, n, body)
    collectgarbage("collect")
    local start = os.clock()
    for _ = 1, n do
        body()
    end
    local elapsed = os.clock() - start
    print(string.format("benchmark: %-46s %9d ops in %7.3f s = %12.0f ops/s",
                        label, n, elapsed, n / elapsed))
    return elapsed
end

local noop = function() end

-- hold: register n callbacks; the ids are kept for the release measurement
local n_hold = 100000
local ids = {}
for i = 1, n_hold do ids[i] = false end -- preallocate: the loop measures only holds
local hold_i = 0
local elapsed_hold = measure("callback: bench_callback_hold (register)", n_hold, function()
    hold_i = hold_i + 1
    ids[hold_i] = bench_callback_hold(noop)
end)

-- call: one pre-registered callback, no extra arguments (pure invocation cost)
local call_id = bench_callback_hold(noop)
local n_call = 500000
local elapsed_call = measure("callback: bench_callback_call (no arguments)", n_call, function()
    bench_callback_call(call_id)
end)

-- call with two numbers (mimics a delivered result pair)
measure("callback: bench_callback_call (2 numbers)", 400000, function()
    bench_callback_call(call_id, 1.5, 2)
end)

-- release: unregister the held callbacks (also empties the store again)
local release_i = 0
local elapsed_release = measure("callback: bench_callback_release (unref)", n_hold, function()
    release_i = release_i + 1
    bench_callback_release(ids[release_i])
end)
bench_callback_release(call_id)
test_assert(bench_callback_call(call_id) == false, "cleanup: the last held callback is released")

-- derived: per-operation costs and the full hold -> call -> release cycle
print(string.format("benchmark: derived registration ~ %.3f us, release ~ %.3f us per callback",
                    elapsed_hold / n_hold * 1e6, elapsed_release / n_hold * 1e6))
print(string.format("benchmark: derived hold -> call -> release cycle ~ %.2f us",
                    (elapsed_hold / n_hold + elapsed_call / n_call + elapsed_release / n_hold) * 1e6))