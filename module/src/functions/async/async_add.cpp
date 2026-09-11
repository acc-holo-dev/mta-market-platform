// Async pattern: compute on a worker, deliver the result through a callback
// via DoPulse. The Callback is just a typed parameter; the task is owned by
// the calling resource and survives its restarts within one generation.

#include <mta/sdk.hpp>

#include <memory>
#include <utility>

MTA_LUA_FUNCTION("sample_async_add",
    "Adds two numbers on a worker; callback(sum) fires on the next DoPulse.")
{
    auto [a, b, callback] = mta::lua::args<double, double, mta::async::Callback>(L);

    // std::function needs copyable targets, so the move-only Callback is
    // wrapped in make_shared when captured into the completion.
    auto cb = std::make_shared<mta::async::Callback>(std::move(callback));

    const mta::async::Task task = mta::async::run(
        L,
        [a, b]() -> mta::lua::Arguments {
            mta::lua::Arguments result;
            result.push_number(a + b);
            return result;
        },
        [cb](const mta::lua::Arguments &result, const char *error) {
            if (error != nullptr)
            {
                mta::log::error("sample_async_add failed: ", error);
                return;
            }
            cb->call(result);
        });

    // run() returns a cancellable handle; a full queue rejects the task.
    if (!task.valid())
    {
        mta::log::error("sample_async_add: task queue is full");
    }

    return mta::lua::push_results(L, task.valid());
}