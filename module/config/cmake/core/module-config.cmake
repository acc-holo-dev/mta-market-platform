include_guard(GLOBAL)

# ---------------------------------------------------------------------------
# Minimal TOML reader for config/module.toml.
#
# Supports the pragmatic subset the project configuration needs:
#   - [section] headers (dots in section names map to underscores);
#   - key = value with string values ("..." or '...'), booleans,
#     integers and floats;
#   - full-line (# ...) and trailing comments (outside quotes);
#   - blank lines and leading/trailing whitespace.
# Anything else (multiline strings, tables of arrays, inline tables) is out
# of scope on purpose: module.toml is a project file, kept deliberately
# simple so that CMake, the CLI and a human can all parse it.
#
# read_module_toml(<file> <prefix>)
#   Parses <file> and sets, in the caller's scope:
#     <prefix>_<section>_<key> = <value string>
#   e.g. with prefix MODULE_CFG:
#     MODULE_CFG_module_name  = "base"
#     MODULE_CFG_build_unity  = "true"
#     MODULE_CFG_async_queue  = "4096"
#   Fails with FATAL_ERROR when the file is missing or a line is malformed.
# ---------------------------------------------------------------------------
function(read_module_toml _file _prefix)
    if(NOT EXISTS "${_file}")
        message(FATAL_ERROR "module configuration not found: ${_file}")
    endif()

    file(READ "${_file}" _toml_text)
    # Escape embedded semicolons first: they must survive the newline-based
    # list split below (a comment like "... count; an integer pins it."
    # would otherwise split into a phantom line).
    string(REPLACE ";" "\\;" _toml_text "${_toml_text}")
    string(REPLACE "\r\n" "\n" _toml_text "${_toml_text}")
    string(REPLACE "\n" ";" _toml_lines "${_toml_text}")

    set(_section "")
    foreach(_line IN LISTS _toml_lines)
        string(STRIP "${_line}" _line)
        if(_line STREQUAL "" OR _line MATCHES "^#")
            continue()
        endif()

        # [section] header
        # (CMake regex: a negated character class cannot contain \] escapes,
        # so [^]] "everything up to the closing bracket" is used.)
        if(_line MATCHES "^\\[([^]]+)\\]$")
            set(_section "${CMAKE_MATCH_1}")
            string(STRIP "${_section}" _section)
            string(REPLACE "." "_" _section "${_section}")
            continue()
        endif()

        # key = value
        # (CMake regex has no \t: a tab must enter the character class as a
        # literal character, otherwise "[ \t]" silently matches 't' too.)
        if(NOT DEFINED _ws_class)
            string(ASCII 9 _ws_tab)
            set(_ws_class "[ ${_ws_tab}]")
        endif()
        if(NOT _line MATCHES "^([A-Za-z0-9_-]+)${_ws_class}*=${_ws_class}*(.*)$")
            message(FATAL_ERROR "module configuration: cannot parse line: ${_line}")
        endif()
        set(_key "${CMAKE_MATCH_1}")
        set(_value "${CMAKE_MATCH_2}")

        # Strip a trailing comment. A quoted value may contain '#', so find
        # the closing quote first and cut everything after it; unquoted
        # values are cut at the first '#'.
        string(SUBSTRING "${_value}" 0 1 _first_char)
        if(_first_char STREQUAL "\"" OR _first_char STREQUAL "'")
            set(_value_full "${_value}")
            string(SUBSTRING "${_value}" 1 -1 _rest)
            string(FIND "${_rest}" "${_first_char}" _close_rel)
            if(_close_rel EQUAL -1)
                message(FATAL_ERROR "module configuration: unterminated string: ${_line}")
            endif()
            string(SUBSTRING "${_value}" 1 ${_close_rel} _value)
            # Everything after the closing quote must be blank or a comment.
            math(EXPR _tail_start "${_close_rel} + 2")
            string(SUBSTRING "${_value_full}" ${_tail_start} -1 _tail)
            string(STRIP "${_tail}" _tail)
            if(NOT _tail STREQUAL "" AND NOT _tail MATCHES "^#")
                message(FATAL_ERROR "module configuration: unexpected text after value: ${_line}")
            endif()
        else()
            string(FIND "${_value}" "#" _comment_idx)
            if(NOT _comment_idx EQUAL -1)
                string(SUBSTRING "${_value}" 0 ${_comment_idx} _value)
                string(STRIP "${_value}" _value)
            endif()
        endif()

        if(_value STREQUAL "")
            message(FATAL_ERROR "module configuration: empty value for '${_key}': ${_line}")
        endif()

        set("${_prefix}_${_section}_${_key}" "${_value}" PARENT_SCOPE)
        set("${_prefix}_keys" "${${_prefix}_keys};${_prefix}_${_section}_${_key}" PARENT_SCOPE)
    endforeach()
endfunction()

# module_toml_bool(<value> <out-var>) — normalizes a TOML boolean ("true",
# "false", or a CMake boolean) to ON/OFF in the caller's scope.
function(module_toml_bool _value _out)
    string(TOUPPER "${_value}" _upper)
    if(_upper STREQUAL "TRUE" OR _upper STREQUAL "ON" OR _upper STREQUAL "YES" OR _upper STREQUAL "Y" OR _upper MATCHES "^[1-9]")
        set(${_out} ON PARENT_SCOPE)
    else()
        set(${_out} OFF PARENT_SCOPE)
    endif()
endfunction()