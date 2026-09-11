# Tutorial: a module from scratch

> The concise reference set lives in [api.md](api.md) (with
> [example.md](example.md), [architecture.md](architecture.md) and
> [migration-v1-to-v2.md](migration-v1-to-v2.md)).

A step-by-step path from an empty folder to a working module loaded on an
MTA server. You need a compiler (MinGW-w64 or MSVC on Windows, GCC on Linux),
CMake ≥ 3.27 and Ninja.

## Step 1. Clone the base

```bash
git clone <your-repository> my-module
cd my-module
```

## Step 2. Build as-is

```bash
# Windows (MinGW-w64)
cmake --preset win-mingw
cmake --build --preset win-mingw

# Linux
cmake --preset linux-gcc
cmake --build --preset linux-gcc
```

Result: build/win-mingw/module/win-x64/base.dll (or .so on Linux).

## Step 3. Run the tests

```bash
mta test unit          # ctest unit fixtures
mta test lua           # embedded Lua harness (scripts/*.lua)
```

or plain `ctest --preset win-mingw`. You should see 100% tests passed. That
means the base works.

## Step 4. Add your first function

Create source/functions/basics/my_sum.cpp — one .cpp is all it takes; the
build and the registration pick it up automatically:

```cpp
#include <mta/sdk.hpp>

MTA_LUA_FUNCTION("my_sum", "Adds two numbers.")
{
    auto [a, b] = mta::lua::args<double, double>(L);
    return mta::lua::push_results(L, a + b);
}
```

Rebuild — the my_sum function is already available. No CMake, no registry or
central file edits needed (a new .cpp lands in the build by itself).

## Step 5. Rename the module

The module identity lives in exactly one file — config/module.toml:

```toml
[module]
name = "my_mod"        # -> my_mod.dll / my_mod.so
title = "My Module"
author = "Jane Doe"
version = "2.1.0"      # the Module version float (2.1) in the load diagnostic
```

The binary name, the CMake target names, the registration metadata, `mta
package` output and `mta doctor` diagnostics all derive from `[module]` —
nothing is duplicated in C++ sources. (CMake cache variables
`-DSDK_MODULE_NAME=...` etc. still work, as explicit overrides.)

## Step 6. Install on the server

1. Copy `my_mod.dll` (or `.so`) into the server's mods/deathmatch/modules/.
2. Add to mtaserver.conf:

```xml
<module src="my_mod"/>
```

3. Restart the server. The module's load diagnostic shows its identity and
   the four separate version entities:

```
module: loaded my_mod (module 2.1, sdk 1.0.0, abi 1; MTA 1.6.0-9.21788.0)
```

## Step 7. Check in Lua

In any server resource:

```lua
outputChatBox("2 + 3 = " .. my_sum(2, 3))  -- 2 + 3 = 5
```

## What's next

- [README.md](../README.md) — every function recipe.
- [api.md](api.md) — the complete API reference.
- [GUIDES.md](GUIDES.md) — advanced topics (threads, async, tables).
- [architecture.md](architecture.md) — how the system is put together.
- [example.md](example.md) — a complete feature, end to end.
- source/functions/ — live examples of every feature.