#include "sdk/runtime/callback.hpp"

#include "ILuaModuleManager10.h"
#include "sdk/lua/protect.hpp"
#include "sdk/lua/stack.hpp"
#include "sdk/logging/logging.hpp"
#include "sdk/abi/module.hpp"
#include "sdk/resources/resources.hpp"

#include <unordered_map>
#include <utility>

namespace mta::async
{
namespace
{
struct TrackedRef
{
    bool dead = false;
    // The VM generation the reference was created in. A fresh VM after a
    // restart can hand out the SAME luaL_ref index; the generation is what
    // tells the two apart.
    std::uint64_t generation = 0;
};

// Registry indices from luaL_ref are only unique within a single VM, and
// every resource owns its own VM. Two resources can therefore legitimately
// receive the SAME index, so references are keyed by resource name first:
// equal indices in different VMs can never collide or leak into each other.
// Within one resource, generations separate the references of successive VMs.
using ResourceRefs = std::unordered_map<int, TrackedRef>;
std::unordered_map<std::string, ResourceRefs> &tracked_refs()
{
    static std::unordered_map<std::string, ResourceRefs> refs;
    return refs;
}

bool ref_is_dead(const std::string &resource, int ref, std::uint64_t generation) noexcept
{
    const auto &refs = tracked_refs();
    const auto resource_it = refs.find(resource);
    if (resource_it == refs.end())
    {
        return true;
    }
    const auto ref_it = resource_it->second.find(ref);
    return ref_it == resource_it->second.end() || ref_it->second.dead ||
           ref_it->second.generation != generation;
}

// Removes a reference from tracking; luaL_unref is called while the
// resource's VM is still reachable. Only the entry of the callback's OWN
// generation is touched: a stale callback releasing itself after a restart
// must not untrack the live reference that the fresh VM handed out for the
// same index.
void untrack_ref(const std::string &resource, int ref, std::uint64_t generation) noexcept
{
    auto &refs = tracked_refs();
    const auto resource_it = refs.find(resource);
    if (resource_it == refs.end())
    {
        return;
    }

    const auto ref_it = resource_it->second.find(ref);
    if (ref_it == resource_it->second.end() || ref_it->second.generation != generation)
    {
        return;
    }

    if (!ref_it->second.dead)
    {
        if (auto *manager = mta::module::manager())
        {
            if (lua_State *vm = manager->GetResourceFromName(resource.c_str()))
            {
                luaL_unref(vm, LUA_REGISTRYINDEX, ref);
            }
        }
    }

    resource_it->second.erase(ref_it);
    if (resource_it->second.empty())
    {
        refs.erase(resource_it);
    }
}
} // namespace

Callback::Callback(Callback &&other) noexcept
    : resource_(std::move(other.resource_)),
      ref_(other.ref_),
      generation_(other.generation_)
{
    other.ref_ = LUA_NOREF;
    other.resource_.clear();
}

Callback &Callback::operator=(Callback &&other) noexcept
{
    if (this != &other)
    {
        release();
        resource_ = std::move(other.resource_);
        ref_ = other.ref_;
        generation_ = other.generation_;
        other.ref_ = LUA_NOREF;
        other.resource_.clear();
    }
    return *this;
}

Callback::~Callback()
{
    release();
}

Callback Callback::from_stack(lua_State *lua_vm, int index)
{
    if (lua_isfunction(lua_vm, index) == 0)
    {
        mta::lua::raise_error("callback must be a function, got ",
                              mta::lua::detail::type_name(lua_type(lua_vm, index)));
    }

    const std::string resource = mta::module::current_resource_name(lua_vm);
    if (resource.empty())
    {
        mta::lua::raise_error("could not determine the calling resource for the callback");
    }

    lua_pushvalue(lua_vm, index);
    const int ref = luaL_ref(lua_vm, LUA_REGISTRYINDEX);

    tracked_refs()[resource][ref] = TrackedRef{false, mta::resources::Hub::instance().generation(resource)};

    Callback callback;
    callback.resource_ = resource;
    callback.ref_ = ref;
    callback.generation_ = mta::resources::Hub::instance().generation(resource);
    return callback;
}

bool Callback::call(const mta::lua::Arguments &arguments) const
{
    if (!valid() || ref_is_dead(resource_, ref_, generation_))
    {
        return false;
    }

    auto *manager = mta::module::manager();
    if (manager == nullptr)
    {
        return false;
    }

    lua_State *vm = manager->GetResourceFromName(resource_.c_str());
    if (vm == nullptr)
    {
        return false; // resource stopped (a restarted one would return a fresh VM)
    }

    // Second line of defense: even with a live tracked ref, a
    // callback of an older generation must never run in the fresh VM of a
    // restarted resource.
    const std::uint64_t current_generation = mta::resources::Hub::instance().generation(resource_);
    if (current_generation != generation_)
    {
        mta::log::debug("callback: dropping a stale callback for resource '", resource_,
                        "' from generation ", generation_, " (current generation ",
                        current_generation, ")");
        return false;
    }

    // Attribute log messages emitted around this call to the callback's
    // resource; restored when the call returns.
    mta::lua::detail::ScopedDiagnosticContext scope{nullptr, 0, 0};
    scope.set_resource(resource_);

    const int base = lua_gettop(vm);
    lua_rawgeti(vm, LUA_REGISTRYINDEX, ref_);
    if (lua_isfunction(vm, -1) == 0)
    {
        lua_settop(vm, base);
        return false;
    }

    // Every pushed argument consumes a stack slot; grow the stack explicitly
    // instead of risking a hard stack overflow inside the call.
    const int argument_count = static_cast<int>(arguments.count());
    if (lua_checkstack(vm, argument_count + 4) == 0)
    {
        mta::log::error("callback stack overflow: could not grow the Lua stack");
        lua_settop(vm, base);
        return false;
    }

    const int pushed = arguments.push(vm);
    if (lua_pcall(vm, pushed, 0, 0) != LUA_OK)
    {
        const char *message = lua_tostring(vm, -1);
        mta::log::error("module callback failed: ", message ? message : "unknown Lua error");
        lua_settop(vm, base);
        return false;
    }

    lua_settop(vm, base);
    return true;
}

void Callback::release() noexcept
{
    if (ref_ != LUA_NOREF)
    {
        untrack_ref(resource_, ref_, generation_);
        ref_ = LUA_NOREF;
        resource_.clear();
        generation_ = 0;
    }
}

void invalidate_resource_callbacks(const std::string &resource)
{
    auto &refs = tracked_refs();
    const auto resource_it = refs.find(resource);
    if (resource_it == refs.end())
    {
        return;
    }
    for (auto &[ref, tracked] : resource_it->second)
    {
        (void)ref;
        tracked.dead = true; // the VM dies right after this -- no unref needed
    }
}

void release_all_callbacks()
{
    auto &refs = tracked_refs();
    for (auto &[resource, resource_refs] : refs)
    {
        const std::uint64_t current_generation =
            mta::resources::Hub::instance().generation(resource);
        for (auto &[ref, tracked] : resource_refs)
        {
            // Only live references of the CURRENT generation still belong to
            // a reachable VM; older generations point into dead VMs.
            if (!tracked.dead && tracked.generation == current_generation)
            {
                if (auto *manager = mta::module::manager())
                {
                    if (lua_State *vm = manager->GetResourceFromName(resource.c_str()))
                    {
                        luaL_unref(vm, LUA_REGISTRYINDEX, ref);
                    }
                }
            }
        }
    }
    refs.clear();
}
} // namespace mta::async
