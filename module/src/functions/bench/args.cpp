// Benchmark plaques for argument conversion (source/sdk/lua/argument.cpp and
// the typed binder in bind.hpp): every call pays the binder's typed argument
// reads, so a measured call rate directly reflects conversion cost.
//
//   bench_args_sum8(a..h)  -- eight numbers per call: the per-number
//                             conversion cost dominates the per-call overhead
//                             and can be separated from it (compare with the
//                             two-number sample_add call rate).
//   bench_args_mixed(...)  -- one conversion of each primitive kind per call
//                             (number, string, boolean, integer) and a
//                             four-value push on the way back.
//
// Measured by other/tests/lua/scripts/091_benchmark_arguments.lua. These are
// measurement surfaces only: they change no behavior beyond converting their
// arguments.

#include <mta/sdk.hpp>

MTA_LUA_FUNCTION("bench_args_sum8",
    "Returns the sum of eight numbers. Benchmark plaque: eight typed number conversions per call.")
{
    auto [a, b, c, d, e, f, g, h] =
        mta::lua::args<double, double, double, double, double, double, double, double>(L);
    return mta::lua::push_results(L, a + b + c + d + e + f + g + h);
}

MTA_LUA_FUNCTION("bench_args_mixed",
    "Returns all four arguments back. Benchmark plaque: one number, string, boolean and integer "
    "conversion per call, plus a four-value result push.")
{
    auto [number, text, flag, integer] = mta::lua::args<double, std::string, bool, std::int64_t>(L);
    return mta::lua::push_results(L, number, text, flag, integer);
}