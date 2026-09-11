#pragma once

// Exception-to-Lua-error conversion.
//
// Module functions must never let a C++ exception escape: the macros wrap
// every entry point in a trampoline that catches everything and turns it
// into a proper Lua error (longjmp across the C boundary is safe because the
// module does not own C++ resources at that point).
//
// Error rendering rules:
//   mta::errors::Error with InternalError -> "internal module error: ..."
//   any other mta::errors::Error          -> message verbatim
//   other std::exception                  -> "internal module error: ..."
//   non-std exception                     -> "internal module error: ..."
//
// While a module function runs, a thread-local diagnostic context is active
// (set by the registration trampolines and by the async dispatcher): the
// registered function name is used to render "bad argument #2 to 'name'", and
// the whole context (function, resource, task/timer) is what mta::log uses to
// attribute messages automatically. The context is scoped: the
// trampolines restore the previous one when the call returns, so a log
// emitted outside a module call is never attributed to a stale call site.

#include "sdk/abi/module.hpp"
#include "sdk/errors/errors.hpp"
#include "sdk/lua/common.hpp"

#include <cstdint>
#include <exception>
#include <sstream>
#include <string>
#include <utility>

namespace mta::lua
{
namespace detail
{
// Diagnostic context of the framework path currently running on this thread
// (thread_local). Written by the registration trampolines (module
// calls) and by the async dispatcher (worker loop, scheduler pump, callback
// delivery); read by error rendering ("bad argument #N to 'name'") and by
// the automatic log-message context. Purely diagnostic bookkeeping: nothing
// here guards resource lifetime.
struct DiagnosticContext
{
    const char *function = nullptr; // borrowed: a registered function name
    std::string resource;           // owning resource name, when known
    std::uint64_t task_id = 0;      // dispatched async task (0 = none)
    std::uint64_t timer_id = 0;     // firing timer (0 = none)
};

inline DiagnosticContext &diagnostic_context() noexcept
{
    thread_local DiagnosticContext context;
    return context;
}

// The registered name of the module function that is currently running
// (nullptr outside a module call); used to render "bad argument #2 to
// 'name'".
inline const char *&current_function_name() noexcept
{
    return diagnostic_context().function;
}

// RAII: applies a diagnostic context for the current scope and restores the
// previous one afterwards (also across exceptions). Its members are noexcept
// because they only move/clear std::strings and never longjmp: an allocation
// failure drops the affected string part instead of terminating.
class ScopedDiagnosticContext
{
public:
    ScopedDiagnosticContext(const char *function, std::uint64_t task_id,
                            std::uint64_t timer_id) noexcept
    {
        DiagnosticContext &context = diagnostic_context();
        previous_.function = context.function;            // pointer copy
        previous_.resource = std::move(context.resource); // move: noexcept
        previous_.task_id = context.task_id;
        previous_.timer_id = context.timer_id;

        context.function = function;
        context.task_id = task_id;
        context.timer_id = timer_id;
        context.resource.clear(); // recorded separately via set_resource()
    }

    ~ScopedDiagnosticContext()
    {
        DiagnosticContext &context = diagnostic_context();
        context.function = previous_.function;
        context.resource = std::move(previous_.resource); // move: noexcept
        context.task_id = previous_.task_id;
        context.timer_id = previous_.timer_id;
    }

    ScopedDiagnosticContext(const ScopedDiagnosticContext &) = delete;
    ScopedDiagnosticContext &operator=(const ScopedDiagnosticContext &) = delete;

    // Records the resource this scope belongs to ("" = unknown). Never
    // throws: the context is diagnostic, allocation failure just drops it.
    void set_resource(std::string resource) noexcept
    {
        try
        {
            diagnostic_context().resource = std::move(resource);
        }
        catch (...) // bad_alloc: diagnostic context only, never fatal
        {
            diagnostic_context().resource.clear();
        }
    }

private:
    DiagnosticContext previous_{};
};
} // namespace detail

// Raise an error that becomes a Lua error at the boundary.
[[noreturn]] inline void raise(std::string message)
{
    throw ::mta::errors::Error(::mta::errors::Category::Generic, std::move(message));
}

// Streaming variant: raise_error("argument #", 2, " must be a number").
template <typename... Args>
[[noreturn]] void raise_error(Args &&...args)
{
    std::ostringstream stream;
    (stream << ... << std::forward<Args>(args));
    raise(stream.str());
}

// Trampoline boundary: run fn(L), catch everything and convert to luaL_error.
//
// Deliberately NOT noexcept: the catch blocks end in luaL_error, which
// longjmps to the Lua pcall protection point. A longjmp that leaves a
// noexcept function is a fail-fast crash on MSVC (exit 0xc0000409), and it
// is at best unspecified elsewhere -- the boundary must stay unwindable.
inline int protected_call(lua_State *L, int (*fn)(lua_State *))
{
    try
    {
        return fn(L);
    }
    catch (const ::mta::errors::Error &e)
    {
        if (e.category() == ::mta::errors::Category::InternalError)
        {
            return luaL_error(L, "internal module error: %s", e.what());
        }
        return luaL_error(L, "%s", e.what());
    }
    catch (std::exception &e)
    {
        return luaL_error(L, "internal module error: %s", e.what());
    }
    catch (...)
    {
        return luaL_error(L, "internal module error: unknown C++ exception");
    }
}

// Same as protected_call, but scoped to the call: it names the running
// function (argument errors render "bad argument #N to '<name>'"), records
// the resource owning L for the automatic log-message context
// and clears any async attribution of the surrounding dispatch. The
// previous context is restored when the call returns.
inline int protected_call_named(lua_State *L, int (*fn)(lua_State *), const char *name)
{
    detail::ScopedDiagnosticContext scope{name, 0, 0};
    scope.set_resource(mta::module::current_resource_name(L));
    return protected_call(L, fn);
}
} // namespace mta::lua