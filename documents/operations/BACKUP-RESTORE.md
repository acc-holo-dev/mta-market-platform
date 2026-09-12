# Backup & Restore — Policy and Drill (PLAN-004 C-004/C-005, Q-001..Q-005)

Статус: действующая политика (PLAN-004).
Инструмент: `scripts/database/backup.sh` (вызывается автоматически из
`scripts/deployments/deploy.sh` перед каждой миграцией).

## 1. Backup policy (C-004, Q-001)

| Вопрос | Ответ |
|---|---|
| WHAT | PostgreSQL dump + uploads (named volume `uploads_data`) + `.env` (только AES-256-шифрованный) + SHA256SUMS-манифест |
| WHEN | (а) автоматически перед каждым production deploy; (б) по расписанию — nightly cron: `0 4 * * * cd /srv/mta-market-platform && ./scripts/database/backup.sh >> backups/cron.log 2>&1` |
| WHERE | `<repo>/backups/` на сервере; для durable-хранения — синхронизация каталога в S3/R2 ведро вне прод-аккаунта (rclone/boto), performed outside the script |
| HOW LONG | retention 30 дней (`BACKUP_RETENTION_DAYS`), ротация автоматическая |
| WHO CAN ACCESS | только операторы сервера; `.env`-бэкап зашифрован `BACKUP_ENCRYPTION_KEY`; ключ бэкапов хранится вне сервера (password manager), доступ — 2 человека |
| ENCRYPTION | `.env` — AES-256-CBC/PBKDF2; SQL-дамп — на усмотрение оператора (содержит хэши паролей, не plaintext); рекомендовано шифровать каталог backups при выгрузке в облако |

RPO = 24h (nightly + pre-deploy backup). RTO = 4h (см. §4).

## 2. Restore procedure (C-005/Q-002) — drill проверяется на staging-клоне

Полный drill (НЕ на живой production БД):

```bash
# 1. Поднять чистый staging (infrastructure/docker/compose/production.yml с staging .env)
./scripts/deployments/deploy.sh staging <last-good-tag>

# 2. Остановить backend (чтобы не писал в клонируемую БД)
docker compose -f infrastructure/docker/compose/production.yml stop backend

# 3. Проверить контрольные суммы бэкапа
cd backups && sha256sum -c <(grep <date> SHA256SUMS)

# 4. Восстановить БД
docker compose -f infrastructure/docker/compose/production.yml exec -T postgres \
  psql -U mtamarket -d mtamarket < backups/db_backup_<date>.sql

# 5. Восстановить uploads
docker run --rm -v mta-market-platform_uploads_data:/dst \
  -v $(pwd)/backups:/src:ro alpine sh -c \
  "cd /dst && tar -xzf /src/uploads_backup_<date>.tar.gz"

# 6. Вернуть backend, проверить приложение
docker compose -f infrastructure/docker/compose/production.yml up -d backend
# 7. Acceptance: логин, Marketplace, resource detail, медиа из хранилища,
#    DRM activate (lease выдаётся), покупка test-картой sandbox.
```

Restore считается успешным только при прохождении acceptance-пунктов.

## 3. Object storage recovery (Q-003)

- Media (covers/screenshots) лежат в S3-префиксе `media/`, артефакты — в
  приватном бакете по object key (`resources/<hex>.<ext>`). Восстановление
  бакета — версионирование бакета + репликация в отдельный аккаунт
  (конфигурация на стороне провайдера, см. runbook §5).
- Ledger/DB — источник истины о том, какие объекты должны существовать;
  после восстановления storage сверяется наличие объектов для активных
  версий (job-аудит — ручной шаг drill).

## 4. Disaster scenario (Q-004)

`server lost → new server`:

1. Новый хост: docker + compose, рестор `.env` из зашифрованного бэкапа
   (`BACKUP_ENCRYPTION_KEY`), выдать SSL-сертификаты (reissue).
2. Поднять Postgres/Redis (`docker compose up -d postgres redis`).
3. Восстановить БД из последнего backup (§2 шаги 3–4).
4. Восстановить uploads volume из tar-бэкапа / пересоздать бакет из реплики.
5. `./scripts/deployments/deploy.sh production <last-good-tag>` (deploy.sh сам
   прогонит миграции — на восстановленной схеме они no-op).
6. Acceptance как в §2 шаг 7.
7. Целевые значения первой production версии: **RTO 4 часа, RPO 24 часа**.

## 5. Что НЕ восстанавливается backup'ом

- `DRM_MASTER_KEY` при потере (если не восстановлен `.env`) → все
  зашифрованные версии артефактов невосстановимы. Ключ хранится в `.env`,
  который бэкапится только в зашифрованном виде — храните
  `BACKUP_ENCRYPTION_KEY` отдельно от сервера.
- Redis — намеренно ephemeral (только rate-limit счётчики, M-003).
