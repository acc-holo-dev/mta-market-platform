-- Table marshalling: read nested structures, build table results.

local stats = sample_table_stats({10, 20, 30, {40, 50}, name = "x", flag = true})
test_assert(stats.values == 7, "values counts numbers+strings+booleans")
test_assert(stats.numbers == 5, "five numbers in total")
test_assert(stats.strings == 1, "one string")
test_assert(stats.sum == 150, "sum of all numbers")
test_assert(stats.depth == 2, "one nesting level below the root")

local deep = sample_table_stats({a = {b = {c = 1}}})
test_assert(deep.depth == 3, "three nested tables")
test_assert(deep.values == 1 and deep.sum == 1, "single value at the bottom")

local ok, err = pcall(sample_table_stats, 42)
test_assert(not ok, "sample_table_stats raises on non-table")
test_assert(err == "bad argument #1 to 'sample_table_stats' (expected table, got number)",
            "error message explains the expected type")

local version = sample_version()
test_assert(type(version) == "table", "sample_version returns a table")
test_assert(type(version.module) == "string" and version.module ~= "", "module title flows from config/module.toml")
test_assert(type(version.module_author) == "string" and version.module_author ~= "", "module author flows from config/module.toml")
test_assert(math.abs(version.module_version - 2.1) < 1e-6, "module version from config/module.toml")
test_assert(version.sdk_version == "1.0.0", "SDK version from source/sdk/version.hpp")
test_assert(version.abi_version == "1", "module ABI version from source/sdk/version.hpp")
test_assert(version.mta == "1.6.0-harness", "server version from the manager")
test_assert(version.netcode == 42, "netcode version")
test_assert(version.os == "harness", "operating system name")
