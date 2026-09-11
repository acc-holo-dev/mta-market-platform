#pragma once

// Typed binder for Lua functions -- the module's main API.
//
//     MTA_LUA_FUNC("my_sum", "Adds two numbers.",
//         [](double a, double b) { return a + b; });
//
// Parameter types are read straight from the signature: the framework checks
// arguments itself, produces a readable Lua error on a type mismatch and
// returns the result to Lua automatically. No indices, check_* or manual
// push_results are needed.
//
// Supported parameter types:
//   double / float          number
//   bool                    boolean
//   int / int64_t / ...     integer (range-checked)
//   std::string             string
//   std::string_view        string without copying (valid until call end)
//   mta::lua::Argument      any value (tables are read recursively)
//   mta::lua::Table         table (error if a non-table was passed)
//   mta::async::Callback    Lua function (stable reference to it)
//   std::optional<T>        optional argument: nil/absent -> nullopt
//   mta::lua::rest_args     trailing (variadic) arguments, last parameter only
//   mta::lua::context       VM and resource name; takes NO Lua argument
//   mta::Resource           name of a running resource, validated live
//
// Optional parameters may also be written with plain C++ defaults:
//
//     MTA_LUA_FUNC("my_greet", "Greets a name.",
//         [](std::string name, std::string greeting = "hi") {
//             return greeting + ", " + name;
//         });
//
// Result types: any value-parameter type, plus
//   void                       return nothing
//   std::tuple / std::pair     several results
//   std::vector<T>             elements are expanded into a result list
//   std::optional<T>           nil when the value is absent
//   mta::lua::Arguments        a whole result list
//   mta::Resource              pushed as its name (the stable Lua identity)

#include "sdk/lua/argument.hpp"
#include "sdk/lua/arguments.hpp"
#include "sdk/lua/protect.hpp"
#include "sdk/lua/stack.hpp"
#include "sdk/abi/module.hpp"
#include "sdk/native/resource.hpp"
#include "sdk/runtime/callback.hpp"

#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <utility>
#include <vector>

namespace mta::lua
{
// Trailing (variadic) arguments: the function's last parameter catches
// everything passed beyond the fixed arguments.
struct rest_args
{
    Arguments values;
};

// Call context: VM and the name of the calling resource. A parameter of this
// type consumes no Lua argument and may appear anywhere in the signature.
struct context
{
    lua_State *vm = nullptr;
    std::string resource;
};

// Signature metadata for one parameter.
struct ArgumentInfo
{
    std::string type;
    bool optional = false;
};

// Signature metadata of a registered function. `derived` is
// false when the metadata could not be derived from C++ (body-style
// functions: the types live inside the body).
struct Signature
{
    std::vector<ArgumentInfo> arguments;
    std::vector<std::string> returns; // empty = returns nothing / unknown
    bool variadic = false;            // trailing rest_args parameter
    bool derived = false;

