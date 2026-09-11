// Native MTA types as typed binder arguments: mta::Resource is
// accepted BY NAME and validated live through the module manager ABI -- an
// unknown or already stopped resource is a readable argument error, never a
// dangling wrapper. The same wrapper is also a result type: it is pushed to
// Lua as its name (the stable Lua-side identity).
//
//     sample_resource_arg("test_resource")      -- "test_resource", true
//     sample_resource_arg("no_such_resource")   -- error: no running resource
//     sample_resource_arg_optional("test_resource") -- "test_resource"
//     sample_resource_arg_optional(nil)             -- nil
//     sample_resource_return("test_resource")   -- "test_resource"

#include <mta/sdk.hpp>

#include <optional>
#include <string>
#include <tuple>

MTA_FUNCTION("sample_resource_arg",
    "Resolves a resource name into mta::Resource (live ABI validation); "
    "returns its name and alive flag.",
    [](mta::Resource resource)
    {
        return std::make_tuple(resource.name(), resource.alive());
    });

MTA_FUNCTION("sample_resource_arg_optional",
    "The running resource by name or nil when the argument is absent.",
    [](std::optional<mta::Resource> resource) -> std::optional<std::string>
    {
        if (!resource.has_value())
        {
            return std::nullopt;
        }
        return resource->name();
    });

MTA_FUNCTION("sample_resource_return",
    "Returns the resource wrapper itself; it is pushed to Lua as its name.",
    [](mta::Resource resource)
    {
        return resource;
    });