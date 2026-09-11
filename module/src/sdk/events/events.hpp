#pragma once

// Triggering MTA events from the module.
//
// The module can "throw" an event into a resource's Lua scripts through the
// standard global triggerEvent. The script catches it with the usual
// addEventHandler:
//
//     -- Lua:
//     addEventHandler("onMyModuleReady", root, function(...) ... end)
//
//     // C++ (inside a module function):
//     mta::lua::Arguments args;
//     args.push_string("hello");
//     mta::events::trigger(L, "onMyModuleReady", args);
//
// The event source is the global root element. Call from the main thread
// only (like everything touching lua_State).

#include "sdk/lua/arguments.hpp"

struct lua_State;

namespace mta::events
{
// Triggers an event in the resource's VM. Returns false if triggerEvent is
// unavailable or the call failed (logged).
bool trigger(lua_State *lua_vm, const char *event_name, const mta::lua::Arguments &arguments);
} // namespace mta::events
