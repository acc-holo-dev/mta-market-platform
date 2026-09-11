# Migration guide — SDK V1 → V2

What changed between the V1 SDK (the `src/`-era module SDK this project
started from) and V2, and how to move an existing module. The good news
first: **every V1 public API still compiles and behaves** — V2 is
additive at the code level, and the breaking changes are in build
configuration, userdata identity and the semantics that V1 got silently
wrong (stale callbacks, uncancellable tasks).

V1 here refers to the audited baseline (see `v2-audit.md`): repository
layout `src/` + `tests/` + `docs/` + `vendor/`, CMake-cache identity,
3-worker scheduler with bare `post_task`, callbacks keyed
`(resource, ref)`, `typeid(T).name()` metatables.

---

## 1. Repository layout

| V1 | V2 |
|---|---|
| `src/` | `source/` (same content: `module/` → `sdk/abi/`, `lua/` → `sdk/lua/` + `sdk/bind/`, `registry/` → `sdk/registry/`, `runtime/` → `sdk/runtime/`, `functions/` → `source/functions/`) |
| `tests/` | `other/tests/` |
| `docs/` (API.md, ARCHITECTURE.md, ...) | `other/documents/` (new lowercase set: `example.md`, `api.md`, `architecture.md`, `migration-v1-to-v2.md`) |
| `vendor/` | `other/third_party/` |
| — | `other/tools/` (`mta` CLI), `other/server/` (integration harness) |

Include root: `source/` (for `<mta/sdk.hpp>`) and `source/sdk/` (internal
headers, unchanged `"lua/bind.hpp"`-style includes). A V1 module that
included internal headers directly keeps working; prefer the facade.

---

## 2. Build & configuration

**V1:** module identity and options were CMake cache variables set per
configure (`-DMODULE_NAME=...` etc.), version lived in `project()`.

**V2:** `config/module.toml` is the single source of truth — identity
(`[module]`), build (`[build]`), async tuning (`[async]`) and subsystem
switches (`[features]`). CMake reads it **before** `project()`; the `mta`
CLI reads the same file. The old cache variables survive as explicit
overrides (`-DSDK_MODULE_NAME=...`), but nothing depends on them anymore.

Migration:

1. Create `config/module.toml` (or start from `mta init`) and move your
   name/author/version there once.
2. Delete `-D` overrides from your build scripts unless they are real
   per-build overrides.
3. Binary path is unchanged in shape:
   `build/<preset>/module/<platform>-x64/<name>.dll` — presets keep their
   names (`win-mingw`, `win-msvc`, `linux-gcc`).
4. New: `[async] queue` bounds the task queue (compile-time
   `SDK_ASYNC_QUEUE_N`); `[features]` switches compile `SDK_FEATURE_*`
   defines and can exclude the bundled sample subsystems.

---

## 3. One include instead of many

**V1:** modules included `src/lua/bind.hpp`, `src/registry/registry.hpp`,
... piecemeal.

**V2:** `<mta/sdk.hpp>` exports the whole supported surface. Mechanical
migration:

```cpp
// V1
#include "registry/registry.hpp"
#include "lua/bind.hpp"

// V2
#include <mta/sdk.hpp>
```

---

## 4. Registration

`MTA_LUA_FUNCTION` and `MTA_LUA_FUNC` are unchanged (bodies, lambdas,
snapshots, stack helpers — all kept). The recommended V2 spelling is the
facade macro:

```cpp
// V1
MTA_LUA_FUNC("sum", "Adds two numbers.", [](double a, double b) { return a + b; });

// V2 (same effect, facade spelling)
MTA_FUNCTION("sum", [](double a, double b) { return a + b; });
MTA_FUNCTION("sum", "Adds two numbers.", [](double a, double b) { return a + b; });
```

Registered names were and stay **verbatim** — V2 adds a regression test
pinning this (`crypto.sha256` is never rewritten).

What improved under the hood: argument errors now carry the running
function's name (`bad argument #2 to 'sum' (expected number, got string)`)
in the documented error format; registry entries carry derived signature metadata
(visible via `mta docs`).

---

## 5. Async: from fire-and-forget to owned tasks

**V1:** `Scheduler::post_task(work, completion)` — no handle, no owner, no
cancellation; a resource stop neither cancelled queued work nor reliably
suppressed its delivery; the queue was unbounded.

**V2:**

```cpp
mta::async::Task task = mta::async::run(L, work, completion);
task.cancel(); task.done(); task.valid(); task.id();
```

Semantic changes to audit in existing code:

* Tasks are **owned by the calling resource and its VM generation** — a
  resource stop cancels queued tasks and drops stale completions before any
  Lua access. Code that relied on a task surviving its resource was relying
  on a bug.
* Queue limits: a full queue now **rejects** the task (`valid() == false` +
  error log) instead of blocking forever.
* `cancel()` is cooperative: queued tasks never run; a running task
  completes but its completion delivery is suppressed.
* Worker count/queue size come from `config/module.toml` (`auto` =
  hardware concurrency, not the fixed 3 of V1).

