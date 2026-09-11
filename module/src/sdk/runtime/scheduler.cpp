#include "sdk/runtime/scheduler.hpp"

#include "sdk/abi/module.hpp"

// scheduler dereferences the manager (GetResourceFromName) — the forward
// declaration in module.hpp is not enough. This TU must compile standalone
// (non-unity builds broke on g++ 15: incomplete ILuaModuleManager10).
#include "ILuaModuleManager10.h"
#include "sdk/logging/logging.hpp"
#include "sdk/lua/protect.hpp"
#include "sdk/resources/resources.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <utility>
#include <vector>

namespace mta::async
{
namespace
{
using clock_type = std::chrono::steady_clock;

constexpr int minimum_timer_delay_ms = 1;
constexpr std::size_t default_queue_limit = 4096;

// Worker count from [async] workers in config/module.toml: "auto" compiles
// to SDK_ASYNC_WORKERS_AUTO, a number to SDK_ASYNC_WORKERS_N.
unsigned configured_worker_count()
{
#if defined(SDK_ASYNC_WORKERS_AUTO)
    const unsigned hardware = std::thread::hardware_concurrency();
    return hardware == 0 ? 2u : std::clamp(hardware, 1u, 8u);
#elif defined(SDK_ASYNC_WORKERS_N)
    return static_cast<unsigned>(SDK_ASYNC_WORKERS_N);
#else
    return 3;
#endif
}

// Queue limit from [async] queue in config/module.toml.
std::size_t configured_queue_limit()
{
#if defined(SDK_ASYNC_QUEUE_N)
    return static_cast<std::size_t>(SDK_ASYNC_QUEUE_N);
#else
    return default_queue_limit;
#endif
}
} // namespace

// Implementation-only types kept OUT of the anonymous namespace: with
// -Werror=subobject-linkage, Scheduler::Impl (external linkage) may not hold
// fields of internal-linkage types (GCC 13+, notably under unity builds).

// A posted task: the shared handle state plus the job.
struct TaskJob
{
    std::shared_ptr<TaskState> state;
    std::function<mta::lua::Arguments()> work;
    std::function<void(const mta::lua::Arguments &, const char *)> completion;
    std::string resource;
    std::uint64_t generation = 0;
};

struct Completion
{
    mta::lua::Arguments results;
    std::string error;
    std::function<void(const mta::lua::Arguments &, const char *)> completion;
    std::string resource;
    std::uint64_t generation = 0;
    // The async task the completion belongs to (0 = unattributed); part of
    // the automatic log-message context.
    std::uint64_t task_id = 0;
};

struct Timer
{
    std::uint64_t id = 0;
    std::string resource;
    // VM generation of the owning resource at creation time: a
    // timer never fires across a restart of its resource.
    std::uint64_t generation = 0;
    // Shared with the public handle when one exists (post_timer_handle):
    // every scheduler-side drop marks the state finished.
    std::shared_ptr<mta::timer::TimerState> state;
    clock_type::time_point next_fire{};
    int interval_ms = 1;
    std::int64_t repeats_left = 0; // 0 = forever
    std::uint64_t fired = 0;
    std::function<void(std::uint64_t)> completion;
};

struct Scheduler::Impl
{
    std::mutex queue_mutex{};
    std::condition_variable queue_signal{};
    std::deque<TaskJob> tasks{};
    std::vector<Completion> completions{};
    std::vector<std::thread> workers{};
    std::atomic<bool> stopping{false};

    // Live task states, for shutdown sweeping. Main thread + workers (under
    // queue_mutex); every entry erases itself when the task goes terminal.
    std::unordered_map<std::uint64_t, std::shared_ptr<TaskState>> live_tasks{};
    std::uint64_t next_task_id = 1;

    // Timers live on the main thread only (pump/handle_resource_stopped/
    // post_timer), so no mutex is needed for them.
    std::vector<Timer> timers{};
    std::uint64_t next_timer_id = 1;

