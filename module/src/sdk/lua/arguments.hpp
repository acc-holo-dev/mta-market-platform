#pragma once

// Flat list of Lua values (tables included). Used to marshal argument sets
// between Lua and C++, e.g. to hand a background task's result to a callback.

#include "sdk/lua/argument.hpp"

#include <string>
#include <vector>

namespace mta::lua
{
class Arguments
{
public:
    Arguments() = default;

    // Reads all arguments from the stack, starting at index_begin (default 1).
    void read(lua_State *lua_vm, int index_begin = 1);
    // Pushes every value onto the stack, returns how many were pushed.
    int push(lua_State *lua_vm) const;
    void append(const Arguments &other);

    // Calls a global Lua function by name with these arguments (via pcall).
    // Returns false and fills error_out (when given) on failure.
    bool call(lua_State *lua_vm, const char *function_name, std::string *error_out = nullptr) const;

    Argument &push_nil();
    Argument &push_boolean(bool value);
    Argument &push_number(lua_Number value);
    Argument &push_string(const char *value);
    Argument &push_string(std::string value);
    Argument &push_light_userdata(void *value);

    [[nodiscard]] std::size_t count() const noexcept { return arguments_.size(); }
    [[nodiscard]] bool empty() const noexcept { return arguments_.empty(); }
    [[nodiscard]] const Argument &at(std::size_t index) const;

private:
    std::vector<Argument> arguments_{};
};
} // namespace mta::lua
