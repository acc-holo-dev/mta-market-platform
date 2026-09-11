// Result list: use Arguments when the number of results is dynamic.
// Integer parameters are range-checked automatically.

#include <mta/sdk.hpp>

#include <cstdint>

MTA_LUA_FUNCTION("sample_range", "Returns the numbers from 'from' to 'to' (several results).")
{
    auto [from, to] = mta::lua::args<std::int64_t, std::int64_t>(L);

    // Reject oversized ranges. The comparison uses unsigned arithmetic so
    // extreme values (e.g. INT64_MIN..INT64_MAX) cannot overflow.
    if (to >= from && static_cast<std::uint64_t>(to) - static_cast<std::uint64_t>(from) > 1000)
    {
        mta::lua::raise_error("range too large: at most 1000 numbers");
    }

    mta::lua::Arguments result;
    for (std::int64_t i = from; i <= to; ++i)
    {
        result.push_number(static_cast<lua_Number>(i));
    }
    return result.push(L);
}