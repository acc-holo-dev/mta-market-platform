# Architecture — MTA Module SDK

How the SDK is put together: the layers, the key flows, the rules that keep
a module safe inside the MTA server process, and how everything is tested —
including the real-server integration harness.

For the public API see [api.md](api.md); for a hands-on walkthrough see
[example.md](example.md); for upgrading an existing V1 module see
[migration-v1-to-v2.md](migration-v1-to-v2.md).

---

## 1. What this project is

An MTA:SA **server module** is a DLL/.so that the server loads at startup.
Through the frozen `ILuaModuleManager10` ABI it registers extra Lua
functions into every resource's VM. The contract is fixed by the server:

* exactly six exported C entry points (`InitModule`, `RegisterFunctions`,
  `DoPulse`, `ShutdownModule`, `ResourceStopping`, `ResourceStopped`);
* a Lua 5.1 interpreter, MTA-patched ABI (`luaL_newstate(nullptr)`);
* everything the module does happens inside the server process — a crash or
  an escaped exception takes the server down.

This SDK turns that raw contract into a **developer-first C++20
framework**: one include (`<mta/sdk.hpp>`), typed function registration,
background work with handles, per-resource state, stable userdata objects
and a configuration file that drives identity, build and features. The
frozen ABI is treated as read-only ground truth (`other/third_party/mta-sdk/`
headers are byte-compared against the vendored Lua in the tests).

---

## 2. Directory layout

```text
config/module.toml          single source of truth (identity/build/features)
source/mta/sdk.hpp          the public facade (the only include you need)
source/sdk/                 the framework (internal layers, see §3)
source/library/             reusable module-agnostic utilities
source/functions/           the bundled sample module (your code goes here)
other/third_party/          vendored Lua 5.1 + MTA SDK headers
other/tests/                unit tests + embedded-Lua harness + scripts
other/tools/                the `mta` CLI, docgen, launchers
other/server/               pinned-server integration harness
other/documents/            docs, audit, phase reports
cmake/                      build system modules (module-config, file glob)
CMakePresets.json           win-msvc / win-mingw / linux-gcc / base
```

---

## 3. The layers of `source/`

Dependencies point **downward only** (`functions → library → sdk`; a
dependency from `sdk` up into `functions` or `library` is forbidden).

```text
        ┌──────────────────────────┐
        │   functions/             │  ← the only layer you extend
        │   your Lua functions     │
        └────────────┬─────────────┘
                     │ MTA_FUNCTION / MTA_LUA_FUNCTION / MTA_LUA_FUNC
        ┌────────────▼─────────────┐
        │   library/               │  ← reusable utilities shared by
        │   (see §3.0)             │     several functions
        └────────────┬─────────────┘
        ┌────────────▼─────────────┐
        │   registry/              │  ← collects + registers functions,
        │   Registry, Spec, macros │     replays them into every VM
        └──┬──────────┬─────────┬──┘
           ▼          ▼         ▼
   ┌────────────┐ ┌─────────┐ ┌────────┐
   │  lua/      │ │ runtime/│ │  abi/  │
   │  bind/     │ │ async   │ │ module │
   │  objects/  │ │ timers  │ │ export │
   │  events/   │ │ callback│ │        │
   └─────┬──────┘ └────┬────┘ └───┬────┘
         └─────────────┴────┬─────┘
                            ▼
        ┌────────────────────────────────────┐
        │ resources/ · native/ · logging/    │
        └───────────────────┬────────────────┘
                            ▼
        other/third_party/ (Lua 5.1, MTA SDK headers)
```

### 3.0 `source/library/` — reusable utilities

Module-agnostic C++ that does not export to Lua directly and can be shared
by several functions (`library` must never depend on a specific function
implementation). The bundled module ships `library/base/handle_map.hpp`
(`mta::library::base::HandleMap<Id, Handle>`) — the id → handle registry
used by the async-task and timer samples for their Lua-facing handle
bookkeeping. A library unit is plain C++ (no Lua types required); add a
subfolder per domain (`library/http/`, `library/json/`, ...) when real
reusable code appears.

### 3.1 `source/sdk/abi/` — the MTA contract

The only place that talks to the server loader. The six exported entry
points forward to `mta::module::{initialize, register_functions, pulse,
shutdown, resource_stopping, resource_stopped}`. It owns the module identity
(`Info` — compiled in from `config/module.toml`) and the module-manager
pointer. All text crossing the manager boundary uses the ABI-safe `char*`
overloads.

**Exported surface.** Windows pins exports with a generated `.def` file,
Linux with a GNU ld version script — exactly the six entry points; nothing
else leaks from the DLL.

