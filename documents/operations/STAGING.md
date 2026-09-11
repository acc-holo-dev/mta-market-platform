status: current
version: 1.0
last_verified: 2026-09-11

# STAGING — предпродакшн-стек

## Файлы и параметры

- Compose: `infrastructure/docker/compose/staging.yml` — та же топология,
  что у production (`production.yml`): postgres 16 + redis 7 + backend +
  frontend, отдельная сеть `mta-network` и собственные volume'ы.
- Имена контейнеров/порты выбраны staging-уникальными, чтобы стек жил на
  одном хосте с локальной production-репетицией:
  - `mta-market-staging-postgres` (без внешнего порта),
  - `mta-market-staging-redis` (без внешнего порта),
  - `mta-market-staging-backend` → **:3101** (внутри 3001),
  - `mta-market-staging-frontend` → **:3100** (внутри 3000).
- Отдельный env-файл: `.env.staging` (не трекается git'ом):

  ```sh
  cp .env.example .env.staging   # затем заполнить STAGING-значения
  docker compose -f infrastructure/docker/compose/staging.yml \
    --env-file .env.staging up -d
  ```

  Правила те же, что для production: dev-секреты и dev-лимиты не
  переиспользуются (см. [.env.example](../../.env.example)); redis-флаги
  (`REDIS_ENABLE_OFFLINE_QUEUE=false`), `LOG_FORMAT=json`,
  `NODE_ENV=production` зашиты в compose.
- **Те же образы, что и production**: `ghcr.io/${GITHUB_REPOSITORY}/backend`
  и `/frontend`, версия пиннится `IMAGE_TAG` (из пайплайна релиза).
  Staging никогда не собирает «свой» код — он проверяет артефакт,
  который уйдёт в production.

## Для чего staging

1. **Pre-prod верификация релиза**: образ с SHA-тегом поднимается в
   production-топологии до боевого деплоя; миграции прогоняются формальным
   путём ([DATABASE-MIGRATIONS.md](DATABASE-MIGRATIONS.md)).
2. **Restore drills**: проверка бэкап/восстановления выполняется на
   staging-клоне, не на живой БД ([BACKUP-RESTORE.md §2](BACKUP-RESTORE.md)).
3. Приёмка цепочки, которую нельзя щупать в dev: S3-контур, webhook'и
   платежей (sandbox-провайдер), DRM-цикл против production-конфигурации.

## Честный статус

**Хостинга/инстанса staging сейчас не существует** — есть compose-файл и
процедура (2026-09-11). Восстановительные drills и pre-prod деплои до сих
пор выполнялись ad-hoc на локальных репетициях (PRODUCTION.md PLAN-004 —
«restore drill проверяется на staging-клоне»; фактический drill боевого
контура остаётся blocker'ом PLAN-004..010). Поднятие постоянного
staging-сервера — операционное решение владельца инфраструктуры.
