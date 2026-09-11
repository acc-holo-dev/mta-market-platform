# SYSTEM — архитектура единой платформы

Область: монорепо `mta-market-platform` в целом. Продуктовое видение и
терминология: [PROJECT](../product/PROJECT.md),
[PRODUCT-ARCHITECTURE](../product/PRODUCT-ARCHITECTURE.md).
API-поверхность: [API](../api/README.md).

## Состав монорепо

| Компонент | Путь | Технологии | Назначение |
|---|---|---|---|
| Web | `site/web` | Next.js 15.5 (app router), React 19, axios, @tanstack/react-query, zustand, Tailwind | SPA-фронтенд маркетплейса/сообщества; структура — [SITE](SITE.md) |
| Server | `site/server` | Node 20+, Express 4, Prisma 8 contract ORM (@prisma/orm-postgres), Redis (ioredis), Zod, bcryptjs | REST API, домены, DRM-сервер v2, jobs; детали — [SITE](SITE.md) |
| Module | `module/` | C++20, CMake 3.27+, Lua 5.1.5 (vendored) | Нативный модуль MTA:SA: SDK (Lua-биндинги, рантайм) + DRM client + market integration client; [MODULE](MODULE.md) |
| Contracts | `contracts/` | — | Зарезервирован под межкомпонентные контракты; **сейчас пуст** — единственный замороженный контракт живёт в `documents/development/reference/` ([DRM](../api/DRM.md)) |
| Tests | `tests/` | vitest, Playwright, CTest-харнессы | Централизованные тесты всех компонентов; [TESTING](TESTING.md) |
| Documents | `documents/` | Markdown | Продукт, разработка, операции, ADR, история |
| Infrastructure | `infrastructure/` | docker compose, nginx, Grafana/Prometheus/Alerts | Топология запуска; nginx — `infrastructure/nginx/nginx.conf`, compose — `infrastructure/docker/compose/{development,production,staging,tests}.yml` |
| Config | `config/` | — | Корневые конфиги инструментов |

Инструменты сборки: pnpm workspaces (pnpm 9) + Turborepo (`turbo.json`), корневой
`package.json` содержит скрипты `dev|build|test|e2e|db:emit|test:e2e:admin`.
Модуль собирается CMake (пресеты `base|win-msvc|win-mingw|linux-gcc`).

## Поток данных (ASCII)

```
                        ┌────────────────────────────── browsers ─────────────────────────────┐
                        │  site/web (Next.js :3000)  ── axios: Bearer + HttpOnly refresh      │
                        └────────────┬────────────────────────────┬───────────────────────────┘
                                     │ (prod: тот же origin,      │ (dev: кросс-домен CORS
                                     │  /api/* → стрип префикса)  │  или Next-rewrite /api)
                            ┌────────▼────────────────────────────▼────────┐
                            │ nginx (TLS, gzip, edge rate limits, CSP)     │  infrastructure/nginx/nginx.conf
                            └───────┬─────────────────────────┬────────────┘
                                    │ /  (Next)               │ /api/ → proxy_pass http://backend/ (стрип /api)
                        ┌───────────▼──────────┐   ┌──────────▼───────────────────┐
                        │ frontend :3000       │   │ backend :3001 (site/server)  │
                        │ (Next.js standalone) │   │ Express: routes → lib → ORM  │
                        └──────────────────────┘   └───┬──────────┬──────────┬────┘
                                                       │          │          │
                                              ┌────────▼───┐ ┌────▼────┐ ┌───▼──────────────┐
                                              │ PostgreSQL │ │ Redis   │ │ S3 / uploads/    │
                                              │ (contract  │ │ ratelimit│ │ артефакты, media │
                                              │  schema)   │ │ activity │ │ (short-lived URL)│
                                              └────────────┘ └─────────┘ └──────────────────┘

  MTA-сервер (модуль) ── HTTPS ──► backend: /drm/v2/* (активация/lease/DEK)
                                  /integration/heartbeat (агрегаты онлайна)
                                  /integration/review-tokens (одноразовые токены)
        игрок ── браузер ──► claim токена → отзыв сервера (SERVERS, SERVERS.md)
```

Отдельные направления чтения/записи:

- **Покупка**: web → `POST /purchases` → `POST /payments/create` → YooKassa →
  `POST /payments/webhook` → atomic completion → ledger → лицензия →
  DRM-активация ([COMMERCE](../api/COMMERCE.md), [DRM](../api/DRM.md)).
- **Community loop**: heartbeat сервера → `/activity` (кэш 45 c) → Home;
  подписки → уведомления → дашборд ([CONTENT](../api/CONTENT.md)).

## Production-топология (docker compose)

`infrastructure/docker/compose/production.yml`, сеть `mta-network`:

| Сервис | Образ | Порт | Примечания |
|---|---|---|---|
| nginx | nginx:alpine | 80/443 | монтирует `infrastructure/nginx/nginx.conf` + ssl; healthcheck `/health` |
| frontend | ghcr.io/<repo>/frontend:$IMAGE_TAG | 3000 | `NEXT_PUBLIC_API_URL` задаёт режим API-доступа |
| backend | ghcr.io/<repo>/backend:$IMAGE_TAG | 3001 | healthcheck бьёт `/ready` (реальный DB-пинг); volumes `uploads_data:/app/uploads`; env: JWT, DRM (`DRM_SERVER_PRIVATE_KEY`, `DRM_MASTER_KEY`, `ARTIFACT_SIGNING_PRIVATE_KEY`), S3, YooKassa, SMTP, rate limits, CORS/cookies, `SERVER_MONITORING_*` |
| postgres | postgres:16-alpine | 5432 (внутри сети) | volume `postgres_data`, healthcheck `pg_isready` |
| redis | redis:7-alpine | 6379 (внутри) | volume `redis_data` |

Порядок зависимостей: backend ждёт здоровых postgres/redis; nginx ждёт
backend+frontend. `IMAGE_TAG` пиннинг обязателен (`:latest` — только локальный
дефолт). Dev-стек (`development.yml`): postgres 5432 и redis 6379 наружу,
backend/frontend запускаются процессами хоста (`pnpm dev`).
Production-операции: [PRODUCTION](../operations/PRODUCTION.md),
миграции: [DATABASE-MIGRATIONS](../operations/DATABASE-MIGRATIONS.md),
бэкапы: [BACKUP-RESTORE](../operations/BACKUP-RESTORE.md).

## Соответствие трёх legacy-репозиториев

Имена legacy-репозиториев — в [PROJECT](../product/PROJECT.md)
(«Репозитории и зачем каждый нужен»); здесь — фактическое размещение в
монорепо:

| Legacy (см. PROJECT.md) | В монорепо | Что переехало |
|---|---|---|
| legacy-репозиторий сайта | `site/` | серверная часть legacy (`apps/…`, ныне каталог `server`) → `site/server`, фронтенд legacy (каталог `web`) → `site/web` |
| legacy-репозиторий модуля | `module/` | `source/` → `module/src`, `other/third_party` → `module/third_party`, `other/tools` → `module/tools` |
| legacy-репозиторий документации | `documents/` | продукт (`documents/product`), development plans, operations |

Связанные исторические документы:

- Права владения компонентами и правила независимых релизов (заморожено):
  [old_repository-contract](../development/reference/old_repository-contract.md).
- Матрица совместимости site ↔ REST ↔ DRM protocol ↔ module:
  [old_compatibility-matrix](../development/reference/old_compatibility-matrix.md).
- `documents/history/MIGRATION.md` — карта переезда трёх репозиториев в
  монорепо (PLAN-011): старый путь → новый путь + действие для каждого
  перенесённого файла/каталога.
- `documents/history/V1-TO-V2-MIGRATION.md` — миграция **SDK модуля** V1→V2
  (не репозиторная): раскладка каталогов, userdata, scheduler.

## Запуск разработки (кратко)

```bash
docker compose -f infrastructure/docker/compose/development.yml up -d  # postgres 5432, redis 6379
pnpm install
pnpm dev            # turbo: web :3000 + server :3001 (tsx watch)
pnpm test           # vitest: unit + integration (нужен тестовый PG :5433 — tests.yml)
pnpm e2e            # Playwright против живых dev-серверов
```

Тестовая инфраструктура подробно: [TESTING](TESTING.md).