### 3.2 `source/sdk/registry/` — the function registry

A process-wide `Registry` of `Spec{name, description, function, signature,
category, flags}`, filled at static-init time by the registration macros.
On every resource start the module replays the registry into that VM via
`ILuaModuleManager10::RegisterFunction` — **the exact developer-provided
name** (no auto-namespacing; a regression script pins `crypto.sha256`
verbatim).

Lambda-style registrations derive a `Signature` (arguments with types and
optional markers, returns, variadic, capability flags) from the C++
signature; the flags (`variadic`, `callback`) land in `Spec::flags` through
the registration bridge. Body-style registrations record `derived == false`
and say so explicitly. Underivable metadata is marked explicitly
wherever the metadata is rendered: the category stays empty (no
registration spelling provides one yet → `n/a` in the docs), and per-function
error lists are not part of the signature metadata at all. `mta docs` dumps
the function metadata without a module manager; object methods
(`MTA_METHOD`, registered lazily per VM) are listed through the recorded
`MethodInfo` metadata after the docgen materializes the declared
`MTA_OBJECT` types in a scratch VM.

### 3.3 `source/sdk/lua/` + `sdk/bind/` — values and the typed binder

* `lua/common.hpp` — the vendored Lua headers' single include point.
* `lua/stack.hpp` — type-safe `check_*`/`opt_*` readers that **throw C++
  exceptions** (local objects destroyed properly on bad input) and carry the
  running function's name in every argument error.
* `lua/protect.hpp` — exception → Lua error conversion and the
  `protected_call` trampoline every registered function runs through.
* `lua/argument.hpp` / `arguments.hpp` — `Argument`/`Table`/`Arguments`
  snapshots (tables recursively, 32-level cycle protection) — the owned half
  of the value model and the only values allowed to cross the async
  boundary.
* `lua/state.hpp` — `mta::state` (alias `mta::LuaView`), the borrowed half
  of the value model: a non-owning wrapper of the
  **current** `lua_State` for exactly one synchronous call — typed argument
  readers (`args<Ts...>()`, `check_*`/`opt_*`), `top()`, `resource_name()`,
  `push_results(...)` — spelled `MTA_STATE(L)` at the call site.
* `bind/bind.hpp` — the typed binder: reads parameters from the stack
  (`args<double, double>(L)` and lambda parameters), synthesizes
  `optional`/`rest_args`/defaults, applies `context`, pushes results
  (scalars, tuples, vectors, `optional`, `Arguments`) and integrates native
  types: a `mta::Resource` parameter is resolved by name and validated live
  through the module manager, a returned `Resource` is pushed as its name
 .
* `objects/userdata.hpp` — `Registry<T>` + `MTA_OBJECT`/`MTA_METHOD`
  (stable, module-aware metatable identities, `__gc` destructor); every
  method call records its `MethodInfo` metadata and `MTA_OBJECT`-named types
  list themselves in `mta::userdata::object_types()` for the docs generator.
* `events/events.hpp` — `mta::events::trigger` (module → Lua events).

**View vs Snapshot.** The two halves of the value model are
deliberately not interchangeable. A *View* (`mta::state`) is borrowed:
main thread only, valid only while the call runs, never cached, never
passed to another thread. A *Snapshot*
(`mta::lua::{Argument, Table, Arguments}`) is owned: it copies its data
(strings copied, tables read recursively) and is the **only** thing that
may cross the async boundary to worker threads and back. A raw
`lua_State*` never crosses a thread boundary — a resource's VM dies with
the resource and a restart runs a fresh VM (see §4.4).

### 3.4 `source/sdk/runtime/` + `resources/` + `native/` + `logging/` — the engine

* `runtime/scheduler` — the internal thread pool (`[async] workers`,
  "auto" = `hardware_concurrency()`); `pump()` on the main thread delivers
  completions and fires timers. `mta::async::run` is the developer API.
* `runtime/task` — the `Task` handle (`cancel/done/valid/id`); ownership is
  `(resource, generation)`; queue-limit rejection returns invalid handles.
* `runtime/timer` — `Timer` handles; every scheduler-side drop (final fire,
  cancel, resource stop, stale generation) marks the state finished so
  `valid()` stays truthful.
* `runtime/callback` — `mta::async::Callback` pinned by
  `(resource, generation, ref)`; stale callbacks are dropped, never fired
  into a restarted VM (the V1 generation-confusion bug, see
  `072_restart.lua`).
* `resources/resources` — `Hub` (generation bookkeeping, lifecycle
  notifications) and `Store<T>` (per-resource state erased on stop and on
  shutdown).
