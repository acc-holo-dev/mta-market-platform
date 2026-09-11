// Native MTA types: the safe Resource wrapper. The module ABI
// exposes no element/player API, so these samples cover what is safely
// representable: live resource lookup by name and the calling resource.
//
//     sample_resource_name()          -- "test_resource" (the caller)
//     sample_resource_find(name)      -- true while that resource is running

#include <mta/sdk.hpp>

MTA_LUA_FUNCTION("sample_resource_name",
    "The name of the resource this function was called from.")
{
    auto self = mta::Resource::current(L);
    if (!self.has_value())
    {
        mta::lua::raise_error("could not determine the calling resource");
    }
    return mta::lua::push_results(L, self->name());
}

MTA_LUA_FUNCTION("sample_resource_find",
    "true if a resource with the given name is currently running (live ABI "
    "lookup; a stopped resource reports false).")
{
    auto [name] = mta::lua::args<std::string>(L);

    auto resource = mta::Resource::find(name);
    if (!resource.has_value())
    {
        return mta::lua::push_results(L, false);
    }

    // find() only reports resources whose VM is registered; alive() is the
    // live re-check (the resource could have stopped between the two).
    return mta::lua::push_results(L, resource->alive());
}