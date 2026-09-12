# TESTING — архитектура тестирования

Область: централизованное дерево `tests/` (правило PLAN-010: тесты живут
только в корневом `tests/`, не в компонентах).
Статусные числа: [CURRENT](../development/CURRENT.md).

## Дерево `tests/`

```
tests/
├── unit/site/           # чистые юнит-тесты серверного кода (vitest)
│   ├── jwt.test.ts, drm-crypto.test.ts, artifact-crypto.test.ts,
│   ├── artifact-manifest.test.ts, sandbox-static.test.ts, startup-policy.test.ts
├── integration/api/     # HTTP-интеграционные (supertest против createApp)
│   ├── auth-flow, identity, commerce, payments-webhook, ledger-refunds,
│   ├── drm-v2, drm-g6, download-auth, moderation, publication-pipeline,
│   ├── reconciliation, services, app-security, block3-observability,
│   ├── block7, n-block8, o-block8,
│   └── plan005-community/news/reviews/servers, plan006-activity,
│       plan007-content, plan008-follows, plan009-thread-follow,
│       plan010-analytics, plan001-e2e, identity-providers,
│       payments-tbank, payments-crypto, auth-plan016
├── e2e/                 # Playwright: браузер против живых dev-серверов
│   ├── authentication/plan001.spec.ts
│   ├── marketplace/plan003.spec.ts, plan010.spec.ts
│   ├── servers/plan005.spec.ts
│   ├── content/plan006.spec.ts, plan007.spec.ts
│   ├── community/plan008.spec.ts, plan009.spec.ts
│   └── plan016/shell.spec.ts (shell/темы/поиск/checkout/identities)
├── module/              # тесты модуля (см. ниже)
├── fixtures/            # общие фикстуры (сейчас пуст)
├── tools/
│   ├── helpers/db-reset.ts, zip.ts
│   └── playwright/helpers.ts
└── concurrency/        # exactly-once фундамент (PLAN-011 §12):
                          commerce/parallel-checkout, ledger/parallel-settlement,
                          payment/duplicate-webhook — 5 тестов, все проходят)
```

## Раннеры

### Vitest (корневой `vitest.config.ts`)

- include: `tests/unit/**`, `tests/integration/**`, `tests/concurrency/**`;
  `fileParallelism: false` (интеграционные сьюты делят один PostgreSQL и
  уничтожили бы фикстуры друг друга), таймауты 30 c.
- Alias'ы: `@server` → `site/server/src`, `@tests` → `tests` — серверные
  модули импортируются без относительных цепочек.
- env: `DATABASE_URL` = `TEST_DATABASE_URL` (по умолчанию
  `postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public`),
  тестовый `JWT_SECRET`, `NODE_ENV=test`, `REDIS_URL` (6379, мгновенный отказ
  — rate limiter fail-open), `EMAIL_ENABLED/YOOKASSA_ENABLED/S3_ENABLED=false`,
  `CORS_ORIGINS=http://localhost:3000`, лимиты `*_RATE_LIMIT_MAX=10000`
  (пер-аккаунтный `userRateLimit` отключён при `NODE_ENV=test`).
- Команды: `pnpm test` (run), `pnpm test:watch`, `pnpm test:concurrency`.

### Playwright (корневой `playwright.config.ts`)

- `testDir: tests/e2e`, `workers: 1`, `fullyParallel: false`, `retries: 0`,
  таймаут теста 120 c / expect 15 c; `baseURL` = `E2E_BASE_URL` (по умолчанию
  `http://localhost:3000`); headless Chromium; screenshot only-on-failure,
  trace retain-on-failure. Команда: `pnpm test:e2e`.
- Локальный запуск Chromium требует системных библиотек (libnspr4 и др.);
  при установке без root — `playwright install-deps` либо LD_LIBRARY_PATH на
  заранее распакованные библиотеки.
- Тесты прогоняют **продуктовые сценарии в браузере** на живых dev-серверах —
  acceptance-уровень (не только HTTP).

### CTest + standalone (модуль)

