// The state view: mta::state / MTA_STATE wraps the calling VM for
// synchronous operations -- borrowed access, never stored. sample_state
// exposes the view's basics; sample_state_readers exercises the typed
// readers (check_*) and the view's push_results.

#include <mta/sdk.hpp>

MTA_LUA_FUNCTION("sample_state",
    "Returns a table {resource = ..., top = ...} describing the calling VM "
    "through the mta::state view.")
{
    mta::state view = MTA_STATE(L);

    mta::lua::Table data;
    data.fields.emplace_back("resource", mta::lua::Argument(view.resource_name()));
    data.fields.emplace_back("top", mta::lua::Argument(static_cast<lua_Number>(view.top())));
    return mta::lua::push_results(L, mta::lua::Argument(std::move(data)));
}

MTA_LUA_FUNCTION("sample_state_readers",
    "Reads (number, integer, boolean, string) through the mta::state typed "
    "readers and returns them back through the view's push_results.")
{
    mta::state view = MTA_STATE(L);

    const double number = view.check_number(1);
    const lua_Integer integer = view.check_integer(2);
    const bool flag = view.check_boolean(3);
    const std::string text = view.check_string(4);

    return view.push_results(number, static_cast<lua_Number>(integer), flag, text);
}