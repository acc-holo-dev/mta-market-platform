# MIGRATION — трёх репозиториев в mta-market-platform (PLAN-011)

Дата: 2026-09-11. Источники: `acc-holo-dev/mta-market-site` (HEAD 1e38f19),
`acc-holo-dev/mta-market-module` (HEAD 09ccb7b), `acc-holo-dev/mta-market-document`
(HEAD c1de79e). Старые репозитории не уничтожены — сохранены как исходники миграции.

Формат карты: `СТАРЫЙ ПУТЬ → НОВЫЙ ПУТЬ [ДЕЙСТВИЕ]`. Действия: MOVE (перенос),
RESTRUCTURE (перенос + реорганизация), MERGE (объединение), REWRITE (переписан),
CREATE (создан с нуля), DELETE (удалён), KEEP-LEGACY (исторический, пути не менялись).

## 1. mta-market-site → site/ + корневые слои

| Старый путь | Новый путь | Действие |
|---|---|---|
| `apps/web/` | `site/web/` | MOVE |
| `apps/server/` | `site/server/` | MOVE |
| `apps/server/src/attic/` | — | DELETE (мёртвый код: не импортируется, исключён tsconfig, сохранён в git-истории старого репо; Rule 001 — README.md вне documents/) |
| `packages/{tsconfig,eslint-config}/` | `site/packages/*` | MOVE (+ phantom `main: index.js` оставлен как есть) |
| — | `site/shared/` | CREATE (DTO types, error-envelope, domain labels; потребляется web через `@mta-market/shared`) |
| `e2e/*.spec.ts` | `tests/e2e/{authentication,marketplace,servers,community,content}/` | RESTRUCTURE (по доменам; helpers → `tests/tools/playwright/`) |
| `apps/server/tests/*.test.ts` (28 integration) | `tests/integration/api/` | MOVE (+ импорты `../src/*` → `@server/*`) |
| `apps/server/tests/*.test.ts` (5 unit) | `tests/unit/site/` | MOVE (классификация по зависимостям: без БД) |
| `apps/server/tests/helpers/` | `tests/tools/helpers/` | MOVE |
| `playwright.config.ts` | `playwright.config.ts` (корень) | MOVE (testDir → `tests/e2e`) |
| `scripts/audit-gate.sh` | `scripts/maintenance/audit.sh` | MOVE (пути compose/exceptions обновлены) |
| `scripts/backup.sh` | `scripts/database/backup.sh` | MOVE (COMPOSE_FILE → infrastructure; volume → `mta-market-platform_uploads_data`) |
| `scripts/deploy.sh` | `scripts/deployments/deploy.sh` | MOVE (+ отдельный `rollback.sh`, `healthcheck.sh`, `migrate.sh`, `restore.sh` — CREATE) |
| `docker-compose.yml` | `infrastructure/docker/compose/development.yml` | RESTRUCTURE (только infra-сервисы; app-контейнеры — из CI-образов) |
| `docker-compose.prod.yml` | `infrastructure/docker/compose/production.yml` | MOVE (`nginx.conf`/`ssl` пути → infrastructure) |
| — | `infrastructure/docker/compose/{tests,staging}.yml` | CREATE (test-PG :5433; staging-топология 3100/3101) |
| `apps/server/Dockerfile` | `infrastructure/docker/site/server.Dockerfile` | MOVE (контекст = корень репо; пути `site/...`; OpenSSL/pnpm пины) |
| `apps/web/Dockerfile` | `infrastructure/docker/site/web.Dockerfile` | MOVE |
| `.dockerignore` | `.dockerignore` (корень) | MOVE (+ module/ исключения) |
| `nginx.conf` | `infrastructure/nginx/nginx.conf` | MOVE |
| `docs/adr/ADR-001-drm-lease-revocation.md` | `documents/adr/ADR-001-drm-lease-revocation.md` | MOVE |
| `docs/operations/backup-restore.md` | `documents/operations/BACKUP-RESTORE.md` | MOVE+REWRITE (пути `/srv/...`, volume, scripts) |
| `docs/operations/database-migrations.md` | `documents/operations/DATABASE-MIGRATIONS.md` | MOVE+REWRITE (`apps/server` → `site/server`) |
| `docs/operations/production-runbook.md` | `documents/operations/PRODUCTION.md` | MOVE+REWRITE |
| `.github/workflows/ci.yml` | `.github/workflows/{validate,tests,security,contracts,site,module,e2e,release}.yml` | REWRITE (единый пайплайн, E2E — блокирующий gate) |
| `.github/ISSUE_TEMPLATE/`, `audit-exceptions.txt` | те же (`.github/`) | MOVE |
| `.prettierrc`, `.prettierignore`, `.env.example`, `LICENSE` | корень | MOVE (`.prettierignore` пере-заякорен) |
| — | `config/{development,staging,production,schemas}` | CREATE (декларативные манифесты окружений + JSON Schema; runtime-источник — env) |
| — | `tests/concurrency/{commerce,ledger,payment}` | CREATE (exactly-once фундамент, §12) |
| `pnpm-workspace.yaml` (`apps/* packages/*`) | `site/web, site/server, site/shared, site/packages/*` | REWRITE |
| `package.json` (корень старого) | корень (mta-market-platform) | REWRITE (+ vitest/supertest/ts в devDeps; overrides сохранены) |