    // Capability flags derived together with the arguments:
    // function_flag_* bits below. The registration bridge copies them into
    // Spec::flags; object methods keep them in their recorded signature.
    std::uint32_t flags = 0;
};

// Capability flags: what the binder derived from the C++ signature
// at registration. Rendered by the docs generator (other/tools/docgen.cpp).
inline constexpr std::uint32_t function_flag_variadic = 1u << 0; // trailing rest_args parameter
inline constexpr std::uint32_t function_flag_callback = 1u << 1; // takes a Lua function argument

namespace detail
{
// --- callable signature -------------------------------------------------------

template <typename R, typename... Args>
struct callable_traits_base
{
    using result = R;
    using args = std::tuple<Args...>;
    static constexpr std::size_t arity = sizeof...(Args);
};

template <typename T>
struct callable_traits;

template <typename R, typename... Args>
struct callable_traits<R (*)(Args...)> : callable_traits_base<R, Args...>
{
};

template <typename R, typename... Args>
struct callable_traits<R (&)(Args...)> : callable_traits_base<R, Args...>
{
};

template <typename F>
struct callable_traits : callable_traits<decltype(&F::operator())>
{
};

template <typename F, typename R, typename... Args>
struct callable_traits<R (F::*)(Args...) const> : callable_traits_base<R, Args...>
{
};

template <typename F, typename R, typename... Args>
struct callable_traits<R (F::*)(Args...)> : callable_traits_base<R, Args...>
{
};

template <typename F, typename R, typename... Args>
struct callable_traits<R (F::*)(Args...) const noexcept> : callable_traits_base<R, Args...>
{
};

template <typename F, typename R, typename... Args>
struct callable_traits<R (F::*)(Args...) noexcept> : callable_traits_base<R, Args...>
{
};

// --- parameter classification --------------------------------------------------

template <typename T>
inline constexpr bool is_optional_v = false;
template <typename T>
inline constexpr bool is_optional_v<std::optional<T>> = true;

template <typename T>
inline constexpr bool is_rest_v = false;
template <>
inline constexpr bool is_rest_v<rest_args> = true;

// A parameter that requires an explicit Lua argument: not optional, not rest
// and not context.
template <typename T>
inline constexpr bool is_required_param_v =
    !is_optional_v<T> && !is_rest_v<T> && !std::is_same_v<T, context>;

// Result container traits (used by the result pusher and by the signature
// metadata below).
template <typename T>
struct is_tuple_like : std::false_type
{
};
template <typename... Ts>
struct is_tuple_like<std::tuple<Ts...>> : std::true_type
{
};
template <typename A, typename B>
struct is_tuple_like<std::pair<A, B>> : std::true_type
{
};

template <typename T>
struct is_vector : std::false_type
{
};
template <typename T, typename A>
struct is_vector<std::vector<T, A>> : std::true_type
{
};

// --- signature metadata ----------------------------------------------------------

// Lua-facing name of a parameter type: used for error messages and
// for the registry's signature metadata. Returns the name the binder's
// checkers actually report; unsupported types map to "value".
template <typename T>
consteval const char *lua_type_name()
{
    using U = std::remove_cvref_t<T>;
    if constexpr (std::is_same_v<U, bool>)
        return "boolean";
    else if constexpr (std::is_same_v<U, mta::async::Callback>)
        return "function";
    else if constexpr (std::is_floating_point_v<U>)
        return "number";
    else if constexpr (std::is_integral_v<U>)
        return "integer";
    else if constexpr (std::is_same_v<U, std::string> || std::is_same_v<U, std::string_view>)
        return "string";
    else if constexpr (std::is_same_v<U, Table>)
        return "table";
    else if constexpr (std::is_same_v<U, mta::Resource>)
        return "resource";
    else if constexpr (std::is_same_v<U, Argument> || std::is_same_v<U, Arguments>)
        return "any";
    else if constexpr (is_optional_v<U>)
        return lua_type_name<typename U::value_type>();
    else
        return "value";
}

template <typename T>
void fill_argument_info(Signature &signature)
{
    using U = std::remove_cvref_t<T>;
    if constexpr (std::is_same_v<U, context>)
    {
        // context takes no Lua argument: not part of the signature.
    }
    else if constexpr (std::is_same_v<U, rest_args>)
    {
        signature.variadic = true;
        signature.flags |= function_flag_variadic;
    }
    else
    {
        if constexpr (std::is_same_v<U, mta::async::Callback>)
        {
            signature.flags |= function_flag_callback;
        }
        signature.arguments.push_back(
            ArgumentInfo{std::string(lua_type_name<U>()), is_optional_v<U>});
    }
}

template <typename T>
void fill_return_type(std::vector<std::string> &returns)
{
    using U = std::remove_cvref_t<T>;
    if constexpr (std::is_void_v<U>)
    {
        // returns nothing
    }
    else if constexpr (is_vector<U>::value)
    {
        returns.push_back(lua_type_name<typename U::value_type>());
        returns.push_back("...");
    }
    else if constexpr (is_tuple_like<U>::value)
    {
        [&returns]<std::size_t... I>(std::index_sequence<I...>) {
            (returns.push_back(lua_type_name<std::tuple_element_t<I, U>>()), ...);
        }(std::make_index_sequence<std::tuple_size_v<U>>{});
    }
    else if constexpr (is_optional_v<U>)
    {
        returns.push_back(std::string(lua_type_name<typename U::value_type>()) + " or nil");
    }
    else if constexpr (std::is_same_v<U, Arguments>)
    {
        returns.push_back("...");
    }
    else
    {
        returns.push_back(lua_type_name<U>());
    }
}

template <typename F, std::size_t... I>
Signature signature_impl(std::index_sequence<I...>)
{
    Signature signature;
    signature.derived = true;
    (fill_argument_info<std::remove_cvref_t<std::tuple_element_t<I, typename callable_traits<F>::args>>>(
         signature),
     ...);
    fill_return_type<typename callable_traits<F>::result>(signature.returns);
    return signature;
}

template <typename F>
Signature signature_of()
{
    return signature_impl<F>(std::make_index_sequence<callable_traits<F>::arity>{});
}

// Signature of an object method (objects/userdata.hpp): the self parameter
// (the first one) is not part of the Lua-facing signature -- the method is
// called as obj:method(...).
template <typename F>
Signature method_signature_of()
{
    using args_type = typename callable_traits<F>::args;
    constexpr std::size_t arity = callable_traits<F>::arity;
    static_assert(arity >= 1, "a method must take self as its first parameter");
    Signature signature;
    signature.derived = true;
    [&signature]<std::size_t... I>(std::index_sequence<I...>) {
        (fill_argument_info<std::remove_cvref_t<std::tuple_element_t<I + 1, args_type>>>(signature),
         ...);
    }(std::make_index_sequence<arity - 1>{});
    fill_return_type<typename callable_traits<F>::result>(signature.returns);
    return signature;
}

// --- reading a single argument --------------------------------------------------

template <typename T>
T pull_arg(lua_State *L, int index)
{
    using U = std::remove_cvref_t<T>;

    if constexpr (std::is_same_v<U, Argument>)
    {
        Argument value;
        value.read(L, index);
        return value;
    }
    else if constexpr (std::is_same_v<U, Table>)
    {
        const int normalized = normalize_index(L, index);
        const int type_value = lua_type(L, normalized);
        if (type_value == LUA_TNONE)
        {
            detail::bad_argument_missing(index, "table");
        }
        if (type_value != LUA_TTABLE)
        {
            detail::bad_argument_type(index, "table", detail::type_name(type_value));
        }
        Argument value;
        value.read(L, normalized);
        return std::move(value.as_table());
    }
    else if constexpr (std::is_same_v<U, mta::async::Callback>)
    {
        const int normalized = normalize_index(L, index);
        const int type_value = lua_type(L, normalized);
        if (type_value == LUA_TNONE)
        {
            detail::bad_argument_missing(index, "function");
        }
        if (type_value != LUA_TFUNCTION)
        {
            detail::bad_argument_type(index, "function", detail::type_name(type_value));
        }
        return mta::async::Callback::from_stack(L, index);
    }
    else if constexpr (is_optional_v<U>)
    {
        using inner_type = typename U::value_type;
        const int type_value = lua_type(L, normalize_index(L, index));
        if (type_value == LUA_TNONE || type_value == LUA_TNIL)
        {
            return U{};
        }
        return U{pull_arg<inner_type>(L, index)};
    }
    else if constexpr (std::is_same_v<U, rest_args>)
    {
        rest_args rest;
        rest.values.read(L, index);
        return rest;
    }
    else if constexpr (std::is_same_v<U, mta::Resource>)
    {
        // Native MTA objects: a Resource is named in Lua -- the
        // only identity the frozen module ABI provides -- and validated LIVE
        // through the module manager (Resource::find, the precedent of
        // resource.cpp). An unknown or already stopped resource is a
        // readable argument error, never a dangling wrapper.
        const int normalized = normalize_index(L, index);
        const int type_value = lua_type(L, normalized);
        if (type_value == LUA_TNONE)
        {
            detail::bad_argument_missing(index, "resource");
        }
        // Strictly a string: a resource name is an identity, so numbers are
        // NOT coerced into it (unlike check_string) -- the type error is the
        // more diagnostic message.
        if (type_value != LUA_TSTRING)
        {
            detail::bad_argument_type(index, "resource", detail::type_name(type_value));
        }
        std::size_t length = 0;
        const char *text = lua_tolstring(L, normalized, &length);
        const std::string name(text ? text : "", length);
        std::optional<mta::Resource> resource = mta::Resource::find(name);
        if (!resource.has_value())
        {
            detail::bad_argument_object(index, ("no running resource '" + name + "'").c_str());
        }
        return std::move(*resource);
    }
    else if constexpr (std::is_same_v<U, bool>)
    {
        return check_boolean(L, index);
    }
    else if constexpr (std::is_same_v<U, std::string>)
    {
        return check_string(L, index);
    }
    else if constexpr (std::is_same_v<U, std::string_view>)
    {
        // The string lives in Lua until the call ends; no copy is needed.
        const int normalized = normalize_index(L, index);
        const int type_value = lua_type(L, normalized);
        if (type_value == LUA_TNONE)
        {
            detail::bad_argument_missing(index, "string");
        }
        if (lua_isstring(L, normalized) == 0)
        {
            detail::bad_argument_type(index, "string", detail::type_name(type_value));
        }
        std::size_t length = 0;
        const char *text = lua_tolstring(L, normalized, &length);
        return std::string_view{text ? text : "", length};
    }
    else if constexpr (std::is_same_v<U, float>)
    {
        return static_cast<float>(check_number(L, index));
    }
    else if constexpr (std::is_same_v<U, double> || std::is_same_v<U, lua_Number>)
    {
        return static_cast<U>(check_number(L, index));
    }
    else if constexpr (std::is_integral_v<U> && !std::is_same_v<U, bool> && !std::is_same_v<U, char> &&
                       !std::is_same_v<U, wchar_t>)
    {
        const lua_Integer value = check_integer(L, index);
        if constexpr (std::is_unsigned_v<U>)
        {
            if (value < 0 || static_cast<std::uint64_t>(value) >
                                 static_cast<std::uint64_t>(std::numeric_limits<U>::max()))
            {
                detail::bad_argument_value(index, "value out of range");
            }
        }
        else
        {
            if (value < static_cast<lua_Integer>(std::numeric_limits<U>::min()) ||
                value > static_cast<lua_Integer>(std::numeric_limits<U>::max()))
            {
                detail::bad_argument_value(index, "value out of range");
            }
        }
        return static_cast<U>(value);
    }
    else
    {
        static_assert(!sizeof(U), "binder: unsupported parameter type; allowed: bool, int, "
                                  "double, float, std::string, std::string_view, "
                                  "std::optional<T>, mta::lua::Argument, mta::lua::Table, "
                                  "mta::async::Callback, mta::lua::rest_args, mta::lua::context, "
                                  "mta::Resource");
    }
}

// Reads a parameter, honoring context (which consumes no Lua argument).
template <typename T>
T pull_param(lua_State *L, std::size_t &index)
{
    using U = std::remove_cvref_t<T>;

    if constexpr (std::is_same_v<U, context>)
    {
        context ctx;
        ctx.vm = L;
        ctx.resource = mta::module::current_resource_name(L);
        return ctx;
    }
    else
    {
        return pull_arg<U>(L, static_cast<int>(index++));
    }
}

// --- result layout --------------------------------------------------------------

template <typename T>
int push_result(lua_State *L, T &&value)
{
    using U = std::remove_cvref_t<T>;

    if constexpr (is_optional_v<U>)
    {
        if (!value.has_value())
        {
            lua_pushnil(L);
            return 1;
        }
        return push_result(L, *value);
    }
    else if constexpr (is_tuple_like<U>::value)
    {
        return std::apply(
            [L](auto &&...elements) {
                return (push_result(L, std::forward<decltype(elements)>(elements)) + ... + 0);
            },
            std::forward<T>(value));
    }
    else if constexpr (is_vector<U>::value)
    {
        int pushed = 0;
        for (auto &element : value)
        {
            pushed += push_result(L, element);
        }
        return pushed;
    }
    else if constexpr (std::is_same_v<U, Arguments>)
    {
        // Arguments is a RESULT LIST: push all of them and return the count.
        return value.push(L);
    }
    else
    {
        push_one(L, std::forward<T>(value));
        return 1;
    }
}

// --- arity and invocation ----------------------------------------------------------

// Closure storage; defined below.
template <std::size_t Tag, typename F>
struct holder;

// Calls f with the first K parameters; missing ones are synthesized
// (optional -> nullopt, rest -> empty); C++ defaults are applied by the
// compiler itself.
template <std::size_t Tag, typename F, std::size_t K>
int invoke_prefix(lua_State *L)
{
    using args_type = typename callable_traits<F>::args;
    using result_type = typename callable_traits<F>::result;

    std::size_t next_index = 1;
    auto args = [&next_index, L]<std::size_t... I>(std::index_sequence<I...>) {
        return std::tuple{pull_param<std::tuple_element_t<I, args_type>>(L, next_index)...};
    }(std::make_index_sequence<K>{});

    if constexpr (std::is_void_v<result_type>)
    {
        std::apply(holder<Tag, F>::stored, std::move(args));
        return 0;
    }
    else
    {
        return push_result(L, std::apply(holder<Tag, F>::stored, std::move(args)));
    }
}

// Can f be invoked with the first J parameters (C++ defaults included)?
template <typename F, std::size_t J, std::size_t... I>
constexpr bool prefix_invocable_impl(std::index_sequence<I...>)
{
    using args_type = typename callable_traits<F>::args;
    return std::is_invocable_v<F, std::tuple_element_t<I, args_type>...>;
}

template <typename F, std::size_t J>
constexpr bool prefix_invocable_v = prefix_invocable_impl<F, J>(std::make_index_sequence<J>{});

// required_counts[J] -- how many of the first J parameters require an explicit
// Lua argument (not optional, not rest, not context).
template <typename F, std::size_t... I>
constexpr std::array<std::size_t, sizeof...(I) + 1> required_counts_impl(std::index_sequence<I...>)
{
    using args_type = typename callable_traits<F>::args;
    std::array<std::size_t, sizeof...(I) + 1> counts{};
    std::size_t running = 0;
    ((counts[I] = running,
      running += is_required_param_v<std::remove_cvref_t<std::tuple_element_t<I, args_type>>>),
     ...);
    counts[sizeof...(I)] = running;
    return counts;
}

struct dispatch_entry
{
    int (*invoke)(lua_State *);
    bool invocable;
};

template <std::size_t Tag, typename F, std::size_t J>
struct dispatch_slot
{
    static constexpr bool invocable = prefix_invocable_v<F, J>;

