-- Benchmark (informational; timings only printed, sanity values asserted):
-- userdata creation and access (source/sdk/objects/userdata.hpp, exercised
-- through the counter sample, source/functions/objects/counter.cpp).
-- counter_create pays Registry::create per call: lua_newuserdata, the
-- metatable attach and the push. The method measurements pay the userdata
-- check, the metatable dispatch and the typed argument conversion (add also
-- converts one argument and pushes one result back).

-- sanity: the counter object round-trips its value through its methods
local c = counter_create(42)
test_assert(c:get() == 42, "counter get returns the constructed value")
c:set(100)
test_assert(c:get() == 100, "counter set stores a new value")
test_assert(c:add(5) == 105, "counter add returns the new value")
test_assert(c:get() == 105, "counter add persisted")

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

-- creation: a fresh userdata per call (the previous one becomes garbage and
-- is finalized by the collectgarbage("collect") of the next measurement)
local sink = nil
local elapsed_create = measure("userdata: counter_create (new object)", 100000, function()
    sink = counter_create(1.5)
end)
test_assert(sink ~= nil and sink:get() == 1.5, "created counters are usable objects")

-- method access without arguments or results (pure dispatch cost)
local obj = counter_create(0)
measure("userdata access: counter :get()", 500000, function()
    obj:get()
end)

-- method access with one argument and one result (arg conversion + push)
measure("userdata access: counter :add(1)", 300000, function()
    obj:add(1)
end)

-- derived: creation cost per object
print(string.format("benchmark: derived creation cost ~ %.3f us per object",
                    elapsed_create / 100000 * 1e6))