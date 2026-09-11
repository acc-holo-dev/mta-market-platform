# Example — a complete module feature, end to end

This walkthrough builds a small but realistic feature — a **player greeting
service** with a synchronous API, background work, timers, an object type
and per-resource state — using only the public SDK surface. The walkthrough
uses short teaching names (`greet`, `greeter`); every C++ construct shown
here exists in the bundled sample module (`source/functions/`) under its
`sample_*` name, and each section names the real file(s) to open — so you
can see each one compiled and tested in place. The closing sections cover
the developer tooling (`mta`) that builds, documents and diagnoses the
module.

*Prerequisites: `mta doctor` reports READY (see api.md, "The `mta` CLI").*

---

## 1. Identity: config/module.toml

The module's identity lives in exactly one file. For a new project run
`mta init` (full scaffold) or edit the bundled one:

```toml
[module]
name = "greeter"       # -> greeter.dll / greeter.so, greeter_* metadata
title = "Greeter Module"
author = "You"
version = "0.1.0"

[build]
cxx_standard = 20
unity = true
lto = true

[async]
workers = "auto"
queue = 1024

[features]
async = true
userdata = true
events = true
objects = true
```

The binary name, the CMake target names, the registration metadata, `mta
package` output and `mta doctor` diagnostics all derive from `[module]` —
nothing is duplicated in C++ sources.

---

## 2. A synchronous function

Bundled analogues of everything below — `source/functions/basics/greet.cpp`
(`sample_greet` — body style + optional), `hello.cpp` (`sample_hello`,
`sample_hello_desc` — lambda style) and `typed_params.cpp`
(`sample_rest_count`/`sample_context_caller` — rest_args + context). Files
under `source/` are picked up automatically; registration happens at
static-init time:

```cpp
#include <mta/sdk.hpp>

// Body style: full control, explicit argument reading.
MTA_LUA_FUNCTION("greet", "Builds a greeting for a name.")
{
    auto [name] = mta::lua::args<std::string>(L);
    return mta::lua::push_results(L, "Hello, " + name + "!");
}
```

```lua
print(greet("World"))          -- Hello, World!
greet(42)                      -- error: bad argument #1 to 'greet'
                               --        (expected string, got number)
```

Body-style bundled analogue: `source/functions/basics/greet.cpp`
(`sample_greet`).

The same function in lambda style — signatures are introspected, argument
checks and result pushing are automatic (bundled analogues:
`source/functions/basics/hello.cpp` — `sample_hello`, `sample_hello_desc`):

```cpp
MTA_FUNCTION("greet", "Builds a greeting for a name.",
    [](std::string name) { return "Hello, " + name + "!"; });
```

Optional arguments, variadic tails and the call context:

```cpp
MTA_LUA_FUNCTION("greet_custom", "Greets with an optional custom salutation.")
{
    auto [name, salutation] =
        mta::lua::args<std::string, std::optional<std::string>>(L);
    return mta::lua::push_results(L,
        salutation.value_or("Hello") + ", " + name);
}

MTA_LUA_FUNCTION("greet_many", "Greets several names at once.")
{
    auto [rest] = mta::lua::args<mta::lua::rest_args>(L);
    mta::lua::Arguments results;
    for (std::size_t i = 0; i < rest.values.count(); ++i)
    {
        results.push_string("Hello, " + rest.values.at(i).as_string() + "!");
    }
    return mta::lua::push_results(L, results);
}

MTA_LUA_FUNCTION("greet_where", "Greets and reports the calling resource.")
{
    auto [name, ctx] = mta::lua::args<std::string, mta::lua::context>(L);
    mta::log::info("greet_where called by resource ", ctx.resource);
    return mta::lua::push_results(L, "Hello, " + name);
}
```

Bundled analogues per construct: the optional argument — `sample_greet`
(`source/functions/basics/greet.cpp`); the variadic tail — `sample_rest_count`
and the call context — `sample_context_caller` (both
`source/functions/basics/typed_params.cpp`).

---

## 3. Background work with a callback

Heavy work runs on a worker thread and delivers on the main thread inside
`DoPulse`. The worker closure must not touch Lua — hand values through
`mta::lua::Arguments` and deliver through an `mta::async::Callback`:

```cpp
// greet_later(name, delay_ms, callback) -- callback(text) on the main thread
MTA_LUA_FUNCTION("greet_later", "Greets after delay_ms on a worker thread.")
{
    auto [name, delay_ms, callback] =
        mta::lua::args<std::string, std::int64_t, mta::async::Callback>(L);

    // std::function needs copyable targets; Callback is move-only.
    auto cb = std::make_shared<mta::async::Callback>(std::move(callback));

    mta::async::Task task = mta::async::run(
        L,
        [name, delay_ms]() -> mta::lua::Arguments {   // worker: no Lua here
            std::this_thread::sleep_for(
                std::chrono::milliseconds(static_cast<int>(delay_ms)));
            mta::lua::Arguments result;
            result.push_string("Hello, " + name + " (from a worker)");
            return result;
        },
        [cb](const mta::lua::Arguments &result, const char *error) {
            if (error != nullptr)
            {
                mta::log::error("greet_later failed: ", error);
                return;
            }
            cb->call(result);                          // main thread
        });

    if (!task.valid())
    {
        mta::lua::raise_error("task queue is full: task not accepted");
    }
    return mta::lua::push_results(L);   // the completion arrives later
}
```

```lua
greet_later("async", 500, function(text)
    print(text)          -- Hello, async (from a worker)
end)
```

Handles: `run()` returns a `Task` — `cancel()` (queued tasks never run;
a running task completes but its delivery is suppressed), `done()`,
`valid()`, `id()`. The task belongs to the calling resource: if it stops,
queued tasks are cancelled and stale completions are dropped before any Lua
access; a restart of the same resource runs a fresh VM generation that can
never receive them.

---

## 4. A cancellable timer

```cpp
MTA_LUA_FUNCTION("greet_after", "Greets once after delay_ms. Returns the timer id.")
{
    auto [delay_ms, callback] = mta::lua::args<std::int64_t, mta::async::Callback>(L);
    auto cb = std::make_shared<mta::async::Callback>(std::move(callback));

    mta::timer::Timer timer = mta::timer::after(L, static_cast<int>(delay_ms), [cb] {
        mta::lua::Arguments args;
        args.push_string("Hello from a timer!");
        cb->call(args);
    });
    if (!timer.valid())
    {
        mta::lua::raise_error("timer was not accepted");
    }
    return mta::lua::push_results(L, static_cast<lua_Number>(timer.id()));
}
```

`mta::timer::every(L, delay_ms, fn)` repeats; both return a `Timer` handle
(`cancel()/valid()/id()`). Timers are resource-aware: a resource stop
invalidates every owned timer, and no timer of an older generation can ever
fire into a restarted resource. The bundled `sample_after`/
`sample_after_cancel` show the full handle bookkeeping with a
`Store<TimerMap>`.

---

## 5. An object type

```cpp
struct Greeter
{
    std::string salutation = "Hello";
};

// Declares the identity ONCE: metatable "mta.greeter.greeter", stable
// across compilers, collision-free across modules.
MTA_OBJECT("greeter", Greeter)

void register_greeter_methods(lua_State *L)
{
    MTA_METHOD(Greeter, "greet", [](Greeter &self, std::string name) {
        return self.salutation + ", " + name + "!";
    });
    MTA_METHOD(Greeter, "set_salutation",
        [](Greeter &self, std::string s) { self.salutation = std::move(s); });
}
const bool greeter_methods_registered = [] {
    mta::userdata::Registry<Greeter>::set_methods(&register_greeter_methods);
    return true;
}();

MTA_LUA_FUNCTION("greeter_create", "Creates a greeter object.")
{
    auto [salutation] = mta::lua::args<std::optional<std::string>>(L);
    Greeter g;
    if (salutation.has_value()) { g.salutation = *salutation; }
    mta::userdata::Registry<Greeter>::create(L, std::move(g));
    return 1;
}
```

```lua
local g = greeter_create("Hi")
print(g:greet("Sam"))                  -- Hi, Sam!
g:set_salutation("Greetings")
print(g:greet("Sam"))                  -- Greetings, Sam!
g = nil                                -- __gc destroys the C++ object

greeter_create({})                     -- error: bad argument #1 to
                                       --   'greeter_create' (expected string, got table)
```