* `native/resource` — `mta::Resource`, the safe subset of native types
  (live ABI lookup; no element API exists behind the module ABI —
  documented) and the Lua-boundary hooks for the binder: a `Resource`
  argument is validated by name on every call, a returned `Resource` is
  pushed as its name (`push_one`, found via argument-dependent lookup, so
  the native layer stays below the Lua layer).
* `logging/logging` — leveled logging to the server console, stdout
  fallback in the harness.

### 3.5 `source/functions/` — your code

Freeform folders (`basics/`, `tables/`, `async/`, `objects/`, `state/`,
`raw/`, `info/`, `events/`). A new `.cpp` anywhere under `source/` is
compiled and picked up automatically (recursive glob) — no central
registration list, no CMake edits. The `sample_*`/`counter_*` functions are
executable documentation and regression anchors; the build's
`[features]` switches can exclude whole subsystems of them.

---

## 4. Key flows

### 4.1 Startup & registration

```text
server loads base.dll                (LoadLibrary / dlsym, x64)
        │
InitModule(manager, name, author, version)
        │  store the manager pointer; identity from config/module.toml
        │  scheduler.start()
        ▼
server starts a resource ──► fresh Lua VM (luaL_newstate)
        │
RegisterFunctions(vm)
        │  Registry::register_all(manager, vm)
        ▼
for each Spec: manager.RegisterFunction(vm, name, fn)   ← callable now
```

### 4.2 A single call (typed binder)

```text
Lua: sample_add(2, 3)
        │
trampoline ──► protected_call(L, &body)          (name attached for errors)
        │
args<double, double>(L)  ──► check_number ×2     (throws on mismatch →
        │                                         luaL_error with the
        │                                         function's name)
push_results(L, a + b) ──► 5 returned to Lua
        │
any C++ exception ──► caught at the trampoline ──► readable Lua error
```

No C++ exception ever escapes into the server process.

### 4.3 Async completion & timers

```text
main thread (DoPulse)                     worker threads
──────────────────────                    ──────────────
async::run(L, work, completion) ────────► work()  (pure C++, no Lua)
        │  ownership: (resource, gen)      builds mta::lua::Arguments
        ▼                                          │
DoPulse ──► Scheduler::pump()                      │
        │  drain completed queue (mutex)           │
        │  stale generations / stopped resources / cancelled tasks
        │  are dropped BEFORE any Lua access       │
        ▼                                          │
completion(results, error) ──► Callback::call()    │
        │  (VM looked up by name, generation re-checked)  │
timers: due timers fire, re-arm or drop; handles update
```

### 4.4 Resource lifecycle & generations

```text
ResourceStopping(vm) ──► Hub::notify_resource_stopping(name)
ResourceStopped(vm)  ──► Hub::bump_generation(name)      ← ends generation N
        │  Store<T> erases the resource's state
        │  Scheduler::handle_resource_stopped(name): cancel timers,
        │  cancel queued tasks, mark completions stale
        │  Callback refs of that resource released
restart: the server creates a FRESH VM; the resource runs under
generation N+1; nothing from generation N can reach it (callbacks,
tasks, timers all carry the generation they were created in)
ShutdownModule        ──► Scheduler::stop() (join workers first)
        │  release_all_callbacks (unref while VMs are still reachable)
        │  Hub::notify_all_released() → Stores cleared
        ▼  manager pointer = nullptr
```

The generation identity exists because a restarted resource gets a fresh VM
whose registry starts in the same state — ref indexes repeat, and only the
generation check tells a live callback from a stale one
(regression `072_restart.lua` reproduces the V1 bug without the fix).

---

## 5. Threading rules

1. Touch Lua **only on the server's main thread** (`DoPulse` and module
   function calls).
2. Workers run **pure C++**; results travel back through `pump()` inside
   `mta::lua::Arguments` snapshots.
3. Never store a `lua_State*` between calls — the VM dies with the resource.
   Use `mta::async::Callback` (deferred calls), `mta::Resource::vm()`
   (live lookup) or `mta::resources::Store` (data).
4. Module bitness must equal server bitness (modern MTA is x64).
5. Functions are registered into **every** resource VM — keep registered
   names unique across the ecosystem and expect calls from any resource.

---

## 6. Configuration

`config/module.toml` is parsed by CMake (`config/cmake/core/module-config.cmake`)
**before** `project()` — even `project(VERSION)` comes from the TOML — and
by the `mta` CLI. `workers`/`queue` compile into `SDK_ASYNC_*` defines;
`[features]` compile into `SDK_FEATURE_*` defines and exclude the matching
sample subsystems from the module and the test binary. Explicit `-D` cache
variables still win (advanced overrides); TOML normal variables shadow stale
cache entries otherwise.

