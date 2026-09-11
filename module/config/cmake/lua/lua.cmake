if(TARGET mta_lua)
  return()
endif()

option(SDK_LUA_WARNINGS_OFF "Silence warnings for third-party Lua" ON)

set(LUA_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/lua/src" CACHE PATH "Lua 5.1 source dir")
if(NOT EXISTS "${LUA_SRC_DIR}")
  # Reset a stale cached path (e.g. left over from an earlier checkout layout).
  set(LUA_SRC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/lua/src" CACHE PATH "Lua 5.1 source dir" FORCE)
endif()

set(LUA_SOURCES
  ${LUA_SRC_DIR}/lapi.c
  ${LUA_SRC_DIR}/lauxlib.c
  ${LUA_SRC_DIR}/lbaselib.c
  ${LUA_SRC_DIR}/lcode.c
  ${LUA_SRC_DIR}/ldblib.c
  ${LUA_SRC_DIR}/ldebug.c
  ${LUA_SRC_DIR}/ldo.c
  ${LUA_SRC_DIR}/ldump.c
  ${LUA_SRC_DIR}/lfunc.c
  ${LUA_SRC_DIR}/lgc.c
  ${LUA_SRC_DIR}/linit.c
  ${LUA_SRC_DIR}/liolib.c
  ${LUA_SRC_DIR}/llex.c
  ${LUA_SRC_DIR}/lmathlib.c
  ${LUA_SRC_DIR}/lmem.c
  ${LUA_SRC_DIR}/loadlib.c
  ${LUA_SRC_DIR}/lobject.c
  ${LUA_SRC_DIR}/lopcodes.c
  ${LUA_SRC_DIR}/loslib.c
  ${LUA_SRC_DIR}/lparser.c
  ${LUA_SRC_DIR}/lstate.c
  ${LUA_SRC_DIR}/lstring.c
  ${LUA_SRC_DIR}/lstrlib.c
  ${LUA_SRC_DIR}/ltable.c
  ${LUA_SRC_DIR}/ltablib.c
  ${LUA_SRC_DIR}/ltm.c
  ${LUA_SRC_DIR}/lundump.c
  ${LUA_SRC_DIR}/lutf8lib.c
  ${LUA_SRC_DIR}/lvm.c
  ${LUA_SRC_DIR}/lzio.c
  ${LUA_SRC_DIR}/print.c
)

add_library(mta_lua OBJECT ${LUA_SOURCES})

target_include_directories(mta_lua
  SYSTEM PUBLIC "${LUA_SRC_DIR}"
)

target_compile_features(mta_lua PUBLIC c_std_99)
set_target_properties(mta_lua PROPERTIES POSITION_INDEPENDENT_CODE ON)

if(SDK_LUA_WARNINGS_OFF)
  if(MSVC)
    target_compile_options(mta_lua PRIVATE /w)
  else()
    target_compile_options(mta_lua PRIVATE -w)
  endif()
endif()

# NOTE: do NOT define LUA_BUILD_AS_DLL. The Lua sources define LUA_CORE or
# LUA_LIB, so that define would mark every Lua API function __declspec(dllexport)
# and export the whole Lua API from the module even though Lua is linked
# statically into it (extra exports risk symbol collisions with other modules
# in the server process). Plain extern linkage exports exactly the six MTA
# entry points (module.def.in pins that list on Windows).
if(UNIX)
  target_compile_definitions(mta_lua PRIVATE LUA_USE_LINUX)
endif()

sdk_enable_lto(mta_lua)
