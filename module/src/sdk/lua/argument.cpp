// Argument snapshot implementation: reading values off the stack (including
// recursive table traversal) and pushing them back.
#include "sdk/lua/argument.hpp"

#include "sdk/lua/stack.hpp"

#include <cassert>
#include <stdexcept>
#include <utility>

namespace mta::lua
{
namespace
{
// Converts an index (including negative/relative ones) to an absolute one.
int normalize_index(lua_State *lua_vm, int index)
{
    if (index >= 0)
    {
        return index;
    }

    const int top = lua_gettop(lua_vm);
    return top + index + 1;
}

// Stores a value at a 1-based sequence position; gaps are filled with nil.
void store_sequence_value(Table &table, lua_Integer position, Argument value)
{
    const std::size_t index = static_cast<std::size_t>(position - 1);
    if (index == table.array.size())
    {
        table.array.push_back(std::move(value));
        return;
    }

    if (index < table.array.size())
    {
        table.array[index] = std::move(value);
        return;
    }

    table.array.resize(index + 1, Argument(nullptr));
    table.array[index] = std::move(value);
}
} // namespace

Argument::Argument(std::nullptr_t) noexcept
    : type_(Type::Nil)
{
    value_.emplace<std::monostate>();
}

Argument::Argument(bool value) noexcept
    : type_(Type::Boolean)
{
    value_ = value;
}

Argument::Argument(lua_Number value) noexcept
    : type_(Type::Number)
{
    value_ = value;
}

Argument::Argument(const char *value)
    : type_(Type::String)
{
    value_ = value ? std::string(value) : std::string();
}

Argument::Argument(std::string value) noexcept
    : type_(Type::String)
{
    value_ = std::move(value);
}

Argument::Argument(void *value) noexcept
    : type_(Type::LightUserData)
{
    value_ = value;
}

Argument::Argument(Table value) noexcept
    : type_(Type::Table)
{
    value_ = std::move(value);
}

bool Argument::as_boolean(bool default_value) const noexcept
{
    if (type_ == Type::Boolean)
    {
        return std::get<bool>(value_);
    }
    return default_value;
}

lua_Number Argument::as_number(lua_Number default_value) const noexcept
{
    if (type_ == Type::Number)
    {
        return std::get<lua_Number>(value_);
    }
    return default_value;
}

const std::string &Argument::as_string() const noexcept
{
    static const std::string empty{};
    if (type_ == Type::String)
    {
        return std::get<std::string>(value_);
    }
    return empty;
}

void *Argument::as_light_userdata() const noexcept
{
    if (type_ == Type::LightUserData)
    {
        return std::get<void *>(value_);
    }
    return nullptr;
}

const Table &Argument::as_table() const
{
    if (type_ != Type::Table)
    {
        throw std::logic_error("Argument does not contain a table");
    }
    return std::get<Table>(value_);
}

Table &Argument::as_table()
{
    if (type_ != Type::Table)
    {
        throw std::logic_error("Argument does not contain a table");
    }
    return std::get<Table>(value_);
}

void Argument::read(lua_State *lua_vm, int index, int depth)
{
    assert(lua_vm);
    const int normalized_index = normalize_index(lua_vm, index);
    const int lua_type_value = lua_type(lua_vm, normalized_index);

    switch (lua_type_value)
    {
    case LUA_TNIL:
        type_ = Type::Nil;
        value_.emplace<std::monostate>();
        break;
    case LUA_TBOOLEAN:
        type_ = Type::Boolean;
        value_ = lua_toboolean(lua_vm, normalized_index) != 0;
        break;
    case LUA_TLIGHTUSERDATA:
        type_ = Type::LightUserData;
        value_ = lua_touserdata(lua_vm, normalized_index);
        break;
    case LUA_TNUMBER:
        type_ = Type::Number;
        value_ = lua_tonumber(lua_vm, normalized_index);
        break;
    case LUA_TSTRING:
    {
        type_ = Type::String;
        std::size_t length = 0;
        const char *str = lua_tolstring(lua_vm, normalized_index, &length);
        value_ = std::string(str ? str : "", length);
        break;
    }
    case LUA_TTABLE:
    {
        type_ = Type::Table;
        Table &table = value_.emplace<Table>();

        if (depth < max_table_depth)
        {
            // Iterate over a copy of the table pushed to the top of the
            // stack: the original index stays valid under any stack changes.
            lua_pushvalue(lua_vm, normalized_index);
            const int copy_index = lua_gettop(lua_vm);
            lua_pushnil(lua_vm);

            while (lua_next(lua_vm, copy_index) != 0)
            {
                // Key sits at -2, value at -1.
                Argument key;
                key.read(lua_vm, -2, depth + 1);

                if (key.type() == Type::Number)
                {
                    const lua_Number key_number = key.as_number();
                    const lua_Integer position = static_cast<lua_Integer>(key_number);
                    if (key_number >= 1.0 && key_number == static_cast<lua_Number>(position))
                    {
                        Argument value;
                        value.read(lua_vm, -1, depth + 1);
                        store_sequence_value(table, position, std::move(value));
                    }
                }
                else if (key.type() == Type::String)
                {
                    Argument value;
                    value.read(lua_vm, -1, depth + 1);
                    table.fields.emplace_back(key.as_string(), std::move(value));
                }

                lua_pop(lua_vm, 1); // pop the value, keep the key for lua_next
            }

            lua_pop(lua_vm, 1); // pop the table copy
        }
        break;
    }
    default:
        type_ = Type::None;
        value_.emplace<std::monostate>();
        break;
    }
}

void Argument::push(lua_State *lua_vm, int depth) const
{
    assert(lua_vm);

    switch (type_)
    {
    case Type::Nil:
        lua_pushnil(lua_vm);
        break;
    case Type::Boolean:
        lua_pushboolean(lua_vm, std::get<bool>(value_) ? 1 : 0);
        break;
    case Type::LightUserData:
        lua_pushlightuserdata(lua_vm, std::get<void *>(value_));
        break;
    case Type::Number:
        lua_pushnumber(lua_vm, std::get<lua_Number>(value_));
        break;
    case Type::String:
    {
        const auto &text = std::get<std::string>(value_);
        lua_pushlstring(lua_vm, text.c_str(), text.size());
        break;
    }
    case Type::Table:
    {
        if (depth >= max_table_depth)
        {
            // Recursion limit: push nil instead of looping forever.
            lua_pushnil(lua_vm);
            break;
        }

        const Table &table = std::get<Table>(value_);
        lua_createtable(lua_vm, static_cast<int>(table.array.size()), static_cast<int>(table.fields.size()));
        const int table_index = lua_gettop(lua_vm);

        for (std::size_t i = 0; i < table.array.size(); ++i)
        {
            if (table.array[i].type() == Type::None)
            {
                lua_pushnil(lua_vm); // holes must not shift sequence positions
            }
            else
            {
                table.array[i].push(lua_vm, depth + 1);
            }
            lua_rawseti(lua_vm, table_index, static_cast<int>(i + 1));
        }

        for (const auto &entry : table.fields)
        {
            lua_pushlstring(lua_vm, entry.first.data(), entry.first.size());
            entry.second.push(lua_vm, depth + 1);
            lua_rawset(lua_vm, table_index);
        }
        break;
    }
    case Type::None:
        break;
    }
}

bool operator==(const Argument &lhs, const Argument &rhs) noexcept
{
    if (lhs.type_ != rhs.type_)
    {
        return false;
    }

    switch (lhs.type_)
    {
    case Argument::Type::None:
    case Argument::Type::Nil:
        return true;
    case Argument::Type::Boolean:
        return lhs.as_boolean() == rhs.as_boolean();
    case Argument::Type::LightUserData:
        return lhs.as_light_userdata() == rhs.as_light_userdata();
    case Argument::Type::Number:
        return lhs.as_number() == rhs.as_number();
    case Argument::Type::String:
        return lhs.as_string() == rhs.as_string();
    case Argument::Type::Table:
    {
        const Table &left = std::get<Table>(lhs.value_);
        const Table &right = std::get<Table>(rhs.value_);
        return left.array == right.array && left.fields == right.fields;
    }
    }

    return false;
}

bool operator!=(const Argument &lhs, const Argument &rhs) noexcept
{
    return !(lhs == rhs);
}

void push_one(lua_State *lua_vm, const Argument &value)
{
    value.push(lua_vm);
}

void push_one(lua_State *lua_vm, const Table &value)
{
    Argument{value}.push(lua_vm);
}
} // namespace mta::lua