- `ctest --preset <platform>`: `sdk_tests` (embedded Lua harness против
  `tests/module/runtime/scripts/010…096*.lua`), `module_config_parse`,
  `module_config_rejects_garbage` (парсер `module.toml`).
- Standalone DRM: `make -f module/src/drm/Makefile test`
  (`tests/module/drm/main.cpp`): канонический JSON (байт-матч с сервером),
  Ed25519, AEAD, key store, HTTP client, lease-верификация.
- Интеграционные Lua-ресурсы: `tests/module/integration/` (на живом MTA-сервере,
  процедура в [INTEGRATION](../module/INTEGRATION.md)).

## Подключение БД

1. Поднять тестовый PostgreSQL:
   `docker compose -f infrastructure/docker/compose/tests.yml up -d`
   (контейнер `mta-market-postgres-test`, **порт 5433**, postgres/postgres;
   Redis тесты переиспользуют dev-инстанс 6379 — `TEST_REDIS_URL`).
2. Схема применяется из контракта: `pnpm db:emit` (генерация клиента) +
   `prisma db update` против тестовой БД (quick-path допустим для тестов).
3. Сброс состояния между сьютами: `resetTestEntities()`
   (`tests/tools/helpers/db-reset.ts`) — удаляет сущности фиксированного
   диапазона тестовых user id (`550e8400-e29b-41d4-a716-44665544…`) в
   FK-безопасном порядке; каждая операция идемпотентна и устойчива к
   упавшим прогонам.

## Предпосылки E2E

1. **Dev-серверы запущены**: web :3000 и API :3001 (`pnpm dev`) + postgres
   (dev-compose :5432) и redis (:6379).
2. **ADMIN-аккаунт**: `pnpm test:e2e:admin` →
   `site/server/scripts/dev-admin.ts --email e2e-admin@mtamarket.local …`
   (создаёт или повышает пользователя до ADMIN; в production отказывается
   работать без `ALLOW_ADMIN_BOOTSTRAP=true`).
3. **Seed-данные** (по необходимости): `site/server/scripts/seed-plan003.ts`
   (маркетплейс), `site/server/scripts/seed-plan005.ts` (10 серверов,
   12 пользователей, 7 категорий, новости/обновления/отзывы; пароль seed-пользователей
   `seed-password-123`), `scripts/dev-heartbeat.ts` (держит серверы онлайн —
   должен быть запущен и успеть протикаться **до** старта спеков, проверяющих
   онлайн-агрегаты, например plan006).
4. **Mojibake-политика**: исходники должны быть чисты от двойного
   кодирования; проверка — `node scripts/development/repair-cyrillic.cjs
   --check` (exit 1 при остатках; сам кодемод описан в
   [DEPENDENCY-POLICY](../architecture/DEPENDENCY-POLICY.md) и истории
   коммитов PLAN-014).
4. Приложение считает лимиты по открытым env'ам — в dev установлены
   ослабленные значения; E2E идут с дефолтными dev-лимитами.

## Текущие объёмы (PLAN-016, 2026-09-12)

- Backend-тесты (vitest: unit + integration): **427/427**; файлов: 8 unit +
  35 integration (включая PLAN-016: identity-providers, payments-tbank,
  payments-crypto, auth-plan016, token-crypto, startup-policy).
- Playwright browser E2E: **59 прежних + 9 plan016** (D-013: спеки plan001/
  plan016 теперь чистят созданные в ране сущности); накопительный ряд:
  12 → 25 → 37 → 42 → 47 → 52 → 56 → 59 → 68.
- Инкременты планов и миграционные пакеты — [CURRENT](../development/CURRENT.md).

## CI-гейты

Workflow-каталог `.github/workflows` наполнен с PLAN-011 (ci, tests, e2e,
validate, contracts, site, module, security, release). Описания гейтов (CI job
`test` с
`contract emit && prisma db update` на чистой БД, `ci.yml` без `|| true`,
production-путь миграций по факту пакета в PR) —
[PLAN-004](../development/completed/PLAN-004.md) и
[DATABASE-MIGRATIONS](../operations/DATABASE-MIGRATIONS.md).
