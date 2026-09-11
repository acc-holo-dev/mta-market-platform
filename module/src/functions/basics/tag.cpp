// Same std::optional, but here nil is a meaningful value.

#include <mta/sdk.hpp>

#include <optional>
#include <string>

MTA_LUA_FUNCTION("sample_tag", "value/tag; tag is optional (nil).")
{
    auto [value, tag] = mta::lua::args<std::string, std::optional<std::string>>(L);
    return mta::lua::push_results(L, value + "/" + tag.value_or("none"));
}