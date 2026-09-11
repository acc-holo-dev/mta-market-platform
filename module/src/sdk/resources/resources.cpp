#include "sdk/resources/resources.hpp"

namespace mta::resources
{
Hub &Hub::instance()
{
    static Hub hub;
    return hub;
}

void Hub::add(Sink &sink)
{
    sinks_.insert(&sink);
}

void Hub::remove(Sink &sink) noexcept
{
    sinks_.erase(&sink);
}

void Hub::notify_resource_stopping(const std::string &resource)
{
    // Iterate over a copy: a sink may unsubscribe itself inside a callback.
    const auto sinks = sinks_;
    for (auto *sink : sinks)
    {
        if (sink != nullptr)
        {
            sink->on_resource_stopping(resource);
        }
    }
}

void Hub::notify_resource_stopped(const std::string &resource)
{
    // The generation ends BEFORE the sinks run: anything invalidated inside
    // the sinks already belongs to the finished generation.
    bump_generation(resource);

    const auto sinks = sinks_;
    for (auto *sink : sinks)
    {
        if (sink != nullptr)
        {
            sink->on_resource_stopped(resource);
        }
    }
}

void Hub::notify_all_released()
{
    const auto sinks = sinks_;
    for (auto *sink : sinks)
    {
        if (sink != nullptr)
        {
            sink->on_all_released();
        }
    }
}

std::uint64_t Hub::generation(const std::string &resource) const noexcept
{
    const auto it = generations_.find(resource);
    return it == generations_.end() ? 1 : it->second;
}

void Hub::bump_generation(const std::string &resource) noexcept
{
    // Generations start at 1; the first stop moves the resource to 2 so that
    // objects created before the first stop (generation 1) are stale.
    auto it = generations_.find(resource);
    if (it == generations_.end())
    {
        generations_.emplace(resource, 2);
    }
    else
    {
        ++it->second;
    }
}

void Hub::forget_all_generations() noexcept
{
    generations_.clear();
}
} // namespace mta::resources
