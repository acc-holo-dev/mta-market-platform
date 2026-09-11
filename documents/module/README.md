# MTA Market — нативный модуль (component `module/`)

Нативный модуль MTA:SA для площадки MTA Market. Два слоя в одном компоненте:

1. **SDK** — C++20-обёртка ABI MTA (типизированный Lua, async, таймеры, CLI `mta`).
2. **DRM client** — `module/src/drm/`: установка с Ed25519-ключом в secure key
   store, challenge-верификация, подписанный lease (activate/verify/renew),
   heartbeat, lease-gated выдача DEK для AES-256-GCM ресурсов (Protocol v2).
   Полный реестр: [DRM-CLIENT.md](DRM-CLIENT.md).

Протокол маркета: [../development/reference/old_drm-protocol-v2.md](../development/reference/old_drm-protocol-v2.md)
(замороженный контракт; истина при расхождении — код).
Серверная сторона: `site/server/src/lib/drm/` и `site/server/src/routes/drm/`.

## Структура компонента

| Путь | Назначение |
|---|---|
| `module/src/` | Исходники: `sdk/` (ядро SDK), `functions/` (Lua-функции), `drm/` (DRM client), `mta/` (ABI-адаптация), `library/` (внутренние утилиты) |
| `module/third_party/` | Vendored: Lua 5.1 (`lua/`), MTA SDK headers (`mta-sdk/`) |
| `module/config/` | `module.toml` (единый источник identity), CMake-модули (`cmake/`) |
| `module/tools/` | `docgen.cpp` (генератор справки), `mta/` (Python CLI), `mock-server/` (интеграционный мок MTA-сервера) |
| `tests/module/` | Централизованные тесты: `drm/`, `runtime/` (Lua harness), `build/` (CMake-script), `integration/` (Lua-ресурсы) |

Документация: [BUILD.md](BUILD.md) — сборка; [RUNTIME.md](RUNTIME.md) —
устройство рантайма; [INTEGRATION.md](INTEGRATION.md) — интеграция с сервером
маркета; [LUA-API.md](LUA-API.md) — справочник Lua API; [TUTORIAL.md](TUTORIAL.md),
[GUIDES.md](GUIDES.md), [EXAMPLE.md](EXAMPLE.md) — руководство и примеры.

## Сборка и тесты

CMake 3.27+, Ninja, компилятор с C++20, Python 3.11+ для CLI, OpenSSL 3.x для DRM client.

```bash
# из module/
cmake --preset linux-gcc
cmake --build --preset linux-gcc
ctest --preset linux-gcc          # sdk_tests + конфиг-парсер тесты

# или через CLI
mta doctor
mta build
mta test
```

Артефакт: `.dll` / `.so` → `mods/deathmatch/modules/` сервера, запись в
`mtaserver.conf`. Имя модуля задаётся в `module/config/module.toml`
(сейчас `base` / 2.1.0).

Standalone DRM-тесты (без MTA-сервера):

```sh
make -f module/src/drm/Makefile test
```

Интеграционные Lua-ресурсы: `tests/module/integration/` (процедура —
[INTEGRATION.md](INTEGRATION.md)).

## Environment

DRM-ключи и endpoint сервера задаются в `config/module.toml` / конфиге
интеграции; серверная сторона ожидает `DRM_SERVER_PRIVATE_KEY`,
`DRM_MASTER_KEY`, `ARTIFACT_SIGNING_PRIVATE_KEY` (см.
[../operations/PRODUCTION.md](../operations/PRODUCTION.md) и
[../drm/KEY-MANAGEMENT.md](../drm/KEY-MANAGEMENT.md)).