    static int invoke(lua_State *L)
    {
        if constexpr (invocable)
        {
            return invoke_prefix<Tag, F, J>(L);
        }
        else
        {
            // Unreachable: slots without invocable are never selected. Keep
            // the message in the plan §7 format so it can never regress into
            // the old "argument #N is missing" wording.
            raise_error("bad argument count to '", detail::current_function_name(),
                        "' (expected at least ", J + 1, " arguments, got ", lua_gettop(L), ")");
        }
    }
};

template <std::size_t Tag, typename F, std::size_t... Js>
constexpr std::array<dispatch_entry, sizeof...(Js)> make_dispatch_table_impl(
    std::index_sequence<Js...>)
{
    return std::array<dispatch_entry, sizeof...(Js)>{
        dispatch_entry{&dispatch_slot<Tag, F, Js>::invoke, dispatch_slot<Tag, F, Js>::invocable}...};
}

// Function storage: a static copy of the closure plus the entry point for Lua.
template <std::size_t Tag, typename F>
struct holder
{
    static inline F stored{};
    static inline const char *registered_name = nullptr;

    using traits = callable_traits<F>;
    static constexpr std::size_t arity = traits::arity;

    static constexpr auto table =
        make_dispatch_table_impl<Tag, F>(std::make_index_sequence<arity + 1>{});
    static constexpr auto required_counts =
        required_counts_impl<F>(std::make_index_sequence<arity>{});