Wrong-typed objects are caught by identity:
`bad argument #1 to 'greet' (expected greeter, got table)`.

---

## 6. Per-resource state

State that belongs to a resource disappears when the resource stops —
`mta::resources::Store<T>` does the bookkeeping:

```cpp
namespace
{
struct GreetStats { std::uint64_t total = 0; };
mta::resources::Store<GreetStats> g_stats;
}

MTA_LUA_FUNCTION("greet_count", "How many greetings this resource made.")
{
    GreetStats &stats = g_stats.for_state(L);
    ++stats.total;
    return mta::lua::push_results(L, static_cast<lua_Number>(stats.total));
}
```

After `restart resource greeter` the count starts from 1 again — the store
was erased on stop. Long-lived handles that outlive a single call (task ids,
timer ids) live in the same kind of store; see `sample_task_run` and
`sample_after`.

---

## 7. Events and resources

```cpp
// Trigger an MTA event the resource's scripts can handle:
MTA_LUA_FUNCTION("greet_broadcast", "Fires onGreeterGreet with a message.")
{
    auto [message] = mta::lua::args<std::string>(L);
    mta::lua::Arguments args;
    args.push_string(message);
    const bool ok = mta::events::trigger(L, "onGreeterGreet", args);
    return mta::lua::push_results(L, ok);
}

// Native (safe) resource lookup:
MTA_LUA_FUNCTION("greet_find", "true if a resource is running.")
{
    auto [name] = mta::lua::args<std::string>(L);
    auto resource = mta::Resource::find(name);
    return mta::lua::push_results(L, resource.has_value() && resource->alive());
}
```

```lua
addEventHandler("onGreeterGreet", root, function(message)
    outputServerLog("greeter event: " .. message)
end)
```

---

## 8. Build, test, install

```text
mta doctor                 -- environment ready?
mta build                  -- configure + build (default preset)
mta test all               -- unit (C++) + lua (embedded VM) suites
mta test integration       -- real pinned MTA server run (harness in other/server/)
mta package                -- dist/greeter-0.1.0-<platform>/ + sha256
mta server install         -- isolated pinned server (first time only)
mta server test            -- the same integration through the harness
```

Manual install: copy the built binary into `<mta-server>/server/x64/modules/`
and add to `mtaserver.conf`:

```xml
<module src="greeter.dll" />
```

Restart the server (or `restart <resource>` after re-copying) and call the
functions from any resource. The integration harness in
`other/server/mta_server.py` does exactly this automatically — read its
generated `sdkintegration` resource for a complete runnable script.

---

## 9. The canonical `sum` example: types, errors, manual validation

This section is the compact reference for how arguments, results and errors
work end to end; §2 above showed the same mechanics inside a feature.

### The function

```cpp
#include <mta/sdk.hpp>

// Lambda style: the C++ signature IS the documentation -- the binder checks
// the arguments and pushes the result automatically.
MTA_FUNCTION("sum",
    [](double a, double b)
    {
        return a + b;
    });
```

### The calls and their results

```lua
sum(10, 20)        -- 30
```

```lua
sum(10)            -- the second argument is absent
```

The conceptual result of this call is: **argument #2 is missing**. The SDK
renders the same condition in its own diagnostic format:

```text
bad argument #2 to 'sum' (expected number, got no value)
```

```lua
sum("10", 20)      -- the first argument has the wrong type
```

The conceptual result of this call is: **argument #1 has invalid type**,
rendered as:

```text
bad argument #1 to 'sum' (expected number, got string)
```

Both concrete formats are pinned by regression tests
(`other/tests/lua/scripts/045_errors.lua`); every message names the argument
position, the function and what was expected/found, so it is usable in
production logs.

### Which types the binder accepts

You can always see what a function accepts: `module_signature("sum")`
returns the derived metadata (argument/return types), and `mta docs` renders
it for every registered function and object method. The supported parameter
types:

| C++ parameter | Lua side |
|---|---|
| `bool` | boolean |
| `double`, `float`, integers | number (integers range-checked) |
| `std::string`, `std::string_view` | string |
| `std::optional<T>` | value or `nil`/absent → `nullopt` |
| `mta::lua::Table` / `Argument` / `rest_args` | table / any value / the tail |
| `mta::async::Callback` | function (stable reference) |
| `mta::lua::context` | — (consumes no Lua argument) |
| `mta::Resource` | name of a running resource, validated live |

Result types: scalars, `std::optional<T>` (`nil` when absent), tuple/pair and
`std::vector<T>` (expanded into several results), `mta::lua::Arguments`,
`void` — and `mta::Resource`, which is pushed as its name.

### How errors are generated

Every registered function runs through a protected trampoline
(`source/sdk/lua/protect.hpp`): C++ exceptions become proper Lua errors and
never escape into the server process (local C++ objects are destroyed
first). Argument problems are raised by the typed readers as categorized
errors (`InvalidType`, `MissingArgument`, `InvalidObject`, …) and rendered as
`bad argument #N to 'name' (…)`; anything categorized `InternalError` is
rendered as `internal module error: …`, so a scripter mistake can never
masquerade as a framework bug. The same model covers object
validation (`expected counter, got table`) and native entities
(`no running resource 'xyz'`).

### Manual validation

Automatic binding checks presence, count and type. Anything beyond that —
ranges, cross-field constraints, business rules — you validate in the body
and raise with `mta::lua::raise_error`:

```cpp
MTA_FUNCTION("divide", "Divides a by b and rejects zero.",
    [](double a, double b)
    {
        if (b == 0)
        {
            mta::lua::raise_error("argument #2 must not be zero");
        }
        return a / b;
    });
```

```lua
divide(1, 0)   -- error: argument #2 must not be zero
```

Body style keeps the automatic typed reading (`args<...>`) and adds manual
checks on top:

```cpp
MTA_LUA_FUNCTION("clamp", "Clamps value into [lo, hi].")
{
    auto [value, lo, hi] = mta::lua::args<double, double, double>(L);
    if (lo > hi)
    {
        mta::lua::raise_error("lo must not exceed hi");
    }
    return mta::lua::push_results(L, value < lo ? lo : (value > hi ? hi : value));
}
```

### When automatic binding is not enough

* The parameter list is not known at compile time — use body style with
  `mta::lua::rest_args` / `Argument` snapshots (see `greet_many` above).
* You need raw stack access or a custom calling convention — body style with
  `check_*`/`opt_*` (api.md, "Direct stack access").
* Body-style registration cannot derive signature metadata: `module_signature`
  reports `derived == false` and `mta docs` says so explicitly.
* Per-function error declarations are not part of the metadata (the binder
  converts raised errors uniformly); document special errors in the
  description.
* The `self` parameter of object methods is bound by `MTA_METHOD`, not by the
  free-function binder.

---

## 10. Multiple return values

A tuple — or several values in one `push_results` call — becomes several Lua
results. Bundled analogues: `source/functions/basics/hello.cpp`
(`sample_hello_len`) and `basics/minmax.cpp` (`sample_minmax`):

```cpp
// Lambda style: the tuple is expanded -- Lua receives two results.
MTA_FUNCTION("sample_hello_len", "Greets and reports the name length.",
    [](std::string name)
    {
        return std::make_tuple("Hello, " + name, static_cast<int>(name.size()));
    });

// Body style: several values in one push_results.
MTA_LUA_FUNCTION("sample_minmax", "Returns the minimum and maximum of two numbers.")
{
    auto [a, b] = mta::lua::args<double, double>(L);
    return mta::lua::push_results(L, std::min(a, b), std::max(a, b));
}
```

```lua
local text, len = sample_hello_len("Sam")   -- text = "Hello, Sam", len = 3
local lo, hi    = sample_minmax(30, 10)     -- lo = 10, hi = 30
sample_hello_len(42)   -- error: bad argument #1 to 'sample_hello_len'
                       --        (expected string, got number)
```

A `std::vector<T>` or `mta::lua::Arguments` result is expanded the same way
(a dynamic result list — `sample_range`, `source/functions/basics/range.cpp`);
a `std::optional<T>` result collapses to `nil` when absent.

---

## 11. Tables

