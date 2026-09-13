# TESTING — архитектура тестирования

Область: централизованное дерево `tests/` (тесты живут только в корневом
`tests/`, не в компонентах). Тесты описывают **поведение продукта**, а не
исторические планы разработки; имена файлов и describe — доменные
(PLAN-017 §26).

Единая точка входа — `python3 startup.py test <tier>`; нижеприведённые
прямые команды — алиасы для отладки.

## Уровни (tier model, L0–L4)

| Уровень | Что запускает | Когда | Вес |
|---------|---------------|-------|-----|
| **L0 fast** | `startup.py test unit` — чистые unit (серверная логика без БД) | на каждый чих при разработке; самые дешёвые | ~4 c |
| **L1 normal** | `startup.py test integration` — unit + integration + concurrency на изолированной тест-БД (уничтожается после прогона) | перед коммитом | ~1 мин |
| **L2 affected** | `startup.py test affected` — vitest `--changed <ref>`: только сьюты, затронутые изменениями | на ветке с крупным диффом | пропорционально диффу |
| **L3 full** | `pnpm exec vitest run` + `startup.py test e2e` — весь vitest + браузерные E2E на живых dev-серверах | перед PR / слиянием | ~5–15 мин |
| **L4 release** | `startup.py test release` — build + локальный production-like стек + smoke | перед релизом/тегом | ~10–20 мин |

## Дерево `tests/`

```
tests/
├── unit/site/            # чистые юнит-тесты серверного кода (vitest)
│   ├── jwt, drm-crypto, artifact-crypto, artifact-manifest,
│   ├── sandbox-static, startup-policy, token-crypto
├── integration/api/      # HTTP-интеграционные (supertest против createApp)
│   ├── auth/             # login-session, providers-discovery, identity-link,
│   │                     # identity-providers
│   ├── commerce/         # checkout, purchase-journey, free-flow-authz,
│   │                     # ledger-refunds, reconciliation, services-adjacent,
│   │                     # payments-webhook-{yookassa,tbank,crypto}
│   ├── community/        # forum, server-reviews, creator-follow, thread-follow
│   ├── content/          # articles, server-news
│   ├── licenses/         # drm-v2, drm-hardening, download-auth
│   ├── marketplace/      # publication-pipeline, compatibility
│   ├── moderation/       # moderation
│   ├── platform/         # activity, analytics, app-security, contracts,
│   │                     # observability
│   ├── servers/          # management
│   └── services/         # orders
├── e2e/                  # Playwright: браузер против живых dev-серверов
│   ├── auth/journey, marketplace/{catalog,analytics-privacy},
│   ├── servers/discovery, content/{dashboard-activity,articles},
│   ├── community/{creator-follow,thread-follow}, platform/shell
├── concurrency/          # exactly-once фундамент: checkout/settlement races,
│                         # duplicate webhook, parallel refunds, dispute CAS
├── module/               # тесты нативного модуля (ctest/make/unittest)
└── tools/
    ├── helpers/          # db-reset (FK-safe сброс), payments-harness,
    │                     # oauth-harness, purchase-journey, zip
    └── playwright/       # helpers, fixtures, cleanup, global-teardown
```

## Раннеры

### Vitest (корневой `vitest.config.ts`)

- include: `tests/unit/**`, `tests/integration/**`, `tests/concurrency/**`;
  `fileParallelism: false` (интеграционные сьюты делят один PostgreSQL и
  уничтожили бы фикстуры друг друга), таймауты 30 c.
- Alias'ы: `@server` → `site/server/src`, `@tests` → `tests`.
- env: `DATABASE_URL` = `TEST_DATABASE_URL` (по умолчанию
  `postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public`),
  тестовый `JWT_SECRET`, `NODE_ENV=test`, `REDIS_URL` (6379, мгновенный отказ
  — rate limiter fail-open), `EMAIL_ENABLED/YOOKASSA_ENABLED/S3_ENABLED=false`,
  `CORS_ORIGINS=http://localhost:3000`, лимиты `*_RATE_LIMIT_MAX=10000`
  (пер-аккаунтный `userRateLimit` отключён при `NODE_ENV=test`).
- Команды: `pnpm test` (полный run), `pnpm exec vitest run tests/unit` (L0),
  `pnpm exec vitest run --changed HEAD` (L2), `pnpm test:watch`,
  `pnpm test:concurrency`.

