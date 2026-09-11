# PLAN-014 — Dependency, Toolchain, CI & Platform Maintenance Modernization (выполнен)

Дата: 2026-09-12. Статус: IMPLEMENTATION COMPLETE.

## 1. Repository audit (§2)

Полный аудит: корневые и workspace-манифесты (web/server/shared/
eslint-config/tsconfig), lockfile, turbo.json, CMake presets,
.github/workflows (9), .github/dependabot.yml, Dockerfiles, startup.py,
сценарии тестов. Ключевые находки — см. §3–§9.

## 2. Dependency matrix (§3)

Создана: [reference/DEPENDENCY-MATRIX.md](../reference/DEPENDENCY-MATRIX.md)
— каждый direct dep с CURRENT/LATEST/классом/решением/обоснованием.
Сводка: UPDATE 15, REMOVE 1 (+1 перенос), HOLD ~20, DEFER 6 major-линий,
IGNORE — dependabot-major (репо-wide).

## 3. E2E regression — root cause и фикс (§32, acceptance §53)

Platform CI на PLAN-013 (0d04531) был red: E2E 3 failed / 5 did not run;
Validate red. Root cause по трём независимым причинам:

1. **Двойное кодирование кириллицы (класс B)** — bug самой починки
   PLAN-012 (d3b0320): часть строк получила второй слой мойдибейка
   (`МеУаџ статьџ ет аУтера` вместо «Новая статья от автора»), U+FFFD
   фрагменты emoji в DRM CLI. Спеки plan008/plan009 матчили
   серверные тайтлы уведомлений через `getByText` — совпадение стало
   невозможным. FIX: `scripts/development/repair-cyrillic.cjs` —
   идемпотентный кодемод (класс A — алгоритмический CP1251→UTF-8
   разворот с валидацией; класс B — словарь верифицированных пар из
   чистого предка 9215c87). 24 строковых фикса в 18 файлах;
   `--check` — зелёный.
2. **`Новинка от [object Object]`** — в CREATOR_RESOURCE-шаблоне
   интерполировался объект пользователя вместо вычисленного лейбла
   (баг с 9215c87). FIX: `${creatorLabel}`.
3. **plan007 E-004** — редизайн PLAN-013 вынес счётчик группы поиска
   в pill-элемент: accessible name `Статьи <n>` (без скобок). FIX
   спеки: role-based locator `/^Статьи \d/`.
4. **Validate red** — сирота `logs/tests/.gitkeep` (никем не
   генерируется) триггерила инвариант «tests only in tests/». FIX:
   удалена.

Почему CI был red при зелёной локальной разработке PLAN-013: класс B
проявляется на рендере свежих данных (CI fresh-DB), и изменение заголовка
поиска ушло без обновления E2E-локатора. Результат: **локальный полный
E2E 59/59 passed** (Plan001–Plan010), включая все три ранее упавшие.

## 4. Prisma subsystem (§16–§18, acceptance §49)

Обнаруженное состояние — случайная комбинация (client 7.10 / adapter
8.0.0-rc.8 / CLI 8.0.0-rc.10 / cli-engine 0.2.3). Решение — **вариант C
(осознанная 8 RC-линия)**: репозиторий завязан на 8.x API (contract emit,
db update, orm-адаптеры); downgrade на стабильную 7.x = переписывание
миграционной инфраструктуры. Унифицировано: CLI **8.0.0-rc.13**
(registry `latest`), orm-postgres **8.0.0-rc.9**, cli-engine **0.3.0**
(парная, заявленная в dependencies rc.13), **@prisma/client пин exact
7.10.0** (стабильного 8.x client не существует; §38). Верификация:
contract emit storageHash идентичен (b1dbf93b…), `db update` идемпотентен
на свежей тестовой БД, vitest **392/392**, commerce/ledger/refunds/DRM
regression в составе suite. refs/db.json синхронизирован с committed
snapshot (stale с PLAN-012).

## 5. Waves 1–3 (§46)

