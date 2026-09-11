# Sources are collected with a recursive glob: to add a function you never
# touch the build files — just drop a .cpp anywhere under src/.
# CONFIGURE_DEPENDS re-runs the glob whenever the file set changes.
file(GLOB_RECURSE SDK_SOURCES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp"
)