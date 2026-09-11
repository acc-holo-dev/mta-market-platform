#include "sdk/native/resource.hpp"

#include "ILuaModuleManager10.h"
#include "sdk/abi/module.hpp"

#include <utility>

namespace mta
{
std::optional<Resource> Resource::find(std::string name)
{
    auto *manager = mta::module::manager();
    if (manager == nullptr || name.empty())
    {
        return std::nullopt;
    }
    // The lookup doubles as the validity check: an unknown or already
    // stopped resource has no VM.
    if (manager->GetResourceFromName(name.c_str()) == nullptr)
    {
        return std::nullopt;
    }
    return Resource(std::move(name));
}

std::optional<Resource> Resource::current(lua_State *lua_vm)
{
    std::string name = mta::module::current_resource_name(lua_vm);
    if (name.empty())
    {
        return std::nullopt;
    }
    return Resource(std::move(name));
}

lua_State *Resource::vm() const noexcept
{
    auto *manager = mta::module::manager();
    if (manager == nullptr || name_.empty())
    {
        return nullptr;
    }
    return manager->GetResourceFromName(name_.c_str());
}
} // namespace mta