cmake_minimum_required(VERSION 3.27)

# ---------------------------------------------------------------------------
# config/module.toml is the single source of truth for module identity and
# build options. It is read BEFORE project() so that
# module identity flows into the build. Explicit CMake cache entries
# (-DSDK_MODULE_NAME=... etc.) remain as per-configure overrides.
# ---------------------------------------------------------------------------
include(config/cmake/core/module-config.cmake)
read_module_toml("${CMAKE_CURRENT_SOURCE_DIR}/config/module.toml" MODULE_CFG)

# The project is the SDK template. The SDK version stays separate from the
# Module version, so project(VERSION) does NOT come from config/module.toml:
# it follows SDK_VERSION in src/sdk/version.hpp -- the same single source
# the C++ SDK includes and the CLI parses for `mta doctor`.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/src/sdk/version.hpp" _sdk_version_hpp)
if(NOT _sdk_version_hpp MATCHES "#define SDK_VERSION \"([0-9]+[.][0-9]+[.][0-9]+)\"")
  message(FATAL_ERROR "src/sdk/version.hpp must define SDK_VERSION as \"X.Y.Z\"")
endif()
project(mta_sdk_module VERSION "${CMAKE_MATCH_1}" LANGUAGES C CXX)

# C++ standard: [build] cxx_standard is the default; -DCMAKE_CXX_STANDARD=...
# still overrides it.
if(NOT DEFINED CACHE{CMAKE_CXX_STANDARD})
  if(MODULE_CFG_build_cxx_standard)
    set(CMAKE_CXX_STANDARD "${MODULE_CFG_build_cxx_standard}")
  else()
    set(CMAKE_CXX_STANDARD 20)
  endif()
endif()
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

# Runtime selection for MSVC (CMP0091); no effect on GCC/Clang.
cmake_policy(SET CMP0091 NEW)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")

# [build] unity / lto are the defaults; explicit -DSDK_UNITY / -DSDK_LTO
# cache entries override them (advanced use).
if(DEFINED CACHE{SDK_UNITY})
  set(SDK_UNITY "$CACHE{SDK_UNITY}")
else()
  module_toml_bool("${MODULE_CFG_build_unity}" SDK_UNITY)
endif()
if(DEFINED CACHE{SDK_LTO})
  set(SDK_LTO "$CACHE{SDK_LTO}")
else()
  module_toml_bool("${MODULE_CFG_build_lto}" SDK_LTO)
endif()
option(SDK_BUILD_TESTS "Build the embedded Lua test harness (sdk_tests)" ON)
option(SDK_SANITIZE "Build with AddressSanitizer + UndefinedBehaviorSanitizer (GCC/Clang)" OFF)

# ---------------------------------------------------------------------------
# Module identity — authored in config/module.toml [module]; renaming the
# module never touches C++ or CMake. The cache variables below are optional
# per-configure overrides:
#
#   cmake -DSDK_MODULE_NAME=my_mod          -> my_mod.dll / my_mod.so
#   cmake -DSDK_MODULE_TITLE="My Module"    -> console name
#   cmake -DSDK_MODULE_AUTHOR="Jane Doe"    -> console author
# ---------------------------------------------------------------------------
if(DEFINED CACHE{SDK_MODULE_NAME})
  set(SDK_MODULE_NAME "$CACHE{SDK_MODULE_NAME}")
else()
  set(SDK_MODULE_NAME "${MODULE_CFG_module_name}")
endif()
if(DEFINED CACHE{SDK_MODULE_TITLE})
  set(SDK_MODULE_TITLE "$CACHE{SDK_MODULE_TITLE}")
else()
  set(SDK_MODULE_TITLE "${MODULE_CFG_module_title}")
endif()
if(DEFINED CACHE{SDK_MODULE_AUTHOR})
  set(SDK_MODULE_AUTHOR "$CACHE{SDK_MODULE_AUTHOR}")
else()
  set(SDK_MODULE_AUTHOR "${MODULE_CFG_module_author}")
endif()

find_package(Threads REQUIRED)

