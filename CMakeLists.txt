cmake_minimum_required(VERSION 3.27)

# MTA Market Platform — root CMake superproject.
#
# The module/ component is a self-contained CMake project on its own
# (cd module && cmake --preset linux-gcc). This root file exists so the
# platform can be configured as one tree from the repository root; it only
# forwards into the component. CMake output lands in build/ (gitignored);
# module/build/ remains the standalone build directory of the component.

project(mta-market-platform LANGUAGES C CXX)

option(PLATFORM_BUILD_MODULE "Build the module/ component" ON)

if(PLATFORM_BUILD_MODULE)
  add_subdirectory(module)
endif()
