// Timer handles: mta::timer::after fires once, every repeats
// until cancelled or the owning resource stops. Both return a handle with
// cancel()/valid(); timers are resource-aware and never survive a restart
// of their resource.
//
//     local id = sample_after(500, function() ... end)
//     sample_after_cancel(id)  -- true: the callback will never fire

#include <mta/sdk.hpp>

#include <library/base/handle_map.hpp>

#include <cstdint>
#include <memory>
#include <utility>

namespace
{
// Live timer handles of the calling resource (main thread only; cleared
// when the resource stops). HandleMap is the reusable id->handle registry
// from the library layer (functions may use library).
mta::resources::Store<mta::library::base::HandleMap<std::uint64_t, mta::timer::Timer>> g_timers;
} // namespace

MTA_LUA_FUNCTION("sample_after",
    "Calls callback() once after delay_ms on the main thread. Returns the "
    "timer id for sample_after_cancel/sample_timer_valid.")
{
    auto [delay_ms, callback] = mta::lua::args<std::int64_t, mta::async::Callback>(L);

    auto cb = std::make_shared<mta::async::Callback>(std::move(callback));
    mta::timer::Timer timer = mta::timer::after(
        L, static_cast<int>(delay_ms), [cb] {
            mta::lua::Arguments result;
            result.push_boolean(true);
            cb->call(result);
        });

    if (!timer.valid())
    {
        mta::lua::raise_error("timer was not accepted");
    }

    const std::uint64_t id = timer.id();
    if (!g_timers.for_state(L).emplace(id, std::move(timer)))
    {
        mta::log::error("sample timer: duplicate timer id ", id);
    }
    return mta::lua::push_results(L, static_cast<lua_Number>(id));
}

MTA_LUA_FUNCTION("sample_every",
    "Calls callback() every delay_ms until cancelled or the resource "
    "stops. Returns the timer id.")
{
    auto [delay_ms, callback] = mta::lua::args<std::int64_t, mta::async::Callback>(L);

    auto cb = std::make_shared<mta::async::Callback>(std::move(callback));
    mta::timer::Timer timer = mta::timer::every(L, static_cast<int>(delay_ms), [cb] {
        mta::lua::Arguments result;
        result.push_boolean(true);
        cb->call(result);
    });

    if (!timer.valid())
    {
        mta::lua::raise_error("timer was not accepted");
    }

    const std::uint64_t id = timer.id();
    if (!g_timers.for_state(L).emplace(id, std::move(timer)))
    {
        mta::log::error("sample timer: duplicate timer id ", id);
    }
    return mta::lua::push_results(L, static_cast<lua_Number>(id));
}

MTA_LUA_FUNCTION("sample_after_cancel",
    "Cancels a timer created by sample_after/sample_every: its callback "
    "will never fire again. true if cancelled.")
{
    auto [id] = mta::lua::args<std::int64_t>(L);

    auto *timer = g_timers.for_state(L).find(static_cast<std::uint64_t>(id));
    if (timer == nullptr)
    {
        return mta::lua::push_results(L, false);
    }

    const bool cancelled = timer->cancel();
    if (cancelled)
    {
        g_timers.for_state(L).erase(static_cast<std::uint64_t>(id));
    }
    return mta::lua::push_results(L, cancelled);
}

MTA_LUA_FUNCTION("sample_timer_valid",
    "true while the timer is still scheduled (will fire again).")
{
    auto [id] = mta::lua::args<std::int64_t>(L);

    auto *timer = g_timers.for_state(L).find(static_cast<std::uint64_t>(id));
    return mta::lua::push_results(L, timer != nullptr && timer->valid());
}