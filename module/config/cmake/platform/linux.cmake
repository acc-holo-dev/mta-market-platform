set_target_properties(sdk_base PROPERTIES
    SKIP_BUILD_RPATH YES
    BUILD_WITH_INSTALL_RPATH NO
)

target_link_options(sdk_base PRIVATE
    -Wl,--no-undefined
    # Export only the six MTA entry points (see src/sdk/abi/module.def.in
    # for the Windows counterpart).
    "-Wl,--version-script=${CMAKE_CURRENT_SOURCE_DIR}/src/sdk/abi/module.ver"
)
