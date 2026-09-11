#include "sdk/logging/logging.hpp"

#include "ILuaModuleManager10.h"
#include "sdk/abi/module.hpp"
#include "sdk/lua/protect.hpp"

#include <cstdio>
#include <string>

namespace mta::log
{
namespace
{
Level g_level = Level::Info;

// Output while the module manager is not attached (test harness, early
// errors).
void fallback_write(std::FILE *target, std::string_view message)
{
    std::fwrite(message.data(), 1, message.size(), target);
    std::fputc('\n', target);
    std::fflush(target);
}

// The context the framework knows about the current call site (// module, function, resource, task, error -- added automatically, callers
// never pass them). The module identity is the compile-time module name; the
// function/resource/task/timer parts come from the thread-local diagnostic
// context that the registration trampolines and the async dispatcher fill:
//
//     [Base Module:sample_timer @ play] sample timer: duplicate timer id 3
//     [Base Module task #7 @ play] async completion failed: ...
//
// include_resource is false for the debug(L, ...) path: MTA's DebugPrintf
// already attributes VM-based debug messages.
std::string context_prefix(bool include_resource)
{
    const mta::lua::detail::DiagnosticContext &context =
        mta::lua::detail::diagnostic_context();
    const char *module_name = mta::module::info().name;

    std::string prefix;
    if (module_name != nullptr && *module_name != '\0')
    {
        prefix += module_name;
    }
    if (context.function != nullptr)
    {
        if (!prefix.empty())
        {
            prefix += ':';
        }
        prefix += context.function;
    }
    if (context.task_id != 0)
    {
        prefix += " task #";
        prefix += std::to_string(context.task_id);
    }
    if (context.timer_id != 0)
    {
        prefix += " timer #";
        prefix += std::to_string(context.timer_id);
    }
    if (include_resource && !context.resource.empty())
    {
        prefix += " @ ";
        prefix += context.resource;
    }

    if (prefix.empty())
    {
        return {};
    }
    return "[" + prefix + "] ";
}
} // namespace

void set_level(Level level) noexcept
{
    g_level = level;
}

Level get_level() noexcept
{
    return g_level;
}

void write_info(std::string_view message)
{
    const std::string text = context_prefix(true) + std::string(message);
    if (auto *manager = mta::module::manager())
    {
        manager->Printf("%s", text.c_str());
        return;
    }
    fallback_write(stdout, text);
}

void write_warn(std::string_view message)
{
    const std::string text = std::string("[WARN] ") + context_prefix(true) + std::string(message);
    if (auto *manager = mta::module::manager())
    {
        manager->Printf("%s", text.c_str());
        return;
    }
    fallback_write(stdout, text);
}

void write_error(std::string_view message)
{
    const std::string text = context_prefix(true) + std::string(message);
    if (auto *manager = mta::module::manager())
    {
        manager->ErrorPrintf("%s", text.c_str());
        return;
    }
    fallback_write(stderr, text);
}

void write_debug(lua_State *lua_vm, std::string_view message)
{
    const std::string text = context_prefix(lua_vm == nullptr) + std::string(message);
    if (auto *manager = mta::module::manager())
    {
        manager->DebugPrintf(lua_vm, "%s", text.c_str());
        return;
    }
    fallback_write(stdout, text);
}
} // namespace mta::log