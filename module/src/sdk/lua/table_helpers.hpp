#pragma once

// Convenient table-field access: read/write by string key without manually
// walking Table.fields, plus Argument -> C++-type conversion.
//
//     auto [t] = mta::lua::args<mta::lua::Table>(L);
//     std::string name = mta::lua::get_field<std::string>(t, "name", "unknown");
//     double hp = mta::lua::get_field<double>(t, "hp", 100.0);
//     mta::lua::set_field(t, "alive", mta::lua::Argument(true));

#include "sdk/lua/argument.hpp"
#include "sdk/lua/protect.hpp"

#include <optional>
#include <string>
#include <type_traits>
#include <utility>

namespace mta::lua
{
// Argument type name for error messages.
inline const char *type_name_of(const Argument &value) noexcept
{
    switch (value.type())
    {
    case Argument::Type::None: return "no value";
    case Argument::Type::Nil: return "nil";
    case Argument::Type::Boolean: return "boolean";
    case Argument::Type::LightUserData: return "userdata";
    case Argument::Type::Number: return "number";
    case Argument::Type::String: return "string";
    case Argument::Type::Table: return "table";
    }
    return "unknown";
}

namespace detail
{
template <typename T>
inline constexpr bool is_optional = false;
template <typename T>
inline constexpr bool is_optional<std::optional<T>> = true;
} // namespace detail

// Converts an Argument into T; throws a readable error on a type mismatch.
template <typename T>
T convert(const Argument &value)
{
    using U = std::remove_cvref_t<T>;

    if constexpr (std::is_same_v<U, Argument>)
    {
        return value;
    }
    else if constexpr (std::is_same_v<U, Table>)
    {
        if (!value.is_table())
        {
            raise_error("field must be a table, got ", type_name_of(value));
        }
        return value.as_table();
    }
    else if constexpr (std::is_same_v<U, bool>)
    {
        if (value.type() != Argument::Type::Boolean)
        {
            raise_error("field must be a boolean, got ", type_name_of(value));
        }
        return value.as_boolean();
    }
    else if constexpr (std::is_same_v<U, std::string>)
    {
        if (value.type() != Argument::Type::String)
        {
            raise_error("field must be a string, got ", type_name_of(value));
        }
        return value.as_string();
    }
    else if constexpr (std::is_floating_point_v<U>)
    {
        if (value.type() != Argument::Type::Number)
        {
            raise_error("field must be a number, got ", type_name_of(value));
        }
        return static_cast<U>(value.as_number());
    }
    else if constexpr (std::is_integral_v<U> && !std::is_same_v<U, bool>)
    {
        if (value.type() != Argument::Type::Number)
        {
            raise_error("field must be a number, got ", type_name_of(value));
        }
        return static_cast<U>(value.as_number());
    }
    else if constexpr (detail::is_optional<U>)
    {
        if (value.type() == Argument::Type::Nil || value.type() == Argument::Type::None)
        {
            return U{};
        }
        return U{convert<typename U::value_type>(value)};
    }
    else
    {
        static_assert(!sizeof(U), "unsupported table field type");
    }
}

// Finds a field by string key; nullptr if absent.
inline const Argument *find_field(const Table &table, const char *key) noexcept
{
    if (key == nullptr)
    {
        return nullptr;
    }
    for (const auto &entry : table.fields)
    {
        if (entry.first == key)
        {
            return &entry.second;
        }
    }
    return nullptr;
}

// Reads a field with a default (the default is used when the field is absent).
template <typename T>
T get_field(const Table &table, const char *key, T default_value)
{
    const Argument *field = find_field(table, key);
    if (field == nullptr)
    {
        return default_value;
    }
    return convert<T>(*field);
}

// Reads a field; throws when the field is absent.
template <typename T>
T get_field(const Table &table, const char *key)
{
    const Argument *field = find_field(table, key);
    if (field == nullptr)
    {
        raise_error("table has no field '", key ? key : "?", "'");
    }
    return convert<T>(*field);
}

// Writes (or overwrites) a field.
inline void set_field(Table &table, const char *key, Argument value)
{
    if (key == nullptr)
    {
        return;
    }
    for (auto &entry : table.fields)
    {
        if (entry.first == key)
        {
            entry.second = std::move(value);
            return;
        }
    }
    table.fields.emplace_back(key, std::move(value));
}
} // namespace mta::lua
