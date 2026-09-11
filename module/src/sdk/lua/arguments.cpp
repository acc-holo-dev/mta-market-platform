#include "sdk/lua/arguments.hpp"

#include "sdk/lua/stack.hpp"

#include <cassert>
#include <stdexcept>
#include <utility>

namespace mta::lua
{
void Arguments::read(lua_State *lua_vm, int index_begin)
{
    assert(lua_vm);
    arguments_.clear();

    const int top = lua_gettop(lua_vm);
    int index = index_begin;
    if (index <= 0)
    {
        index = top + index + 1;
    }

    for (; index <= top; ++index)
    {
        Argument argument;
        argument.read(lua_vm, index);
        arguments_.push_back(std::move(argument));
    }
}

int Arguments::push(lua_State *lua_vm) const
{
    assert(lua_vm);
    int pushed = 0;

    for (const auto &argument : arguments_)
    {
        if (argument.type() == Argument::Type::None)
        {
            continue;
        }

        argument.push(lua_vm);
        ++pushed;
    }

    return pushed;
}

void Arguments::append(const Arguments &other)
{
    arguments_.insert(arguments_.end(), other.arguments_.begin(), other.arguments_.end());
}

bool Arguments::call(lua_State *lua_vm, const char *function_name, std::string *error_out) const
{
    assert(lua_vm);
    if (!function_name)
    {
        return false;
    }

    lua_getglobal(lua_vm, function_name);
    if (!lua_isfunction(lua_vm, -1))
    {
        lua_pop(lua_vm, 1);
        return false;
    }

    const int pushed = push(lua_vm);
    if (lua_pcall(lua_vm, pushed, 0, 0) != LUA_OK)
    {
        if (error_out)
        {
            const char *message = lua_tostring(lua_vm, -1);
            if (message)
            {
                *error_out = message;
            }
            else
            {
                error_out->clear();
            }
        }

        lua_pop(lua_vm, 1);
        return false;
    }

    return true;
}

Argument &Arguments::push_nil()
{
    arguments_.emplace_back(nullptr);
    return arguments_.back();
}

Argument &Arguments::push_boolean(bool value)
{
    arguments_.emplace_back(value);
    return arguments_.back();
}

Argument &Arguments::push_number(lua_Number value)
{
    arguments_.emplace_back(value);
    return arguments_.back();
}

Argument &Arguments::push_string(const char *value)
{
    arguments_.emplace_back(value ? value : "");
    return arguments_.back();
}

Argument &Arguments::push_string(std::string value)
{
    arguments_.emplace_back(std::move(value));
    return arguments_.back();
}

Argument &Arguments::push_light_userdata(void *value)
{
    arguments_.emplace_back(value);
    return arguments_.back();
}

const Argument &Arguments::at(std::size_t index) const
{
    if (index >= arguments_.size())
    {
        throw std::out_of_range("Arguments: index out of range");
    }
    return arguments_[index];
}

void push_one(lua_State *lua_vm, const Arguments &values)
{
    const int pushed = values.push(lua_vm);
    (void)pushed;
}
} // namespace mta::lua
