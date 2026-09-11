#pragma once

// userdata/metatables: objects with methods and automatic memory release.
//
// A type is declared ONCE with a stable, compiler-independent identity and
// registered with the module name prefix:
//
//     struct Counter { double value = 0; };
//
//     // Stable type id: the metatable name becomes "mta.<module>.counter"
//     // regardless of the compiler (no typeid(T).name() identity).
//     MTA_OBJECT("counter", Counter)
//
//     // Register the methods (once per process; Registry calls them once
//     // per VM):
//     void register_counter_methods(lua_State *L)
//     {
//         MTA_METHOD(Counter, "get", [](Counter &self) { return self.value; });
//         MTA_METHOD(Counter, "set", [](Counter &self, double v) { self.value = v; });
//     }
//     const bool _ = mta::userdata::Registry<Counter>::set_methods(&register_counter_methods);
//
//     // Create an object from a module function:
//     MTA_LUA_FUNCTION("counter_create", "Creates a counter.")
//     {
//         auto [value] = mta::lua::args<double>(L);
//         mta::userdata::Registry<Counter>::create(L, Counter{value});
//         return 1;
//     }
//
//     -- Lua:
//     local c = counter_create(42)
//     c:get()   -- 42
//     c:set(100)
//     c = nil   -- __gc calls ~Counter()
//
// The identity is deterministic, stable and compiler-independent when
// declared via MTA_OBJECT, and module-aware: two different modules built
// from this SDK cannot collide on the same type name. A type without an
// explicit name falls back to a compiler-dependent identity and logs a
// warning -- use MTA_OBJECT in new code.
//
// Introspection: every MTA_METHOD call records the method's
// name and derived signature (self excluded) into MethodInfo records; types
// named with MTA_OBJECT are listed in mta::userdata::object_types(). The
// docs generator (other/tools/docgen.cpp) materializes the types in a
// scratch VM and lists the object methods from these records.

#include "sdk/abi/module.hpp"
#include "sdk/bind/bind.hpp"
#include "sdk/logging/logging.hpp"
#include "sdk/lua/protect.hpp"

#include <string>
#include <type_traits>
#include <typeinfo>
#include <utility>
#include <vector>

namespace mta::userdata
{
// Method metadata recorded at every MTA_METHOD call: the self
// parameter is not part of the signature. Consumed by the docs generator
// (other/tools/docgen.cpp) and future tooling; independent of any VM.
struct MethodInfo
{
    std::string name;
    mta::lua::Signature signature;
};

// Introspection handle for one object type declared with MTA_OBJECT
//: tooling without a VM lists the methods registered through
// MTA_METHOD through it. `materialize` runs the lazy metatable + method
// registration in the given VM; `methods` returns the recorded metadata.
struct ObjectTypeInfo
{
    std::string type;
    void (*materialize)(lua_State *);
    const std::vector<MethodInfo> &(*methods)();
};

// (internal) registration path; the public object_types() below stays
// read-only (introspection never mutates the registry).
[[nodiscard]] inline std::vector<ObjectTypeInfo> &object_types_mutable() noexcept
{
    static std::vector<ObjectTypeInfo> types;
    return types;
}

// Every object type registered through MTA_OBJECT in this process, in
// registration order. Types without an explicit MTA_OBJECT name are not
// listed: their identity would be compiler-dependent.
[[nodiscard]] inline const std::vector<ObjectTypeInfo> &object_types() noexcept
{
    return object_types_mutable();
}

template <typename T>
class Registry
{
public:
    // Function that registers the type's methods (called once per VM).
    using Registrar = void (*)(lua_State *);

    // Sets the explicit type identity: stable, deterministic,
    // compiler-independent. Returns true (usable as a static initializer,
    // which is what the MTA_OBJECT macro does). The first call wins; later
    // conflicting calls are a programming error and are ignored with a log.
    // The first successful naming also lists the type in object_types()
    //.
    static bool set_type_name(const char *name)
    {
        if (name == nullptr || *name == '\0')
        {
            mta::log::error("MTA_OBJECT: an empty type name is not allowed");
            return false;
        }
        auto &stored = type_name_();
        if (stored.empty())
        {
            stored = name;
            register_type_();
            return true;
        }
        if (stored == name)
        {
            return true;
        }
        mta::log::error("MTA_OBJECT: type identity '", stored, "' is already set; ignoring '",
                        name, "'");
        return false;
    }

