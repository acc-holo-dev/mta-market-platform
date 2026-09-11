// Simplest possible function: arguments are read by type through args<...>,
// checks and readable errors come for free.

#include <mta/sdk.hpp>

MTA_LUA_FUNCTION("sample_add", "Returns the sum of two numbers.")
{
    auto [a, b] = mta::lua::args<double, double>(L);
    return mta::lua::push_results(L, a + b);
}