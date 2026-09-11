// Multiple results: push_results accepts any number of values.

#include <mta/sdk.hpp>

#include <algorithm>

MTA_LUA_FUNCTION("sample_minmax", "Returns the minimum and maximum of two numbers (two results).")
{
    auto [a, b] = mta::lua::args<double, double>(L);
    return mta::lua::push_results(L, std::min(a, b), std::max(a, b));
}