    // Sets the method registrar. Call once (e.g. from a static initializer)
    // before the first create/check.
    static void set_methods(Registrar registrar)
    {
        registrar_() = registrar;
    }

    // Registers the metatable in THIS VM (lazily) and calls the registrar.
    static void ensure(lua_State *L)
    {
        luaL_getmetatable(L, identity());
        if (!lua_isnil(L, -1))
        {
            lua_pop(L, 1);
            return;
        }
        lua_pop(L, 1);

        luaL_newmetatable(L, identity());

        // __gc -- the object destructor.
        lua_pushcfunction(L, &gc_metamethod);
        lua_setfield(L, -2, "__gc");

        // __index -- the method table.
        lua_newtable(L);
        lua_setfield(L, -2, "__index");

        lua_pop(L, 1);

        // Methods are registered in this VM (every resource has its own
        // lua_State).
        if (registrar_() != nullptr)
        {
            registrar_()(L);
        }
    }

    // Creates T as userdata on the stack and attaches the metatable. Returns T*.
    static T *create(lua_State *L, T value)
    {
        ensure(L);
        void *memory = lua_newuserdata(L, sizeof(T));
        const int userdata_index = lua_gettop(L);
        T *object = nullptr;
        try {
            object = new (memory) T(std::move(value));
        } catch (...) {
            lua_remove(L, userdata_index);  // remove raw userdata before re-throwing
            throw;
        }
        luaL_getmetatable(L, identity());
        lua_setmetatable(L, -2);
        return object;
    }

    // Validates userdata at the index; throws a readable error on a mismatch.
    static T *check(lua_State *L, int index)
    {
        if (lua_type(L, index) != LUA_TUSERDATA)
        {
            mta::lua::detail::bad_argument_type(index, expected_name(),
                                                mta::lua::detail::type_name(lua_type(L, index)));
        }

        if (lua_getmetatable(L, index) == 0)
        {
            mta::errors::raise_error(
                ::mta::errors::Category::InvalidObject, "bad argument #", index, " (expected ",
                expected_name(), ", got object without a metatable)");
        }
        luaL_getmetatable(L, identity());
        const bool matches = lua_rawequal(L, -1, -2) != 0;
        lua_pop(L, 2);

        if (!matches)
        {
            mta::errors::raise_error(::mta::errors::Category::InvalidObject, "bad argument #",
                                     index, " (expected ", expected_name(), ", got object of "
                                                                            "another type)");
        }

        return static_cast<T *>(lua_touserdata(L, index));
    }

    // Method metadata recorded at MTA_METHOD calls, in
    // registration order. The registrar runs once per VM that uses the
    // type, so records are deduplicated by name.
    [[nodiscard]] static const std::vector<MethodInfo> &method_list() noexcept
    {
        return methods_();
    }

    // Registers a method (obj:method(...)). Tag is unique per call site.
    template <std::size_t Tag, typename F>
    static void add_method(lua_State *L, const char *name, F fn)
    {
        method_holder<Tag, F>::fn = std::move(fn);
        method_holder<Tag, F>::registered_name = name;
        // Metadata for the docs generator: derived from F with
        // the self parameter skipped; recording is independent of the VM.
        record_method(name, mta::lua::detail::method_signature_of<F>());

        ensure(L);
        luaL_getmetatable(L, identity());
        lua_getfield(L, -1, "__index");
        // lua_pushcclosure directly: the lua_pushcfunction macro cannot cope
        // with a comma in template arguments like method_holder<Tag, F>.
        lua_pushcclosure(L, &method_holder<Tag, F>::trampoline, 0);
        lua_setfield(L, -2, name);
        lua_pop(L, 2);
    }

private:
    // Adds this type to the process-wide introspection list: the
    // docs generator lists object methods through it. Called once, by
    // set_type_name on the first successful naming -- the registrar may not
    // be set yet; the stored callbacks read the current state at call time.
    static void register_type_()
    {
        object_types_mutable().push_back(ObjectTypeInfo{
            type_name_(),
            [](lua_State *vm) { ensure(vm); },
            []() -> const std::vector<MethodInfo> & { return methods_(); },
        });
    }

    static Registrar &registrar_()
    {
        static Registrar registrar = nullptr;
        return registrar;
    }

    static std::string &type_name_()
    {
        static std::string name;
        return name;
    }

