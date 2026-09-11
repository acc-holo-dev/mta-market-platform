// Optional argument via std::optional: nil or absence yields nullopt,
// the default is pulled out with value_or.

#include <mta/sdk.hpp>

#include <optional>
#include <string>

MTA_LUA_FUNCTION("sample_greet", "Greets a name; greeting is optional (nil).")
{
    auto [name, greeting] = mta::lua::args<std::string, std::optional<std::string>>(L);
    return mta::lua::push_results(L, greeting.value_or("hello") + ", " + name);
}