# MODULE — архитектура нативного модуля (module/)

Область: `module/`. Подробная пользовательская документация компонента —
[documents/module/](../module/README.md): [BUILD](../module/BUILD.md),
[RUNTIME](../module/RUNTIME.md), [LUA-API](../module/LUA-API.md),
[GUIDES](../module/GUIDES.md), [TUTORIAL](../module/TUTORIAL.md),
[EXAMPLE](../module/EXAMPLE.md). Этот файл — архитектурный обзор; деталей не
дублируем.

Два слоя в одном компоненте: **SDK** (ядро) и **DRM client + market
integration** (subsystem). Артефакт сборки — `base.dll`/`base.so` (имя из
`module/config/module.toml`, сейчас `base` v2.1.0) → `mods/deathmatch/modules/`
сервера MTA:SA + запись в `mtaserver.conf`.

## SDK core (`module/src/sdk`)

| Подкаталог | Ответственность |
|---|---|
| `abi/` | экспорт ABI модуля (`export.hpp`, `module.cpp`, `.def`/`.ver` шаблоны) — точка входа MTA |
| `lua/` | типизированный Lua-биндинг: стек, arguments (декларативная привязка аргументов), protect, state, table helpers |
| `bind/` | фасад привязки функций в реестр (`bind.hpp`) |
| `runtime/` | scheduler, tasks, timers, callbacks (асинхронные задачи — workers из `[async]` секции `module.toml`, очередь 4096) |
| `events/` | события (`events.{hpp,cpp}`) |
| `registry/` | реестр функций/ресурсов модуля |
| `native/` | обёртки нативных MTA-вызовов: module / resource |
| `objects/` | userdata-объекты (`userdata.hpp`) |
| `resources/` | работа с ресурсами |
| `errors/`, `logging/` | ошибки и логирование |
| `version.hpp` | `SDK_VERSION` — единый источник версии SDK (не совпадает с версией модуля) |

Фасад для модулей: `#include <mta/sdk.hpp>` (`module/src/mta/sdk.hpp`).
Внутренние утилиты: `module/src/library/base/` (handle map).

## Functions tree (`module/src/functions`) — Lua-поверхность

| Домен | Файлы | Суть |
|---|---|---|
| `basics/` | hello, greet, echo, add, minmax, range, tag, typed_params | демо привязок и типов аргументов |
| `tables/` | table_fields, table_stats | работа с Lua-таблицами |
| `async/` | timers, timer_demo, task_demo, async_add | таймеры/задачи/очередь |
| `events/` | trigger_demo | триггеры событий |
| `info/` | version, functions_list, resource_info | интроспекция (`mta doctor`) |
| `native/` | resource_args | вызовы нативных MTA-функций |
| `objects/` | counter | userdata-демо |
| `raw/` | stack_dump | сырой стек |
| `state/` | session, view | состояние между вызовами |
| `bench/` | args, callback, tables | бенчмарки |
| `drm/` | market.cpp, spike.cpp | **market integration** (`mta_market_configure/start/stop/report_players/status/review_token` — heartbeat + review-токены, только агрегаты) и сохранённый Stage-0 spike |

Справочник Lua API: [LUA-API](../module/LUA-API.md).

## DRM client (`module/src/drm`)

Протокол v2: [DRM](../api/DRM.md); реестр файлов: [DRM-CLIENT](../module/DRM-CLIENT.md).

| Файл | Ответственность |
|---|---|
| `json.{hpp,cpp}` | JSON parser + **канонический сериализатор** (байт-совпадение с сервером: сортировка ключей, strip `signature`, дословные числа) |
| `base64.{hpp,cpp}` | строгий RFC 4648 |
| `ed25519.{hpp,cpp}` | генерация пары, импорт/экспорт raw-ключей, sign/verify, SPKI DER (формат публичного ключа сервера) |
| `aead.{hpp,cpp}` | AES-256-GCM (расшифровка payload, работа с DEK) |
| `http_client.{hpp,cpp}` | минимальный authenticated HTTPS-клиент (TLS 1.2+, валидация сертификата) для вызовов `/drm/v2/*` и `/integration/*` |
| `key_store.{hpp,cpp}` | secure key store установки: файл AES-256-GCM, 0600, машинно-производный ключ (Linux); на Windows фактически деградирует (см. §9 support matrix — Windows NOT SUPPORTED; заявленный ранее DPAPI-вариант в коде отсутствует); **INV-010: приватный ключ никогда не передаётся** |
| `license_client.{hpp,cpp}` | жизненный цикл лицензии: register installation → challenge verify → activate (lease) → renew → heartbeat; верификация подписи lease по `serverKeyId` |
| `market_client.{hpp,cpp}` | интеграция с маркетом: `POST /integration/heartbeat` (онлайн-агрегаты) и `POST /integration/review-tokens` (выдача игроку одноразового токена) |
| `Makefile` | standalone-тесты DRM без MTA-сервера: `make -f module/src/drm/Makefile test` |

Требования сборки DRM: OpenSSL 3.x.

## Third-party (`module/third_party`)