    static int entry(lua_State *L) noexcept
    {
        // Name the running function and record its resource once per call:
        // argument errors render "bad argument #N to '<name>' (expected ...,
        // got ...)" and log messages carry the call site (see the
        // diagnostic context in protect.hpp).
        return protected_call_named(L, &holder<Tag, F>::dispatch, registered_name);
    }

    static int dispatch(lua_State *L)
    {
        const std::size_t k = static_cast<std::size_t>(lua_gettop(L));
        for (std::size_t J = arity + 1; J-- > 0;)
        {
            if (table[J].invocable && required_counts[J] <= k)
            {
                return table[J].invoke(L);
            }
        }
        // No arity matched: the first missing/invalid parameter in pull order
        // produces the typed error.
        return error_probe(L);
    }

    // Reads every parameter just to produce a readable error; synthesized
    // parameters are read silently.
    static int error_probe(lua_State *L)
    {
        using args_type = typename traits::args;
        std::size_t index = 1;
        [&index, L]<std::size_t... I>(std::index_sequence<I...>) {
            ((void)pull_param<std::remove_cvref_t<std::tuple_element_t<I, args_type>>>(L, index),
             ...);
        }(std::make_index_sequence<arity>{});
        // Every parameter pulled successfully (optionals synthesized) yet no
        // arity matched: report the count itself.
        if (const char *name = detail::current_function_name())
        {
            ::mta::errors::raise_error(
                ::mta::errors::Category::InvalidArgument, "bad argument count to '", name,
                "' (expected at least ", required_counts[arity], " arguments, got ", lua_gettop(L),
                ")");
        }
        ::mta::errors::raise_error(::mta::errors::Category::InvalidArgument,
                                   "bad argument count (expected at least ", required_counts[arity],
                                   " arguments, got ", lua_gettop(L), ")");
        // raise_error always longjmps; unreachable, closes the exit path.
        return 0;
    }
};

// rest_args may only be the last parameter.
template <typename F, std::size_t... I>
constexpr bool rest_only_last_impl(std::index_sequence<I...>)
{
    using args_type = typename callable_traits<F>::args;
    constexpr std::size_t n = sizeof...(I);
    bool ok = true;
    ((ok = ok && (I + 1 == n || !is_rest_v<std::remove_cvref_t<std::tuple_element_t<I, args_type>>>)),
     ...);
    return ok;
}

template <typename F>
constexpr bool rest_only_last_v = rest_only_last_impl<F>(
    std::make_index_sequence<callable_traits<F>::arity>{});

// Adds a function to the registry (implemented in registry/registry.cpp).
bool register_function(const char *name, const char *description, int (*entry)(lua_State *),
                       const Signature &signature = {});

// Registers a typed function; Tag is a unique number per call site.
template <std::size_t Tag, typename F>
bool register_typed(const char *name, const char *description, F function)
{
    using G = std::decay_t<F>;

    static_assert(rest_only_last_v<G>, "rest_args may only be the last parameter");
    static_assert(std::is_assignable_v<decltype(holder<Tag, G>::stored) &, G>,
                  "MTA_LUA_FUNC lambdas must be assignable (no non-copyable captures); "
                  "use MTA_LUA_FUNCTION body-style for captures or complex state");

    holder<Tag, G>::stored = std::move(function);
    holder<Tag, G>::registered_name = name;
    return register_function(name, description, &holder<Tag, G>::entry, signature_of<G>());
}
} // namespace detail

// Reads typed arguments (1..N) as a tuple -- for structured bindings:
//
//     auto [a, b] = mta::lua::args<double, double>(L);
//
// Types are validated automatically; optional<T> accepts nil/absence.
// Extra arguments are ignored; missing ones produce a readable Lua error.
template <typename... Ts>
std::tuple<Ts...> args(lua_State *L)
{
    std::size_t index = 1;
    return std::tuple<Ts...>{detail::pull_param<Ts>(L, index)...};
}
} // namespace mta::lua
