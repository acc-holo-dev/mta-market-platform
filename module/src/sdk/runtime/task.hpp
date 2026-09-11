#pragma once

// Developer-facing async task handle.
//
//     auto task = mta::async::run(L, work, completion);
//     task.cancel();   // the completion will never run
//     task.done();     // the task has finished (delivered, cancelled, dropped)
//     task.valid();    // false for a default handle / a queue-full rejection
//
// A Task is a light shared handle: copies share the state. Cancellation is
// cooperative -- running work cannot be interrupted, but its completion is
// suppressed, so a cancelled task never touches Lua. Tasks are owned by the
// resource that posted them: when that resource stops, queued
// tasks are cancelled and completions of a finished generation are dropped
// before any Lua access.

#include <cstdint>
#include <memory>
#include <mutex>

namespace mta::async
{
// Shared state between a Task handle and the scheduler.
struct TaskState
{
    enum class Status : int
    {
        Queued,    // waiting for a worker
        Running,   // work is executing on a worker
        Done,      // completion delivered (or delivered at shutdown attempt)
        Cancelled, // never delivered: cancelled, resource stopped, or shutdown
    };

    std::mutex mutex{};
    std::uint64_t id = 0;
    Status status = Status::Queued;
    bool cancel_requested = false;
};

class Task
{
public:
    Task() = default;
    explicit Task(std::shared_ptr<TaskState> state) noexcept
        : state_(std::move(state))
    {
    }

    // Returns true if the task existed and had not finished: its completion
    // will never run after this call. Queued tasks are not executed at all;
    // running work finishes but delivers nothing.
    bool cancel() noexcept;

    // true when nothing more will happen: completed, cancelled, or the
    // scheduler shut down. false for a default (invalid) handle.
    [[nodiscard]] bool done() const noexcept;

    // false for a default-constructed handle or a task rejected because the
    // queue was full.
    [[nodiscard]] bool valid() const noexcept { return state_ != nullptr; }

    // 0 for an invalid handle; otherwise the scheduler-assigned task id.
    [[nodiscard]] std::uint64_t id() const noexcept { return state_ ? state_->id : 0; }

private:
    std::shared_ptr<TaskState> state_;
};
} // namespace mta::async