# PLAN-011 — Unified Platform Monorepo (mta-market-platform)

> Нумерация: план-источник миграции текстуально назывался «PLAN-010», но имя
> было занято завершённым PLAN-010 (Creator Analytics Foundation). По правилам
> цикла нумерация продолжена: **PLAN-011**. Это план реструктуризации
> платформы, а не продуктовая фича — приёмка фиксируется инженерными
> проверками (см. §10), browser E2E прогнан как регрессионный gate.

## 1. Цель

Создать единый главный репозиторий **mta-market-platform** — единый источник
разработки всей платформы MTA Market — и перенести в него три существующих
репозитория (`mta-market-site`, `mta-market-module`, `mta-market-document`),
сохранив рабочую функциональность и устранив дублирование:

- чистый корень: `documents/ contracts/ site/ module/ tests/ logs/ scripts/
  config/ infrastructure/ .github/` + технически необходимые root-файлы;
- централизация: tests, logs, scripts, config, documentation;
- contracts как машиночитаемый слой API/DRM/module/events/compatibility;
- единый `startup.py`, единый CI/CD, строгий `.gitignore`.

## 2. Исходное состояние

- Три независимых репозитория (см. [../../history/ARCHITECTURE-HISTORY.md](../../history/ARCHITECTURE-HISTORY.md));
  документация — в отдельном репо, кросс-репозиторные контракты заморожены
  ([reference/](../reference/README.md)), тесты разрозненны (`apps/server/tests/`,
  `e2e/`, `tests_drm/`, `other/tests/**`).
- Состояние продукта — после PLAN-010: backend 378/378, browser E2E 59/59.

## 3. Scope

- Аудит всех трёх репозиториев (структура, код, конфигурация, CI, тесты, доки).
- Новая структура репозитория + миграция по карте
  ([../../history/MIGRATION.md](../../history/MIGRATION.md)).
- Документация: реструктуризация + новые разделы (api/, architecture/, drm/,
  operations/, ideas/, history/); ничего важного не потеряно.
- Contracts: формализация существующих протоколов (без новых).
- Инфраструктура: compose (dev/tests/staging/production), Dockerfiles, nginx.
- `startup.py`; GitHub CI; `.gitignore`/`.gitattributes`.

### Вне scope

- Продуктовые фичи; domain-refactoring backend (route-heavy → modular) —
  поэтапно в будущих планах; правка foundational-документов по существу.

## 4. Assumptions

- Старые репозитории сохраняются до завершения миграции (не удаляются).
- Пути замороженных контрактов (`reference/old_*`) исторические — контент
  не переписывается, добавлена пометка о соответствии путей.
- Нумерация планов продолжается с конфликтующего имени (см. эпиграф).

## 5. Технические требования / ключевые решения

1. Rule 001–006 (строгие инварианты) — выполнены; validate-гейт в CI проверяет.
2. Тесты: root `tests/` — единственное место; импорты серверных модулей через
   алиас `@server/*` (vitest + tsconfig.test.json); классификация unit/integration
   по зависимостям (28 integration, 5 unit).
3. workspace: `site/web`, `site/server`, `site/shared` (новый, DTO/error-envelope/
   domain labels), `site/packages/*`; overrides перенесены в корень; lockfile
   перегенерирован.
4. Модуль: `source/` → `src/` (заголовки co-located — осознанное отклонение от
   `include/`-цели: ~100 инклодов не тронуты, CMake glob покрывает дерево);
   `other/` → `third_party|tools|tests` (централизация тестов — Rule 002).
5. Прекоммитные проверки миграции: pnpm install → prisma contract emit + db update
   → vitest → web/server builds → cmake+ctest+make (module) → playwright.

## 6. Задачи (выполнены)

- [x] аудит трёх репозиториев (внутренние отчёты);
- [x] скелет + gitignore/gitattributes/workspace;
- [x] documents: перенос 27 файлов, разбиение IDEAS, новые api/architecture/drm/
      operations/history (33 новых документа), обновление путей;
- [x] site: перенос, тесты централизованы, shared-пакет, attic удалён;
- [x] module: перенос, CMake-пути, исправление 5 pre-existing дефектов (см.
      [../../history/MIGRATION.md](../../history/MIGRATION.md) §2), spike_luac восстановлен;
- [x] contracts: 26 файлов, все парсятся; DRM v2 wire-схемы точны;
- [x] scripts/ (development/builds/tests/database/deployments/maintenance);
- [x] config/ (манифесты 3 окружений + схемы); logs/ (gitkeep-only);
- [x] infrastructure/ (4 compose, 3 Dockerfile, nginx, deployment dirs);
- [x] startup.py (dev/site/module/tests/build/status/stop/clean/doctor);
- [x] .github/ (8 workflows, CODEOWNERS, dependabot, PR template, issue templates);
- [x] security: gitleaks-паттерн-скан чист; audit-gate работает; dockerignore-политика.

