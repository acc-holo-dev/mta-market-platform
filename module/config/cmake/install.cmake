include_guard(GLOBAL)

# Install layout: the module binary plus README, ready to drop into
# mods/deathmatch/modules/ of an MTA server.
install(TARGETS sdk_base
    RUNTIME DESTINATION .
    LIBRARY DESTINATION .
)

# The module documentation lives in the centralized documents/ tree
# (PLAN-010 Rule 001: no .md next to sources). The package ships the module
# README from documents/module/ so a distributed ZIP is self-describing.
set(MODULE_README "${CMAKE_CURRENT_SOURCE_DIR}/../documents/module/README.md")

install(FILES
    "${MODULE_README}"
    DESTINATION .
)

# CPack: produce a ZIP with the module binary and README.
# The package lands in build/<preset>/package/ regardless of where cpack runs.
set(CPACK_PACKAGE_DIRECTORY "${CMAKE_BINARY_DIR}/package")
set(CPACK_PACKAGE_NAME "${SDK_MODULE_NAME}")
set(CPACK_PACKAGE_VENDOR "HoloDev")
set(CPACK_PACKAGE_VERSION "${MODULE_CFG_module_version}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "MTA:SA Lua module SDK (${SDK_MODULE_NAME})")
set(CPACK_RESOURCE_FILE_README "${MODULE_README}")
set(CPACK_GENERATOR "ZIP")
set(CPACK_INCLUDE_TOPLEVEL_DIRECTORY OFF)
# This ZIP packages the MODULE (binary + docs), so its name carries the
# Module version from config/module.toml -- not the SDK/project version.
set(CPACK_PACKAGE_FILE_NAME "${SDK_MODULE_NAME}-${MODULE_CFG_module_version}-${SDK_PLATFORM_TAG}-${SDK_ARCH_TAG}")
include(CPack)
