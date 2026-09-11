#pragma once

// Snapshot of a single Lua value: nil / boolean / number / string /
// lightuserdata and tables (recursively, up to max_table_depth levels --
// protection against cyclic references).

#include "sdk/lua/common.hpp"

#include <cstddef>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace mta::lua
{
// Table recursion limit for reading/writing: anything deeper is dropped
// when reading and replaced with nil when writing.
inline constexpr int max_table_depth = 32;

// Forward declaration: Table below holds containers of Argument values.
class Argument;

// Table snapshot: the integer sequence part (1..n) and string-keyed fields.
// Keys of other types (boolean, tables, ...) are discarded when reading.
struct Table
{
    std::vector<Argument> array;
    std::vector<std::pair<std::string, Argument>> fields;
};

class Argument
{
public:
    enum class Type : int
    {
        None = LUA_TNONE,
        Nil = LUA_TNIL,
        Boolean = LUA_TBOOLEAN,
        LightUserData = LUA_TLIGHTUSERDATA,
        Number = LUA_TNUMBER,
        String = LUA_TSTRING,
        Table = LUA_TTABLE,
    };

    Argument() = default;
    Argument(std::nullptr_t) noexcept;
    explicit Argument(bool value) noexcept;
    explicit Argument(lua_Number value) noexcept;
    explicit Argument(const char *value);
    explicit Argument(std::string value) noexcept;
    explicit Argument(void *value) noexcept;
    explicit Argument(Table value) noexcept;

    Type type() const noexcept { return type_; }

    bool as_boolean(bool default_value = false) const noexcept;
    lua_Number as_number(lua_Number default_value = 0.0) const noexcept;
    const std::string &as_string() const noexcept;
    void *as_light_userdata() const noexcept;

    [[nodiscard]] bool is_table() const noexcept { return type_ == Type::Table; }
    [[nodiscard]] const Table &as_table() const;
    [[nodiscard]] Table &as_table();

    // Reads the value at the index (positive or relative).
    void read(lua_State *lua_vm, int index, int depth = 0);
    // Pushes the value onto the top of the stack.
    void push(lua_State *lua_vm, int depth = 0) const;

    friend bool operator==(const Argument &lhs, const Argument &rhs) noexcept;
    friend bool operator!=(const Argument &lhs, const Argument &rhs) noexcept;

private:
    using Storage = std::variant<std::monostate, bool, lua_Number, std::string, void *, Table>;

    Type type_{Type::None};
    Storage value_{};
};
} // namespace mta::lua