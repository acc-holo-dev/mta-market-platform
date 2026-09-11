// Benchmark plaques for the callback path (source/sdk/runtime/callback.cpp):
// the three costs a Lua function reference incurs, each measurable in
// isolation.
//
//   bench_callback_hold(fn)     -- registration: Callback::from_stack pays
//                                  luaL_ref plus the per-resource tracking
//                                  bookkeeping.
//   bench_callback_call(id, ..) -- invocation: Callback::call pays the dead-ref
//                                  lookup, the generation check, the registry
//                                  fetch (lua_rawgeti) and the pcall.
//   bench_callback_release(id)  -- release: the destructor pays untracking and
//                                  luaL_unref.
//
// The callbacks are stored per resource (Store + HandleMap, like the timer
// samples) and fire synchronously into the calling VM: Callback::call is a
// main-thread operation and the module function runs on the main thread, so
// the direct call is the same delivery path the scheduler uses on DoPulse --
// without the scheduling noise around it. Measured by
// other/tests/lua/scripts/093_benchmark_callback.lua; the end-to-end delivery
// through DoPulse is measured in 094_benchmark_scheduling.lua. Measurement
// surfaces only: no behavior beyond registering/calling/releasing callbacks.

#include <mta/sdk.hpp>

#include <library/base/handle_map.hpp>

#include <cstdint>
#include <utility>

namespace
{
// Live benchmark callbacks of the calling resource (main thread only; the
// store clears itself when the resource stops). Keyed by the id handed to Lua.
mta::resources::Store<mta::library::base::HandleMap<std::uint64_t, mta::async::Callback>>
    g_bench_callbacks;

std::uint64_t next_callback_id()
{
    static std::uint64_t next_id = 0;
    return ++next_id; // main thread only; ids never repeat within a run
}
} // namespace

MTA_LUA_FUNCTION("bench_callback_hold",
    "Stores a callback and returns its id. Benchmark plaque: the cost of registering a Lua "
    "function reference (luaL_ref + callback bookkeeping).")
{
    auto [callback] = mta::lua::args<mta::async::Callback>(L);

    const std::uint64_t id = next_callback_id();
    if (!g_bench_callbacks.for_state(L).emplace(id, std::move(callback)))
    {
        mta::lua::raise_error("bench_callback_hold: duplicate id ", id);
    }
    return mta::lua::push_results(L, static_cast<lua_Number>(id));
}

MTA_LUA_FUNCTION("bench_callback_call",
    "Invokes a stored callback with the remaining arguments and returns whether it ran. Benchmark "
    "plaque: the cost of Callback::call (reference lookup, generation check, pcall).")
{
    auto [id] = mta::lua::args<std::int64_t>(L);

    auto *callback = g_bench_callbacks.for_state(L).find(static_cast<std::uint64_t>(id));
    if (callback == nullptr)
    {
        return mta::lua::push_results(L, false);
    }

    mta::lua::Arguments arguments;
    arguments.read(L, 2); // every argument after the id
    return mta::lua::push_results(L, callback->call(arguments));
}

MTA_LUA_FUNCTION("bench_callback_release",
    "Releases a stored callback and returns whether it existed. Benchmark plaque: the cost of "
    "releasing a Lua function reference (untracking + luaL_unref).")
{
    auto [id] = mta::lua::args<std::int64_t>(L);

    auto *callbacks = &g_bench_callbacks.for_state(L);
    const bool released = callbacks->erase(static_cast<std::uint64_t>(id));
    return mta::lua::push_results(L, released);
}