The V1 `Scheduler::post_task/post_timer` still exist as internal engine
API — move call sites to `mta::async::run`.

**Callbacks** (the most important fix): V1 keyed a callback by
`(resource, luaL_ref index)`; a restarted resource's fresh VM handed out
the same index and a **stale V1 callback could fire the wrong function in
the new VM**. V2 keys callbacks by `(resource, generation, ref)`, checks
the generation on every call, and releases refs on stop. Code that kept
`Callback`s across resource restarts now gets `call() == false` — correct,
but move to re-binding on restart if you need fresh callbacks. Regression:
`072_restart.lua`.

---

## 6. Timers

**V1:** `Scheduler::post_timer(resource, delay, repeats, completion)`
returned a bare `uint64_t`; validity was not observable, and a timer
dropped by the scheduler (final fire, cancel) still looked "valid" to the
caller.

**V2:**

```cpp
auto timer = mta::timer::after(L, 5000, [] { ... });   // one-shot
auto timer = mta::timer::every(L, 1000, [] { ... });   // repeating
timer.cancel();   // true if a scheduled timer was cancelled
timer.valid();    // truthful: every scheduler-side drop marks the state
timer.id();
```

Timers are resource-aware and generation-checked like tasks; negative
delays are argument errors.

---

## 7. Objects (userdata)

**V1:** the metatable identity was `typeid(T).name()` — compiler-dependent
(`class Counter` vs `struct Counter`), non-deterministic across
toolchains, and module-global (two modules could collide).

**V2:**

```cpp
MTA_OBJECT("counter", Counter)   // metatable "mta.<module>.counter"
```

Migration: add `MTA_OBJECT("yourtype", YourType)` next to each type that
had a V1 `Registry<T>`. Without it V2 logs a warning and falls back to the
V1-style identity — port before shipping. `Registry<T>::create/check` are
unchanged; `MTA_METHOD` is unchanged. Error messages now use the declared
type name (`expected counter, got table`).

---

## 8. Per-resource state

`mta::resources::Store<T>` still erases state on resource stop — unchanged
usage. What is new:

* The generation bookkeeping (`Hub::generation(name)`) is public;
* everything long-lived (callbacks, tasks, timers) carries the generation
  it was created in, so *no* stale handle can reach a restarted resource's
  fresh VM even when indexes repeat;
* module shutdown clears every store (`notify_all_released`).

V1 code that cached `lua_State*` across calls was broken by design —
replace it with `mta::async::Callback`, `mta::Resource::vm()` (live lookup)
or `Store<T>`.

---

## 9. Native types

**V1:** nothing — the SDK did not wrap MTA types.

**V2:** `mta::Resource` (`find(name)`, `current(L)`, live `vm()`,
`alive()`). Deliberately **no** Player/Vehicle/Element wrappers: the frozen
module ABI exposes no element API, so they cannot be represented safely
(documented in the header).

---

## 10. Tooling

| V1 | V2 |
|---|---|
| hand-edited CMake for tests/docs | `mta test all\|unit\|lua\|integration`, `mta docs` (registry metadata via `sdk_docgen`) |
| no environment checks | `mta doctor` (TOML, headers, Lua ABI byte-compare, toolchain, presets) |
| manual server install & testing | `mta server install\|test` — pinned server, isolated install, real end-to-end integration run |
| CPack ZIP release | `mta package` → `dist/` + sha256 (artifacts narrowed to the module binary itself) |
| CI matrix (linux-gcc, win-mingw, win-msvc) | same matrix + doctor/CLI job + real-server integration |

---

## 11. Step-by-step migration checklist

1. Pull the V2 checkout; `mta doctor` until READY.
2. Port your identity into `config/module.toml`; drop identity `-D`s.
3. Replace scattered includes with `<mta/sdk.hpp>`.
4. Add `MTA_OBJECT("name", Type)` for every userdata type.
5. Replace `Scheduler::post_task` call sites with `mta::async::run(L, ...)`;
   audit the new ownership semantics (tasks die with their resource).
6. Replace `Scheduler::post_timer` call sites with
   `mta::timer::after/every` handles.
7. Audit code that kept callbacks or handles across resource restarts —
   they will (correctly) report stale now; re-bind on restart.
8. Replace cached `lua_State*` with `Callback`/`Store`/`Resource::vm()`.
9. Re-run your Lua scripts against the harness (`mta test lua`) — argument
   error text changed format (function name included); scripts that match
   on error strings need updating.
10. `mta build && mta test all && mta test integration` on the pinned
    server; then `mta package`.

---

## 12. What did NOT change

* The six exported entry points and the frozen `ILuaModuleManager10`
  contract; vendored Lua 5.1 MTA-patched ABI (byte-compared in CI).
* Export hygiene (only the six symbols; no `std::string` across the
  manager boundary).
* `MTA_LUA_FUNCTION`/`MTA_LUA_FUNC` semantics, `mta::lua::args`,
  `push_results`, snapshots, stack helpers, `mta::log`, `mta::events`.
* CMake presets and the `build/<preset>` layout; warning flags.
* The six `sample_*` regression anchors (plus new ones per subsystem).