| Каталог | Содержимое |
|---|---|
| `lua/` | **vendored Lua 5.1.5** (`third_party/lua/src`, `LUA_RELEASE "Lua 5.1.5"`) — билдится как таргет `mta_lua`, не модифицируется |
| `mta-sdk/` | заголовки MTA server SDK (`ILuaModuleManager10.h`, `lua/`) — ABI-контракт с сервером MTA |

## Система сборки

- **Единый источник identity** — `module/config/module.toml` (`[module]`
  name/title/author/version, `[build]` cxx_standard/unity/lto, `[async]`
  workers/queue, `[features]` подсистемы). Читается **до** `project()`
  (`config/cmake/core/module-config.cmake`); CLI `mta` читает тот же файл.
  Переопределения — опциональные CMake cache-переменные (`-DSDK_MODULE_NAME=…`,
  `-DSDK_UNITY=OFF`, `-DSDK_SANITIZE=ON` и т.п.).
- `project(mta_sdk_module VERSION <SDK_VERSION>)` — версия проекта берётся из
  `src/sdk/version.hpp`, не из `module.toml` (SDK-версия ≠ модульная).
- Пресеты (`module/CMakePresets.json`): configure `base`, `win-msvc`,
  `win-mingw`, `linux-gcc`; build — те же платформенные. Сборка:

  ```bash
  cmake --preset linux-gcc && cmake --build --preset linux-gcc && ctest --preset linux-gcc
  ```

- Таргеты: `sdk_core` (ядро), `sdk_base` (функции), `sdk_tests` (embedded Lua
  harness), `sdk_docgen` (генератор справки), fixture `sdk_spike_luac_fixture`.
- CLI разработчика: `module/tools/mta/` (Python 3.11+; `mta doctor|build|test`),
  `docgen.cpp`, `mock-server/` (интеграционный мок MTA-сервера).

## Toolchain policy (PLAN-012 §21B)

**GCC (Linux x64) — официальный release toolchain.** Все блокирующие CI-гейты
(сборка, ctest, DRM-тесты, CLI) исполняются GCC; сборка релиза модуля —
GCC + OpenSSL.

**Clang — report-only leg** (`continue-on-error` в module.yml). Точная
причина отказа clang18 + libstdc++-14: самореференциальные члены
`mta::drm::Json` в `module/src/drm/json.hpp` (строки 39/45/46:
`using Members = std::vector<std::pair<std::string, Json>>;`
`std::vector<Json> array;` `Members object;`) требуют complete-type
инстанцирования при объявлении члена вclang; GCC/libstdc++ допускает
инстанцирование с незавершённым типом (C++17 incomplete-type allowance).
Конструктив не nlohmann, exceptions включены, unity для DRM исключён —
риск локализован в одном заголовке. FIX (indirection через unique_ptr)
возможен точечно, но меняет API потребителей; до выделенного hardening-этапа
принята формальная политика «GCC release, clang report-only».

## Support matrix (PLAN-012 §21C)

| Платформа | Статус | Обоснование |
|---|---|---|
| Linux x64 (GCC, OpenSSL) | **SUPPORTED — release path**, CI-блокирующий гейт (build + ctest + DRM make test + CLI + harness) | верифицированный путь релиза |
| Linux x64 (Clang) | report-only (build probe, не блокирует) | см. §8 выше |
| Windows (MinGW/MSVC) | **NOT SUPPORTED** | POSIX-слой: `netdb.h`/`sys/socket.h`/`getaddrinfo`/`close` в `http_client.cpp` (без `_WIN32`-гвардов), `key_store.cpp` деградирует (home-каталог не создаётся, machine-id из `/etc/machine-id`), `timegm` в `license_client.cpp:332`; платформенной абстракции (winsock2/mkgmtime/fs) нет. CI win-* — build-probe (continue-on-error), не тестирует. |

## Тесты (`tests/module/*`, централизованно)

| Каталог | Чем запускается | Что проверяет |
|---|---|---|
| `runtime/` (`harness.cpp` + `scripts/010…096*.lua`) | CTest `sdk_tests` | embedded-Lua harness: биндинги, таблицы, async/task/timer, ошибки, lifecycle, restart, стресс, бенчмарки, `096_drm_spike` |
| `build/` | CTest `module_config_parse`, `module_config_rejects_garbage` | парсер `module.toml` и отказ на мусорном конфиге |
| `drm/` (`main.cpp`) | `make -f module/src/drm/Makefile test` | канонический JSON (байт-матч), Ed25519, AEAD, key store, HTTP client, lease-верификация |
| `integration/` (`main_resource.lua`, `witness_resource.lua`) | на живом MTA-сервере | процедура в [INTEGRATION](../module/INTEGRATION.md) (в documents/module) |

Структура тестов модуля пережила миграцию: прежние `other/tests/**` →
`tests/module/*` (см. [V1-TO-V2-MIGRATION](../history/V1-TO-V2-MIGRATION.md)).

## Границы компонента

- Модуль **не знает** о PostgreSQL/Redis/Prisma — он общается только с HTTP
  API (`/drm/v2/*`, `/integration/*`).
- Приватность: модуль отправляет только агрегаты (online count/status) —
  никаких player identity/IP/чата (§33, `market_client`).
