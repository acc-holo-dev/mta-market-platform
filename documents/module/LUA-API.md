# API Reference — MTA Module SDK

The public surface of the SDK. A module developer includes exactly one
header and registers functions; everything else in this document is
optional and grouped by subsystem.

```cpp
#include <mta/sdk.hpp>
```

Everything exported by `<mta/sdk.hpp>` lives under `mta::*` or in the
registration macros. Registered Lua names are used **verbatim** — the SDK
never adds prefixes, namespaces or suffixes (`crypto.sha256` stays
`crypto.sha256`).

The bundled sample module (`source/functions/`) registers a small set of
`sample_*` / `counter_*` functions; they double as regression anchors and as
the live example of every API in this document.

---

## Contents

1. [Registering functions](#registering-functions)
2. [Reading arguments](#reading-arguments)
3. [Returning results](#returning-results)
4. [Errors](#errors)
5. [Value snapshots: Argument / Table / Arguments](#value-snapshots-argument--table--arguments)
6. [The borrowed state view: mta::state / MTA_STATE](#the-borrowed-state-view-mtastate--mta_state)
7. [Direct stack access](#direct-stack-access)
8. [Logging](#logging)
9. [Background tasks (async)](#background-tasks-async)
10. [Callbacks](#callbacks)
11. [Timers](#timers)
12. [Per-resource state](#per-resource-state)
13. [Objects (userdata)](#objects-userdata)
14. [Events](#events)
15. [Native types (Resource)](#native-types-resource)
16. [Module identity and lifecycle](#module-identity-and-lifecycle)
17. [Configuration: config/module.toml](#configuration-configmoduletoml)
18. [The `mta` CLI](#the-mta-cli)

---

## Registering functions

Registration happens at static-init time — any `.cpp` under `source/` is
picked up by the build; no lists to maintain.

### `MTA_FUNCTION` (recommended)

```cpp
// Without a description:
MTA_FUNCTION("sum", [](double a, double b) { return a + b; });

// With a description:
MTA_FUNCTION("crypto.sha256", "Hashes a string.",
    [](std::string value) { return sha256_hex(value); });

// Multiple results: return a tuple/pair.
MTA_FUNCTION("divmod", "Quotient and remainder.",
    [](double a, double b) { return std::make_pair(a / b, std::fmod(a, b)); });
```

The function registers under exactly `name`. Lambda signatures are
introspected: parameter types are checked per call (with readable
`bad argument #N` errors), the return value is pushed automatically, and the
signature is recorded in the registry metadata (shown by `mta docs`).

A description containing commas must be wrapped in parentheses (macro
argument rules): `MTA_FUNCTION("x", (a, b containing commas), fn)`.

### `MTA_LUA_FUNCTION` (body style)

```cpp
MTA_LUA_FUNCTION("sample_add", "Returns the sum of two numbers.")
{
    auto [a, b] = mta::lua::args<double, double>(L);
    return mta::lua::push_results(L, a + b);
}
```

The body is a normal Lua C function; the macro wraps it in the protected
call machinery (C++ exceptions become Lua errors, `L` stays balanced, the
running function name is attached to argument errors).

### `MTA_LUA_FUNC` (one-line lambda)

```cpp
MTA_LUA_FUNC("my_sum", "Adds two numbers.",
    [](double a, double b) { return a + b; });
```

---

## Reading arguments

### `mta::lua::args<Ts...>(L)`

Reads the Lua stack positionally and returns a `std::tuple<Ts...>` (with
structured-binding sugar). Supported parameter types:

| C++ type | Lua side |
|---|---|
| `bool` | boolean |
| `double`, `float`, `lua_Number` | number |
| any integer type (`int`, `std::int64_t`, `std::uint32_t`, ...) | number, range-checked |
| `std::string` | string (numbers coerce, `luaL_checkstring` semantics) |
| `std::string_view` | string, zero-copy (valid only during the call) |
| `std::optional<T>` | value or `nil`/absent → `nullopt` |
| `mta::lua::Argument` | any single value (snapshot) |
| `mta::lua::Table` | table (snapshot; non-table is an error) |
| `mta::lua::rest_args` | all remaining values, last parameter only |
| `mta::lua::context` | the VM and the calling resource name; consumes **no** Lua argument |
| `mta::async::Callback` | function (a stable reference, see below) |
| `mta::Resource` | name of a **running** resource; strict string, validated live |

```cpp
MTA_LUA_FUNCTION("sample_join", "Joins values with a separator.")
{
    auto [separator, rest] = mta::lua::args<std::string, mta::lua::rest_args>(L);
    ...
}

MTA_LUA_FUNCTION("sample_where", "Reports where it was called from.")
{
    auto [ctx] = mta::lua::args<mta::lua::context>(L);
    // ctx.vm, ctx.resource ("test_resource")
    return mta::lua::push_results(L, ctx.resource);
}
```

Missing arguments beyond the declared ones are hard type errors
(`bad argument #2 to 'sum' (expected number, got no value)`).

### Lambda parameters

The same types work as lambda parameters with `MTA_FUNCTION`/`MTA_LUA_FUNC`
— the binder reads them per call. C++ default arguments work: missing
trailing arguments synthesize `nullopt`/empty rest values and the compiler
applies the defaults.

---

## Returning results

* `int`-returning body style: the classic Lua count (return whatever you
  pushed).
* `mta::lua::push_results(L, value)` — pushes one value of any supported
  result type and returns its count.
* Automatic push (lambda style / `push_result`):

| C++ result | Lua side |
|---|---|
| scalars (`bool`, numbers, strings) | one value |
| `std::optional<T>` | value or `nil` |
| tuple/pair | each element as a separate result |
| `std::vector<T>` | each element as a separate result |
| `mta::lua::Arguments` | every value as a separate result |
| `mta::Resource` | its name (the stable Lua-side identity) |
| `void` | nothing |

```cpp
MTA_FUNCTION("stats", "Min, max and count.", [](std::vector<double> v) {
    ... return std::make_tuple(min, max, v.size());
});
```

---

## Errors

* `mta::lua::raise_error("message", ...)` — throws a C++ exception that the
  protected-call layer converts into a proper Lua error (local objects are
  destroyed first). **C++ exceptions never leak into Lua.**
* `mta::errors::raise_error(Category, ...)` — the categorized form used
  internally.
* Format rules: while a registered function runs, argument errors
  carry its name —

  ```text
  bad argument #2 to 'sum' (expected number, got string)
  bad argument #1 to 'counter_set' (expected counter, got table)
  ```

  The `to 'name'` part appears only inside a module call; `expected counter`
  is the **declared object type name** (see Objects).

---

## Value snapshots: Argument / Table / Arguments

Safe value containers that own their data (strings copied, tables read
recursively up to 32 levels with cycle protection). They are how values
cross the async boundary — a background worker never touches `lua_State`.

* `mta::lua::Argument` — one value: `Type` (`Nil`, `Boolean`, `Number`,
  `String`, `Table`, `LightUserData`), `as_boolean()/as_number()/
  as_string()/as_table()`, `read(L, index)`, `push(L)`.
* `mta::lua::Table` — `array` (1..n) + `fields` (string keys). Keys of other
  types are discarded when reading.
* `mta::lua::Arguments` — a flat list: `read(L, start_index)`, `push(L)`,
  `push_number/push_string/push_boolean/push_nil/push_light_userdata`,
  `append`, `count`, `call(L, "global_fn", &error)` (pcall convenience).

---

## The borrowed state view: mta::state / MTA_STATE

`mta::state` is the **View** half of the value model (the borrowed model is
spelled "LuaView"; `mta::LuaView` is an alias for the same type): a borrowed,
non-owning wrapper around the **current** VM, valid only for the synchronous
call that created it. Where the snapshots above own copies of values so they
can survive the async boundary, `mta::state` is the convenience read/write
surface while the call is live.

```cpp
mta::state view = MTA_STATE(L);   // expression form: wrap the calling VM
```

Methods (each mirrors the free function of the same name — see
[Reading arguments](#reading-arguments) and
[Direct stack access](#direct-stack-access)):

* `top()` / `arg_count()` — values currently on the stack (inside a module
  function this is the call-argument count).
* `resource_name()` — the resource owning this VM right now, resolved live
  through the module manager (`""` when it cannot be determined).
* `args<Ts...>()` — the same typed positional read as `mta::lua::args`,
  returning a `std::tuple<Ts...>` (the same supported types table).
* `push_results(...)` — the same result conversions as
  `mta::lua::push_results`; returns how many values were pushed.
* `check_number/check_integer/check_string/check_boolean(index)` and
  `opt_number/opt_integer/opt_string/opt_boolean(index, default)` — the
  same typed readers and error messages as the free `mta::lua::check_*`/
  `opt_*` helpers (1-based indices, negatives count from the top).
* `valid()` / `handle()` — null-safety and the wrapped `lua_State*`.

The rule that makes the View safe: **never store it and never carry it
anywhere** — not into a later call, not across threads, not into async
work. A resource's VM dies when the resource stops and a restart runs a
fresh VM. The only values allowed to cross the async boundary
are the owned snapshots `mta::lua::{Argument, Table, Arguments}` (see
[Value snapshots](#value-snapshots-argument--table--arguments)).

Sample (`sample_state`, `source/functions/state/view.cpp`):

```cpp
MTA_LUA_FUNCTION("sample_state",
    "Returns a table {resource = ..., top = ...} describing the calling VM "
    "through the mta::state view.")
{
    mta::state view = MTA_STATE(L);
    mta::lua::Table data;
    data.fields.emplace_back("resource", mta::lua::Argument(view.resource_name()));
    data.fields.emplace_back("top", mta::lua::Argument(static_cast<lua_Number>(view.top())));
    return mta::lua::push_results(L, mta::lua::Argument(std::move(data)));
}
```

```lua
sample_state()       -- { resource = "test_resource", top = 0 }
sample_state(1, 2)   -- { resource = "test_resource", top = 2 }  (top counts the call arguments)
```

---

## Direct stack access

`mta::lua::check_number(L, i)`, `check_integer`, `check_string`,
`check_boolean`, `opt_number(L, i, default)`, `opt_string`, `opt_boolean`
— throw typed errors with the running function's name.
`mta::lua::push_one(L, value)` overloads push any scalar safely
(`lua_checkstack` guarded). Use these in body-style functions when the
structured `args<...>` form does not fit.

### Table helpers

`mta::lua::get_field<T>(table, "key", default)`, `get_field<T>(table,
"key")`, `set_field(table, "key", value)` and `mta::lua::convert<T>(argument)`
— typed access to `Table` snapshots:

```cpp
auto [data] = mta::lua::args<mta::lua::Table>(L);
const int level = mta::lua::get_field<int>(data, "level", 1);
mta::lua::set_field(data, "level", level + 1);
return mta::lua::push_results(L, data);
```

`convert<T>` supports the same scalar types as arguments; a missing or
wrongly-typed field with no default throws a typed error.

---

## Logging

Output goes to the MTA server console through the module manager; before
the manager is attached it falls back to stdout/stderr.

```cpp
mta::log::set_level(mta::log::Level::Debug);   // default Info
mta::log::info("connected to ", host, ":", port);
mta::log::warn("suspicious value: ", value);
mta::log::error("request failed: ", reason);
mta::log::debug(L, "called in resource context");  // resource-attributed
mta::log::debug("outside a VM context");           // overload without L
```

Levels: `Debug < Info < Warn < Error < Off`; a message prints when its
level ≥ the current level.

**Automatic context.** The framework prefixes every message with
the parts it knows about the current call site — developers never pass them.
The module identity is always known; the running function, the task/timer id
and the owning resource come from the thread-local diagnostic context that
the registration trampolines and the async dispatcher fill:

```text
[Base Module:sample_timer @ play] sample timer: duplicate timer id 3
[Base Module task #7 @ play] async completion failed: ...
[Base Module timer #12 @ play] timer callback failed: ...
```

Inside a module function the function name and the owning resource are
recorded automatically; background work, completion delivery, timer fires and
callback calls carry their resource (and task/timer where applicable).
`debug(L, ...)` skips the resource part because MTA's DebugPrintf already
attributes VM-based debug messages; the `debug` overload without `L` gets
the resource from the context when it is known.

---

## Background tasks (async)

The scheduler runs pure C++ on worker threads and delivers results on the
**main thread** inside `DoPulse`. Lua is never touched from a worker.

```cpp
mta::async::Task task = mta::async::run(
    L,
    []() -> mta::lua::Arguments {          // worker thread: NO Lua access
        mta::lua::Arguments result;
        result.push_number(42);
        return result;
    },
    [](const mta::lua::Arguments &result, const char *error) {
        // main thread (DoPulse): deliver to Lua
        if (error != nullptr) { mta::log::error("task failed: ", error); return; }
        ...
    });

task.cancel();   // cooperative: queued tasks never run; running tasks are
                 // completed but their delivery is suppressed
task.done();     // true once finished (Done or Cancelled)
task.valid();    // true while the handle refers to a live task
task.id();       // scheduler id (0 on an invalid handle)
```

Ownership rules:

* `run(L, work, completion)` attributes the task to the **calling resource
  and its VM generation**.
* Resource stop → queued tasks are cancelled, completions of the finished
  generation are dropped **before any Lua access**.
* A restarted resource runs a fresh VM under a new generation — stale
  completions are structurally unable to reach it.
* Queue limit (`[async] queue` in `config/module.toml`): a full queue
  **rejects** the task — `run` returns an invalid handle (`valid() == false`)
  and logs an error. Fire-and-forget callers may ignore the handle.

`mta::async::Scheduler::instance()` is the internal engine (`start/stop/
pump/post_task/post_timer/configure(queue_limit)`); developers normally use
`mta::async::run` only.

---

## Callbacks

`mta::async::Callback` is a stable reference to a Lua function that survives
`DoPulse` frames and resource restarts **within its own VM generation**.

```cpp
auto [callback] = mta::lua::args<mta::async::Callback>(L);  // Lua function argument

mta::lua::Arguments args;
args.push_number(30);
callback.call(args);   // false when the resource is gone, the callback is
                       // stale (older generation) or the Lua call failed
```

Identity is `(resource, generation, ref)`: a stopped resource never fires;
a restarted resource's fresh VM can never execute a callback of the older
generation even when the new registry hands out the same `luaL_ref` index
(this exact bug existed in V1; the regression lives in `072_restart.lua`).

Move-only; wrap in `std::shared_ptr` when captured into `std::function`
completions.

---

## Timers

```cpp
auto timer = mta::timer::after(L, 5000, [] { ... });  // fires once
auto timer = mta::timer::every(L, 1000, [] { ... });  // repeats until cancelled
auto timer = mta::timer::every(L, 1000, 5,            // fires 5 times total
                               [](std::uint64_t tick) { ... });

timer.cancel();  // true if a scheduled timer was cancelled
timer.valid();   // still scheduled (will fire again)
timer.id();      // scheduler id (0 on an invalid handle)
```

Timers fire on the main thread, belong to the calling resource and its VM
generation: a resource stop invalidates every owned timer, a restart never
revives one of an older generation, and every scheduler-side drop (final
fire, cancel, stop, stale generation) marks the handle invalid. A negative
delay is an argument error.

`mta::timer::after/every` take `std::function<void()>`; the counted `every`
overload takes `std::function<void(std::uint64_t tick)>` (tick = 1, 2, ...;
a repeat count <= 0 repeats forever). Deliver Lua values by capturing an
`mta::async::Callback` (see the `sample_after` implementation).

---

## Per-resource state

Every resource lives in its own VM that dies when the resource stops.
`mta::resources::Store<T>` owns per-resource data and erases it on stop and
on module shutdown:

```cpp
namespace { mta::resources::Store<MySession> g_sessions; }

MTA_LUA_FUNCTION("session_get", "Returns this resource's session id.")
{
    MySession &session = g_sessions.for_state(L);  // created on first access
    ...
}
```

Use only from module functions (main thread, live VM). The calling resource
is determined through the module manager; it cannot be determined →
`raise_error`. `try_find(name)` reads another resource's data without
creating it.

Generations: `mta::resources::Hub::generation(name)` is 1
for a never-stopped resource and increments on every stop/restart cycle.
Callbacks, tasks and timers record the generation they were created in and
never operate across generations.

---

## Objects (userdata)

```cpp
struct Counter { double value = 0; };

// Stable, compiler-independent identity; metatable "mta.<module>.counter".
MTA_OBJECT("counter", Counter)

void register_counter_methods(lua_State *L)
{
    MTA_METHOD(Counter, "get", [](Counter &self) { return self.value; });
    MTA_METHOD(Counter, "set", [](Counter &self, double v) { self.value = v; });
    MTA_METHOD(Counter, "add", [](Counter &self, double v) { self.value += v; return self.value; });
}
const bool counter_methods_registered = [] {
    mta::userdata::Registry<Counter>::set_methods(&register_counter_methods);
    return true;
}();

MTA_LUA_FUNCTION("counter_create", "Creates a counter.")
{
    auto [value] = mta::lua::args<double>(L);
    mta::userdata::Registry<Counter>::create(L, Counter{value});
    return 1;
}
```

```lua
local c = counter_create(42)
c:get()    -- 42
c:add(8)   -- 50
c = nil    -- __gc calls ~Counter()
```

Rules:

* `MTA_OBJECT("name", T)` declares the type identity once; the metatable is
  `mta.<module>.<name>` — module-aware, so two modules cannot collide.
* A type without `MTA_OBJECT` falls back to a `typeid(T).name()`-based
  identity with a **warning** (compiler-dependent; do not ship that).
* `Registry<T>::check(L, i)` validates the metatable and produces
  `bad argument #1 to '...' (expected counter, got table)`.
* The first `set_type_name` wins; conflicting re-declarations are logged as
  errors and ignored.

---

## Events

Module → Lua events through the standard `triggerEvent` (source: the global
root element):

```cpp
mta::lua::Arguments args;
args.push_string("hello");
mta::events::trigger(L, "onMyModuleReady", args);
```

```lua
addEventHandler("onMyModuleReady", root, function(message) ... end)
```

Returns false (and logs) when `triggerEvent` is unavailable or the call
failed. Main thread only.

---

## Native types (Resource)

The frozen module ABI exposes exactly one VM lookup
(`GetResourceFromName`); there is **no element/player/vehicle API** behind
the module boundary, so the SDK ships the safe subset only — `mta::Resource`
(documented; Player/Vehicle/Element wrappers are intentionally absent).

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

`vm()` is looked up **live on every call** — never cache a `lua_State`; a
stopped resource reports `nullptr`/`alive() == false`. Samples:
`sample_resource_name`, `sample_resource_find`.

### `mta::Resource` as a typed binder argument/result

`mta::Resource` is a full binder parameter: Lua names the resource, and the
binder resolves the name through `Resource::find` on every call. An unknown
or already stopped resource is a readable argument error, never a dangling
wrapper; a returned `Resource` is pushed to Lua as its name;
`std::optional<mta::Resource>` accepts `nil`/absent as `nullopt`:

```cpp
MTA_FUNCTION("resource_report", "Name and liveness of a running resource.",
    [](mta::Resource resource)
    {
        return std::make_tuple(resource.name(), resource.alive());
    });
```

```lua
resource_report("play")   -- "play", true
resource_report("nope")   -- error: bad argument #1 to 'resource_report'
                          --   (no running resource 'nope')
resource_report(42)       -- error: bad argument #1 to 'resource_report'
                          --   (expected resource, got number)  -- strict, no coercion
```

The signature metadata reports the type as `resource` (see
`module_signature`). Samples: `sample_resource_arg`,
`sample_resource_arg_optional`, `sample_resource_return`
(`source/functions/native/resource_args.cpp`).

---

## Module identity and lifecycle

`mta::module::info()` → `{name, author, version}` — from
`config/module.toml`, compiled into the binary. `current_resource_name(L)`
is the ABI-safe resource lookup used by `context`, `Store` and `Callback`.

### The four versions

Four version entities are kept strictly separate. The two SDK-side ones have
a single source — `source/sdk/version.hpp` — whose values are never
duplicated as literals anywhere else:

| Version | Source | Surfaces |
|---|---|---|
| SDK version | `SDK_VERSION "1.0.0"` in `source/sdk/version.hpp` | `mta::sdk_info().version`; CMake `project(VERSION)`; `mta doctor` |
| Module version | `config/module.toml` `[module] version` → CMake `SDK_MODULE_VERSION` float (`"2.1.0"` → `2.1`) | binary metadata / `InitModule`, `module_info().version`, packaging |
| ABI version | `SDK_ABI_VERSION "1"` in `source/sdk/version.hpp` | `mta::sdk_info().abi_version` — the six `MTAEXPORT` entry points + `ILuaModuleManager10` contract |
| MTA server version | runtime fact from the module manager (`GetVersionString()`) | `mta::server_info()` (with netcode version and OS) |

```cpp
const mta::SdkInfo sdk = mta::sdk_info();  // compile-time: available before InitModule
if (auto server = mta::server_info())      // runtime: nullopt without a module manager
    mta::log::info("MTA server ", server->version);
```

* CMake parses `SDK_VERSION` out of `version.hpp` for `project(VERSION)`
  (`CMakeLists.txt`) — the project version is the SDK's, deliberately not
  the module's; `config/cmake/install.cmake` names the package ZIP with the
  **Module** version, because the ZIP is a module artifact.
* The load diagnostic reports them separately:
  `module: loaded base (module 2.1, sdk 1.0.0, abi 1; MTA <server version>)`.
* `mta doctor` parses the same header (`read_sdk_version_header` in
  `other/tools/mta/cli.py`) and prints `SDK version: sdk 1.0.0` and
  `ABI version: module-abi 1` as two separate checks, next to the Project
  line that carries the Module version — the same facts the build compiles
  in.
* `sample_version` (`source/functions/info/version.cpp`) returns
  `module`/`module_version`, `sdk_version`, `abi_version` and (when the
  module manager is attached) `mta`/`netcode`/`os` as separate fields.

The lifecycle hooks (`initialize`, `register_functions`, `pulse`,
`shutdown`, `resource_stopping`, `resource_stopped`) are implemented by the
module core (`source/sdk/abi/module.cpp`) and forwarded from the six frozen
`MTAEXPORT` entry points. Developers implement none of them — they attach
to the lifecycle through `mta::resources::Hub::Sink` (used by `Store`,
the scheduler and the callback tracker) or by doing work in module
functions.

---

## Configuration: config/module.toml

The single source of truth — read by CMake and the CLI:

```toml
[module]
name = "base"          # binary + registration name (base.dll / base.so)
title = "Base Module"  # human-readable title
author = "Developer"
version = "2.1.0"      # semver; flows into metadata and packaging

[build]
cxx_standard = 20      # 20
unity = true           # unity build (fast compile)
lto = true             # link-time optimization (release)

[async]
workers = "auto"       # "auto" or an integer worker count
queue = 4096           # max queued async tasks

[features]             # subsystem switches -> SDK_FEATURE_* defines
async = true
userdata = true
events = true
objects = true
```

* `workers`/`queue` compile into the module
  (`SDK_ASYNC_WORKERS_AUTO`/`SDK_ASYNC_WORKERS_N`/`SDK_ASYNC_QUEUE_N`).
* A `features.* = false` switch compiles `SDK_FEATURE_*` = 0 and **excludes
  the bundled sample functions of that subsystem** from the module and the
  test binary.
* Every value can still be overridden per configure with explicit CMake
  cache variables (`-DSDK_MODULE_NAME=my_mod`, `-DSDK_UNITY=OFF`,
  `-DSDK_FEATURE_EVENTS=OFF`, ...). TOML values win over stale cache
  entries unless the cache variable is set explicitly.

---

## The `mta` CLI

`other/tools/mta/mta.cmd` (Windows) / `other/tools/mta/mta` (Linux):

| Command | Effect |
|---|---|
| `mta doctor` | Environment readiness: TOML validity + identity, SDK headers, Lua ABI byte-compare, toolchain probes, presets, build output, git state. Prints READY/NOT READY. |
| `mta build [preset]` | CMake configure+build of the configured/default preset. |
| `mta test all\|unit\|lua\|integration` | `ctest` filters; `integration` runs the real-server harness  |
| `mta docs` | Builds `sdk_docgen` and dumps registry metadata (name, description, derived signature with argument/return types and optional markers, category/flags where derivable, explicit `n/a` markers, object methods) as markdown. |
| `mta package` | Copies the module binary into `dist/<name>-<version>-<platform>` + sha256. |
| `mta server install\|update\|version\|start\|stop\|test` | Pinned MTA server harness (isolated install, real-server integration). |
| `mta init` / `mta new function\|object <name>` | Project scaffold / compile-ready skeletons (registered names verbatim). |