Module binary: `build/<preset>/module/<win|linux>-x64/<name>.<dll|so>`.
Presets: `win-msvc`, `win-mingw`, `linux-gcc` (base defines the flags:
`-Wall -Wextra -Wpedantic -Werror -Wconversion -Wsign-conversion -Wundef`,
unity + LTO from TOML).

---

## 7. Testing

Three layers, all green in CI (`ctest --preset win-mingw`):

1. **Unit** (`other/tests/*.cpp`): config parsing (accepts the TOML,
   rejects garbage), compiled-in identity.
2. **Embedded-Lua harness** (`other/tests/lua/harness.cpp`): boots a clean
   Lua 5.1 with the MTA-patched ABI, installs a mock
   `ILuaModuleManager10`, and runs every `other/tests/lua/scripts/*.lua`
   (`010_basic` … `095_benchmark_userdata`), plus C++-level async regressions
   (task handles, cancellation suppression, ownership drops, queue limits)
   run after the scripts and before module shutdown. This is where restart
   generations are simulated deterministically (`test_resource_restart`
   swaps in a real fresh VM under a new generation).
3. **Real-server integration** (`other/server/mta_server.py`):
   downloads and extracts a **pinned** MTA x64 server build (identity +
   sha256 in `other/server/install.json`, isolated under `other/server/`),
   prepares a throwaway server tree, installs the built module, and drives
   the generated `sdkintegration` resource on the running server: module
   load, registration, return values, argument validation, userdata,
   timers, async tasks, callbacks, the stale-generation restart scenario (the
   harness types `restart` into the server console; a stale generation-1
   task must never deliver into generation 2) and a graceful shutdown with
   an active worker task that must never fire. The Windows
   server requires a real console, so the harness shares its console
   (CONIN$/CONOUT$), injects commands as key events and keeps the console
   scrollback as the run log (`other/server/logs/<timestamp>/server.log`).

`mta test all|unit|lua|integration` maps onto these via ctest filters; `mta
docs` builds `sdk_docgen` and dumps registry metadata; `mta doctor` verifies
the environment (headers, Lua ABI byte-compare, toolchain, presets).

---

## 8. Performance / benchmarks

Policy: **measure before optimizing**. No hot path is tuned on
intuition — a change that claims a performance win runs the benchmark set
before and after the change and reports the numbers.
The benchmarks are informational Lua scripts in the embedded harness:
timings are printed, sanity values are asserted, nothing fails on rate.

Benchmark map (`other/tests/lua/scripts/`):

| Script | Measures |
|---|---|
| `090_benchmark.lua` | module call throughput (`sample_add`, calls/s) |
| `091_benchmark_arguments.lua` | argument conversion through the typed binder (2-number baseline, 8 numbers, mixed primitives; derives the per-value conversion cost) |
| `092_benchmark_tables.lua` | `Table` snapshot roundtrip (read + push) |
| `093_benchmark_callback.lua` | callback bookkeeping |
| `094_benchmark_scheduling.lua` | async/timer scheduling |
| `095_benchmark_userdata.lua` | userdata creation/access |

Cost notes — why the hot paths look the way they do:

* **Snapshot copies** — `Argument`/`Table` copy tables recursively up to
  `max_table_depth = 32` levels with cycle protection
  (`source/sdk/lua/argument.{hpp,cpp}`); the copy depth is the cost driver
  of the snapshot model and what `092` measures.
* **Task queue and limits** — the scheduler keeps a bounded task queue
  (`[async] queue` in `config/module.toml`, default 4096): a full queue
  **rejects** the task into an invalid handle and logs
  `async: task queue is full (N); task rejected` instead of blocking the
  caller (`source/sdk/runtime/scheduler.cpp`).
* **Callback bookkeeping** — a callback is pinned as
  `(resource, generation, luaL_ref)`; every call re-resolves the VM by
  resource name and re-checks the generation before firing
  (`source/sdk/runtime/callback.hpp`) — the price of making
  stale-generation delivery structurally impossible (§4.4).

---

## 9. Conventions

* **Code style** — `.clang-format`; comments and user-facing strings in
  English; C++20.
* **No ABI surprises** — exceptions stay inside the module; the six entry
  points are the only exports; `char*` overloads across the manager
  boundary; workers never touch `lua_State`.
* **Registered names are verbatim** — the SDK never rewrites a developer's
  name.
* **New subsystems** get `mta::<sub>`, a `source/sdk/<sub>/` folder, a
  facade export in `<mta/sdk.hpp>`, sample coverage and harness tests.
* **Docs live in `other/documents/`**; per-phase reports in
  `v2-phase-reports.md`.
