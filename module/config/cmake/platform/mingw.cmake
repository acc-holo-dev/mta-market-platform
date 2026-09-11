if(MINGW)
  # Fully static runtime: the module DLL must not drag MinGW runtime DLLs
  # into the MTA server process.
  foreach(_target sdk_base sdk_tests)
    if(TARGET ${_target})
      target_link_options(${_target} PRIVATE
          -static
          -static-libgcc
          -static-libstdc++
      )
    endif()
  endforeach()
endif()
