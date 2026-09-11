# Unit test: config/cmake/core/module-config.cmake TOML reader.
# Run by CTest: cmake -P module_config_parse.cmake (exit code 0 = pass).

cmake_minimum_required(VERSION 3.27)

include("${CMAKE_CURRENT_LIST_DIR}/../../../module/config/cmake/core/module-config.cmake")

set(_fixture "${CMAKE_CURRENT_LIST_DIR}/fixtures/module.toml")
read_module_toml("${_fixture}" CFG)

function(expect_config var expected)
    if(NOT DEFINED "${var}")
        message(FATAL_ERROR "config parse: variable ${var} is not defined")
    endif()
    if(NOT "${${var}}" STREQUAL "${expected}")
        message(FATAL_ERROR "config parse: ${var}: expected '${expected}', got '${${var}}'")
    endif()
endfunction()

expect_config(CFG_module_name "fixture_mod")
expect_config(CFG_module_title "Fixture #1 Module") # '#' inside quotes must survive
expect_config(CFG_module_author "Fixture Author")   # single quotes + trailing comment
expect_config(CFG_module_version "9.9.9")
expect_config(CFG_build_cxx_standard "23")
expect_config(CFG_build_unity "false")
expect_config(CFG_build_lto "true")                 # trailing comment stripped
expect_config(CFG_async_workers "auto")
expect_config(CFG_async_queue "4096")
expect_config(CFG_features_async "true")
expect_config(CFG_features_userdata "false")

# Boolean normalization: TOML spellings and CMake spellings both work.
module_toml_bool("${CFG_build_unity}" unity_flag)
module_toml_bool("true" t_bool)
module_toml_bool("false" f_bool)
module_toml_bool("ON" on_bool)
if(NOT t_bool STREQUAL "ON" OR NOT on_bool STREQUAL "ON")
    message(FATAL_ERROR "config parse: module_toml_bool true/ON failed")
endif()
if(NOT f_bool STREQUAL "OFF" OR NOT unity_flag STREQUAL "OFF")
    message(FATAL_ERROR "config parse: module_toml_bool false failed")
endif()

message(STATUS "module_config_parse: all assertions passed")