### Playwright (корневой `playwright.config.ts`)

- `testDir: tests/e2e`, `workers: 1`, `fullyParallel: false`, `retries: 0`,
  таймаут теста 120 c / expect 15 c; `baseURL` = `E2E_BASE_URL` (по умолчанию
  `http://localhost:3000`); headless Chromium; screenshot only-on-failure,
  trace retain-on-failure; `globalTeardown` — канальная очистка
  `e2e_*`-пользователей и `e2e-*`-сущностей (см. «Гигиена данных»).
- Команда: `python3 startup.py test e2e` (поднимет стек, просеет admin) или
  вручную `pnpm test:e2e` на уже запущенных dev-серверах.

### CTest + standalone (модуль)

- `ctest --preset <platform>`: `sdk_tests` (embedded Lua harness против
  `tests/module/runtime/scripts/010…096*.lua`), `module_config_parse`,
  `module_config_rejects_garbage`.
- Standalone DRM: `make -f module/src/drm/Makefile test` — канонический JSON,
  Ed25519, AEAD, key store, lease-верификация.
- Команда: `python3 startup.py module` (Linux); Windows — не поддерживается
  (MODULE.md), честно сообщается doctor'ом.

## Подключение БД

- L0 — БД не нужна. L1/L3 — `startup.py test integration` поднимает
  изолированный тест-стек (`infrastructure/docker/compose/tests.yml`,
  проект `mta-market-tests`, порт по умолчанию 5433, переопределяется
  `TEST_DB_HOST_PORT`) и **уничтожает его после прогона** (тома одноразовые;
  `--keep` сохраняет для отладки). Постоянный занятый 5433 не требуется.
- Схема применяется из контракта: `prisma contract emit` + `db update`
  против тестовой БД (quick-path допустим только для тестов/dev).
- Сброс состояния между сьютами: `resetTestEntities()`
  (`tests/tools/helpers/db-reset.ts`) — FK-безопасный порядок удалений,
  идемпотентен. Dev/test изоляция: отдельные имена контейнеров, томов,
  сети и портов; dev-БД (5432) тестами никогда не перезаписывается.

## Гигиена E2E-данных

- Все спеки создают пользователей с префиксом `e2e_` (RUN-суффикс от
  `Date.now()` исключает коллизии параллельных прогонов) и чистят за собой
  через канальный `cleanupEntities` (`tests/tools/playwright/cleanup.ts`):
  FK-безопасный порядок (финансы → заказы → покупки → ресурсы → серверы →
  пользователи), `e2e-admin` защищён от удаления.
- `globalTeardown` подчищает остатки по префиксам (`e2e_*`, `e2e-%`) даже
  после упавшего прогона — накопления тестовых сущностей быть не должно.

## Предпосылки E2E (ручной запуск)

1. Dev-серверы: `python3 startup.py dev` (web :3000, API :3001, PG, Redis).
2. Admin-аккаунт: `pnpm test:e2e:admin` (e2e-admin@mtamarket.local; в
   production отказывается работать без `ALLOW_ADMIN_BOOTSTRAP=true`).
3. Seed-данные по необходимости: `python3 startup.py db seed` (маркетплейс,
   серверы, услуги) + `--heartbeat` (симулятор «живого» онлайна — запустить
   заранее для спеков с онлайн-агрегатами).
4. Mojibake-политика: исходники чисты от двойного кодирования —
   `node scripts/development/repair-cyrillic.cjs --check` (CI-гейт).

## Изоляция повторных прогонов

Требование: два прогона подряд дают одинаковое состояние. Обеспечивают:
одноразовые тест-тома (L1), фиксированный диапазон тест-UUID + FK-сброс
(vitest), RUN-суффиксы + afterAll-очистка + globalTeardown (E2E). Проверка
— финальная матрица прогоняет полный suite дважды (CURRENT.md).

## CI-гейты

`ci.yml` — единственная точка входа push/PR; повторно используемые воркфлоу:
`validate` (структура репо), `contracts` (синтаксис contracts/),
`security` (gitleaks + audit), `tests` (vitest на GH-services),
`module` (ctest + make + unittest; Windows best-effort), `site` (lint +
type-check + сборки + runtime smoke), `e2e` (браузер). Публикация образов —
только после всех гейтов; release-тег перегоняет гейт как защиту перед
публикацией релиза.