## 2. mta-market-module → module/

| Старый путь | Новый путь | Действие |
|---|---|---|
| `source/` | `module/src/` | MOVE (drm/, functions/, mta/, sdk/, library/) |
| `config/{cmake,module.toml}` | `module/config/` | MOVE |
| `other/third_party/{lua,mta-sdk}` | `module/third_party/` | MOVE (+ `third_party/lua/LICENSE` CREATE — Lua 5.1.5 MIT) |
| `other/tools/{docgen.cpp,mta}` | `module/tools/` | MOVE (cli.py: `SDK_ROOT` depth + `source/`→`src/`, `other/server`→`tools/mock-server`, `other/third_party`→`third_party`) |
| `other/server/` (harness реального MTA-сервера) | `module/tools/mock-server/` | MOVE (README → documents/module/INTEGRATION.md) |
| `other/tests/lua/{harness.cpp,scripts}` | `tests/module/runtime/` | MOVE (CMake-пути обновлены) |
| `other/tests/unit/*.cmake + fixtures` | `tests/module/build/` | MOVE (include-путь к module-config.cmake поправлен) |
| `other/tests/integration/*.lua` | `tests/module/integration/` | MOVE (README → documents/module/INTEGRATION.md) |
| `other/tests/python/test_harness.py` | `tests/module/test_harness.py` | MOVE (ROOT depth `parents[2]`, пути sys.path) |
| `tests_drm/main.cpp` | `tests/module/drm/main.cpp` | MOVE (+ Makefile: пути от корня платформы) |
| `other/documents/{api,architecture,TUTORIAL,GUIDES,example}.md` | `documents/module/{LUA-API,RUNTIME,TUTORIAL,GUIDES,EXAMPLE}.md` | MOVE (переименованы) |
| `other/documents/migration-v1-to-v2.md` | `documents/history/V1-TO-V2-MIGRATION.md` | MOVE (legacy) |
| `docs/H-001-inventory.md` | `documents/module/DRM-CLIENT.md` | MOVE |
| `README.md` (корень модуля) | `documents/module/README.md` | REWRITE (структура монорепо, ссылки на documents) |
| — | `documents/module/BUILD.md`, `INTEGRATION.md` | CREATE (сборка + интеграция; content of library/base + mock-server README поглощён) |
| `.clang-format` | `module/.clang-format` | MOVE; `.editorconfig` → корень |
| `.github/workflows/{ci,release}.yml` | `.github/workflows/{module,release}.yml` | REWRITE (пути, OpenSSL, header-drift gate) |
| — | `infrastructure/docker/module/Dockerfile` | CREATE (build+test+cpack в контейнере) |
| — | `CMakeLists.txt` (корень) + `CMakePresets.json` (корень) | CREATE (root superproject: `add_subdirectory(module)`) |

### Исправленные pre-existing дефекты модуля (найдены и зафиксированы миграцией)

1. **Unity-коллизии**: `aead.cpp`/`key_store.cpp` (`kKeyBytes`), `license_client.cpp`/`market_client.cpp`
   (`UrlParts`/`split_url`) — одинаковые имена в per-file anonymous namespaces;
   под UNITY_BUILD сборка ломалась. Fix: `SKIP_UNITY_BUILD_INCLUSION` для `src/drm/*`.
2. **`-Werror=sign-conversion`**: `src/drm/json.cpp:16` (char→unsigned char в range-for) — fix static_cast.
3. **OpenSSL не линковался в CMake** (только в Makefile) — `find_package(OpenSSL REQUIRED)` + link в `sdk_core`.
4. **`scheduler.cpp:275`** — incomplete type `ILuaModuleManager10` при не-unity сборке
   (маскировалось unity-блобом) — добавлен прямой include.
5. **`spike_luac` не существовал**: 096_drm_spike.lua требовал fixture
   `build/protected.luac` от инструмента, которого нет в git — написан
   `module/tools/spike_luac.cpp` (MTA-совместимый Lua 5.1 bytecode: header
   size_t=4, 4-байтовые размеры строк, счётчик прототипов) + CMake-таргет
   `sdk_spike_luac_fixture`.

## 3. mta-market-document → documents/

