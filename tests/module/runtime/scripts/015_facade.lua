-- <mta/sdk.hpp> facade: MTA_FUNCTION registers a lambda under EXACTLY the
-- developer-provided name (no prefixes, no namespaces), with or
-- without a description.

test_assert(sample_hello("World") == "Hello, World", "facade function returns greeting")
test_assert(sample_hello_desc("World") == "Good evening, World", "described facade form works")

-- naming rule: registered verbatim, no implicit prefixes
local list = module_functions()
test_assert(list["sample_hello"] ~= nil, "sample_hello registered under its exact name")
test_assert(list["sample_hello"] == "", "descriptionless MTA_FUNCTION has an empty description")
test_assert(list["sample_hello_desc"] == "Greets politely.", "described form keeps its description")

-- lambda signatures are typed exactly like the classic binder
-- (numbers coerce to strings like luaL_checkstring; a table is an error)
local ok, err = pcall(sample_hello, {1, 2})
test_assert(not ok, "facade lambda validates argument types")
test_assert(err == "bad argument #1 to 'sample_hello' (expected string, got table)",
            "typed error message from the facade signature")

local ok2, err2 = pcall(sample_hello)
test_assert(not ok2, "facade lambda rejects a missing argument")
test_assert(err2 == "bad argument #1 to 'sample_hello' (expected string, got no value)",
            "missing-argument error message")

-- MTA_STATE / mta::state: the borrowed state view over the calling VM
--; synchronous use only.
local view = sample_state()
test_assert(type(view) == "table" and view.resource == "test_resource",
            "mta::state reports the calling resource")
test_assert(type(view.top) == "number", "mta::state exposes the stack depth")

-- the view's typed readers (check_*) and its push_results: values travel
-- through the same conversions as the free mta::lua helpers
local num, int, flag, text = sample_state_readers(2.5, 7, true, "hi")
test_assert(num == 2.5 and int == 7 and flag == true and text == "hi",
            "mta::state typed readers round-trip number/integer/boolean/string")
local okv, errv = pcall(sample_state_readers, "bad", 1, true, "x")
test_assert(not okv, "the state view rejects a wrong argument type")
test_assert(errv == "bad argument #1 to 'sample_state_readers' (expected number, got string)",
            "typed reader error carries the function name and position")
local okm, errm = pcall(sample_state_readers, 1)
test_assert(not okm, "the state view rejects a missing argument")
test_assert(errm == "bad argument #2 to 'sample_state_readers' (expected integer, got no value)",
            "typed reader missing-argument error message")