#pragma once

// Per-resource state with automatic cleanup, and the ResourceContext identity
//: every resource has a generation that increments on every stop.
//
// Every MTA resource lives in its own VM, and that VM dies when the resource
// stops. Everything the module stores per resource must be reset in
// ResourceStopped. Store does this for you:
//
//     namespace
//     {
//     mta::resources::Store<MySession> g_sessions;
//     }
//
//     MTA_LUA_FUNCTION("session_get", "...")
//     {
//         MySession &session = g_sessions.for_state(L);
//         ...
//     }
//
// Use only from module functions (main thread, live VM): the store
// determines the calling resource through the module manager.
//
// Generation rule: a resource named "test" runs under
// generation N; after a restart it runs under generation N+1 with a FRESH
// VM. Callbacks, async tasks and timers record the generation they were
// created in and are never allowed to operate across generations -- stale
// objects can never reach the new VM of a resource with the same name.

#include "sdk/lua/protect.hpp"
#include "sdk/abi/module.hpp"

#include <cstdint>
#include <string>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>

namespace mta::resources
{
// Lifecycle-notification recipient; the module core calls the hub from
// ResourceStopping/ResourceStopped/ShutdownModule on the main thread.
class Sink
{
public:
    virtual ~Sink() = default;
    virtual void on_resource_stopping(const std::string &resource)
    {
        (void)resource;
    }
    virtual void on_resource_stopped(const std::string &resource) = 0;
    virtual void on_all_released() = 0;
};

class Hub
{
public:
    static Hub &instance();

    void add(Sink &sink);
    void remove(Sink &sink) noexcept;

    void notify_resource_stopping(const std::string &resource);
    void notify_resource_stopped(const std::string &resource);
    void notify_all_released();

    // The current generation of a resource: 1 for a resource that never
    // stopped, +1 for every completed stop/restart cycle.
    [[nodiscard]] std::uint64_t generation(const std::string &resource) const noexcept;

    // Ends the current generation (called when a resource stops); the next
    // start of the same resource runs under the returned generation + 1.
    void bump_generation(const std::string &resource) noexcept;

    // Clears the generation bookkeeping (module shutdown).
    void forget_all_generations() noexcept;

private:
    Hub() = default;
    std::unordered_set<Sink *> sinks_{};
    std::unordered_map<std::string, std::uint64_t> generations_{};
};

// Per-resource data of type T. T must be default-constructible.
template <typename T>
class Store final : public Sink
{
    static_assert(std::is_default_constructible_v<T>, "per-resource state type must be default-constructible");

public:
    Store()
    {
        Hub::instance().add(*this);
    }

    ~Store() override
    {
        Hub::instance().remove(*this);
    }

    Store(const Store &) = delete;
    Store &operator=(const Store &) = delete;

    // Data of the resource that is calling now. Created on first access.
    T &for_state(lua_State *lua_vm)
    {
        const std::string resource = mta::module::current_resource_name(lua_vm);
        if (resource.empty())
        {
            mta::lua::raise_error("could not determine the calling resource");
        }
        return data_[resource];
    }

    [[nodiscard]] T *try_find(const std::string &resource) noexcept
    {
        const auto it = data_.find(resource);
        return it == data_.end() ? nullptr : &it->second;
    }

    void on_resource_stopped(const std::string &resource) override
    {
        data_.erase(resource);
    }

    void on_all_released() override
    {
        data_.clear();
    }

private:
    std::unordered_map<std::string, T> data_{};
};
} // namespace mta::resources