`mta::lua::Table` is a decoded snapshot of a Lua table — an `array` part plus
named `fields` — so C++ works on plain data instead of stack indices. Field
access by key lives in `source/sdk/lua/table_helpers.hpp` (`get_field`,
`set_field`, `find_field`). Bundled analogues:
`source/functions/tables/table_fields.cpp` and `tables/table_stats.cpp`:

```cpp
// table_fields.cpp: read fields with defaults, write a field back.
MTA_LUA_FUNCTION("sample_table_get",
    "Reads the 'name' (string) and 'hp' (number) fields of a table; returns both.")
{
    auto [table] = mta::lua::args<mta::lua::Table>(L);

    const std::string name = mta::lua::get_field<std::string>(table, "name", "unknown");
    const double hp = mta::lua::get_field<double>(table, "hp", 0.0);

    return mta::lua::push_results(L, name, hp);
}

MTA_LUA_FUNCTION("sample_table_set",
    "Writes the 'name' field into a table and returns the table back.")
{
    auto [table, name] = mta::lua::args<mta::lua::Table, std::string>(L);

    mta::lua::set_field(table, "name", mta::lua::Argument(name));

    return mta::lua::push_results(L, mta::lua::Argument(std::move(table)));
}
```

```lua
local name, hp = sample_table_get({name = "Alice", hp = 100})  -- "Alice", 100
local name, hp = sample_table_get({})                          -- "unknown", 0
local t = sample_table_set({hp = 90}, "Bob")                   -- {name = "Bob", hp = 90}

sample_table_get("not a table")  -- error: bad argument #1 to 'sample_table_get'
                                 --        (expected table, got string)
```

Nested tables are decoded recursively: `table_stats.cpp` walks `array` +
`fields` down the whole value tree and builds its result table with
`result.fields.emplace_back(...)`. The helpers raise readable errors when a
field is missing without a default (`table has no field 'hp'`) or has the
wrong type (`field must be a number, got string`) —
`source/sdk/lua/table_helpers.hpp`.

---

## 12. Errors

§9 showed where argument errors come from; this is the model behind them
(`source/sdk/errors/errors.hpp`, rendered at the protected trampoline in
`source/sdk/lua/protect.hpp`). From your own code raise with
`mta::lua::raise_error(...)` — it streams the message, throws the `Generic`
category, and the trampoline converts it into a proper Lua error (local C++
objects destroyed first, nothing escapes into the server). Bundled analogue:
`source/functions/basics/range.cpp`:

```cpp
// range.cpp -- a deliberate, scripter-facing error:
if (to >= from && static_cast<std::uint64_t>(to) - static_cast<std::uint64_t>(from) > 1000)
{
    mta::lua::raise_error("range too large: at most 1000 numbers");
}
```

```lua
sample_range(1, 5000)   -- error: range too large: at most 1000 numbers
```

Every error carries a category; the category decides how it is rendered:

| Category | Producer | Rendered to Lua |
|---|---|---|
| `Generic` | deliberate `raise_error` in a function body | message verbatim |
| `InvalidArgument` / `InvalidType` / `MissingArgument` | binder (count / order / type) | `bad argument #N to 'name' (…)` |
| `ResourceStopped` | operation on a dead resource generation | message verbatim |
| `InvalidCallback` | stale or invalid Lua callback reference | message verbatim |
| `InvalidObject` | object of another type or another resource | message verbatim |
| `AsyncCancelled` | background task was cancelled | message verbatim |
| `InternalError` | framework bug / unexpected C++ exception | `internal module error: …` |

The one asymmetry is deliberate: only `InternalError` gets the
`internal module error:` prefix, so a framework bug can never masquerade as
a scripter mistake — every other category is the producer's user-facing
message, verbatim.

---

## 13. Native MTA types

The module ABI exposes exactly one safe native lookup — resources.
`mta::Resource` (`source/sdk/native/resource.hpp`) pairs a name with a VM
handle that is resolved live on every use: `Resource::find(name)` returns
nothing for an unknown/stopped resource, `vm()` is never cached. It is also
a full typed-binder parameter and result. Bundled analogue:
`source/functions/native/resource_args.cpp`:

