// Table helpers: read/write fields by string key.
//
//     local t = {name = "Alice", hp = 100}
//     local name, hp = sample_table_get(t)   -- "Alice", 100

#include <mta/sdk.hpp>

#include <string>

MTA_LUA_FUNCTION("sample_table_get",
    "Reads the 'name' (string) and 'hp' (number) fields of a table; returns both.")
{
    auto [table] = mta::lua::args<mta::lua::Table>(L);

    const std::string name = mta::lua::get_field<std::string>(table, "name", "unknown");
    const double hp = mta::lua::get_field<double>(table, "hp", 0.0);

    return mta::lua::push_results(L, name, hp);
}

MTA_LUA_FUNCTION("sample_table_set",
    "Writes the 'name' field into a table and returns the table back.")
{
    auto [table, name] = mta::lua::args<mta::lua::Table, std::string>(L);

    mta::lua::set_field(table, "name", mta::lua::Argument(name));

    return mta::lua::push_results(L, mta::lua::Argument(std::move(table)));
}