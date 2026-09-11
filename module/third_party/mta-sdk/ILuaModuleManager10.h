/*****************************************************************************
 *
 *  MTA:SA Lua module interface, aligned with the official SDK shipped in
 *  the mtasa-blue repository (Shared/publicsdk/include/ILuaModuleManager.h).
 *
 *  IMPORTANT: the virtual layout of these classes must stay identical to the
 *  server-side implementation (CLuaModule). Do NOT add, remove or reorder
 *  virtual methods: the module receives a pointer to a server object and
 *  calls it through this exact vtable.
 *
 *  Module contract implemented by the server (mods/deathmatch CLuaModule):
 *    - InitModule(manager, char name[128], char author[128], float* version)
 *    - RegisterFunctions(lua_State*)  - called once per resource VM start
 *    - DoPulse()                      - called every server frame
 *    - ShutdownModule()               - called before the module is unloaded
 *    - ResourceStopping(lua_State*)   - optional, VM is still alive
 *    - ResourceStopped(lua_State*)    - optional, VM is about to be destroyed
 *
 *****************************************************************************/

#pragma once

#include <cstddef>
#include <string>

extern "C"
{
#include "lua/lua.h"
#include "lua/lualib.h"
#include "lua/lauxlib.h"
}

#define MAX_INFO_LENGTH 128

class CChecksum
{
public:
    unsigned long ulCRC;
    unsigned char mD5[16];
};

/* Interface for modules until DP2.3 */
class ILuaModuleManager
{
public:
    virtual void ErrorPrintf(const char *format, ...) = 0;
    virtual void DebugPrintf(lua_State *luaVM, const char *format, ...) = 0;
    virtual void Printf(const char *format, ...) = 0;

    virtual bool RegisterFunction(lua_State *luaVM, const char *functionName, lua_CFunction function) = 0;
    // NOTE: this overload passes std::string across the DLL boundary and may
    // break if the module and the server use different compiler versions.
    // Prefer the char*/size_t overload below.
    virtual bool GetResourceName(lua_State *luaVM, std::string &name) = 0;
    virtual CChecksum GetResourceMetaChecksum(lua_State *luaVM) = 0;
    virtual CChecksum GetResourceFileChecksum(lua_State *luaVM, const char *file) = 0;
};

/* Interface for modules until 1.0 */
class ILuaModuleManager10 : public ILuaModuleManager
{
public:
    // Not part of the vtable: only re-exposes the base overload so that the
    // char* overload below does not hide it (-Woverloaded-virtual).
    using ILuaModuleManager::GetResourceName;

    virtual unsigned long GetVersion() = 0;
    virtual const char *GetVersionString() = 0;
    virtual const char *GetVersionName() = 0;
    virtual unsigned long GetNetcodeVersion() = 0;
    virtual const char *GetOperatingSystemName() = 0;

    virtual lua_State *GetResourceFromName(const char *resourceName) = 0;

    // Compiler-safe variant of GetResourceName above.
    virtual bool GetResourceName(lua_State *luaVM, char *name, std::size_t length) = 0;
    virtual bool GetResourceFilePath(lua_State *luaVM, const char *fileName, char *path, std::size_t length) = 0;
};