## 7. Критерии завершения (факт)

| Критерий | Статус | Доказательство |
|---|---|---|
| Единый репозиторий, naming policy | ✅ | корень 9 директорий + root-файлы; validate.yml |
| `.md` только в documents/ | ✅ | validate-гейт + локальная проверка (0 нарушений) |
| web запускается / build | ✅ | next build exit 0; web :3000 200 (E2E-прогон) |
| backend запускается / build | ✅ | tsc exit 0; /health healthy (:3001) |
| migrations работают | ✅ | contract emit + db update (dev :5432 и test :5433) |
| module собирается / CMake работает | ✅ | cmake+ninja: base.so, ctest 3/3, make DRM: ALL TESTS PASSED; non-unity тоже |
| contracts соответствуют реализации | ✅ | схемы из кода; parse OK; единственное известное расхождение задокументировано (revoke endpoint — код выигрывает) |
| только root tests/ | ✅ | unit+integration+concurrency: **383/383** (36 файлов) |
| concurrency foundation | ✅ | 5 тестов (exactly-once checkout, idempotent settlement, webhook replay) |
| E2E проходят | ✅ | **59/59** browser E2E (см. §10) |
| logs централизованы, не tracked | ✅ | logs/** + .gitkeep only; runtime логи вне git |
| secrets не tracked | ✅ | паттерн-скан 609 файлов — чист; .env локальные untracked |
| `python3 startup.py` doctor/dev/status/stop | ✅ | doctor PASS; dev поднял полный стек; status/stop работают |
| workflows обновлены; tests+E2E — CI gates | ✅ | 8 workflows; e2e.yml блокирующий |
| Vision/Product docs сохранены | ✅ | documents/product/* 1:1; ссылки обновлены |

## 8. Тесты

- Backend (vitest, unit+integration+concurrency): **383/383** (378 унаследованных
  + 5 новых concurrency).
- Browser E2E (Playwright): **59/59** — см. §10.
- Module: ctest **3/3** (sdk_tests 226 assertions + config-parser ×2),
  standalone DRM make-tests: **ALL TESTS PASSED**, python harness: **12/12**.
- Type-check: workspaces + tests — exit 0 (включая новые `@server`/`@tests` алиасы).
- Contracts: 26/26 файлов парсятся.

## 9. Миграционные требования

- Формальная миграционная политика соблюдена: audit → map → skeleton → migrate →
  verify. Миграции БД не требовались (схема не менялась).
- Замороженные контракты не переписывались; wire-схемы contracts/drm/v2 —
  формализация существующего (версия v2 не менялась).

## 10. Финальная приёмка (2026-09-11, на этой машине)

1. `python3 startup.py doctor` — 12/12 PASS.
2. `python3 startup.py dev` — полный стек поднялся (infra → schema → API :3001 →
   web :3000; /health healthy).
3. `pnpm exec vitest run` — **383/383**.
4. `pnpm type-check` — exit 0.
5. `pnpm test:e2e` — **59/59** (после локальной установки недостающих системных
   библиотек chromium; примечание для окружений: `playwright install-deps`).
6. Module: cmake --preset linux-gcc + build + ctest **3/3**; make DRM — **ALL TESTS
   PASSED**; `mta doctor` — PASS; non-unity сборка — OK.
7. Security: паттерн-скан 609 файлов — чист; `pnpm audit` gate — работает
   (scripts/maintenance/audit.sh); секреты в git — отсутствуют.
8. GitHub workflows: validate/tests/security/contracts/site/module/e2e/release —
   прогнаны локально эквивалентными командами; полный CI-прогон — на GitHub.

## 11. Ограничения и remaining work (честно)

- Multi-instance exactly-once (checkout/settlement) требует unique partial index
  (formal migration path) — key-lock покрывает single-instance топологию.
- Windows-сборка модуля не проверялась (best-effort CI); real-server integration —
  best-effort (сетевые загрузки pinned-сервера).
- OpenAPI: тела запросов/ответов формализованы пока только для DRM v2/module.
- В `/creators/[username]` vs `/sellers/[username]` и PRODUCT-MODEL §3.1 (OFFLINE)
  — известные расхождения документации, вынесены в MIGRATION.md §5 (tech debt).
- CI-прогон на GitHub (новый репозиторий) — после push; локальные прогоны
  эквивалентны по шагам.

## 12. Итоговый статус

**PLAN-011 = IMPLEMENTATION COMPLETE (2026-09-11).**

Структура создана, функциональность сохранена и проверена (383/383 backend,
59/59 E2E, module 3/3 + DRM PASS, startup.py работает). Production-проверка
остаётся отдельным решением (как и после PLAN-004…010).