# The DRM client (src/drm/http_client.cpp TLS, aead.cpp AES-256-GCM via EVP,
# ed25519.cpp signing) requires OpenSSL. The CMake pipeline never linked it
# after the DRM subsystem landed — the standalone Makefile build provided
# -lssl -lcrypto explicitly, the CMake build did not (pre-existing defect
# found during PLAN-010).
find_package(OpenSSL REQUIRED)

include(config/cmake/core/platform.cmake)
include(config/cmake/core/common.cmake)
include(config/cmake/lua/lua.cmake)
include(config/cmake/core/file.cmake)

# ---------------------------------------------------------------------------
# [features]: subsystem switches. They flow into the build as
# SDK_FEATURE_* compile definitions, and the bundled sample functions of a
# disabled subsystem are excluded from the module (and the test binary) —
# the developer decides what the built module ships, only in module.toml.
# Explicit cache overrides win: -DSDK_FEATURE_ASYNC=OFF, ...
# ---------------------------------------------------------------------------
foreach(_feature ASYNC USERDATA EVENTS OBJECTS)
  string(TOLOWER "${_feature}" _feature_cfg)
  if(DEFINED CACHE{SDK_FEATURE_${_feature}})
    set(SDK_FEATURE_${_feature} "$CACHE{SDK_FEATURE_${_feature}}")
  elseif(MODULE_CFG_features_${_feature} STREQUAL "false")
    set(SDK_FEATURE_${_feature} OFF)
  else()
    set(SDK_FEATURE_${_feature} ON)
  endif()
endforeach()

set(SDK_FEATURE_DEFINES "")
foreach(_feature ASYNC USERDATA EVENTS OBJECTS)
  if(SDK_FEATURE_${_feature})
    list(APPEND SDK_FEATURE_DEFINES "SDK_FEATURE_${_feature}=1")
  else()
    list(APPEND SDK_FEATURE_DEFINES "SDK_FEATURE_${_feature}=0")
  endif()
endforeach()

# Sample functions of a disabled subsystem leave the build entirely.
if(NOT SDK_FEATURE_ASYNC)
  list(FILTER SDK_SOURCES EXCLUDE REGEX "/functions/async/")
endif()
if(NOT SDK_FEATURE_USERDATA OR NOT SDK_FEATURE_OBJECTS)
  list(FILTER SDK_SOURCES EXCLUDE REGEX "/functions/objects/")
endif()
if(NOT SDK_FEATURE_EVENTS)
  list(FILTER SDK_SOURCES EXCLUDE REGEX "/functions/events/")
endif()

