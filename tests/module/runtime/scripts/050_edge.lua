-- Edge cases: nil, extra arguments, empty ranges, limits.

-- extra arguments are ignored
test_assert(sample_add(1, 2, 3, 4) == 3, "extra arguments ignored")

-- nil instead of a number -> readable error
local ok, err = pcall(sample_add, nil, 1)
test_assert(not ok, "nil for number raises")
test_assert(err == "bad argument #1 to 'sample_add' (expected number, got nil)",
            "nil error message")

-- single-element range
local single = {sample_range(5, 5)}
test_assert(#single == 1 and single[1] == 5, "single-element range")

-- empty range (from > to) -> zero results
local empty = {sample_range(5, 4)}
test_assert(#empty == 0, "empty range returns nothing")

-- oversized range -> error
local ok2, err2 = pcall(sample_range, 1, 2000)
test_assert(not ok2, "huge range raises")
test_assert(err2 and string.find(err2, "range too large", 1, true) ~= nil, "range error message")

-- explicit nil in optional -> default
test_assert(sample_greet("x", nil) == "hello, x", "explicit nil uses default")
test_assert(sample_tag("x", nil) == "x/none", "explicit nil -> nullopt")

-- missing required argument
local ok3, err3 = pcall(sample_minmax, 5)
test_assert(not ok3, "missing required argument raises")
test_assert(err3 == "bad argument #2 to 'sample_minmax' (expected number, got no value)",
            "missing arg message")

-- cancelling a nonexistent timer
test_assert(sample_timer_cancel(999999) == false, "cancel nonexistent timer returns false")

-- empty stack_dump call
local n = sample_stack_dump()
test_assert(n == 0, "stack_dump with no args returns count 0")
