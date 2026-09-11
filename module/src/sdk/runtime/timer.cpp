#include "sdk/runtime/timer.hpp"

#include "sdk/abi/module.hpp"
#include "sdk/lua/protect.hpp"
#include "sdk/runtime/scheduler.hpp"

#include <utility>

namespace mta::timer
{
namespace
{
Timer schedule(lua_State *lua_vm, int delay_ms, std::int64_t repeat_count,
               std::function<void(std::uint64_t)> fn)
{
    const std::string resource = mta::module::current_resource_name(lua_vm);
    if (resource.empty())
    {
        mta::lua::raise_error("could not determine the calling resource for the timer");
    }
    return mta::async::Scheduler::instance().post_timer_handle(std::move(resource), delay_ms,
                                                               repeat_count, std::move(fn));
}

int checked_delay(int delay_ms)
{
    if (delay_ms < 0)
    {
        mta::lua::raise_error("timer delay must not be negative");
    }
    return delay_ms;
}
} // namespace

Timer after(lua_State *lua_vm, int delay_ms, std::function<void()> fn)
{
    return schedule(lua_vm, checked_delay(delay_ms), 1,
                    [fn = std::move(fn)](std::uint64_t) { fn(); });
}

Timer every(lua_State *lua_vm, int delay_ms, std::function<void()> fn)
{
    return schedule(lua_vm, checked_delay(delay_ms), 0,
                    [fn = std::move(fn)](std::uint64_t) { fn(); });
}

Timer every(lua_State *lua_vm, int delay_ms, std::int64_t repeat_count,
            std::function<void(std::uint64_t tick)> fn)
{
    // The scheduler treats a repeat count <= 0 as "until cancelled".
    return schedule(lua_vm, checked_delay(delay_ms), repeat_count, std::move(fn));
}

bool Timer::cancel() noexcept
{
    if (state_ == nullptr || state_->cancelled || state_->finished)
    {
        return false;
    }
    state_->cancelled = true;
    state_->finished = true;
    mta::async::Scheduler::instance().cancel_timer(state_->id);
    return true;
}
} // namespace mta::timer