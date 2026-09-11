// An argument-less function returning a table. Facts come from the facade
// (module identity + SDK/ABI versions + server facts); the ABI layer stays
// internal. The four version entities are reported as
// separate fields -- module_version, sdk_version, abi_version, mta/netcode.

#include <mta/sdk.hpp>

MTA_LUA_FUNCTION("sample_version",
    "Returns a table with SDK, module, ABI and server version information.")
{
    const mta::ModuleInfo info = mta::module_info();
    const mta::SdkInfo sdk = mta::sdk_info();

    mta::lua::Table data;
    data.fields.emplace_back("module", mta::lua::Argument(info.name));
    data.fields.emplace_back("module_author", mta::lua::Argument(info.author));
    data.fields.emplace_back("module_version",
                             mta::lua::Argument(static_cast<lua_Number>(info.version)));
    data.fields.emplace_back("sdk_version", mta::lua::Argument(sdk.version));
    data.fields.emplace_back("abi_version", mta::lua::Argument(sdk.abi_version));

    if (auto server = mta::server_info())
    {
        data.fields.emplace_back(
            "mta", mta::lua::Argument(server->version.empty() ? std::string("?") : server->version));
        data.fields.emplace_back(
            "netcode", mta::lua::Argument(static_cast<lua_Number>(server->netcode_version)));
        data.fields.emplace_back(
            "os", mta::lua::Argument(server->operating_system.empty() ? std::string("?")
                                                                      : server->operating_system));
    }

    return mta::lua::push_results(L, mta::lua::Argument(std::move(data)));
}