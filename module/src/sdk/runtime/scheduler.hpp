#pragma once

// Background task engine with results delivered on the main thread.
//
// The Lua VM is NOT thread-safe: any lua_State access must happen on the
// server's main thread. The scheduler therefore runs pure C++ on workers and
// delivers results on the main thread inside DoPulse (see pump()), where the
// module core enters on every server frame. Lua is never called from a
// worker thread.
//
// The scheduler is the INTERNAL engine; the developer-facing API is
// mta::async::run() (see task.hpp), which returns a cancellable Task handle
// and attaches resource ownership automatically:
//
//     auto task = mta::async::run(L,
//         [] { /* background work, no Lua */ return mta::lua::Arguments{}; },
//         [](const mta::lua::Arguments &result, const char *error) {
//             /* main thread: deliver to Lua */
//         });
//     task.cancel(); task.done(); task.valid();
//
// Queue limits ([async] queue in config/module.toml) apply at post time: a
// full queue rejects the task (the handle is invalid) instead of blocking.
// Timers also fire on the main thread and are cancelled automatically when
// the owning resource stops.

#include "sdk/lua/arguments.hpp"
#include "sdk/runtime/task.hpp"
#include "sdk/runtime/timer.hpp"

#include <cstddef>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

struct lua_State;

namespace mta::async
{
class Scheduler
{
public:
    static Scheduler &instance();

    // Spawns the workers. Repeated calls are safe.
    void start();
    // Stops the workers, cancels every queued task and clears every queue.
    // Called on module shutdown; handles of posted tasks report done().
    void stop();
    // Main thread: dispatches finished results and fires timers. Never throws.
    void pump();

    // Runs work() on a worker; then completion(results, error) runs on the
    // main thread during pump(); error == nullptr on success. The task is
    // owned by (resource, generation) when a resource is given: on resource
    // stop, queued tasks are cancelled and completions of the finished
    // generation are dropped before any Lua access. Returns an invalid
    // handle when the queue is full (queue limits) -- fire-and-
    // forget callers may ignore the result.
    [[nodiscard]] Task post_task(std::function<mta::lua::Arguments()> work,
                                 std::function<void(const mta::lua::Arguments &, const char *)> completion,
                                 std::string resource = {},
                                 std::uint64_t generation = 0);

    // Calls completion(tick) every delay_ms, repeat_count times
    // (0 = until cancelled or the resource stops). Returns an id > 0.
    [[nodiscard]] std::uint64_t post_timer(std::string resource, int delay_ms, std::int64_t repeat_count,
                                            std::function<void(std::uint64_t)> completion);
    // Same, but returns a shared-state handle whose cancel()/valid() reflect
    // scheduler-side drops too (fired final, resource stopped, stale
    // generation) -- the mta::timer::after/every implementation.
    [[nodiscard]] timer::Timer post_timer_handle(std::string resource, int delay_ms,
                                                 std::int64_t repeat_count,
                                                 std::function<void(std::uint64_t)> completion);
    bool cancel_timer(std::uint64_t timer_id);

    // Cancels the timers of a resource that just stopped.
    void handle_resource_stopped(const std::string &resource);

    // Runtime override of the task-queue limit. Main thread.
    void configure(std::size_t queue_limit);

    [[nodiscard]] bool running() const noexcept;

private:
    Scheduler();
    ~Scheduler();
    Scheduler(const Scheduler &) = delete;
    Scheduler &operator=(const Scheduler &) = delete;

    void worker_loop();
    [[nodiscard]] std::shared_ptr<timer::TimerState> post_timer_impl(
        std::string &resource, int delay_ms, std::int64_t repeat_count,
        std::function<void(std::uint64_t)> completion);

    struct Impl;
    std::unique_ptr<Impl> impl_;
};

// Developer-facing task API: posts the task, attributes it to the
// calling resource and returns a cancellable handle.
[[nodiscard]] Task run(lua_State *lua_vm, std::function<mta::lua::Arguments()> work,
                       std::function<void(const mta::lua::Arguments &, const char *)> completion);
} // namespace mta::async