```cpp
// The binder validates the name LIVE through the module manager ABI: an
// unknown resource is an argument error, never a dangling wrapper.
MTA_FUNCTION("sample_resource_arg",
    "Resolves a resource name into mta::Resource (live ABI validation); "
    "returns its name and alive flag.",
    [](mta::Resource resource)
    {
        return std::make_tuple(resource.name(), resource.alive());
    });

// Optional form: nil/absent -> nullopt instead of an error.
// sample_resource_arg_optional, sample_resource_return: same file.
```

Manual lookup, no binder involved:

```cpp
if (auto res = mta::Resource::find("play"); res && res->alive())
{
    // res->vm() is the live lua_State of that resource
}
if (auto self = mta::Resource::current(L))
{
    mta::log::info("called from resource ", self->name());
}
```

```lua
sample_resource_arg("play")              -- "play", true
sample_resource_arg("no_such_resource")  -- error: bad argument #1 to
                                         --   'sample_resource_arg'
                                         --   (no running resource 'no_such_resource')
```

A `Resource` returned to Lua is pushed as its name — the only stable
Lua-side identity the ABI provides (`sample_resource_return`).

---

## 14. Library usage

`source/library/` is plain C++ shared by your functions (dependency
direction `functions → library → sdk`; library code never touches Lua and
never registers functions itself — `source/library/base/README.md`).
`HandleMap` (`source/library/base/handle_map.hpp`) is the id → handle
registry you need whenever Lua holds numeric ids (task ids, timer ids, your
own). Bundled analogue: `source/functions/async/task_demo.cpp`:

```cpp
#include <mta/sdk.hpp>

#include <library/base/handle_map.hpp>

namespace
{
// Live handles of the calling resource; the Store clears the map when the
// resource stops.
mta::resources::Store<mta::library::base::HandleMap<std::uint64_t, mta::async::Task>> g_tasks;
}

// sample_task_run: register the returned handle under its id ...
const std::uint64_t id = task.id();
if (!g_tasks.for_state(L).emplace(id, std::move(task)))
{
    mta::log::error("sample_task_run: duplicate task id ", id);
}

// ... sample_task_cancel: find -> cancel -> erase.
auto *tasks = &g_tasks.for_state(L);
mta::async::Task *task = tasks->find(static_cast<std::uint64_t>(id));
if (task == nullptr) { return mta::lua::push_results(L, false); }
const bool cancelled = task->cancel();
tasks->erase(static_cast<std::uint64_t>(id));
```

```lua
local id = sample_task_run(100, 2, 3, function(sum) print(sum) end)
sample_task_cancel(id)   -- true:  the completion will never run
sample_task_cancel(id)   -- false: already cancelled and erased
```

Organize your own helpers by domain — `library/http/`, `library/json/`,
… one folder per topic; a new `.cpp` anywhere under `source/` is picked up
by the build automatically.

---

## 15. Creating a new function / a new object

`mta new` writes compile-ready skeletons into `source/functions/`; the
registered name is used verbatim, dotted names become underscores in the
file and C++ identifiers (`other/tools/mta/cli.py`):

```text
mta new function crypto.sha256   # -> source/functions/crypto_sha256.cpp
mta new object account           # -> source/functions/account.cpp
```

`new function` generates an `MTA_FUNCTION` one-liner; `new object` generates
a struct + `MTA_OBJECT("<name>", …)` + methods + a `<name>_create`
constructor — the object pattern of §5. The next build picks the file up
automatically; there is no registration list to edit.

```text
mta new function greet           # source/functions/greet.cpp is created
mta new function greet           # error: refusing to overwrite an existing
                                 #        file: .../source/functions/greet.cpp
```

A whole new module project is `mta init <name>` — it copies the SDK checkout
and rewrites `config/module.toml` with the new identity (§1).

---

## 16. Documentation generation

`mta docs` builds the `sdk_docgen` target and dumps the registry metadata —
function name, description, derived signature (argument/return types,
optional markers), object methods — as markdown. `--output FILE` writes it
to a file instead of stdout, `--preset` selects the CMake preset
(details: api.md, "The `mta` CLI").

```text
mta docs --output docs/module.md
```

Body-style functions have no derivable signature: the docgen reports them
with an explicit `n/a` marker instead of guessing (§9, "module_signature").

---

## 17. Doctor

