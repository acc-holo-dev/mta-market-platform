// Benchmark plaque for table conversion (source/sdk/lua/argument.cpp): one
// call performs a FULL roundtrip -- the read path builds the recursive Table
// snapshot (lua_next traversal into an Argument tree) and the write path
// rebuilds the Lua table from it (lua_createtable + per-element pushes).
//
//   local copy = bench_table_roundtrip(t)  -- t, deep-copied through the SDK
//
// Measured by other/tests/lua/scripts/092_benchmark_tables.lua across several
// table sizes; the read-only snapshot path is additionally measured through
// sample_table_stats (the existing read conversion sample). This is a
// measurement surface only: the result equals the input by value.

#include <mta/sdk.hpp>

MTA_LUA_FUNCTION("bench_table_roundtrip",
    "Reads a table into a snapshot and pushes it back unchanged. Benchmark plaque: one full "
    "read+write table conversion per call.")
{
    auto [table] = mta::lua::args<mta::lua::Table>(L);
    return mta::lua::push_results(L, mta::lua::Argument(std::move(table)));
}