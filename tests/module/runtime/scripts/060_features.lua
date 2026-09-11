-- New capabilities: userdata, events, table helpers.

-- userdata: counter object with methods
local c = counter_create(42)
test_assert(c:get() == 42, "counter get")
c:set(100)
test_assert(c:get() == 100, "counter set")
test_assert(c:add(5) == 105, "counter add returns new value")
test_assert(c:get() == 105, "counter add persisted")

-- stable type identity: type validation names the declared type
local unbound_get = c.get
local ok_t, err_t = pcall(unbound_get, 42)
test_assert(ok_t == false, "calling get without a counter fails")
test_assert(tostring(err_t):find("counter", 1, true) ~= nil,
    "the error names the declared type: " .. tostring(err_t))

-- events: the module triggers a Lua event
local events = {}
root = {}
function triggerEvent(name, source, ...)
    events[#events + 1] = {name = name, args = {...}}
end
sample_trigger_event("onTest", 1, "two")
test_assert(events[1] ~= nil, "event triggered")
test_assert(events[1].name == "onTest", "event name")
test_assert(events[1].args[1] == 1 and events[1].args[2] == "two", "event args")

-- table helpers: reading fields
local name, hp = sample_table_get({name = "Alice", hp = 100})
test_assert(name == "Alice" and hp == 100, "table get fields")

-- table helpers: default when the field is absent
local name2, hp2 = sample_table_get({})
test_assert(name2 == "unknown" and hp2 == 0, "table get defaults")

-- table helpers: writing a field
local t = sample_table_set({hp = 50}, "Alice")
test_assert(t.name == "Alice" and t.hp == 50, "table set field")

-- native types: the safe Resource wrapper
test_assert(sample_resource_name() == "test_resource", "sample_resource_name returns the calling resource")
test_assert(sample_resource_find("test_resource") == true, "a running resource is found")
test_assert(sample_resource_find("no_such_resource_xyz") == false, "an unknown resource is not found")

-- native types as typed binder arguments: mta::Resource by
-- name, validated live through the module manager
local res_name, res_alive = sample_resource_arg("test_resource")
test_assert(res_name == "test_resource" and res_alive == true, "mta::Resource parameter is validated live")

local ok_res, err_res = pcall(sample_resource_arg, "no_such_resource_xyz")
test_assert(ok_res == false, "an unknown resource raises")
test_assert(err_res == "bad argument #1 to 'sample_resource_arg' (no running resource 'no_such_resource_xyz')",
            "unknown resource error names the argument and the resource")

local ok_res2, err_res2 = pcall(sample_resource_arg, 42)
test_assert(ok_res2 == false
            and err_res2 == "bad argument #1 to 'sample_resource_arg' (expected resource, got number)",
            "a non-string argument is a typed error")

test_assert(sample_resource_arg_optional("test_resource") == "test_resource", "optional resource provided")
test_assert(sample_resource_arg_optional(nil) == nil, "optional resource omitted -> nil")
test_assert(sample_resource_return("test_resource") == "test_resource", "a returned Resource is pushed as its name")

-- signature metadata names the native type
local res_sig = module_signature("sample_resource_arg")
test_assert(res_sig ~= nil and res_sig.arguments[1].type == "resource", "resource parameter metadata")
test_assert(res_sig.returns[1] == "string" and res_sig.returns[2] == "boolean",
            "resource function return metadata")
local res_opt_sig = module_signature("sample_resource_arg_optional")
test_assert(res_opt_sig ~= nil and res_opt_sig.arguments[1].type == "resource"
            and res_opt_sig.arguments[1].optional == true, "optional resource parameter metadata")
test_assert(res_opt_sig.returns[1] == "string or nil", "optional resource return metadata")