`mta doctor` checks the environment before you fight the build: TOML
validity + identity, SDK headers, Lua ABI byte-compare, toolchain probes
(target architecture), presets, build output, git state — one `[ok]` /
`[warn]` / `[FAIL]` line per check and a final verdict (details: api.md,
"The `mta` CLI"). It is the gate the prerequisite at the top of this
document refers to.

```text
mta doctor
MTA Module SDK Doctor
------------------------------------------------------------
[ok]   Project            ...
------------------------------------------------------------
Status: READY
```

Failure example: run it outside a module project — the Project check fails
and the command exits non-zero:

```text
[FAIL] Project            config/module.toml not found
------------------------------------------------------------
Status: NOT READY
```

---

## Where each concept is exercised in the repo

| Concept | Sample | Tests |
|---|---|---|
| body/lambda registration | `functions/basics/add.cpp`, `hello.cpp` | `010_basic.lua`, `015_facade.lua` |
| tables deep-reading | `functions/tables/table_stats.cpp` | `020_tables.lua` |
| async task + handle | `functions/async/task_demo.cpp` | `035_task.lua` |
| timers + handles | `functions/async/timer_demo.cpp` | `038_timer.lua` |
| callback delivery | `functions/async/async_add.cpp` | `030_async.lua` |
| typed rest_args / context | `functions/basics/typed_params.cpp` | `040_binder.lua` |
| objects | `functions/objects/counter.cpp` | `060_features.lua` |
| events | `functions/basics/trigger_demo.cpp` | `060_features.lua` |
| per-resource state | `functions/state/session.cpp` | `070_lifecycle.lua` |
| restart generations | — (harness-level) | `072_restart.lua` |
| native Resource | `functions/info/resource_info.cpp` | `060_features.lua` |
| native Resource as binder argument/result | `functions/native/resource_args.cpp` | `060_features.lua` |
| stress | — | `080_stress.lua` |
| full restart + shutdown on a real server | `other/server/mta_server.py` | `mta test integration` |

---

## Coverage map: feature topic index

This document keeps its walkthrough order instead of one section per
topic; every important feature is demonstrated in full — here is where
each one lives, in this document or in the bundled file that exercises it:

| Topic | In this document | Bundled code / command |
|---|---|---|
| Basic function | §2, §9 | `source/functions/basics/greet.cpp`, `hello.cpp` (`sample_greet`, `sample_hello`) |
| Multiple arguments | §2, §10 | `basics/minmax.cpp` (`sample_minmax`), `async/task_demo.cpp` (`sample_task_run`) |
| Optional arguments | §2 | `basics/greet.cpp` (`sample_greet`) |
| Variadic arguments | §2 | `basics/typed_params.cpp` (`sample_rest_count`), `basics/range.cpp` (`sample_range`) |
| Return values | §2, §9 | `basics/add.cpp` (`sample_add`), `hello.cpp` |
| Multiple return values | §10 | `hello.cpp` (`sample_hello_len`), `minmax.cpp` (`sample_minmax`) |
| Tables | §11 | `tables/table_fields.cpp`, `tables/table_stats.cpp` |
| Callbacks | §3, §4 | `async/async_add.cpp` (`sample_async_add`) |
| Async | §3 | `async/task_demo.cpp` (`sample_task_run`) |
| Timers | §4 | `async/timers.cpp` (`sample_timer`), `async/timer_demo.cpp` (`sample_after`) |
| Errors | §12, §9 | `basics/range.cpp` (`raise_error`), `source/sdk/errors/errors.hpp` |
| Resource state | §6 | `state/session.cpp` (`sample_session_hit`) |
| Objects | §5 | `objects/counter.cpp` |
| Native MTA types | §13, §7 | `native/resource_args.cpp`, `source/sdk/native/resource.hpp` |
| Library usage | §14 | `source/library/base/handle_map.hpp` via `async/task_demo.cpp` |
| Testing | §8 | `mta test`, `other/tests/lua/scripts/*.lua` |
| Creating a new function | §15 | `mta new function <name>` |
| Creating a new object | §15 | `mta new object <name>` |
| Building | §8 | `mta build` |
| Documentation generation | §16 | `mta docs` |
| Doctor | §17 | `mta doctor` |