// Example of direct Lua stack access, for when args<...> does not fit
// (dynamic logic, fine-grained parsing). The body receives lua_State* L and
// may do anything with the stack -- the framework only catches exceptions.

#include <mta/sdk.hpp>

MTA_LUA_FUNCTION("sample_stack_dump", "Returns the argument count and the type of each argument.")
{
    const int count = lua_gettop(L);
    lua_pushnumber(L, static_cast<lua_Number>(count));
    for (int i = 1; i <= count; ++i)
    {
        lua_pushstring(L, lua_typename(L, lua_type(L, i)));
    }
    return count + 1;
}