// Async task handle: run() returns a Task that can be cancelled
// before its completion is delivered, and reports its state.
//
//     local id = sample_task_run(100, 2, 3, function(sum) ... end)
//     sample_task_cancel(id)  -- true: the completion will never run

#include <mta/sdk.hpp>

#include <library/base/handle_map.hpp>

#include <chrono>
#include <cstdint>
#include <memory>
#include <thread>
#include <utility>

namespace
{
// Live task handles of the calling resource (main thread only; cleared when
// the resource stops). HandleMap is the reusable id->handle registry from
// the library layer (functions may use library).
mta::resources::Store<mta::library::base::HandleMap<std::uint64_t, mta::async::Task>> g_tasks;
} // namespace

MTA_LUA_FUNCTION("sample_task_run",
    "Computes a + b on a worker after delay_ms; callback(sum) fires on the "
    "main thread. Returns the task id for sample_task_cancel.")
{
    auto [delay_ms, a, b, callback] =
        mta::lua::args<std::int64_t, double, double, mta::async::Callback>(L);

    auto cb = std::make_shared<mta::async::Callback>(std::move(callback));

    mta::async::Task task = mta::async::run(
        L,
        [delay_ms, a, b]() -> mta::lua::Arguments {
            std::this_thread::sleep_for(std::chrono::milliseconds(static_cast<int>(delay_ms)));
            mta::lua::Arguments result;
            result.push_number(a + b);
            return result;
        },
        [cb](const mta::lua::Arguments &result, const char *error) {
            if (error != nullptr)
            {
                mta::log::error("sample_task_run failed: ", error);
                return;
            }
            cb->call(result);
        });

    if (!task.valid())
    {
        mta::lua::raise_error("task queue is full: task not accepted");
    }

    const std::uint64_t id = task.id();
    if (!g_tasks.for_state(L).emplace(id, std::move(task)))
    {
        mta::log::error("sample_task_run: duplicate task id ", id);
    }
    return mta::lua::push_results(L, static_cast<lua_Number>(id));
}

MTA_LUA_FUNCTION("sample_task_cancel",
    "Cancels a queued task: its completion will never run. true if cancelled.")
{
    auto [id] = mta::lua::args<std::int64_t>(L);

    auto *tasks = &g_tasks.for_state(L);
    mta::async::Task *task = tasks->find(static_cast<std::uint64_t>(id));
    if (task == nullptr)
    {
        return mta::lua::push_results(L, false);
    }

    const bool cancelled = task->cancel();
    tasks->erase(static_cast<std::uint64_t>(id));
    return mta::lua::push_results(L, cancelled);
}