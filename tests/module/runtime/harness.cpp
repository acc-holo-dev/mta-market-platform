// Embedded test harness.
//
// Loads the module core into a clean Lua 5.1 interpreter together with a
// mock ILuaModuleManager10 and runs every other/tests/lua/scripts/*.lua. Module
// functions are verified without launching an MTA server: argument types,
// error translation, tables, async result delivery, timers, resource
// restarts (a restart swaps in a REAL fresh VM -- fresh registry,
// fresh luaL_ref space -- under a new generation).
//
// Lua-side helpers:
//   test_assert(condition, message)   -- records a pass/fail
//   test_pump(milliseconds)           -- pumps DoPulse for the given time
//   test_resource_stop()              -- ResourceStopping + ResourceStopped
//   test_resource_start()             -- re-registers functions (same VM)
//   test_resource_restart()           -- stop + REAL fresh VM (new generation)
//   test_fresh_vm_dostring(chunk)     -- runs a chunk in the current resource VM
//   test_fresh_vm_get(name)           -- copies a global from that VM here

#include "ILuaModuleManager10.h"

#include "sdk/lua/common.hpp"
#include "sdk/lua/argument.hpp"
#include "sdk/abi/module.hpp"
#include "sdk/runtime/scheduler.hpp"

#include <algorithm>
#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

namespace
{
int g_passed = 0;
int g_failed = 0;
int g_script_errors = 0;

class MockModuleManager;

MockModuleManager *g_manager = nullptr;
std::vector<lua_State *> g_all_vms;

// Manager mock: registers functions into the test VM, reports fake server
// facts and "knows" a single resource named test_resource.
class MockModuleManager final : public ILuaModuleManager10
{
public:
    lua_State *test_vm = nullptr;
    std::vector<std::string> registered_names;

    static void report(char *buffer, std::size_t size, const char *format, va_list args)
    {
        std::vsnprintf(buffer, size, format, args);
    }

    void ErrorPrintf(const char *format, ...) override
    {
        char buffer[1024];
        va_list args;
        va_start(args, format);
        report(buffer, sizeof(buffer), format, args);
        va_end(args);
        std::printf("  [mock error] %s\n", buffer);
    }

    void DebugPrintf(lua_State *, const char *format, ...) override
    {
        char buffer[1024];
        va_list args;
        va_start(args, format);
        report(buffer, sizeof(buffer), format, args);
        va_end(args);
        std::printf("  [mock debug] %s\n", buffer);
    }

    void Printf(const char *format, ...) override
    {
        char buffer[1024];
        va_list args;
        va_start(args, format);
        report(buffer, sizeof(buffer), format, args);
        va_end(args);
        std::printf("  [mock log] %s\n", buffer);
    }

    bool RegisterFunction(lua_State *lua_vm, const char *function_name, lua_CFunction function) override
    {
        if (lua_vm == nullptr || function_name == nullptr || function == nullptr)
        {
            return false;
        }
        lua_register(lua_vm, function_name, function);
        registered_names.push_back(function_name);
        return true;
    }

    bool GetResourceName(lua_State *, std::string &name) override
    {
        name = "test_resource";
        return true;
    }

    CChecksum GetResourceMetaChecksum(lua_State *) override
    {
        CChecksum checksum{};
        return checksum;
    }

    CChecksum GetResourceFileChecksum(lua_State *, const char *) override
    {
        CChecksum checksum{};
        return checksum;
    }

    unsigned long GetVersion() override { return 0x10005; }
    const char *GetVersionString() override { return "1.6.0-harness"; }
    const char *GetVersionName() override { return "MockModuleManager"; }
    unsigned long GetNetcodeVersion() override { return 42; }
    const char *GetOperatingSystemName() override { return "harness"; }

    lua_State *GetResourceFromName(const char *resource_name) override
    {
        if (resource_name != nullptr && std::strcmp(resource_name, "test_resource") == 0)
        {
            return test_vm;
        }
        return nullptr;
    }