    std::size_t queue_limit = configured_queue_limit();
};

Scheduler &Scheduler::instance()
{
    static Scheduler scheduler;
    return scheduler;
}

Scheduler::Scheduler()
    : impl_(std::make_unique<Impl>())
{
}

Scheduler::~Scheduler()
{
    stop();
}

void Scheduler::start()
{
    std::lock_guard<std::mutex> lock(impl_->queue_mutex);
    if (!impl_->workers.empty())
    {
        return;
    }

    impl_->stopping.store(false);
    const unsigned count = configured_worker_count();
    impl_->workers.reserve(count);
    for (unsigned i = 0; i < count; ++i)
    {
        impl_->workers.emplace_back([this] { worker_loop(); });
    }
}

void Scheduler::worker_loop()
{
    while (true)
    {
        TaskJob job;
        {
            std::unique_lock<std::mutex> lock(impl_->queue_mutex);
            impl_->queue_signal.wait(lock, [this] {
                return impl_->stopping.load() || !impl_->tasks.empty();
            });

            if (impl_->stopping.load())
            {
                return; // unfinished tasks are dropped on shutdown
            }

            job = std::move(impl_->tasks.front());
            impl_->tasks.pop_front();

            // queue_mutex -> state->mutex is the lock order everywhere; a
            // cancelled queued task is skipped without running its work.
            std::lock_guard<std::mutex> state_lock(job.state->mutex);
            if (job.state->status == TaskState::Status::Cancelled)
            {
                impl_->live_tasks.erase(job.state->id);
                continue;
            }
            job.state->status = TaskState::Status::Running;
        }

        Completion completion;
        completion.resource = job.resource;
        completion.generation = job.generation;
        completion.task_id = job.state->id;
        // Attribute log messages emitted by the background work to the
        // owning resource and task; the context is per-thread, so
        // a worker thread gets its own.
        mta::lua::detail::ScopedDiagnosticContext scope{nullptr, job.state->id, 0};
        scope.set_resource(job.resource);
        try
        {
            completion.results = job.work();
        }
        catch (const std::exception &e)
        {
            completion.error = e.what();
        }
        catch (...)
        {
            completion.error = "unknown C++ exception in async task";
        }
        completion.completion = std::move(job.completion);

        {
            std::lock_guard<std::mutex> lock(impl_->queue_mutex);
            std::lock_guard<std::mutex> state_lock(job.state->mutex);
            if (impl_->stopping.load() || job.state->cancel_requested)
            {
                job.state->status = TaskState::Status::Cancelled; // deliver nothing
            }
            else
            {
                job.state->status = TaskState::Status::Done;
                impl_->completions.push_back(std::move(completion));
            }
            impl_->live_tasks.erase(job.state->id);
        }
    }
}

void Scheduler::stop()
{
    {
        std::lock_guard<std::mutex> lock(impl_->queue_mutex);
        impl_->stopping.store(true);
        // Every still-queued task is cancelled; running ones are finished by
        // their workers (which deliver nothing once stopping is set).
        for (auto &[id, state] : impl_->live_tasks)
        {
            (void)id;
            std::lock_guard<std::mutex> state_lock(state->mutex);
            if (state->status == TaskState::Status::Queued)
            {
                state->status = TaskState::Status::Cancelled;
            }
        }
    }
    impl_->queue_signal.notify_all();

    for (auto &worker : impl_->workers)
    {
        if (worker.joinable())
        {
            worker.join();
        }
    }
    impl_->workers.clear();

    {
        std::lock_guard<std::mutex> lock(impl_->queue_mutex);
        impl_->tasks.clear();
        impl_->completions.clear();
        impl_->live_tasks.clear();
    }
    impl_->timers.clear();
}

void Scheduler::pump()
{
    // Deliver the results of finished background tasks. A completion owned
    // by a resource whose VM is gone or whose generation has ended never
    // reaches Lua.
    std::vector<Completion> ready;
    {
        std::lock_guard<std::mutex> lock(impl_->queue_mutex);
        ready.swap(impl_->completions);
    }

    for (auto &entry : ready)
    {
        if (!entry.resource.empty())
        {
            auto *manager = mta::module::manager();
            lua_State *vm = manager != nullptr
                                ? manager->GetResourceFromName(entry.resource.c_str())
                                : nullptr;
            const std::uint64_t current =
                mta::resources::Hub::instance().generation(entry.resource);
            if (vm == nullptr || current != entry.generation)
            {
                mta::log::debug("async: dropping a completion for resource '", entry.resource,
                                "' from generation ", entry.generation, " (current generation ",
                                current, ")");
                continue;
            }
        }

        // Attribute the delivery (and its log output) to the owning
        // resource and task.
        mta::lua::detail::ScopedDiagnosticContext scope{nullptr, entry.task_id, 0};
        scope.set_resource(entry.resource);
        try
        {
            entry.completion(entry.results, entry.error.empty() ? nullptr : entry.error.c_str());
        }
        catch (const std::exception &e)
        {
            mta::log::error("async completion failed: ", e.what());
        }
        catch (...)
        {
            mta::log::error("async completion failed: unknown C++ exception");
        }
    }

    // Fire the timers whose time has come. Due timers are moved into a local
    // snapshot BEFORE any callback runs: a callback may create or cancel
    // timers (post_timer/cancel_timer), and mutating impl_->timers while
    // iterating over it would invalidate iterators and references. Timers of
    // a stale generation (their resource restarted meanwhile) are dropped:
    // they must never fire into a fresh VM.
    const auto now = clock_type::now();

    std::vector<Timer> due;
    {
        auto &timers = impl_->timers;
        for (auto it = timers.begin(); it != timers.end();)
        {
            if (it->next_fire > now)
            {
                ++it;
                continue;
            }
            if (it->generation != mta::resources::Hub::instance().generation(it->resource))
            {
                mta::log::debug("timer: dropping a stale timer of resource '", it->resource,
                                "' from generation ", it->generation);
                if (it->state != nullptr)
                {
                    it->state->finished = true;
                }
                it = timers.erase(it);
                continue;
            }
            due.push_back(std::move(*it));
            it = timers.erase(it);
        }
    }

    for (auto &timer : due)
    {
        ++timer.fired;
        // Attribute the dispatch (and its log output) to the firing timer
        // and its resource.
        mta::lua::detail::ScopedDiagnosticContext scope{nullptr, 0, timer.id};
        scope.set_resource(timer.resource);
        try
        {
            timer.completion(timer.fired);
        }
        catch (const std::exception &e)
        {
            mta::log::error("timer callback failed: ", e.what());
        }
        catch (...)
        {
            mta::log::error("timer callback failed: unknown C++ exception");
        }

        // The handle may have been cancelled from inside this very callback:
        // the scheduler-side erase cannot find a timer that is being
        // dispatched from the local snapshot, so drop it here -- cancel()
        // must mean the completion never fires again.
        if (timer.state != nullptr && timer.state->cancelled)
        {
            continue;
        }

        if (timer.repeats_left > 0 && --timer.repeats_left == 0)
        {
            if (timer.state != nullptr)
            {
                timer.state->finished = true; // repeat limit reached -- drop
            }
            continue;
        }

        timer.next_fire = now + std::chrono::milliseconds(timer.interval_ms);
        impl_->timers.push_back(std::move(timer));
    }
}

Task Scheduler::post_task(std::function<mta::lua::Arguments()> work,
                          std::function<void(const mta::lua::Arguments &, const char *)> completion,
                          std::string resource, std::uint64_t generation)
{
    auto state = std::make_shared<TaskState>();
    {
        std::lock_guard<std::mutex> lock(impl_->queue_mutex);
        if (impl_->stopping.load())
        {
            return Task{}; // shutdown: nothing is accepted anymore
        }
        if (impl_->tasks.size() >= impl_->queue_limit)
        {
            mta::log::error("async: task queue is full (", impl_->queue_limit,
                            "); task rejected");
            return Task{};
        }
        state->id = impl_->next_task_id++;
        impl_->tasks.push_back(
            TaskJob{state, std::move(work), std::move(completion), std::move(resource), generation});
        impl_->live_tasks.emplace(state->id, state);
    }
    impl_->queue_signal.notify_one();
    return Task(std::move(state));
}

Task run(lua_State *lua_vm, std::function<mta::lua::Arguments()> work,
         std::function<void(const mta::lua::Arguments &, const char *)> completion)
{
    const std::string resource = mta::module::current_resource_name(lua_vm);
    std::uint64_t generation = 0;
    if (!resource.empty())
    {
        generation = mta::resources::Hub::instance().generation(resource);
    }
    return Scheduler::instance().post_task(std::move(work), std::move(completion), resource,
                                           generation);
}

std::uint64_t Scheduler::post_timer(std::string resource, int delay_ms, std::int64_t repeat_count,
                                    std::function<void(std::uint64_t)> completion)
{
    return post_timer_impl(resource, delay_ms, repeat_count, std::move(completion))->id;
}

timer::Timer Scheduler::post_timer_handle(std::string resource, int delay_ms, std::int64_t repeat_count,
                                          std::function<void(std::uint64_t)> completion)
{
    return timer::Timer{post_timer_impl(resource, delay_ms, repeat_count, std::move(completion))};
}

std::shared_ptr<timer::TimerState> Scheduler::post_timer_impl(
    std::string &resource, int delay_ms, std::int64_t repeat_count,
    std::function<void(std::uint64_t)> completion)
{
    Timer timer;
    timer.id = impl_->next_timer_id++;
    timer.state = std::make_shared<mta::timer::TimerState>();
    timer.state->id = timer.id;
    timer.state->resource = resource;
    timer.generation = mta::resources::Hub::instance().generation(resource);
    timer.state->generation = timer.generation;
    timer.resource = std::move(resource);
    if (delay_ms < minimum_timer_delay_ms)
    {
        mta::log::warn("scheduler: post_timer delay ", delay_ms, " ms clamped to ", minimum_timer_delay_ms);
    }
    timer.interval_ms = std::max(delay_ms, minimum_timer_delay_ms);
    timer.repeats_left = repeat_count < 0 ? 0 : repeat_count;
    timer.next_fire = clock_type::now() + std::chrono::milliseconds(timer.interval_ms);
    timer.completion = std::move(completion);

    auto state = timer.state; // copy before the timer is moved into the list
    impl_->timers.push_back(std::move(timer));
    return state;
}

bool Scheduler::cancel_timer(std::uint64_t timer_id)
{
    const auto it = std::find_if(impl_->timers.begin(), impl_->timers.end(),
                                 [timer_id](const Timer &timer) { return timer.id == timer_id; });
    if (it == impl_->timers.end())
    {
        return false;
    }
    if (it->state != nullptr)
    {
        it->state->finished = true;
    }
    impl_->timers.erase(it);
    return true;
}

void Scheduler::handle_resource_stopped(const std::string &resource)
{
    // Timers of the stopped resource are cancelled outright; handles of
    // public timers report invalid afterwards.
    for (auto it = impl_->timers.begin(); it != impl_->timers.end();)
    {
        if (it->resource == resource)
        {
            if (it->state != nullptr)
            {
                it->state->finished = true;
            }
            it = impl_->timers.erase(it);
        }
        else
        {
            ++it;
        }
    }

    // Still-queued tasks of the stopped generation are cancelled: their
    // completions must never run. Running ones are dropped at
    // delivery by the generation check in pump().
    std::lock_guard<std::mutex> lock(impl_->queue_mutex);
    for (auto it = impl_->tasks.begin(); it != impl_->tasks.end();)
    {
        if (it->resource == resource)
        {
            std::lock_guard<std::mutex> state_lock(it->state->mutex);
            if (it->state->status == TaskState::Status::Queued)
            {
                it->state->status = TaskState::Status::Cancelled;
                impl_->live_tasks.erase(it->state->id);
            }
            it = impl_->tasks.erase(it);
        }
        else
        {
            ++it;
        }
    }
}

void Scheduler::configure(std::size_t queue_limit)
{
    std::lock_guard<std::mutex> lock(impl_->queue_mutex);
    impl_->queue_limit = queue_limit == 0 ? 1 : queue_limit;
}

bool Scheduler::running() const noexcept
{
    return !impl_->stopping.load() && !impl_->workers.empty();
}

// --- Task handle ---------------------------------------------------------------

bool Task::cancel() noexcept
{
    if (state_ == nullptr)
    {
        return false;
    }
    std::lock_guard<std::mutex> lock(state_->mutex);
    switch (state_->status)
    {
    case TaskState::Status::Queued:
        state_->status = TaskState::Status::Cancelled;
        return true;
    case TaskState::Status::Running:
        state_->cancel_requested = true;
        return true;
    default:
        return false;
    }
}

bool Task::done() const noexcept
{
    if (state_ == nullptr)
    {
        return false;
    }
    std::lock_guard<std::mutex> lock(state_->mutex);
    return state_->status == TaskState::Status::Done || state_->status == TaskState::Status::Cancelled;
}
} // namespace mta::async