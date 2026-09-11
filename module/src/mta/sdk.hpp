#pragma once

// ===========================================================================
// <mta/sdk.hpp> -- the public facade of the MTA Module SDK.
//
// This is the ONLY header a module developer normally needs:
//
//     #include <mta/sdk.hpp>
//
//     MTA_FUNCTION("sum", [](double a, double b) { return a + b; });
//
// Everything below is grouped by subsystem. The directories under
// source/sdk/ (abi, lua, bind, registry, runtime, resources, objects,
// events, logging, native) are internal implementation layers: they exist so
// the framework can be maintained, not because a developer has to understand
// them. Internal headers stay reachable through the same include root, but
// the facade is the supported surface.
//
// Exported here (additions land together with their subsystem):
//   MTA_FUNCTION / MTA_LUA_FUNCTION / MTA_LUA_FUNC   -- function registration
//   MTA_STATE / mta::state (mta::LuaView)            -- borrowed Lua state
//                                                    --   view
//   mta::lua::args / push_results / raise_error      -- values & errors
//   mta::lua::{Argument, Table, Arguments}           -- snapshots (async-safe)
//   mta::lua::{check_*, opt_*}                       -- manual stack access
//   mta::async::Callback / mta::async::Scheduler     -- background work
//   mta::timer::{after, every}                       -- timer handles
//   mta::Resource                                    -- native types (safe subset)
//   mta::resources::{Hub, Store}                     -- per-resource state
//   mta::module_info / mta::server_info              -- module & server identity
//   mta::registered_functions()                      -- read-only registry view
//   mta::log::{info, warn, error, debug}             -- logging (auto-context)
//   mta::events::trigger                             -- module -> Lua events
//   mta::userdata::Registry<T> + MTA_OBJECT / MTA_METHOD -- native objects
// ===========================================================================

// --- registration (macros live in the registry) -----------------------------
#include "sdk/registry/registry.hpp"

// --- Lua values: state view, snapshots and stack helpers ---------------------
#include "sdk/lua/argument.hpp"
#include "sdk/lua/arguments.hpp"
#include "sdk/lua/state.hpp"
#include "sdk/lua/stack.hpp"
#include "sdk/lua/table_helpers.hpp"
#include "sdk/lua/protect.hpp"

// --- runtime services ---------------------------------------------------------
#include "sdk/native/module.hpp"
#include "sdk/native/resource.hpp"
#include "sdk/runtime/callback.hpp"
#include "sdk/runtime/scheduler.hpp"
#include "sdk/runtime/timer.hpp"
#include "sdk/resources/resources.hpp"
#include "sdk/logging/logging.hpp"
#include "sdk/events/events.hpp"

// --- native objects -----------------------------------------------------------
#include "sdk/objects/userdata.hpp"

// ===========================================================================
// Facade-level conveniences: thin, read-only helpers that keep developer code
// away from the internal singletons.
// ===========================================================================
namespace mta
{
// Introspection: the functions registered by this module with
// their signature metadata, read-only. The Registry singleton itself stays
// internal -- developer code goes through this view.
[[nodiscard]] inline const std::vector<::mta::registry::Spec> &registered_functions()
{
    return ::mta::registry::Registry::instance().functions();
}
} // namespace mta