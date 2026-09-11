-- Benchmark (informational; timings only printed, sanity values asserted):
-- argument conversion through the typed binder (source/sdk/lua/argument.cpp,
-- bind.hpp). sample_add measures the two-number baseline call (the same
-- function as 090_benchmark.lua), bench_args_sum8 converts eight numbers per
-- call so the per-number conversion cost separates from the per-call
-- overhead, and bench_args_mixed converts one value of every primitive kind.
-- All rates include the same constant per-iteration loop overhead (one Lua
-- closure call), so rates stay comparable across the benchmark scripts.

-- sanity: the plaques convert what they claim
local mn, tx, fl, in_ = bench_args_mixed(2.5, "x", true, 7)
test_assert(mn == 2.5 and tx == "x" and fl == true and in_ == 7,
            "bench_args_mixed round-trips number, string, boolean and integer")
test_assert(bench_args_sum8(1, 2, 3, 4, 5, 6, 7, 8) == 36, "bench_args_sum8 sums eight numbers")

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

local two = 2.0
local text = "benchmark string"
local elapsed2 = measure("argument conversion: sample_add (2 numbers)", 1000000, function()
    sample_add(1.5, two)
end)
local elapsed8 = measure("argument conversion: bench_args_sum8 (8 numbers)", 400000, function()
    bench_args_sum8(1, 2, 3, 4, 5, 6, 7, two)
end)
local elapsedm = measure("argument conversion: bench_args_mixed (4 typed values)", 400000, function()
    bench_args_mixed(1.5, text, true, 7)
end)

-- derived: per-number conversion cost from the 2-number vs 8-number call rate
-- (sub-0.1 s timings carry jitter; a negative derivation means the two rates
-- are within measurement noise and the marginal cost is reported as ~0)
local per_number_us = (elapsed8 / (8 * 400000) - elapsed2 / (2 * 1000000)) * 1e6
if per_number_us < 0 then
    print("benchmark: derived marginal per-number conversion cost ~ 0 (within measurement noise)")
else
    print(string.format("benchmark: derived marginal per-number conversion cost ~ %.3f us", per_number_us))
end
print(string.format("benchmark: number conversions/s ~ %.0f (from bench_args_sum8)",
                    8 * 400000 / elapsed8))