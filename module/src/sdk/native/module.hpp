#pragma once

// Module identity and server facts for diagnostics and version
// displays. This is the facade-level wrapper over the ABI glue (sdk/abi) and
// the module manager: developer code never includes the MTA manager header
// and never calls mta::module::manager() directly.

#include <cstdint>
#include <optional>
#include <string>

namespace mta
{
// Identity of THIS module: the title/author/version configured in
// config/module.toml, reported to the server in InitModule.
struct ModuleInfo
{
    std::string name;
    std::string author;
    float version = 0.0f;
};

// Facts reported by the running MTA server.
struct ServerInfo
{
    std::string version;           // server version string
    std::uint64_t netcode_version = 0; // MTA netcode version
    std::string operating_system;  // server-reported operating system name
};

// The SDK's own version facts: the release version of the SDK and
// the version of the MTA module ABI it implements. Both are separate from
// ModuleInfo::version (the Module version, from config/module.toml) and from
// ServerInfo (the runtime MTA server version).
struct SdkInfo
{
    std::string version;     // SDK version (source/sdk/version.hpp)
    std::string abi_version; // MTA module ABI version
};

// The module's own identity (compile-time; available before InitModule).
[[nodiscard]] ModuleInfo module_info();

// The SDK version / module ABI version this SDK was built with
// (compile-time; available before InitModule).
[[nodiscard]] SdkInfo sdk_info();

// The running server's facts. Nothing when the module manager is not
// attached (before InitModule / after ShutdownModule -- e.g. in a bare test
// harness).
[[nodiscard]] std::optional<ServerInfo> server_info();
} // namespace mta