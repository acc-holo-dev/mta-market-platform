#pragma once

// Convenient, type-safe access to the Lua stack for module function bodies.
//
// All check_*/opt_* helpers throw exceptions (see protect.hpp) instead of
// calling luaL_error directly, so local C++ objects are destroyed properly on
// bad arguments. The push helpers grow the stack safely via lua_checkstack.
//
// Error format: while a registered module function runs, argument
// errors carry its name --
//
//     bad argument #2 to 'sum' (expected number, got no value)
//     bad argument #1 to 'sum' (expected number, got string)
//
// Outside a module call the name part is omitted. Numbers coerce to strings
// (luaL_checkstring semantics); everything else is a hard type error.

#include "sdk/lua/common.hpp"
#include "sdk/lua/protect.hpp"

#include <string>
#include <string_view>

namespace mta::lua
{
namespace detail
{
[[nodiscard]] inline int normalize_index(lua_State *L, int index) noexcept
{
    if (index >= 0)
    {
        return index;
    }
    return lua_gettop(L) + index + 1;
}

[[nodiscard]] inline const char *type_name(int lua_type_value) noexcept
{
    switch (lua_type_value)
    {
    case LUA_TNONE: return "no value";
    case LUA_TNIL: return "nil";
    case LUA_TBOOLEAN: return "boolean";
    case LUA_TLIGHTUSERDATA: return "userdata";
    case LUA_TNUMBER: return "number";
    case LUA_TSTRING: return "string";
    case LUA_TTABLE: return "table";
    case LUA_TFUNCTION: return "function";
    case LUA_TUSERDATA: return "userdata";
    default: return "unknown";
    }
}

// Renders "bad argument #N to 'name' (expected EXPECTED, got GOT)"; the
// function name part is omitted when the diagnostic context is unset.
[[noreturn]] inline void bad_argument(int index, const char *expected, const char *got,
                                      ::mta::errors::Category category)
{
    if (const char *name = current_function_name())
    {
        ::mta::errors::raise_error(category, "bad argument #", index, " to '", name,
                                   "' (expected ", expected, ", got ", got, ")");
    }
    ::mta::errors::raise_error(category, "bad argument #", index, " (expected ", expected,
                               ", got ", got, ")");
}

[[noreturn]] inline void bad_argument_type(int index, const char *expected, const char *got)
{
    bad_argument(index, expected, got, ::mta::errors::Category::InvalidType);
}

[[noreturn]] inline void bad_argument_missing(int index, const char *expected)
{
    bad_argument(index, expected, "no value", ::mta::errors::Category::MissingArgument);
}

// "bad argument #N to 'name' (DETAIL)" for constraint violations that are not
// plain type mismatches (value ranges, whole numbers).
[[noreturn]] inline void bad_argument_value(int index, const char *detail_text)
{
    if (const char *name = current_function_name())
    {
        ::mta::errors::raise_error(::mta::errors::Category::InvalidType, "bad argument #", index,
                                   " to '", name, "' (", detail_text, ")");
    }
    ::mta::errors::raise_error(::mta::errors::Category::InvalidType, "bad argument #", index, " (",
                               detail_text, ")");
}

// "bad argument #N to 'name' (DETAIL)" for a native object reference the
// server cannot resolve right now (e.g. an unknown or already stopped
// resource) -- a well-typed value that names no living entity.
[[noreturn]] inline void bad_argument_object(int index, const char *detail_text)
{
    if (const char *name = current_function_name())
    {
        ::mta::errors::raise_error(::mta::errors::Category::InvalidObject, "bad argument #", index,
                                   " to '", name, "' (", detail_text, ")");
    }
    ::mta::errors::raise_error(::mta::errors::Category::InvalidObject, "bad argument #", index,
                               " (", detail_text, ")");
}
} // namespace detail

[[nodiscard]] inline int arg_count(lua_State *L) noexcept
{
    return lua_gettop(L);
}

// --- Typed argument readers (throw on mismatch) ------------------------------

[[nodiscard]] inline double check_number(lua_State *L, int index)
{
    const int normalized = detail::normalize_index(L, index);
    const int type_value = lua_type(L, normalized);
    if (type_value == LUA_TNONE)
    {
        detail::bad_argument_missing(index, "number");
    }
    if (type_value != LUA_TNUMBER)
    {
        detail::bad_argument_type(index, "number", detail::type_name(type_value));
    }
    return lua_tonumber(L, normalized);
}

[[nodiscard]] inline double opt_number(lua_State *L, int index, double default_value)
{
    const int normalized = detail::normalize_index(L, index);
    const int type_value = lua_type(L, normalized);
    if (type_value == LUA_TNONE || type_value == LUA_TNIL)
    {
        return default_value;
    }
    if (type_value != LUA_TNUMBER)
    {
        detail::bad_argument_type(index, "number or nil", detail::type_name(type_value));
    }
    return lua_tonumber(L, normalized);
}

[[nodiscard]] inline lua_Integer check_integer(lua_State *L, int index)
{
    const int normalized = detail::normalize_index(L, index);
    const int type_value = lua_type(L, normalized);
    if (type_value == LUA_TNONE)
    {
        detail::bad_argument_missing(index, "integer");
    }
    if (type_value != LUA_TNUMBER)
    {
        detail::bad_argument_type(index, "integer", detail::type_name(type_value));
    }
    const lua_Number value = lua_tonumber(L, normalized);
    if (value != static_cast<lua_Number>(static_cast<lua_Integer>(value)))
    {
        const std::string msg = std::to_string(value) + " is not a whole number";
        detail::bad_argument_value(index, msg.c_str());
    }
    return static_cast<lua_Integer>(value);
}

[[nodiscard]] inline lua_Integer opt_integer(lua_State *L, int index, lua_Integer default_value)
{
    const int normalized = detail::normalize_index(L, index);
    const int type_value = lua_type(L, normalized);
    if (type_value == LUA_TNONE || type_value == LUA_TNIL)
    {
        return default_value;
    }
    if (type_value != LUA_TNUMBER)
    {
        detail::bad_argument_type(index, "integer or nil", detail::type_name(type_value));
    }
    const lua_Number value = lua_tonumber(L, normalized);
    if (value != static_cast<lua_Number>(static_cast<lua_Integer>(value)))
    {
        const std::string msg = std::to_string(value) + " is not a whole number";
        detail::bad_argument_value(index, msg.c_str());
    }
    return static_cast<lua_Integer>(value);
}

[[nodiscard]] inline bool check_boolean(lua_State *L, int index)
{
    const int normalized = detail::normalize_index(L, index);
    const int type_value = lua_type(L, normalized);
    if (type_value == LUA_TNONE)
    {
        detail::bad_argument_missing(index, "boolean");
    }
    if (type_value != LUA_TBOOLEAN)
    {
        detail::bad_argument_type(index, "boolean", detail::type_name(type_value));
    }
    return lua_toboolean(L, normalized) != 0;
}

[[nodiscard]] inline bool opt_boolean(lua_State *L, int index, bool default_value)
{
    const int normalized = detail::normalize_index(L, index);
    const int type_value = lua_type(L, normalized);
    if (type_value == LUA_TNONE || type_value == LUA_TNIL)
    {
        return default_value;
    }
    if (type_value != LUA_TBOOLEAN)
    {
        detail::bad_argument_type(index, "boolean or nil", detail::type_name(type_value));
    }
    return lua_toboolean(L, normalized) != 0;
}

// Accepts strings (numbers are converted, like the standard luaL_checkstring).
[[nodiscard]] inline std::string check_string(lua_State *L, int index)
{
    const int normalized = detail::normalize_index(L, index);
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
    return std::string(text ? text : "", length);
}

[[nodiscard]] inline std::string opt_string(lua_State *L, int index, const char *default_value)
{
    const int normalized = detail::normalize_index(L, index);
    const int type_value = lua_type(L, normalized);
    if (type_value == LUA_TNONE || type_value == LUA_TNIL)
    {
        return std::string(default_value ? default_value : "");
    }
    if (lua_isstring(L, normalized) == 0)
    {
        detail::bad_argument_type(index, "string or nil", detail::type_name(type_value));
    }
    std::size_t length = 0;
    const char *text = lua_tolstring(L, normalized, &length);
    return std::string(text ? text : "", length);
}

[[nodiscard]] inline void *check_light_userdata(lua_State *L, int index)
{
    const int normalized = detail::normalize_index(L, index);
    const int type_value = lua_type(L, normalized);
    if (type_value == LUA_TNONE)
    {
        detail::bad_argument_missing(index, "userdata");
    }
    if (type_value != LUA_TLIGHTUSERDATA)
    {
        detail::bad_argument_type(index, "userdata", detail::type_name(type_value));
    }
    return lua_touserdata(L, normalized);
}

// --- Result pushing ----------------------------------------------------------

inline void push_one(lua_State *L, lua_Number value) noexcept
{
    lua_pushnumber(L, value);
}

inline void push_one(lua_State *L, lua_Integer value) noexcept
{
    lua_pushnumber(L, static_cast<lua_Number>(value));
}

inline void push_one(lua_State *L, int value) noexcept
{
    lua_pushnumber(L, static_cast<lua_Number>(value));
}

inline void push_one(lua_State *L, bool value) noexcept
{
    lua_pushboolean(L, value ? 1 : 0);
}

inline void push_one(lua_State *L, std::nullptr_t) noexcept
{
    lua_pushnil(L);
}

inline void push_one(lua_State *L, const char *value) noexcept
{
    lua_pushstring(L, value ? value : "");
}

inline void push_one(lua_State *L, const std::string &value) noexcept
{
    lua_pushlstring(L, value.data(), value.size());
}

inline void push_one(lua_State *L, std::string_view value) noexcept
{
    lua_pushlstring(L, value.data(), value.size());
}

inline void push_one(lua_State *L, void *value) noexcept
{
    lua_pushlightuserdata(L, value);
}

// Declared below (argument.hpp/arguments.hpp): allows passing arguments and
// tables straight into push_results.
class Argument;
class Arguments;
struct Table;
void push_one(lua_State *L, const Argument &value);
void push_one(lua_State *L, const Arguments &value);
void push_one(lua_State *L, const Table &value);

// Pushes one or more values and returns how many were pushed.
// Grows the stack safely; throws if the stack cannot grow.
template <typename... Values>
int push_results(lua_State *L, Values &&...values)
{
    if constexpr (sizeof...(values) == 0)
    {
        return 0;
    }
    else
    {
        if (lua_checkstack(L, static_cast<int>(sizeof...(values)) + 8) == 0)
        {
            raise_error("Lua stack overflow: could not push ", sizeof...(values), " values");
        }
        (push_one(L, std::forward<Values>(values)), ...);
        return static_cast<int>(sizeof...(values));
    }
}
} // namespace mta::lua