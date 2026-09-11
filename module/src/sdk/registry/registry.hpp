#pragma once

// Lua-function registry and registration macros.
//
// The main style is body-style with typed arguments:
//
//     MTA_LUA_FUNCTION("my_sum", "Adds two numbers.")
//     {
//         auto [a, b] = mta::lua::args<double, double>(L);
//         return mta::lua::push_results(L, a + b);
//     }
//
// Short one-liners use the lambda style (types from the signature, automatic
// return):
//
//     MTA_LUA_FUNC("my_sum", "Adds two numbers.",
//         [](double a, double b) { return a + b; });
//
// Both macros work in any .cpp under source/ -- the build picks up the file
// and registration happens automatically when the module loads.

#include "sdk/bind/bind.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

class ILuaModuleManager10;

namespace mta::registry
{
// Raw entry point (C++ linkage); the framework wraps it into a Lua function.
using module_function = int (*)(lua_State *lua_vm);

struct Spec
{
    const char *name;
    const char *description;
    module_function function;

    // Derived for lambda-style registrations; empty (derived == false) for
    // body-style ones -- underivable metadata is stated explicitly.
    mta::lua::Signature signature{};

    // Free-form grouping; empty unless a future registration spelling
    // provides it. The docs generator marks the empty value as "n/a"
    // (underivable information is stated explicitly).
    std::string category{};

    // Binder capabilities derived from the C++ signature:
    // mta::lua::function_flag_* bits (variadic tail, Lua function
    // parameter); 0 for body-style registrations. Copied from
    // Signature::flags by the registration bridge.
    std::uint32_t flags = 0;
};

class Registry
{
public:
    static Registry &instance();

    void add(const Spec &spec);

    // Registers every function into the resource's VM (at each resource start).
    void register_all(ILuaModuleManager10 &manager, lua_State *lua_vm) const;

    [[nodiscard]] const std::vector<Spec> &functions() const noexcept { return functions_; }
    [[nodiscard]] std::size_t size() const noexcept { return functions_.size(); }

private:
    Registry() = default;
    std::vector<Spec> functions_{};
};
} // namespace mta::registry

#define MTA_CAT_(a, b) a##b
#define MTA_CAT(a, b) MTA_CAT_(a, b)

// --- lambda style (short) -----------------------------------------------------

#define MTA_LUA_FUNC_IMPL(Name, Description, Function, Counter)     [[maybe_unused]] static const bool MTA_CAT(mta_func_registered_, Counter) =         ::mta::lua::detail::register_typed<Counter>((Name), (Description), (Function))

// MTA_LUA_FUNC("name", "description", lambda-function);
#define MTA_LUA_FUNC(Name, Description, Function)     MTA_LUA_FUNC_IMPL((Name), (Description), (Function), __COUNTER__)

// --- body style (main) ---------------------------------------------------------

#define MTA_LUA_FUNCTION_IMPL(Name, Description, Counter)     static int MTA_CAT(mta_body_, Counter)(lua_State * L);     [[maybe_unused]] static const bool MTA_CAT(mta_registered_, Counter) =         ::mta::lua::detail::register_function(             (Name), (Description),             +[](lua_State * L) -> int {                 return ::mta::lua::protected_call_named(L, &MTA_CAT(mta_body_, Counter), (Name));             });     static int MTA_CAT(mta_body_, Counter)(lua_State * L)

// MTA_LUA_FUNCTION("name", "description") { body; arguments via args<...> }
#define MTA_LUA_FUNCTION(Name, Description)     MTA_LUA_FUNCTION_IMPL((Name), (Description), __COUNTER__)

// --- developer-facing facade spelling ------------------------------------------------------

// MTA_FUNCTION is the developer-facing registration macro: the
// function is registered under EXACTLY the given name -- the SDK never adds
// prefixes or namespaces.
//
//     MTA_FUNCTION("sum", [](double a, double b) { return a + b; });
//     MTA_FUNCTION("crypto.sha256", "Hashes a string.", [](std::string v) { ... });
//
// Two forms:
//   MTA_FUNCTION(name, function)                    -- no description
//   MTA_FUNCTION(name, "description", function)     -- with description
// (A description containing commas must be wrapped in parentheses, like any
// macro argument.)
#define MTA_FUNCTION_CHOOSER_(_1, _2, _3, NAME, ...) NAME
#define MTA_FUNCTION(...)     MTA_FUNCTION_CHOOSER_(__VA_ARGS__, MTA_FUNCTION_DESCRIBED_, MTA_FUNCTION_SIMPLE_)(__VA_ARGS__)

#define MTA_FUNCTION_SIMPLE_(Name, Function)     MTA_LUA_FUNC_IMPL((Name), "", (Function), __COUNTER__)

#define MTA_FUNCTION_DESCRIBED_(Name, Description, Function)     MTA_LUA_FUNC_IMPL((Name), (Description), (Function), __COUNTER__)