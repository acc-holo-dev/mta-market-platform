#pragma once

// Single point of inclusion for Lua 5.1 (vendored headers from other/third_party/mta-sdk).

extern "C"
{
#include "lua/lauxlib.h"
#include "lua/lualib.h"
#include "lua/lua.h"
}

#ifndef LUA_OK
#define LUA_OK 0
#endif