- Wave 1 (GREEN): @aws-sdk/* 3.1127→3.1131, zod 4.5→4.6,
  lucide-react 1.41→1.45, nodemailer 10.0.0→10.0.8, @typescript-eslint/*
  8.18→8.70, @types/node 22.20.2, @types/react(-dom) 19.3.0,
  autoprefixer/pg-store refresh.
- Wave 2 (testing/tooling): lockfile-минорные обновления turbo/vitest/
  playwright-линий без смены веток (все стабильны).
- Wave 3 (frontend toolchain): Next 16 / React pairing / TS 7 / Tailwind 4
  — осознанно **DEFER/HOLD** (см. DEPENDENCY-POLICY.md), compatibility
  analysis зафиксирован в матрице.

## 6. Node / pnpm (§9–§10, acceptance §49)

Одна матрица: **Node 22 LTS** (local = CI = Docker `node:22-alpine`;
Docker был 24 — расхождение устранено) и **pnpm 9.15.0** через
`packageManager` (CI pnpm/action-setup@v6 читает его, Docker corepack
пин 9.15.0, corepack локально). Node 20 удалён с GitHub-раннеров
2026-09-16 — в гейтах не используется.

## 7. Dependabot (§5–§7, §55)

.github/dependabot.yml переписан: patch и minor — **группами**
(еженедельно/понедельник, cap 5), major npm — **игнорируются репо-wide**
(контролируемая ручная миграция вместо потока из 9 open PR), github-actions
minor+patch группой (majors — отдельные PR), pip monthly. Security-обновления
идут вне расписания немедленно.

## 8. GitHub Actions (§25–§27, acceptance §50)

Все actions на текущих stable: checkout v7, setup-node v7, setup-python v7,
upload-artifact v7, pnpm/action-setup v6 (убирает живую Node-20
deprecation-аннотацию), gitleaks-action v3 (Node 24 runtime), docker
buildx/login v4, metadata v6, build-push v7. Единая модель
ci.yml (Validate→Contracts→Security→Tests→Module→Site→E2E→Publish)
сохранена; Publish по-прежнему блокируется падением любого gate.

## 9. Native module (§28–§31, acceptance §51)

Linux GCC (canonical release toolchain): cmake preset configure + build +
**ctest 3/3** + standalone DRM `make test` — **ALL TESTS PASSED**
(локально, gcc 15.2 / cmake 4.4). Политики уже формализованы в MODULE.md
§8/§9 (GCC release path / clang report-only / Windows NOT SUPPORTED) —
PLAN-014 подтверждает их актуальность. §31: причина clang-отказа
исследована и документирована (самореференциальные члены `mta::drm::Json`
не инстанцируются libstdc++-14 под clang; fix требует indirection,
меняющего API потребителей) — policy-путь выбран, FIX отдельным
hardening-этапом. Локальная репродукция clang недоступна (нет sudo для
установки компилятора), CI leg продолжает репортить.

## 10. Package boundaries / unused (§36–§37)

- `date-fns` перенесён devDependencies → dependencies (импортируется
  production-кодом reconciliation-jobs).
- `@types/bcryptjs` удалён (deprecated; bcryptjs 3 шипит типы).
- Остальные direct deps проверены grep'ом по импортам — unused не найдено.

## 11. Security (§34, acceptance §52)

`pnpm audit` — 0 уязвимостей (prod и full). gitleaks gate — зелёный.
License audit (§35): 100% prod-графа — пермиссивные (MIT/ISC/Apache/BSD/
BlueOak); исключения MPL-2.0 (axe-core, транзитив) и LGPL-3.0
(@img/sharp-libvips-*, динамическая линковка) — совместимы; AGPL/GPL в
runtime-графе отсутствуют. Политика зафиксирована в DEPENDENCY-POLICY.md.
Секреты: docker build контекст без .env (PLAN-004 G-001); ephemeral-ключи
CI генерируются per-run.

## 12. Docker / production (§42–§43, acceptance §54)

**Найден и исправлен production-баг**: runner-стадия backend.Dockerfile
копировала только workspace-level node_modules без корневого .pnpm-стора —
все ESM-импорты из dist/ были битыми симлинками, контейнер падал при
старте (ERR_MODULE_NOT_FOUND 'dotenv'; CI dist-smoke этого не ловит,
т.к. стор в repo tree существует). Layout приведён к топологии pnpm
workspace; UPLOAD_DIR=/app/uploads (абсолютный, mount-friendly; чинит
EACCES mkdir при другом CWD). Верификация на реальных образах:
production start против БД, /health 200, /ready {database: ok}, SIGTERM
graceful shutdown (exit 0, server_shutdown-лог), fail-fast при отсутствии
секретов сохранён; web standalone-образ отдаёт 200.

## 13. Documentation sync (§44)

Созданы: architecture/TOOLCHAIN.md (normative matrix),
architecture/DEPENDENCY-POLICY.md, reference/DEPENDENCY-MATRIX.md.
Обновлены: architecture/TESTING.md (команда `pnpm test:e2e`, системные
библиотеки Chromium, heartbeat-предусловие, mojibake-политика),
development/CURRENT.md, reference/NEXT-PHASE.md. Эта запись —
completed/PLAN-014.md. .md-политика соблюдена.

## 14. Приёмка

- Vitest: **392/392** (unit+integration+concurrency, свежая БД).
- Type-check: чист (workspaces + tests config).
- Lint: зелёный (существующие warnings без новых).
- Playwright E2E: **59/59** (все спеки, локально, чистый прогон).
- Module: ctest 3/3 + DRM make test ALL PASSED.
- Docker: backend+frontend образы собираются; production runtime
  верифицирован (health/ready/graceful/fail-fast).
- pnpm audit: 0; repair-cyrillic --check: clean; frozen-lockfile install:
  ок.

## 15. Остатки (не блокеры)

1. DEFERRED majors: Next 16 (+ESLint 9/flat config), Express 5,
   TypeScript 7, Tailwind 4, commander 15 / dotenv 17 — каждый отдельной
   волной по DEPENDENCY-POLICY.md.
2. Clang leg: report-only (причина документирована; fix — точечный
   indirection в json.hpp под отдельным DRM-hardening этапом).
3. Windows-сборка модуля: NOT SUPPORTED (MODULE.md §9).
4. Production verification (live domain/real payments) — вне скоупа
   maintenance-плана, как и раньше (блокеры владельца инфраструктуры).
