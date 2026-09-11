-- Benchmark (informational; timings only printed, sanity values asserted):
-- table snapshot conversion (source/sdk/lua/argument.cpp). bench_table_roundtrip
-- performs one FULL conversion per call: the read path builds the recursive
-- Table snapshot (lua_next traversal into an Argument tree) and the write path
-- rebuilds the Lua table from it (lua_createtable + per-element pushes).
-- Small and large arrays separate the per-element cost from the per-call
-- overhead; the read-only snapshot path (read without write-back) is
-- measured through sample_table_stats, the existing read conversion sample.

-- sanity: the roundtrip returns the input by value, nested tables included
local round = bench_table_roundtrip({1, 2, 3, x = 4, y = "s", flag = true})
test_assert(type(round) == "table", "bench_table_roundtrip returns a table")
test_assert(round[1] == 1 and round[2] == 2 and round[3] == 3,
            "bench_table_roundtrip preserves the array part")
test_assert(round.x == 4 and round.y == "s" and round.flag == true,
            "bench_table_roundtrip preserves the fields")
local nested = bench_table_roundtrip({a = {b = 2}})
test_assert(type(nested.a) == "table" and nested.a.b == 2,
            "bench_table_roundtrip preserves nested tables")
local eight = bench_table_roundtrip({1, 2, 3, 4, 5, 6, 7, 8})
local kept = 0
for _ in ipairs(eight) do kept = kept + 1 end
test_assert(kept == 8, "an 8-element array round-trips element for element")
local stats = sample_table_stats({1, 2, 3, 4})
test_assert(stats.values == 4 and stats.sum == 10,
            "sample_table_stats reads a table through the read-only path")

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

local small = {1, 2, 3, 4, 5, 6, 7, 8}
local large = {}
for i = 1, 64 do large[i] = i end
local mixed = {1, 2, 3, 4, x = 5, y = 6, name = "v", flag = true}

local elapsed8 = measure("table snapshot: roundtrip (8 elements)", 80000, function()
    bench_table_roundtrip(small)
end)
local elapsed64 = measure("table snapshot: roundtrip (64 elements)", 20000, function()
    bench_table_roundtrip(large)
end)
measure("table snapshot: roundtrip (8 mixed entries)", 80000, function()
    bench_table_roundtrip(mixed)
end)
measure("table read: sample_table_stats (64 elements)", 40000, function()
    sample_table_stats(large)
end)

-- derived: marginal per-element cost from the 8- vs 64-element roundtrip rate
-- (a negative derivation means the two rates are within measurement noise)
local per_element_us = (elapsed64 / (64 * 20000) - elapsed8 / (8 * 80000)) * 1e6
if per_element_us < 0 then
    print("benchmark: derived marginal per-element roundtrip cost ~ 0 (within measurement noise)")
else
    print(string.format("benchmark: derived marginal per-element roundtrip cost ~ %.3f us",
                        per_element_us))
end