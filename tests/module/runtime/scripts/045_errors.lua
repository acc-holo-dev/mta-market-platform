-- Unified error model and signature metadata.
-- The error matrix follows the documented error format exactly;
-- metadata follows the documented signature metadata rules.

-- wrong type at position 1
local ok, err = pcall(sample_minmax, "hello", 10)
test_assert(not ok, "type mismatch raises")
test_assert(err == "bad argument #1 to 'sample_minmax' (expected number, got string)",
            "type mismatch: bad argument #1 ... (expected number, got string)")

-- missing argument is reported at its position
local ok2, err2 = pcall(sample_minmax, 5)
test_assert(not ok2, "missing argument raises")
test_assert(err2 == "bad argument #2 to 'sample_minmax' (expected number, got no value)",
            "missing argument: bad argument #2 ... (expected number, got no value)")

-- integer parameters report "integer"
local ok3, err3 = pcall(sample_range, "x", 1)
test_assert(not ok3, "integer mismatch raises")
test_assert(err3 == "bad argument #1 to 'sample_range' (expected integer, got string)",
            "integer parameters report 'integer'")

-- optional<T> with an incompatible type reports the inner type
local ok4, err4 = pcall(sample_tag, "x", {})
test_assert(not ok4, "optional with wrong type raises")
test_assert(err4 == "bad argument #2 to 'sample_tag' (expected string, got table)",
            "optional argument error")

-- callback parameters report "function"
local ok5, err5 = pcall(sample_async_add, 1, 2, "not-a-function")
test_assert(not ok5, "callback with wrong type raises")
test_assert(err5 == "bad argument #3 to 'sample_async_add' (expected function, got string)",
            "callback argument error")

-- boolean parameters report "boolean" (no sample uses bool; probe via
-- stack_dump is not typed, so check the whole-number constraint instead)
local ok6, err6 = pcall(sample_range, 1.5, 2)
test_assert(not ok6, "fractional integer raises")
test_assert(err6 ~= nil and string.find(err6, "bad argument #1 to 'sample_range'", 1, true) ~= nil,
            "whole-number constraint is reported with position and name")

-- --- signature metadata (module_signature) -------------------------------------

local minmax = module_signature("sample_minmax")
test_assert(type(minmax) == "table", "module_signature returns metadata")
test_assert(minmax.derived == false, "body-style signature is explicitly not derived")
test_assert(#minmax.arguments == 0, "body-style has no argument metadata")
test_assert(#minmax.returns == 0, "body-style has no return metadata")

local hello = module_signature("sample_hello")
test_assert(hello.derived == true, "lambda-style signature is derived")
test_assert(hello.arguments[1].type == "string" and hello.arguments[1].optional == false,
            "facade lambda argument metadata")
test_assert(hello.returns[1] == "string", "facade lambda return metadata")

local len = module_signature("sample_hello_len")
test_assert(len.derived == true, "tuple-return signature is derived")
test_assert(len.returns[1] == "string" and len.returns[2] == "integer",
            "tuple return metadata")
test_assert(len.arguments[1].type == "string", "tuple-return argument metadata")

test_assert(module_signature("does_not_exist") == nil, "unknown name -> nil")

local listed = module_functions()
for _, name in ipairs({"sample_hello", "sample_hello_len", "sample_minmax", "module_signature"}) do
    test_assert(listed[name] ~= nil, "module_functions lists " .. name)
end
test_assert(select(2, sample_hello_len("Alice")) == 5, "tuple-returning facade function works")