    static std::vector<MethodInfo> &methods_()
    {
        static std::vector<MethodInfo> records;
        return records;
    }

    // Records one method's metadata for tooling. Deduplicated by
    // name: ensure() runs the registrar in every VM that uses the type.
    static void record_method(const char *name, mta::lua::Signature signature)
    {
        auto &records = methods_();
        for (const auto &record : records)
        {
            if (record.name == name)
            {
                return;
            }
        }
        records.push_back(MethodInfo{name == nullptr ? std::string() : std::string(name),
                                     std::move(signature)});
    }

    // The metatable identity: module-aware, deterministic, and
    // stable when the type name was declared with MTA_OBJECT. Computed once
    // per process; the module name never changes after initialization.
    static const char *identity()
    {
        static const std::string name = [] {
            const std::string module = mta::module::info().name;
            const std::string &explicit_name = type_name_();
            if (!explicit_name.empty())
            {
                return "mta." + module + "." + explicit_name;
            }
            mta::log::warn("MTA_OBJECT: type ", typeid(T).name(),
                           " has no explicit type name; using a compiler-dependent fallback "
                           "identity (declare the type with MTA_OBJECT)");
            return "mta." + module + ".userdata." + std::string(typeid(T).name());
        }();
        return name.c_str();
    }

    // How the type is named in argument errors: the declared type id, or a
    // generic "module object" when no explicit name was set.
    static const char *expected_name()
    {
        const std::string &explicit_name = type_name_();
        return explicit_name.empty() ? "module object" : explicit_name.c_str();
    }

    static int gc_metamethod(lua_State *L)
    {
        T *object = static_cast<T *>(lua_touserdata(L, 1));
        object->~T();
        return 0;
    }

    template <std::size_t Tag, typename F>
    struct method_holder
    {
        static inline F fn{};
        static inline const char *registered_name = nullptr;

        // Deliberately NOT noexcept: protected_call_named ends in
        // luaL_error (longjmp) and a longjmp out of a noexcept function is
        // a fail-fast crash on MSVC — same rule as protect.hpp.
        static int trampoline(lua_State *L)
        {
            // Name the running method and record the resource: argument
            // errors render "bad argument #2 to 'set' (expected number, got
            // string)" and log messages carry the call site.
            return mta::lua::protected_call_named(L, &method_holder<Tag, F>::call, registered_name);
        }

        static int call(lua_State *L)
        {
            T *self = Registry<T>::check(L, 1);
            return invoke_method(L, self, fn);
        }
    };

    // Calls fn(*self, args...), with args read from the stack starting at 2.
    template <typename F>
    static int invoke_method(lua_State *L, T *self, F &fn)
    {
        using traits = mta::lua::detail::callable_traits<F>;
        using args_type = typename traits::args;
        using result_type = typename traits::result;
        constexpr std::size_t arity = traits::arity;

        static_assert(arity >= 1, "a method must take self as its first parameter");

        std::size_t index = 2;
        auto args = [&index, L]<std::size_t... I>(std::index_sequence<I...>) {
            // I + 1 skips self (the first signature parameter).
            return std::tuple{
                mta::lua::detail::pull_param<std::tuple_element_t<I + 1, args_type>>(L, index)...};
        }(std::make_index_sequence<arity - 1>{});

        if constexpr (std::is_void_v<result_type>)
        {
            std::apply([&](auto &&...a) { fn(*self, std::forward<decltype(a)>(a)...); },
                       std::move(args));
            return 0;
        }
        else
        {
            return mta::lua::detail::push_result(
                L, std::apply([&](auto &&...a) { return fn(*self, std::forward<decltype(a)>(a)...); },
                              std::move(args)));
        }
    }
};
} // namespace mta::userdata

// Declares an object type with a stable, compiler-independent identity
//: MTA_OBJECT("counter", Counter) -- at namespace scope. The
// macro carries its own semicolon.
#define MTA_OBJECT(Name, Type) \
    static const bool mta_object_registered_##Type = \
        ::mta::userdata::Registry<Type>::set_type_name((Name));

// Registers an object method: MTA_METHOD(Type, "name", lambda);
// The lambda takes self (Type&) as its first parameter.
#define MTA_METHOD(Type, Name, Fn)     ::mta::userdata::Registry<Type>::add_method<__COUNTER__>(L, (Name), (Fn))