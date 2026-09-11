status: historical
version: 1.0
recorded: 2026-09-11

# История архитектуры — от трёх репозиториев к платформе

Терse-хроника того, как устройство репозиториев менялось и почему. Это
исторический документ: здесь цитируются **старые** имена репозиториев
(`mta-market-site`, `mta-market-module`, `mta-market-document`) — только
в этом файле и [LEGACY.md](LEGACY.md).

## Фаза 1 — три отдельных репозитория

Проект существовал как три репозитория с разделением ответственности
(замороженный контракт —
[development/reference/old_repository-contract.md](../development/reference/old_repository-contract.md)):

| Репозиторий | Владел | Никогда не владел |
|---|---|---|
| `mta-market-site` | Всё веб-приложение: `apps/server` (Express API, DRM v2 сервер, артефакты, платежи, ledger), `apps/web` (Next.js), `contract.prisma` (единственная схема БД), Docker/nginx, backup-скрипты, CI | Модулем (нет C++), клиентскими приватными ключами (INV-010), второй копией DRM-диалекта |
| `mta-market-module` | `source/sdk/**` (MTA ABI SDK), `source/drm/**` (DRM client), `tests_drm/`, `other/` (documents/tools/tests/third_party) | Бизнес-логикой маркетплейса, копиями серверных ключей, вторым источником истины протокола |
| `mta-market-document` | Продуктовые документы, Development Plan system, замороженные контракты, идеи | Дублями кода/схемы «для справки», маркетинговыми заявлениями без доказательств |

Клеймом фазы были **замороженные межрепозиторные контракты** (сейчас —
[development/reference/](../development/reference/README.md)): DRM Protocol
v2 (истина — `protocol.ts`), contract repository (правила владения и
независимых релизов), compatibility matrix (только верифицированные
строки site ↔ REST ↔ DRM protocol ↔ module). Изменение замороженного
значения = bump версии протокола + новая строка матрицы, «спека
обновляется первой».

Правило «код выигрывает при расхождении» и INV-инварианты (INV-007,
INV-010, INV-011) сформулированы в этой фазе и сохранены без изменений.

## Фаза 2 — унификация в `mta-market-platform` (PLAN-011)

Единичный монорепозиторий: один продукт, один процесс разработки, один
набор инфраструктуры. План объединения выполнен и записан как
**PLAN-011** — [PLAN-011.md](../development/completed/PLAN-011.md);
полная карта переноса — [MIGRATION.md](MIGRATION.md).

### Что куда переехало

| Было (старые репозитории) | Стало (mta-market-platform) |
|---|---|
| `mta-market-site/apps/server` | `site/server` (включая `src/lib/drm/`, `src/routes/drm/`, `migrations/`, `Dockerfile`) |
| `mta-market-site/apps/web` | `site/web` |
| — (кросс-компонентные типы web) | `site/shared` (новый `@mta-market/shared`: DTO/error-envelope; PLAN-010 Rule 006 — связность через shared-типы и `contracts/`, не через сорцы) |
| `mta-market-site/packages` (eslint-config, tsconfig) | `site/packages` |
| `mta-market-site/e2e`, `apps/server/tests`, модульные тесты | `tests/` — централизованное дерево: `tests/e2e`, `tests/integration`, `tests/unit`, `tests/module`, `tests/tools` (PLAN-010 Rule 002: единственное место тестов) |
| `mta-market-module/source` | `module/src` (`sdk/`, `drm/`, `functions/`, `library/`, `mta/`) |
| `mta-market-module/other/third_party` | `module/third_party` (Lua 5.1, MTA SDK headers) |
| `mta-market-module/other/tools` (+ `other/server`) | `module/tools` (`mta` CLI, `mock-server`, `docgen.cpp`, `spike_luac.cpp`) |
| `mta-market-module/other/documents` (lowercase-набор) | `documents/module/` (BUILD/RUNTIME/LUA-API/TUTORIAL/GUIDES/EXAMPLE и др.) |
| `mta-market-module/tests_drm` | `tests/module/drm` |
| `mta-market-module/docs/H-001-inventory.md` | Перенос долга: пока остаётся в старом репозитории (см. [LEGACY.md](LEGACY.md)) |
| `mta-market-site/docker-compose*.yml`, `nginx.conf`, скрипты deploy/backup | `infrastructure/` (`docker/compose/{development,tests,staging,production}.yml`, `nginx/`), целевые пути скриптов — `scripts/deployments/` (перенос скриптов — pending, см. [LEGACY.md](LEGACY.md)) |
| `mta-market-document/*.md` (PROJECT, VISION, PRODUCT-*, DAILY-EXPERIENCE) | `documents/product/` |
| `mta-market-document/DEVELOPMENT` (ACTIVE/COMPLETED/CURRENT/NEXT-PHASE) | `documents/development/` (ACTIVE → `active/`, COMPLETED → `completed/`) |
| `mta-market-document/DEVELOPMENT/REFERENCE` | `documents/development/reference/` (файлы с префиксом `old_` — замороженные эталоны) |
| `mta-market-document/IDEAS` | `documents/ideas/` (разложен по темам; см. [ideas/README.md](../ideas/README.md)) |
| — | `contracts/` — новый слой машиночитаемых контрактов (DRM v2 схемы; каталог создан, наполнение — pending) |

Корневые CMake (`CMakeLists.txt` + `CMakePresets.json`) — суперпроект,
форвардинг в самостоятельный `module/`; логи — корневой `logs/`
(конвенция, в git только `.gitkeep`).

## Почему

- **Один продукт.** MTA Market — единая система (site + module + контракты);
  три репозитория заставляли синхронизировать три git-истории ради одного
  продуктового изменения.
- **Один процесс разработки.** Единый Development Plan цикл, единые
  CI-прогоны и приёмка; планы больше не размазаны между «основным
  объёмом работ» и «документацией».
- **Централизация тестов/логов/скриптов/конфига/инфраструктуры.** Все
  тесты — в `tests/`; логи — `logs/`; скрипты — `scripts/`; конфиг —
  `config/` + `.env.example`; инфраструктура — `infrastructure/`.
- **Слой контрактов.** `contracts/` выделяет машиночитаемые
  межкомпонентные соглашения (вместо «спека в документации, код в трёх
  репозиториях»); связность компонентов — через `@mta-market/shared` и
  `contracts/`, не через кросс-импорты сорцов.

Замороженные контракты фазы 1 сохраняют силу и внутри монорепозитория:
`site/server/src/lib/drm/protocol.ts` — истина протокола,
`documents/development/reference/old_*` — замороженные эталоны,
изменение констант — только через bump версии (v3).