    bool GetResourceName(lua_State *, char *name, std::size_t length) override
    {
        if (name == nullptr || length == 0)
        {
            return false;
        }
        std::snprintf(name, length, "test_resource");
        return true;
    }

    bool GetResourceFilePath(lua_State *, const char *, char *, std::size_t) override
    {
        return false;
    }
};

void register_test_helpers(lua_State *lua_vm);

int test_assert(lua_State *lua_vm)
{
    const bool condition = lua_toboolean(lua_vm, 1) != 0;

    int line = -1;
    lua_Debug debug{};
    if (lua_getstack(lua_vm, 1, &debug) != 0)
    {
        lua_getinfo(lua_vm, "Sl", &debug);
        line = debug.currentline;
    }

    if (condition)
    {
        ++g_passed;
        // Progress line per assertion: with unbuffered stdout it survives a
        // fail-fast crash, so the CI log pins the exact failing call site.
        std::printf("  ok %d (line %d)\n", g_passed, line);
        return 0;
    }

    const char *message = lua_tostring(lua_vm, 2);
    std::printf("  ASSERT FAILED (line %d): %s\n", line, message ? message : "?");
    ++g_failed;
    return 0;
}

// Pumps pulse() until the timeout so background tasks and timers deliver
// their results into the test VM.
int test_pump(lua_State *lua_vm)
{
    const lua_Integer timeout_ms = luaL_checkinteger(lua_vm, 1);
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    while (std::chrono::steady_clock::now() < deadline)
    {
        mta::module::pulse();
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
    mta::module::pulse();
    return 0;
}

// Simulates a resource stop: ResourceStopping + ResourceStopped on the
// CURRENT resource VM (which may differ from the VM the script runs in
// after a restart).
int test_resource_stop(lua_State *)
{
    if (g_manager->test_vm != nullptr)
    {
        mta::module::resource_stopping(g_manager->test_vm);
        mta::module::resource_stopped(g_manager->test_vm);
    }
    return 0;
}

// Simulates a resource restart that reuses the same VM (functions
// re-registered; the VM generation advanced through the stop above).
int test_resource_start(lua_State *)
{
    if (g_manager->test_vm != nullptr)
    {
        mta::module::register_functions(g_manager->test_vm);
    }
    return 0;
}

// The restart regression: a restart gives the resource a REAL fresh VM --
// fresh registry,
// fresh luaL_ref space -- under a new generation. The script itself keeps
// running in the VM it started in; use test_fresh_vm_dostring /
// test_fresh_vm_get to drive and observe the new one.
int test_resource_restart(lua_State *)
{
    if (g_manager->test_vm != nullptr)
    {
        mta::module::resource_stopping(g_manager->test_vm);
        mta::module::resource_stopped(g_manager->test_vm);
    }

    // The vendored Lua is MTA's patched 5.1: luaL_newstate takes the state's
    // owner (mtasaowner) - nullptr for a module-owned state.
    lua_State *fresh = luaL_newstate(nullptr);
    luaL_openlibs(fresh);
    g_manager->test_vm = fresh;
    g_all_vms.push_back(fresh);

    mta::module::register_functions(fresh);
    register_test_helpers(fresh);
    return 0;
}

// Runs a Lua chunk inside the CURRENT resource VM. Returns true, or false
// plus the error message.
int test_fresh_vm_dostring(lua_State *caller)
{
    const char *chunk = luaL_checkstring(caller, 1);
    lua_State *vm = g_manager->test_vm;
    if (vm == nullptr)
    {
        lua_pushboolean(caller, 0);
        lua_pushliteral(caller, "no resource VM");
        return 2;
    }
    if (luaL_dostring(vm, chunk) != LUA_OK)
    {
        const char *error = lua_tostring(vm, -1);
        lua_pushboolean(caller, 0);
        lua_pushstring(caller, error ? error : "unknown error");
        lua_pop(vm, 1);
        return 2;
    }
    lua_pushboolean(caller, 1);
    return 1;
}

// Copies the global 'name' from the CURRENT resource VM into the calling VM
// (a value snapshot; tables are deep-copied by the Argument reader).
int test_fresh_vm_get(lua_State *caller)
{
    const char *name = luaL_checkstring(caller, 1);
    lua_State *vm = g_manager->test_vm;
    if (vm == nullptr)
    {
        lua_pushnil(caller);
        return 1;
    }
    lua_getglobal(vm, name);
    mta::lua::Argument value;
    value.read(vm, -1);
    lua_pop(vm, 1);
    value.push(caller);
    return 1;
}

// Harness bookkeeping after a restart test: reattaches the resource VM to
// the VM the scripts run in, so later scripts keep working against the VM
// they are running in. (A real server never mixes VMs like this.)
int test_resource_restore(lua_State *caller)
{
    g_manager->test_vm = caller;
    return 0;
}

void register_test_helpers(lua_State *lua_vm)
{
    lua_register(lua_vm, "test_assert", test_assert);
    lua_register(lua_vm, "test_pump", test_pump);
    lua_register(lua_vm, "test_resource_stop", test_resource_stop);
    lua_register(lua_vm, "test_resource_start", test_resource_start);
    lua_register(lua_vm, "test_resource_restart", test_resource_restart);
    lua_register(lua_vm, "test_fresh_vm_dostring", test_fresh_vm_dostring);
    lua_register(lua_vm, "test_fresh_vm_get", test_fresh_vm_get);
    lua_register(lua_vm, "test_resource_restore", test_resource_restore);
}

// --- C++-side async task regressions ----------------------------

void expect(bool condition, const char *message)
{
    if (condition)
    {
        ++g_passed;
        return;
    }
    std::printf("  REGRESSION FAILED: %s\n", message);
    ++g_failed;
}

void run_async_regressions(lua_State *script_vm)
{
    using mta::async::Task;
    std::printf("== async task regressions (C++)\n");

    // run() -> valid handle -> main-thread completion -> done()
    bool delivered = false;
    Task task = mta::async::run(
        script_vm,
        [] {
            mta::lua::Arguments result;
            result.push_number(1);
            return result;
        },
        [&](const mta::lua::Arguments &, const char *error) { delivered = (error == nullptr); });
    expect(task.valid(), "run() returns a valid handle");
    expect(!task.done(), "queued task is not done yet");
    std::this_thread::sleep_for(std::chrono::milliseconds(30));
    mta::module::pulse();
    expect(delivered, "completion delivered on the main thread");
    expect(task.done(), "delivered task reports done()");
    expect(!task.cancel(), "cancelling a finished task reports false");

    // cancellation suppresses the completion
    bool cancelled_delivery = false;
    Task task2 = mta::async::run(
        script_vm,
        [] { std::this_thread::sleep_for(std::chrono::milliseconds(80)); return mta::lua::Arguments{}; },
        [&](const mta::lua::Arguments &, const char *) { cancelled_delivery = true; });
    expect(task2.cancel(), "a queued/running task accepts cancellation");
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    mta::module::pulse();
    expect(!cancelled_delivery, "a cancelled task never runs its completion");
    expect(task2.done(), "a cancelled task reports done()");

    // resource ownership: the completion of a finished generation
    // never runs
    bool owned_delivery = false;
    Task task3 = mta::async::run(
        script_vm,
        [] { std::this_thread::sleep_for(std::chrono::milliseconds(80)); return mta::lua::Arguments{}; },
        [&](const mta::lua::Arguments &, const char *) { owned_delivery = true; });
    mta::module::resource_stopping(script_vm);
    mta::module::resource_stopped(script_vm);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    mta::module::pulse();
    expect(!owned_delivery, "a completion is dropped after its resource stopped");

    // queue limit: a full queue rejects tasks instead of blocking.
    // With W workers (auto: at most 8) and queue limit 2, posting 20 slow
    // tasks rejects at least 20 - 8 - 2 = 10 of them deterministically.
    mta::async::Scheduler::instance().configure(2);
    int rejected = 0;
    for (int i = 0; i < 20; ++i)
    {
        Task blocker = mta::async::run(
            script_vm,
            [] { std::this_thread::sleep_for(std::chrono::milliseconds(100)); return mta::lua::Arguments{}; },
            [](const mta::lua::Arguments &, const char *) {});
        if (!blocker.valid())
        {
            ++rejected;
        }
    }
    expect(rejected >= 10, "a full task queue rejects tasks beyond the limit");
    mta::async::Scheduler::instance().configure(4096); // repo module.toml value
    std::this_thread::sleep_for(std::chrono::milliseconds(2600));
    mta::module::pulse();
}
} // namespace

int main()
{
    // Unbuffered stdout: when the process dies by fail-fast (MSVC reports
    // such crashes as exit code 0xc0000409), a buffered tail would be lost
    // and the CI log would show nothing before the exception.
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    // The vendored Lua is MTA's patched 5.1: luaL_newstate takes the state's
    // owner (mtasaowner) - nullptr for a module-owned state. Passing it lets
    // the state be created exactly like the real server does, and the check
    // below pins the ABI: if the module's lua headers ever drift from the
    // compiled Lua again, this fails loudly instead of storing garbage.
    lua_State *lua_vm = luaL_newstate(nullptr);
    if (lua_getmtasaowner(lua_vm) != nullptr)
    {
        std::printf("FATAL: Lua state owner mismatch (mtasaowner must be null)\n");
        return 2;
    }
    luaL_openlibs(lua_vm);
    g_all_vms.push_back(lua_vm);

    MockModuleManager manager;
    manager.test_vm = lua_vm;
    g_manager = &manager;

    char module_name[MAX_INFO_LENGTH * 2]{};
    char module_author[MAX_INFO_LENGTH * 2]{};
    float module_version = 0.0F;

    if (!mta::module::initialize(&manager, module_name, module_author, &module_version))
    {
        std::printf("FATAL: the module failed to initialize\n");
        return 2;
    }

    mta::module::register_functions(lua_vm);
    register_test_helpers(lua_vm);

    std::printf("harness: module functions registered: %zu\n", manager.registered_names.size());

    std::vector<fs::path> scripts;
    for (const auto &entry : fs::directory_iterator(SDK_TESTS_DIR))
    {
        if (entry.is_regular_file() && entry.path().extension() == ".lua")
        {
            scripts.push_back(entry.path());
        }
    }
    std::sort(scripts.begin(), scripts.end());

    for (const auto &script : scripts)
    {
        std::printf("== %s\n", script.filename().string().c_str());
        if (luaL_dofile(lua_vm, script.string().c_str()) != LUA_OK)
        {
            const char *error = lua_tostring(lua_vm, -1);
            std::printf("  SCRIPT ERROR: %s\n", error ? error : "unknown");
            lua_pop(lua_vm, 1);
            ++g_script_errors;
        }
        lua_gc(lua_vm, LUA_GCCOLLECT, 0);
    }

    run_async_regressions(lua_vm);

    std::printf("harness: C++ async regressions done; shutting down\n");
    mta::module::shutdown();

    // The module is shut down and the manager no longer hands out VMs; close
    // every VM created during the run (the script VM plus restart VMs).
    g_manager = nullptr;
    manager.test_vm = nullptr;
    for (lua_State *vm : g_all_vms)
    {
        lua_close(vm);
    }

    std::printf("\nharness: passed %d, failed %d, script errors %d\n", g_passed, g_failed,
                g_script_errors);
    return (g_failed > 0 || g_script_errors > 0) ? 1 : 0;
}