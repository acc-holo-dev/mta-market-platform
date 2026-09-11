// Timers: callback(tick) fires on the main thread every delay_ms,
// repeat_count times (0 = until cancelled). Built on the developer-facing
// timer API (mta::timer::every) -- the scheduler stays internal
//. The timer is tied to the calling resource and is cancelled
// automatically when that resource stops.

#include <mta/sdk.hpp>

#include <library/base/handle_map.hpp>

#include <cstdint>
#include <memory>
#include <utility>

namespace
{
// Live sample_timer handles of the calling resource (main thread only; the
// store clears itself when the resource stops). Keyed by the timer id
// handed to Lua.
mta::resources::Store<mta::library::base::HandleMap<std::uint64_t, mta::timer::Timer>> g_sample_timers;
} // namespace

MTA_LUA_FUNCTION("sample_timer",
    "Calls callback(tick) every delay_ms, repeat_count times (0 = forever). Returns the timer id.")
{
    auto [delay, repeats, callback] =
        mta::lua::args<std::int64_t, std::int64_t, mta::async::Callback>(L);

    auto cb = std::make_shared<mta::async::Callback>(std::move(callback));

    mta::timer::Timer timer = mta::timer::every(
        L, static_cast<int>(delay), repeats,
        [cb](std::uint64_t tick) {
            mta::lua::Arguments arguments;
            arguments.push_number(static_cast<lua_Number>(tick));
            cb->call(arguments);
        });

    if (!timer.valid())
    {
        mta::lua::raise_error("timer was not accepted");
    }

    const std::uint64_t timer_id = timer.id();
    if (!g_sample_timers.for_state(L).emplace(timer_id, std::move(timer)))
    {
        mta::log::error("sample timer: duplicate timer id ", timer_id);
    }
    return mta::lua::push_results(L, static_cast<lua_Number>(timer_id));
}

MTA_LUA_FUNCTION("sample_timer_cancel",
    "Cancels a timer created by sample_timer. true if a timer was cancelled.")
{
    auto [timer_id] = mta::lua::args<std::int64_t>(L);

    auto *timer = g_sample_timers.for_state(L).find(static_cast<std::uint64_t>(timer_id));
    if (timer == nullptr)
    {
        return mta::lua::push_results(L, false);
    }

    const bool cancelled = timer->cancel();
    if (cancelled)
    {
        g_sample_timers.for_state(L).erase(static_cast<std::uint64_t>(timer_id));
    }
    return mta::lua::push_results(L, cancelled);
}