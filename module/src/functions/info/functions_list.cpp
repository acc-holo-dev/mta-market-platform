// Built-in introspection: a list of every module function with its description.

#include <mta/sdk.hpp>

#include <string>

MTA_LUA_FUNCTION("module_functions",
    "Returns a table {name = description} with all module functions.")
{
    mta::lua::Table table;
    for (const auto &spec : mta::registered_functions())
    {
        table.fields.emplace_back(
            spec.name, mta::lua::Argument(std::string(spec.description ? spec.description : "")));
    }
    return mta::lua::push_results(L, mta::lua::Argument(std::move(table)));
}

MTA_LUA_FUNCTION("module_signature",
    "Returns signature metadata for a module function (nil if unknown).")
{
    auto [name] = mta::lua::args<std::string>(L);

    for (const auto &spec : mta::registered_functions())
    {
        if (name != spec.name)
        {
            continue;
        }

        mta::lua::Table info;
        info.fields.emplace_back("name", mta::lua::Argument(std::string(spec.name)));
        info.fields.emplace_back(
            "description",
            mta::lua::Argument(std::string(spec.description ? spec.description : "")));
        info.fields.emplace_back("category", mta::lua::Argument(spec.category));
        info.fields.emplace_back("derived", mta::lua::Argument(spec.signature.derived));
        info.fields.emplace_back("variadic", mta::lua::Argument(spec.signature.variadic));

        mta::lua::Table arguments;
        for (const auto &entry : spec.signature.arguments)
        {
            mta::lua::Table argument;
            argument.fields.emplace_back("type", mta::lua::Argument(entry.type));
            argument.fields.emplace_back("optional", mta::lua::Argument(entry.optional));
            arguments.array.emplace_back(mta::lua::Argument(std::move(argument)));
        }
        info.fields.emplace_back("arguments", mta::lua::Argument(std::move(arguments)));

        mta::lua::Table returns;
        for (const auto &type : spec.signature.returns)
        {
            returns.array.emplace_back(mta::lua::Argument(type));
        }
        info.fields.emplace_back("returns", mta::lua::Argument(std::move(returns)));

        return mta::lua::push_results(L, mta::lua::Argument(std::move(info)));
    }
    return mta::lua::push_results(L, nullptr);
}