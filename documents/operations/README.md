# OPERATIONS — эксплуатация MTA Market

Операционные документы платформы: воспроизведение сред, деплой, инциденты,
бэкапы и миграции.

## Карта документов

| Документ | Содержание |
|---|---|
| [DEVELOPMENT.md](DEVELOPMENT.md) | Dev-среда: контейнеры, применение контракт-схемы, запуск dev-серверов, тесты, E2E-пререквизиты. |
| [STAGING.md](STAGING.md) | Staging-стек (compose, порты 3100/3101, `.env.staging`); назначение и текущий статус. |
| [PRODUCTION.md](PRODUCTION.md) | Production runbook PLAN-004: подготовка сервера, secrets, проверки OAuth/payments/media/DRM. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Пайплайн: CI-образы ghcr (SHA-теги), deploy-скрипт (backup → migrate → pull → up --wait → health gate → rollback), nginx-топология, IMAGE_TAG policy. |
| [BACKUP-RESTORE.md](BACKUP-RESTORE.md) | Политика бэкапов (RPO 24h / RTO 4h), restore-процедура, что не восстанавливается. |
| [DATABASE-MIGRATIONS.md](DATABASE-MIGRATIONS.md) | Prisma 8 contract-ORM: quick path (dev) vs formal path (staging/production). |
| [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) | Минимальный честный runbook инцидентов: health, логи, типовые отказы, компрометация ключей, утечка секретов. |

## Окружения и конфигурация

- **Матрица переменных окружения** — корневой
  [.env.example](../../.env.example) (обязательные PROD-значения помечены
  `PROD: REQUIRED`; правила: dev-секреты никогда не переезжают в
  staging/production, каждый секрет генерируется отдельно).
- Реальные `.env`-файлы (`.env`, `.env.staging`, `site/server/.env`,
  `site/web/.env.local`) не трекаются git'ом — только `*.env.example`.
- **Compose-файлы** — `infrastructure/docker/compose/`:

| Файл | Назначение |
|---|---|
| `development.yml` | Postgres 16 + Redis 7 для хост-run dev-стека (:5432, :6379). |
| `tests.yml` | Тестовая БД на :5433 (проект `mta-market-tests`, изолированные volume'ы). |
| `staging.yml` | Staging-топология, порты 3100/3101, те же ghcr-образы, что и production. |
| `production.yml` | Production-стек: postgres, redis, backend, frontend, nginx; IMAGE_TAG пиннит версию. |

- **Nginx** — `infrastructure/nginx/nginx.conf` (+ `templates/`,
  `snippets/`); TLS-сертификаты — `infrastructure/nginx/ssl/`
  (операторские, в git не попадают — `*.pem`/`*.key` в `.gitignore`).
- **Скрипты deployments/maintenance** — `scripts/deployments/`,
  `scripts/maintenance/`, `scripts/database/` (см.
  [DEPLOYMENT.md](DEPLOYMENT.md)).

Связанные области: [development/](../development/README.md) (планы и
состояние), [BACKUP-RESTORE.md](BACKUP-RESTORE.md) для DRM-ключей —
[drm/KEY-MANAGEMENT.md](../drm/KEY-MANAGEMENT.md).
