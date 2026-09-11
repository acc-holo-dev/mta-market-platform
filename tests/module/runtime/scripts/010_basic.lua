-- Basic function behaviour and error translation.

local sum = sample_add(2, 3)
test_assert(sum == 5, "sample_add(2, 3) == 5")
test_assert(sample_add(-1.5, 0.5) == -1.0, "sample_add with floats")

local ok, err = pcall(sample_add, "x", 1)
test_assert(not ok, "sample_add raises a Lua error on bad type")
test_assert(err == "bad argument #1 to 'sample_add' (expected number, got string)",
            "documented error format with function name, position and types")

local a, b, c = sample_echo(1, "two", true)
test_assert(a == 1 and b == "two" and c == true, "sample_echo returns scalars unchanged")
test_assert(sample_echo() == nil, "sample_echo with no arguments returns nil")

local t = sample_echo({10, 20, {x = "deep"}})
test_assert(type(t) == "table", "sample_echo returns a table")
test_assert(t[1] == 10 and t[2] == 20, "table sequence part preserved")
test_assert(t[3].x == "deep", "nested table preserved")

local list = module_functions()
test_assert(type(list) == "table", "module_functions returns a table")
test_assert(list["sample_add"] ~= nil, "module_functions lists sample_add")
test_assert(list["sample_echo"] ~= nil, "module_functions lists sample_echo")
test_assert(list["module_functions"] ~= nil, "module_functions lists itself")
