# Advanced Guides — MTA Module SDK

> The concise reference set lives in [api.md](api.md) (with
> [example.md](example.md), [architecture.md](architecture.md) and
> [migration-v1-to-v2.md](migration-v1-to-v2.md)).

In-depth guides on non-obvious topics. For a quick start and basic recipes
see [README.md](../README.md).

## Contents

1. [Thread safety](#1-thread-safety)
2. [Async and timers](#2-async-and-timers)
3. [Tables: deep reading](#3-tables-deep-reading)
4. [Per-resource state](#4-per-resource-state)
5. [Errors and exceptions](#5-errors-and-exceptions)
6. [Direct stack access](#6-direct-stack-access)
7. [Objects (userdata/metatables)](#7-objects-userdatametatables)
8. [Events (module → Lua)](#8-events-module--lua)
9. [Logging levels](#9-logging-levels)

---

## 1. Thread safety

**The main rule: touch Lua only on the server's main thread.**

- Every MTA resource lives in its own lua_State. The VM is NOT thread-safe.
- Calling Lua from workers is a sure way to crash the server.
- Therefore background tasks (post_task) run **pure C++** without Lua, and
  the result is delivered to the main thread through DoPulse (pump()).

Threading model of the module:

```
main thread (server)             workers (Scheduler)
─────────────────────            ─────────────────────
  Lua function call                 work() — pure C++
  post_task(...)  ───────────────► does the job
  ...                              pushes the result
  DoPulse → pump() ◄────────────── (mutex)
  completion() — Lua again ✓
```

This leads to the rules:

1. Never store lua_State* between calls (the VM dies when the resource stops).
2. For a deferred Lua call use mta::async::Callback.
3. For per-resource data use mta::resources::Store.

## 2. Async and timers

### Background task

```cpp
MTA_LUA_FUNCTION("my_fetch", "Computes in the background and calls a callback.")
{
    auto [url, callback] = mta::lua::args<std::string, mta::async::Callback>(L);
    auto cb = std::make_shared<mta::async::Callback>(std::move(callback));

    mta::async::Scheduler::instance().post_task(
        [url]() {                        // WORKER: no Lua!
            mta::lua::Arguments result;
            result.push_string(do_http_get(url));
            return result;
        },
        [cb](const mta::lua::Arguments &result, const char *error) {
            if (error != nullptr) {      // MAIN thread (DoPulse)
                mta::log::error("my_fetch: ", error);
                return;
            }
            cb->call(result);            // it is safe to call Lua here
        });

    return mta::lua::push_results(L, true);
}
```

### Important details

- Callback is move-only: when captured into std::function, wrap it in
  std::make_shared (std::function needs copyable targets).
- If work() throws, the worker catches it and the error reaches completion
  as a string.
- Callback::call returns false if the owning resource already stopped — a
  stale callback never fires after a resource restart.

### Timer

```cpp
MTA_LUA_FUNCTION("my_every", "Calls a callback every N ms.")
{
    auto [delay, callback] = mta::lua::args<std::int64_t, mta::async::Callback>(L);
    auto cb = std::make_shared<mta::async::Callback>(std::move(callback));

    const auto id = mta::async::Scheduler::instance().post_timer(
        cb->resource(),                       // the timer lives as long as the resource
        static_cast<int>(delay), 0,           // 0 = forever
        [cb](std::uint64_t tick) {
            mta::lua::Arguments args;
            args.push_number(static_cast<lua_Number>(tick));
            cb->call(args);
        });

    return mta::lua::push_results(L, static_cast<lua_Number>(id));
}
```

The timer is cancelled automatically when its owning resource stops (the
resource name is read from cb->resource()).

## 3. Tables: deep reading

mta::lua::Argument reads tables recursively, up to 32 levels (max_table_depth).
Nested tables are the same Argument values inside Table.

```cpp
// Lua: {10, 20, {30, 40}, name = "x"}
MTA_LUA_FUNCTION("my_flatten", "Sum of every number in the table.")
{
    auto [table] = mta::lua::args<mta::lua::Table>(L);

    double sum = 0.0;
    std::function<void(const mta::lua::Table&)> walk =
        [&](const mta::lua::Table &t) {
            for (const auto &v : t.array) {
                if (v.type() == mta::lua::Argument::Type::Number) sum += v.as_number();
                else if (v.is_table()) walk(v.as_table());
            }
            for (const auto &[k, v] : t.fields) {
                (void)k;
                if (v.type() == mta::lua::Argument::Type::Number) sum += v.as_number();
                else if (v.is_table()) walk(v.as_table());
            }
        };
    walk(table);

    return mta::lua::push_results(L, sum);
}
```

Useful details:

- Table.array — only the integer keys 1..n; holes are filled with nil.
- Table.fields — only the string keys; other keys are discarded.
- A cyclic table cannot freeze the module: deeper than 32 levels it is cut off.
- For a table result: build a mta::lua::Table and return it via
  push_results(L, mta::lua::Argument(std::move(table))).

## 4. Per-resource state

Every resource is its own VM, and it dies when the resource stops. Storing
per-resource data correctly looks like this:

```cpp
namespace
{
struct Session { std::string token; int requests = 0; };
mta::resources::Store<Session> g_sessions;   // one static in the .cpp
}

MTA_LUA_FUNCTION("session_hit", "Hit counter of the resource.")
{
    Session &s = g_sessions.for_state(L);    // create/get
    ++s.requests;
    return mta::lua::push_results(L, static_cast<lua_Number>(s.requests));
}
```

Cleanup is fully automatic: on ResourceStopped the resource record is
erased, on ShutdownModule everything is cleared. No manual cleanup
functions exist.

## 5. Errors and exceptions

- **Inside a function** throw mta::lua::raise_error("...") — the C++ stack
  unwinds correctly and the Lua scripter gets a readable error.
- **Type checks** are done by args<...> itself — no manual checks needed.
- **Any** uncaught C++ exception is caught by the trampoline and becomes a
  Lua error: the server does not crash.
- Do not call luaL_error/luaL_check* directly — that is a longjmp over
  C++ objects (destructor leaks). Use raise_error.

Typical messages (generated automatically):

```
argument #1 must be a number, got string
argument #2 must be a string, got table
argument #3 must be an integer, got no value   ← argument not passed
```

## 6. Direct stack access

Inside MTA_LUA_FUNCTION, lua_State *L is available — you can call any Lua
5.1 C API function directly (when args<...> does not fit):

```cpp
MTA_LUA_FUNCTION("my_dump", "Types of every argument.")
{
    const int count = lua_gettop(L);
    lua_pushnumber(L, static_cast<lua_Number>(count));
    for (int i = 1; i <= count; ++i)
    {
        lua_pushstring(L, lua_typename(L, lua_type(L, i)));
    }
    return count + 1;
}
```

Exceptions are caught by the framework here too. Never store L between calls.

## 7. Objects (userdata/metatables)

Objects with methods and a destructor — like in the sockets/mysql libraries.

```cpp
#include <mta/sdk.hpp>

namespace
{
struct Counter { double value = 0; };

void register_counter_methods(lua_State *L)
{
    MTA_METHOD(Counter, "get", [](Counter &self) { return self.value; });
    MTA_METHOD(Counter, "set", [](Counter &self, double v) { self.value = v; });
}

// Once per process: bind the method registrar to the type.
const bool counter_registered = [] {
    mta::userdata::Registry<Counter>::set_methods(&register_counter_methods);
    return true;
}();
} // namespace

MTA_LUA_FUNCTION("counter_create", "Creates a counter.")
{
    auto [value] = mta::lua::args<double>(L);
    mta::userdata::Registry<Counter>::create(L, Counter{value});
    return 1;
}
```

```lua
local c = counter_create(42)
c:get()   -- 42
c:set(100)
c = nil   -- __gc calls ~Counter()
```

Important details:

- Methods are registered **per VM** (each resource has its own lua_State and
  its own metatable) — Registry does this itself via set_methods.
- __gc calls the ~T() destructor on garbage collection — no memory leaks.
- Registry<T>::check(L, index) extracts T* from userdata with a type check.
- A live example is source/functions/objects/counter.cpp.

## 8. Events (module → Lua)

The module can "throw" an event into the resource's scripts via the standard
triggerEvent:

```cpp
MTA_LUA_FUNCTION("my_notify", "Sends an event.")
{
    auto [message] = mta::lua::args<std::string>(L);

    mta::lua::Arguments args;
    args.push_string(message);
    mta::events::trigger(L, "onMyNotify", args);

    return mta::lua::push_results(L, true);
}
```

```lua
addEventHandler("onMyNotify", root, function(msg)
    outputChatBox("The module sent: " .. msg)
end)
```

The event source is the global root. Call from the main thread only.

## 9. Logging levels

```cpp
mta::log::set_level(mta::log::Level::Debug);  // show everything
mta::log::debug(L, "detail: ", value);        // visible only on Debug
mta::log::info("ordinary message");
mta::log::warn("suspicious: ", x);
mta::log::error("error: ", reason);
```

The default level is Info: debug is hidden, info/warn/error are visible.
set_level(Level::Off) disables everything except error.

You never pass module/function/resource/task context yourself: the framework
prefixes each message with what it knows about the current call site
(`[Base Module:my_fn @ play] ...`; async delivery adds `task #N` / `timer
#N`, see "Logging" in `other/documents/api.md`). Write plain messages and let
the framework attribute them.
