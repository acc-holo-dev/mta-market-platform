status: current
version: 1.0
last_verified: 2026-09-11

# DEVELOPMENT — воспроизведение среды разработки

Процедура развёртывания dev-среды monorepo `mta-market-platform` (обновление
раздела «Воспроизведение среды разработки и проверки» из
[development/README.md](../development/README.md) под новые пути).
Требования: Node ≥ 20, pnpm ≥ 9, Python ≥ 3.10 (утилиты запуска), Docker
Engine + compose plugin, CMake 3.27+ / Ninja / компилятор C++20 (модуль),
OpenSSL 3.x.

## 1. Инфраструктурные сервисы

```sh
docker compose -f infrastructure/docker/compose/development.yml up -d
# postgres :5432 (mtamarket/dev_password), redis :6379
```

Приложение в dev работает на хосте, не в контейнерах: API — `site/server`
(:3001), frontend — `site/web` (:3000). Контейнеризуется только stateful
инфраструктура (см. комментарий в `infrastructure/docker/compose/development.yml`).

## 2. БД: применить контракт-схему

```sh
cd site/server
# DATABASE_URL берётся из site/server/.env (скопируйте из .env.example)
npx prisma contract emit && npx prisma db update --confirm mtamarket
```

Схема — единственный источник `site/server/src/prisma/contract.prisma`;
миграции и formal path для staging/production —
[DATABASE-MIGRATIONS.md](DATABASE-MIGRATIONS.md). `db update` (quick path)
разрешён **только** на локальной dev-БД.

## 3. Запуск dev-серверов

```sh
# из корня репозитория
pnpm dev              # turbo: server :3001 + web :3000
# либо раздельно:
pnpm dev:server       # Express API  :3001
pnpm dev:web          # Next.js web  :3000
```

`python3 startup.py dev` — единый dev-раннер (корень репозитория):
infra → schema → backend → web → URL-ы; `startup.py doctor` — проверка
окружения. Проверен на этой машине (doctor PASS, dev стартует).
`pnpm dev` / раздельные фильтры — эквивалент по-компонентно.

## 4. Тесты

```sh
# тестовая БД :5433 (изолированный compose-проект)
docker compose -f infrastructure/docker/compose/tests.yml up -d

# прогон из корня (централизованное дерево tests/ — PLAN-010 Rule 002)
pnpm test             # vitest: tests/unit + tests/integration
```

`vitest.config.ts` по умолчанию ждёт PostgreSQL на
`127.0.0.1:5433` (postgres/postgres) — переопределяется `TEST_DATABASE_URL`;
Redis для тестов — dev-инстанс :6379 (override `TEST_REDIS_URL`). Локальные
зеркала наборов с относительными импортами лежат в `site/server/tests/`.

Качество:

```sh
pnpm type-check       # turbo + tsconfig.test.json
pnpm format:check
pnpm --filter @mta-market/web build   # production build web
```

## 5. Модуль (module/)

```sh
cd module
cmake --preset linux-gcc          # configure (build/module/linux-gcc)
cmake --build --preset linux-gcc  # сборка модуля
```

DRM-подсистема без MTA SDK (быстрая проверка):

```sh
make -f module/src/drm/Makefile test   # из корня; ожидается ALL TESTS PASSED
```

Linux x64 — верифицированная платформа; Windows-сборка модуля остаётся
отдельной задачей (blocker PLAN-004, унаследован в PLAN-005).

## 6. E2E (браузер, Playwright)

Пререквизиты: запущенные API :3001 + web :3000 + Postgres/Redis (п.1–3).

```sh
# admin-аккаунт для разработки/админ-E2E
pnpm test:e2e:admin
# dev-админ по желанию (отказ в NODE_ENV=production):
pnpm --filter @mta-market/server exec tsx scripts/dev-admin.ts \
  --email admin@dev.local --username admin --password 'dev-password-123'

# dev-датасет сообщества/серверов + «живой онлайн» (симулятор интеграции)
pnpm --filter @mta-market/server exec tsx scripts/seed-plan005.ts
pnpm --filter @mta-market/server exec tsx scripts/dev-heartbeat.ts

# прогон
pnpm e2e                 # playwright: tests/e2e (Chromium, 1 worker)
```

Платежи в dev: `YOOKASSA_*` опциональны — иначе используется
dev-completion `POST /payments/:id/simulate`.

## 7. Переменные окружения

- Матрица — корневой [.env.example](../../.env.example) (DEVELOPMENT /
  STAGING / PRODUCTION, пометки `PROD: REQUIRED`).
- Компонентные примеры: `site/server/.env.example` (обязательны
  `DATABASE_URL`, `JWT_SECRET`; DRM: `DRM_SERVER_PRIVATE_KEY`,
  `DRM_MASTER_KEY`, `ARTIFACT_SIGNING_PRIVATE_KEY`), `site/web/.env.example`.
- Реальные `.env`/`.env.local` **не трекаются git'ом** — коммитятся только
  `*.env.example` (корневой `.gitignore`).