set(_outdir "${CMAKE_BINARY_DIR}/module/${SDK_PLATFORM_TAG}-${SDK_ARCH_TAG}")
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${_outdir}")
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY "${_outdir}")
set(CMAKE_ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/.cache/${SDK_PLATFORM_TAG}-${SDK_ARCH_TAG}")

# ---------------------------------------------------------------------------
# Module core: every source, compiled once.
# ---------------------------------------------------------------------------
add_library(sdk_core OBJECT ${SDK_SOURCES})

# The DRM client sources were authored as standalone translation units with
# same-named internals in per-file anonymous namespaces (kKeyBytes, UrlParts,
# split_url, ...). Under a unity build those internals collide, so the DRM
# files must stay separate TUs (pre-existing defect found during PLAN-010:
# the Linux CMake pipeline never built after the DRM subsystem landed — the
# standalone Makefile build used milder flags and masked it).
foreach(_drm_src ${SDK_SOURCES})
  if(_drm_src MATCHES "/src/drm/")
    set_source_files_properties("${_drm_src}" PROPERTIES SKIP_UNITY_BUILD_INCLUSION TRUE)
  endif()
endforeach()

# Single source of truth for the MODULE version float (Module version is
# its own entity, separate from the SDK version that project(VERSION) now
# carries): the [module] version in config/module.toml. "2.1.0" is kept
# verbatim — module.cpp parses it with sscanf (locale-independent integers).
if(NOT MODULE_CFG_module_version MATCHES "^([0-9]+)\\.([0-9]+)(\\.([0-9]+))?$")
  message(FATAL_ERROR "config/module.toml [module] version must be X.Y or X.Y.Z, got: ${MODULE_CFG_module_version}")
endif()
set(SDK_MODULE_VERSION "${MODULE_CFG_module_version}")
# [async] runtime knobs: worker count and task-queue limit are
# compiled in from config/module.toml so the module and its config stay one
# source of truth. workers = "auto" compiles to a hardware-concurrency probe.
# Explicit cache overrides win: -DSDK_ASYNC_WORKERS=4 -DSDK_ASYNC_QUEUE=1024.
if(DEFINED CACHE{SDK_ASYNC_WORKERS})
  set(SDK_ASYNC_WORKERS_CFG "$CACHE{SDK_ASYNC_WORKERS}")
else()
  set(SDK_ASYNC_WORKERS_CFG "${MODULE_CFG_async_workers}")
endif()
if(SDK_ASYNC_WORKERS_CFG STREQUAL "auto")
  set(SDK_ASYNC_WORKER_DEFINES SDK_ASYNC_WORKERS_AUTO=1)
else()
  set(SDK_ASYNC_WORKER_DEFINES "SDK_ASYNC_WORKERS_N=${SDK_ASYNC_WORKERS_CFG}")
endif()
if(DEFINED CACHE{SDK_ASYNC_QUEUE})
  set(SDK_ASYNC_QUEUE_N "$CACHE{SDK_ASYNC_QUEUE}")
elseif(NOT MODULE_CFG_async_queue)
  set(SDK_ASYNC_QUEUE_N 4096)
else()
  set(SDK_ASYNC_QUEUE_N "${MODULE_CFG_async_queue}")
endif()

target_compile_definitions(sdk_core PRIVATE
    SDK_MODULE_VERSION="${SDK_MODULE_VERSION}"
    "SDK_MODULE_TITLE=\"${SDK_MODULE_TITLE}\""
    "SDK_MODULE_AUTHOR=\"${SDK_MODULE_AUTHOR}\""
    ${SDK_ASYNC_WORKER_DEFINES}
    "SDK_ASYNC_QUEUE_N=${SDK_ASYNC_QUEUE_N}"
    ${SDK_FEATURE_DEFINES}
)

target_include_directories(sdk_core
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}/src
    PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/third_party/mta-sdk
)

target_link_libraries(sdk_core
    PUBLIC
        mta_lua
        Threads::Threads
        OpenSSL::SSL
        OpenSSL::Crypto
)

set_target_properties(sdk_core PROPERTIES
    POSITION_INDEPENDENT_CODE ON
)

if(SDK_UNITY)
  set_property(TARGET sdk_core PROPERTY UNITY_BUILD ON)
endif()

sdk_target_apply_baseline_options(sdk_core)

