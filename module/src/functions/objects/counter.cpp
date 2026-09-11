// userdata/metatables: a counter object with get/set/add methods and __gc.
// The type identity is declared with MTA_OBJECT: stable,
// compiler-independent, module-aware ("mta.<module>.counter").
//
//     local c = counter_create(42)
//     c:get()   -- 42
//     c:set(100)
//     c:add(5)  -- 105
//     c = nil   -- __gc calls ~Counter()

#include <mta/sdk.hpp>

namespace
{
struct Counter
{
    double value = 0;
};

// Stable type identity: the metatable name is derived from this declared
// name, never from typeid(T).name().
MTA_OBJECT("counter", Counter)

// Registers the type's methods. Registry calls it once per VM
// (each resource has its own lua_State and its own metatable).
void register_counter_methods(lua_State *L)
{
    MTA_METHOD(Counter, "get", [](Counter &self) { return self.value; });
    MTA_METHOD(Counter, "set", [](Counter &self, double v) { self.value = v; });
    MTA_METHOD(Counter, "add", [](Counter &self, double v) {
        self.value += v;
        return self.value;
    });
}

// Once per process: bind the method registrar to the type.
const bool counter_methods_registered = [] {
    mta::userdata::Registry<Counter>::set_methods(&register_counter_methods);
    return true;
}();
} // namespace

MTA_LUA_FUNCTION("counter_create", "Creates a counter object with get/set/add methods.")
{
    auto [value] = mta::lua::args<double>(L);
    mta::userdata::Registry<Counter>::create(L, Counter{value});
    return 1;
}