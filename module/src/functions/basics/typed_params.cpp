// Typed binder parameters beyond scalars: rest_args (the variadic
// tail) and context (VM + calling resource; consumes no Lua argument) are
// read by the binder itself -- a body-style function would unpack the same
// values by hand with args<...>.
//
//     sample_rest_count("a", "b", "c")  -- 3
//     sample_rest_count()               -- 0
//     sample_context_caller()           -- the calling resource name

#include <mta/sdk.hpp>

MTA_FUNCTION("sample_rest_count",
    "Counts the trailing arguments (typed rest_args parameter).",
    [](mta::lua::rest_args rest)
    {
        return static_cast<int>(rest.values.count());
    });

MTA_FUNCTION("sample_context_caller",
    "Returns the calling resource name through a typed mta::lua::context parameter.",
    [](mta::lua::context ctx)
    {
        return ctx.resource;
    });