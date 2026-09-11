#pragma once

// Module lifecycle. The MTAEXPORT entry points in module.cpp forward here;
// the same hooks are used by internal subsystems.

#include <string>

class ILuaModuleManager10;
struct lua_State;

namespace mta::module
{
struct Info
{
    const char *name;
    const char *author;
    float version;
};

Info info() noexcept;
ILuaModuleManager10 *manager() noexcept;

// The name of the resource owning lua_vm; an empty string when it cannot be
// determined. Uses the ABI-safe char* manager overload (the std::string
// overload crosses the DLL boundary with an ABI-sensitive type).
std::string current_resource_name(lua_State *lua_vm);

bool initialize(ILuaModuleManager10 *manager, char *module_name, char *author, float *version) noexcept;
void register_functions(lua_State *lua_vm) noexcept;
bool pulse() noexcept;
bool shutdown() noexcept;
bool resource_stopping(lua_State *lua_vm) noexcept;
bool resource_stopped(lua_State *lua_vm) noexcept;
} // namespace mta::module