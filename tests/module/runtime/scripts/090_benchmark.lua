-- Benchmark (informational, no assertions): module call throughput.

local n = 200000
local acc = 0
local start = os.clock()
for i = 1, n do
    acc = sample_add(acc, 1)
end
local elapsed = os.clock() - start
print(string.format("benchmark: %d sample_add calls in %.3f s = %.0f calls/s",
                    n, elapsed, n / elapsed))