# Sanitizers (ASan/UBSan) — for debugging only, not for the production module.
if(SDK_SANITIZE)
  if(MSVC)
    message(WARNING "SDK_SANITIZE is supported only on GCC/Clang")
  else()
    foreach(_target sdk_core sdk_tests)
      if(TARGET ${_target})
        target_compile_options(${_target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer -g)
        target_link_options(${_target} PRIVATE -fsanitize=address,undefined)
      endif()
    endforeach()
  endif()
endif()

# ---------------------------------------------------------------------------
# The module itself: ${SDK_MODULE_NAME}.dll / .so, loaded by the MTA server.
# ---------------------------------------------------------------------------
add_library(sdk_base SHARED)
target_link_libraries(sdk_base PRIVATE sdk_core mta_lua)

# Export ONLY the six MTA entry points: everything else (Lua API, runtime
# internals) stays private to the DLL so module symbols cannot collide with
# other modules loaded into the server process.
if(WIN32)
  # The .def is generated from a template so its LIBRARY name follows
  # SDK_MODULE_NAME automatically (it lives out of source in the build dir).
  file(MAKE_DIRECTORY "${CMAKE_BINARY_DIR}/module")
  configure_file(
      src/sdk/abi/module.def.in
      "${CMAKE_BINARY_DIR}/module/${SDK_MODULE_NAME}.def"
      @ONLY)
  target_sources(sdk_base PRIVATE "${CMAKE_BINARY_DIR}/module/${SDK_MODULE_NAME}.def")
endif()

set_target_properties(sdk_base PROPERTIES
    OUTPUT_NAME "${SDK_MODULE_NAME}"
    PREFIX ""
)

sdk_target_apply_baseline_options(sdk_base)
sdk_enable_lto(sdk_base)

if(MSVC)
  include(config/cmake/platform/msvc.cmake)
elseif(MINGW)
  include(config/cmake/platform/mingw.cmake)
elseif(UNIX)
  include(config/cmake/platform/linux.cmake)
endif()

# ---------------------------------------------------------------------------
# Embedded test harness: runs every module function in clean Lua 5.1 with a
# mock manager — no MTA server needed.
# ---------------------------------------------------------------------------
if(SDK_BUILD_TESTS)
  enable_testing()

  add_executable(sdk_tests ../tests/module/runtime/harness.cpp)
  target_link_libraries(sdk_tests PRIVATE sdk_core mta_lua Threads::Threads)

  target_include_directories(sdk_tests PRIVATE
      ${CMAKE_CURRENT_SOURCE_DIR}/src
      ${CMAKE_CURRENT_SOURCE_DIR}/third_party/mta-sdk
  )

  target_compile_definitions(sdk_tests PRIVATE
      SDK_TESTS_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../tests/module/runtime/scripts"
  )

  sdk_target_apply_baseline_options(sdk_tests)
  sdk_enable_lto(sdk_tests)

  # Fixture: protected.luac — MTA-compatible Lua 5.1 bytecode of the spike
  # marker chunk, required by 096_drm_spike.lua. The old repository referenced
  # an offline "spike_luac" tool that was never committed; the generator now
  # lives in tools/spike_luac.cpp and the fixture is rebuilt with the tests.
  # The 096 script probes "build/protected.luac" relative to the sdk_tests
  # working directory (ctest runs it in ${CMAKE_BINARY_DIR}).
  add_executable(sdk_spike_luac tools/spike_luac.cpp)
  sdk_target_apply_baseline_options(sdk_spike_luac)
  set(_luac_fixture "${CMAKE_BINARY_DIR}/build/protected.luac")
  add_custom_command(
      OUTPUT "${_luac_fixture}"
      COMMAND sdk_spike_luac "${_luac_fixture}"
      DEPENDS sdk_spike_luac
      COMMENT "Generating protected.luac spike fixture"
      VERBATIM)
  add_custom_target(sdk_spike_luac_fixture DEPENDS "${_luac_fixture}")
  add_dependencies(sdk_tests sdk_spike_luac_fixture)

  add_test(NAME sdk_tests COMMAND sdk_tests
      WORKING_DIRECTORY "${CMAKE_BINARY_DIR}")

  # Configuration parser tests (CMake-script mode).
  add_test(NAME module_config_parse
      COMMAND "${CMAKE_COMMAND}" -P "${CMAKE_CURRENT_SOURCE_DIR}/../tests/module/build/module_config_parse.cmake")
  add_test(NAME module_config_rejects_garbage
      COMMAND "${CMAKE_COMMAND}" -P "${CMAKE_CURRENT_SOURCE_DIR}/../tests/module/build/module_config_rejects_garbage.cmake")
  set_tests_properties(module_config_rejects_garbage PROPERTIES WILL_FAIL TRUE)
endif()

# ---------------------------------------------------------------------------
# Registry documentation generator: dumps every registered function with its
# signature metadata as markdown; `mta docs` builds and runs it.
# ---------------------------------------------------------------------------
add_executable(sdk_docgen tools/docgen.cpp)
target_link_libraries(sdk_docgen PRIVATE sdk_core mta_lua)
target_include_directories(sdk_docgen PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${CMAKE_CURRENT_SOURCE_DIR}/third_party/mta-sdk
)
sdk_target_apply_baseline_options(sdk_docgen)
sdk_enable_lto(sdk_docgen)

# Install rules + packaging for releases (see config/cmake/install.cmake).
include(config/cmake/install.cmake)
