// Reading nested tables and building a result table. The Table parameter is
// validated automatically: a non-table produces a readable Lua error.
//
//   sample_table_stats({10, 20, {30, 40}, name = "x", flag = true})
//     -> {values=7, numbers=4, strings=1, sum=100, depth=2}

#include <mta/sdk.hpp>

#include <algorithm>
#include <cstdint>

namespace
{
struct TableStats
{
    std::uint64_t values = 0;
    std::uint64_t numbers = 0;
    std::uint64_t strings = 0;
    double sum = 0.0;
    int depth = 0;
};

void collect_value(const mta::lua::Argument &value, int level, TableStats &stats);

void collect_table(const mta::lua::Table &table, int level, TableStats &stats)
{
    stats.depth = std::max(stats.depth, level);
    for (const auto &entry : table.array)
    {
        collect_value(entry, level + 1, stats);
    }
    for (const auto &entry : table.fields)
    {
        collect_value(entry.second, level + 1, stats);
    }
}

void collect_value(const mta::lua::Argument &value, int level, TableStats &stats)
{
    using mta::lua::Argument;

    stats.depth = std::max(stats.depth, level);

    switch (value.type())
    {
    case Argument::Type::Number:
        ++stats.values;
        ++stats.numbers;
        stats.sum += value.as_number();
        break;
    case Argument::Type::String:
        ++stats.values;
        ++stats.strings;
        break;
    case Argument::Type::Boolean:
        ++stats.values;
        break;
    case Argument::Type::Table:
        // The table already sits at 'level'; its children are at level + 1.
        collect_table(value.as_table(), level, stats);
        break;
    default:
        break;
    }
}
} // namespace

MTA_LUA_FUNCTION("sample_table_stats",
    "Returns table statistics: {values, numbers, strings, sum, depth}.")
{
    auto [table] = mta::lua::args<mta::lua::Table>(L);

    TableStats stats;
    collect_table(table, 0, stats);

    mta::lua::Table result;
    result.fields.emplace_back("values", mta::lua::Argument(static_cast<lua_Number>(stats.values)));
    result.fields.emplace_back("numbers", mta::lua::Argument(static_cast<lua_Number>(stats.numbers)));
    result.fields.emplace_back("strings", mta::lua::Argument(static_cast<lua_Number>(stats.strings)));
    result.fields.emplace_back("sum", mta::lua::Argument(stats.sum));
    result.fields.emplace_back("depth", mta::lua::Argument(static_cast<lua_Number>(stats.depth)));

    return mta::lua::push_results(L, mta::lua::Argument(std::move(result)));
}