#include "sdk/native/module.hpp"

#include "ILuaModuleManager10.h"
#include "sdk/abi/module.hpp"
#include "sdk/version.hpp"

#include <utility>

namespace mta
{
ModuleInfo module_info()
{
    const mta::module::Info info = mta::module::info();
    ModuleInfo module;
    module.name = info.name != nullptr ? info.name : "";
    module.author = info.author != nullptr ? info.author : "";
    module.version = info.version;
    return module;
}

SdkInfo sdk_info()
{
    return SdkInfo{SDK_VERSION, SDK_ABI_VERSION};
}

std::optional<ServerInfo> server_info()
{
    auto *manager = mta::module::manager();
    if (manager == nullptr)
    {
        return std::nullopt; // no manager: module not loaded into a server
    }

    const char *version = manager->GetVersionString();
    const char *operating_system = manager->GetOperatingSystemName();

    ServerInfo server;
    server.version = version != nullptr ? version : "";
    server.netcode_version = static_cast<std::uint64_t>(manager->GetNetcodeVersion());
    server.operating_system = operating_system != nullptr ? operating_system : "";
    return server;
}
} // namespace mta