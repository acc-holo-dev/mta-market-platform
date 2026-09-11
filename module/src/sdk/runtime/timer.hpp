#pragma once

// Developer-facing timer API.
//
//     auto timer = mta::timer::after(5000, [] { ... });  // fires once
//     auto timer = mta::timer::every(1000, [] { ... });  // repeats forever
//     timer.cancel();   // true if a scheduled timer was cancelled
//     timer.valid();    // still scheduled (will fire again)
//
// Timers are resource-aware: they belong to the calling resource and its VM
// generation. When the resource stops, every owned timer is invalidated, and
// a restart of the same resource never revives one of an older generation
// (the scheduler drops stale-generation timers before they can fire).

#include "sdk/lua/common.hpp"

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace mta::timer
{
// Shared state between a Timer handle and the scheduler. Main thread only
// (timers fire on the main thread, and cancel() is called from module
// functions) -- no locking needed.
struct TimerState
{
    std::uint64_t id = 0;
    std::string resource;
    std::uint64_t generation = 0;
    bool cancelled = false; // cancel() was called
    bool finished = false;  // scheduler dropped it: fired final / stale /
                            // resource stopped / explicitly cancelled
};

// Light shared handle: copies share the state; default handles are invalid.
class Timer
{
public:
    Timer() = default;
    explicit Timer(std::shared_ptr<TimerState> state) noexcept
        : state_(std::move(state))
    {
    }

    // Cancels the timer: the completion will not fire again. Returns true if
    // a scheduled timer was cancelled, false when it was already finished.
    bool cancel() noexcept;

    // true while the timer is still scheduled (pending or repeating).
    [[nodiscard]] bool valid() const noexcept
    {
        return state_ != nullptr && !state_->cancelled && !state_->finished;
    }

    // 0 for an invalid handle; otherwise the scheduler-assigned timer id.
    [[nodiscard]] std::uint64_t id() const noexcept { return state_ ? state_->id : 0; }

private:
    std::shared_ptr<TimerState> state_;
};

// One-shot: fn() fires on the main thread after delay_ms. Resource-aware:
// owned by the calling resource and cancelled when it stops.
[[nodiscard]] Timer after(lua_State *lua_vm, int delay_ms, std::function<void()> fn);

// Repeating: fn(tick-less) fires every delay_ms until cancelled or the
// owning resource stops.
[[nodiscard]] Timer every(lua_State *lua_vm, int delay_ms, std::function<void()> fn);

// Repeating with a fire limit: fn(tick) fires every delay_ms, repeat_count
// times in total (tick = 1, 2, ...). repeat_count <= 0 repeats forever --
// the same as every(). Resource-aware like the other forms.
[[nodiscard]] Timer every(lua_State *lua_vm, int delay_ms, std::int64_t repeat_count,
                          std::function<void(std::uint64_t tick)> fn);
} // namespace mta::timer