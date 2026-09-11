// Events: the module triggers an event into the resource's Lua scripts.
//
//     -- Lua:
//     addEventHandler("onSampleEvent", root, function(...) ... end)
//     sample_trigger_event("onSampleEvent", 1, "two")

#include <mta/sdk.hpp>

MTA_LUA_FUNCTION("sample_trigger_event",
    "Triggers an event with the given name and arguments (source is root).")
{
    auto [name] = mta::lua::args<std::string>(L);

    mta::lua::Arguments arguments;
    arguments.read(L, 2); // every argument after the name

    const bool ok = mta::events::trigger(L, name.c_str(), arguments);
    return mta::lua::push_results(L, ok);
}