include_guard(GLOBAL)

if(NOT DEFINED SDK_IPO_SUPPORTED)
  include(CheckIPOSupported)
  check_ipo_supported(RESULT SDK_IPO_SUPPORTED OUTPUT SDK_IPO_MESSAGE)
endif()

# Baseline warnings and optimizations shared by every target.
# Exceptions stay ENABLED: module functions translate C++ exceptions into
# Lua errors at the SDK_LUA_FUNCTION trampoline boundary.
function(sdk_target_apply_baseline_options target)
  if(MSVC)
    target_compile_options(${target} PRIVATE
      /W4 /WX
      /permissive-
      /Zc:__cplusplus /Zc:preprocessor /Zc:inline /Zc:throwingNew
      /EHsc
      /Ot /Oi
    )
    target_link_options(${target} PRIVATE /OPT:REF /OPT:ICF)
  else()
    target_compile_options(${target} PRIVATE
      -Wall -Wextra -Wpedantic -Werror
      -Wconversion -Wsign-conversion -Wundef
      -ffunction-sections -fdata-sections
      -O2
    )
    target_link_options(${target} PRIVATE -Wl,--as-needed -Wl,--gc-sections)
  endif()
endfunction()

function(sdk_enable_lto target)
  if(NOT SDK_LTO)
    return()
  endif()

  if(SDK_IPO_SUPPORTED)
    set_property(TARGET ${target} PROPERTY INTERPROCEDURAL_OPTIMIZATION TRUE)
  else()
    get_property(_ipo_warned GLOBAL PROPERTY SDK_IPO_WARNING_EMITTED SET)
    if(NOT _ipo_warned)
      message(WARNING "IPO/LTO is unavailable: ${SDK_IPO_MESSAGE}")
      set_property(GLOBAL PROPERTY SDK_IPO_WARNING_EMITTED TRUE)
    endif()
  endif()
endfunction()