| Старый путь | Новый путь | Действие |
|---|---|---|
| `README.md` | `documents/README.md` | REWRITE (карта монорепо) |
| `VISION/PROJECT/PRODUCT-*` (5) + `DAILY-EXPERIENCE.md` | `documents/product/` | MOVE |
| `DEVELOPMENT/{README,CURRENT,NEXT-PHASE}.md` | `documents/development/` | MOVE+UPDATE (пути монорепо, счётчик планов 001…011, delta PLAN-011) |
| `DEVELOPMENT/ACTIVE/.gitkeep` | `documents/development/active/` | MOVE |
| `DEVELOPMENT/COMPLETED/PLAN-001..010.md` | `documents/development/completed/` | MOVE (+ автоматическая замена путей `apps/server`→`site/server` и т.п.) |
| `DEVELOPMENT/REFERENCE/old_*` | `documents/development/reference/` | KEEP-LEGACY (+ пометка о путях PLAN-011) |
| `IDEAS/IDEAS.md` (10 секций) | `documents/ideas/{MARKETPLACE,COMMUNITY,TRUST,FUTURE}.md` | RESTRUCTURE (секции дословно) |
| — | `documents/ideas/README.md`, `ideas/SERVERS.md` | CREATE |
| — | `documents/adr/` | CREATE (ADR-001 перенесён из site) |
| — | `documents/api/{README,AUTH,MARKETPLACE,COMMERCE,SERVERS,COMMUNITY,CONTENT,DRM}.md` | CREATE (по инвентарю кода) |
| — | `documents/architecture/{SYSTEM,SITE,MODULE,DATA,SECURITY,TESTING,DEPLOYMENT}.md` | CREATE |
| — | `documents/drm/{README,PROTOCOL-V2,SECURITY,CRYPTOGRAPHY,KEY-MANAGEMENT}.md` | CREATE (из frozen-контракта + кода) |
| — | `documents/operations/{README,DEVELOPMENT,STAGING,DEPLOYMENT,INCIDENT-RESPONSE}.md` | CREATE |
| — | `documents/history/{ARCHITECTURE-HISTORY,LEGACY,MIGRATION}.md` | CREATE (этот файл — MIGRATION) |
| — | `contracts/` | CREATE (26 файлов: openapi + 6 доменных инвентарей, DRM v2 wire-схемы, module-схемы, events, data, compatibility) |
| — | `documents/development/completed/PLAN-011.md` | CREATE (запись о выполнении миграции; нумерация продолжена — план-источник именовался «PLAN-010», имя конфликтовало с существующим PLAN-010 Creator Analytics) |

## 4. Удалено (полный список)

- `site/server/src/attic/` (6 файлов) — parked-заготовки фаз B/C, не импортируются,
  исключены tsconfig; сохранены в git-истории mta-market-site. Причина: Rule 001
  (README.md рядом с кодом) + чистота tsc/lint-скоупа.
- `module/tools/mock-server/README.md`, `module/src/library/base/README.md` —
  содержимое перенесено в `documents/module/INTEGRATION.md` / `BUILD.md` (Rule 001).
- Ничего больше: неизвестное не удалялось (§28); все legacy-файлы перенесены
  или задокументированы в `LEGACY.md`.

## 5. Свест оставшихся технических долгов

1. **Cross-instance exactly-once**: key-lock (keyLock.ts) сериализует checkout/settlement
   внутри одного процесса backend; для multi-replica нужен unique partial index
   (formal migration path).
2. **Windows-сборка модуля** не проверялась (CI-джобы best-effort) — исторический
   blocker из CURRENT.md.
3. **Real-server integration** (module) — best-effort CI-джоба: зависит от pinned
   загрузок nightly.mtasa.com.
4. **OpenAPI request/response schemas** — инвентарь доменных эндпоинтов полный,
   но тела запросов/ответов формализованы пока только для DRM v2 и module wire.
5. **Дублирование ZIP/PNG builders** (tests/tools/helpers/zip.ts vs
   tests/tools/playwright/helpers.ts) — не объединено (разные рантаймы vitest/playwright).
6. **packages/{tsconfig,eslint-config}**: phantom `main: "index.js"` остался (безвредно).
7. **`/creators/[username]` vs `/sellers/[username]`** — расхождение SURFACE-MAP (target)
   и PROJECT.md (фактический URL) зафиксировано; сверка поверхности — отдельный план.
8. **PRODUCT-MODEL §3.1** (OFFLINE как lifecycle-стадия) противоречит
   PRODUCT-ARCHITECTURE §4.1 (monitoring — отдельная ось); реализация соответствует
   ARCHITECTURE. Правка MODEL — отдельное решение (foundational doc).
9. **`node dist/` не запускается напрямую** (ESM-импорты без расширений при
   `module: preserve` и без `"type": "module"`): production-образы API
   исторически не проверялись рантаймом (Blockers в CURRENT.md). CI-E2E
   запускает API документированным dev-путём (tsx); самодостаточная упаковка
   dist — отдельная задача перед production-проверкой.
10. **Clang-leg**: clang18 + libstdc++-14 требует complete-type инстанцирования
    самореферентного `Json::Members` (GCC допускает) — джоба report-only;
    основной тулчейн релиза — GCC (Linux x64 verified).
11. **CI-E2E окружение**: сиды (plan003/plan005), heartbeat-симулятор,
    CORS_ORIGINS и ослабленный rate-limit профиль задаются в `e2e.yml` —
    в CI нет локального `.env`; это часть сборки среды прогона.
