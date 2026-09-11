#pragma once

// ===========================================================================
// The SDK's own version facts -- the single source of
// truth for the two SDK-side version entities:
//
//   SDK_VERSION     the release version of this SDK itself;
//   SDK_ABI_VERSION the version of the MTA module ABI (the six MTAEXPORT
//                   entry points + ILuaModuleManager10 contract) that this
//                   SDK implements.
//
// Four version concepts are kept strictly separate:
//
//   SDK version      -> SDK_VERSION below
//   Module version   -> config/module.toml [module] version (via CMake
//                       SDK_MODULE_VERSION; the float the MTA server ABI
//                       reports in InitModule -- it cannot carry the others)
//   ABI version      -> SDK_ABI_VERSION below
//   MTA server ver.  -> runtime fact from the module manager
//                       (GetVersionString(); see mta::server_info())
//
// Consumers (none of them duplicates the values as literals):
//   - C++ SDK: #include "sdk/version.hpp" (mta::sdk_info(), load diagnostics);
//   - CMake: parses SDK_VERSION for project(VERSION) (CMakeLists.txt);
//   - CLI: parses this file for `mta doctor` (other/tools/mta/cli.py).
// Bump SDK_VERSION on an SDK release; bump SDK_ABI_VERSION only when the
// exported module ABI contract changes.
// ===========================================================================

#define SDK_VERSION "1.0.0"
#define SDK_ABI_VERSION "1"