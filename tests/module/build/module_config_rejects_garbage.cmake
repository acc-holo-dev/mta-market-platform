# Unit test (negative): the TOML reader must reject malformed input.
# Run by CTest with WILL_FAIL: a FATAL_ERROR below is the EXPECTED outcome.

cmake_minimum_required(VERSION 3.27)

include("${CMAKE_CURRENT_LIST_DIR}/../../../module/config/cmake/core/module-config.cmake")

read_module_toml("${CMAKE_CURRENT_LIST_DIR}/fixtures/garbage.toml" BAD)

# Unreachable: read_module_toml must have failed on fixtures/garbage.toml.
message(STATUS "garbage.toml was accepted: ${BAD_module_name}")