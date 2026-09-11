status: current
version: 1.0
last_verified: 2026-09-11

# DEPLOYMENT — пайплайн деплоя

Пайплайн доставки: CI собирает иммутабельные образы с SHA-тегами, деплой
идёт скриптом с обязательным backup → migrate → health-gate и автоматическим
rollback'ом. Политики унаследованы от PLAN-004 (K-003/K-004/K-006/K-007).

## 1. CI: сборка образов

- Пайплайн собирает и публикует в ghcr два образа:
  `ghcr.io/<org>/<repo>/backend` (из `site/server/Dockerfile`) и
  `ghcr.io/<org>/<repo>/frontend` (из `site/web/Dockerfile`).
- Теги (metadata-action): **полный SHA коммита** (`type=sha,format=long` —
  однозначная коммит→образ провенанс, K-003), ветка, semver, `latest`
  только с default-ветки.
- **Честный статус**: рабочий tree monorepo на 2026-09-11 **не содержит
  workflow-файлов** (`.github/` пуст) — пайплайн описан по проверенной
  реализации CI прежнего (до миграции) репозитория сайта, workflow
  восстанавливается из его git-истории (см.
  [history/LEGACY.md](../history/LEGACY.md)); целевое имя в monorepo —
  `site.yml`. Перенос workflow — незавершённая часть миграции PLAN-011.

## 2. Deploy-скрипт

Реализация: `scripts/deployments/deploy.sh` (перенесён из mta-market-site;
исходная версия сохранена в git-истории прежнего репозитория, см.
[history/LEGACY.md](../history/LEGACY.md)). Flow (C-001):

```text
backup  →  migrate  →  pull  →  up -d --wait  →  health gate  →  (success | rollback)
```

1. **Backup** (`scripts/backup.sh`) перед любой миграцией; провал бэкапа
   прерывает деплой («нет бэкапа — нет миграции»).
2. **Migrate**: `npx prisma db migrate` внутри backend-образа против живой
   БД (formal path, пакеты `site/server/migrations/app/`); провал миграции
   прерывает деплой (бэкап уже снят).
3. **Pull + up**: `docker compose -f infrastructure/docker/compose/production.yml
   up -d --wait --wait-timeout 180` с `IMAGE_TAG=<deploy-tag>`.
4. **Health gate (K-006)**: `--wait` держит деплой до healthcheck'ов
   (backend-проба бьёт реальный `/health`, зависящий от состояния; см.
   [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md)).
5. **Rollback**: при провале gate — автоматический подъём предыдущего тега
   (`up -d --wait` 120 s). Предыдущий тег читается из labels текущего
   контейнера до замены (K-004/K-005); dangling-образы чистятся только
   старше 7 дней — окно rollback сохраняется.
6. Предыдущие версии: `./deploy.sh production <previous-tag>` — откат
   одной командой.

Использование: `./deploy.sh production sha-<commit>` (иммутабельный
CI-тег). Требования: `.env` на месте, SSL-сертификаты установлены.

## 3. IMAGE_TAG policy

| Среда | Тег |
|---|---|
| Production | Иммутабельный **SHA-тег** из CI (K-004). `latest` в production запрещён. |
| Dev | `latest` (default-ветка CI) — только для локальных репетиций. |
| Staging | Тот же SHA-тег, что планируется в production ([STAGING.md](STAGING.md)). |

`GITHUB_REPOSITORY` (org/repo) обязателен — без него ссылка на образ
невалидна ([.env.example](../../.env.example)).

## 4. Nginx-топология

`infrastructure/nginx/nginx.conf`, контейнер `nginx` в production-стеке:

- **80/443**: HTTP-редирект на HTTPS (+ ACME challenge); неизвестные Host
  отбрасываются (444, защита от Host-header injection).
- **TLS 1.2/1.3** (H-002); сертификаты монтируются из
  `infrastructure/nginx/ssl/` (`fullchain.pem`/`privkey.pem` →
  `/etc/nginx/ssl/` в контейнере). Сертификаты операторские — в git не
  попадают (`*.pem`/`*.key` в `.gitignore`); domain — через
  `SERVER_NAME`/envsubst, дефолт `localhost|mtamarket.local`.
- **`/api/` → backend со strip-префиксом**: `proxy_pass http://backend/`
  (trailing slash убирает `/api/`); `/api/auth/` — отдельный, более строгий
  rate-limit; `TRUST_PROXY=true` (один hop).
- **HSTS** (max-age 1 год, includeSubDomains, preload сознательно не
  включён) и **CSP** (`default-src 'self'`, без unsafe-eval) — на уровне
  edge (G-004/H-003); X-Frame-Options DENY, nosniff, Referrer-Policy,
  Permissions-Policy.
- `client_max_body_size 100M` == backend multer-лимит (H-006).
- `/uploads/` прокси **удалён** (B-005): платные артефакты доступны только
  через entitlement-проверенный download-route с короткоживущими
  подписанными URL; `/media/` — только опакеченные `media-<hex>` имена.
- Frontend (`/` → frontend:3000) и `/_next/static/` с immutable-кэшем.

## 5. Verification checklist (после деплоя)

1. `curl -s https://<domain>/api/ready | jq` — `checks.database: "ok"`.
2. `curl -s https://<domain>/api/live`; `docker compose ... ps` — все healthy.
3. OAuth: Discord callback URL `https://<domain>/auth/discord/callback`;
   логин → сессия переживает reload.
4. Payments: webhook URL `https://<domain>/api/payments/webhook`
   зарегистрирован в ЛК ЮKassa; тестовый платёж → purchase COMPLETED →
   license ACTIVE → reconciliation без MISMATCH; повторная доставка
   webhook'а → одна бизнес-операция.
5. Media: загрузка обложки → объект доступен; прямой `/uploads/...` → 404.
6. DRM: `pnpm --filter @mta-market/server drm:test-installation`; полный
   цикл покупка → installation → verify → activate → lease → DEK.
7. Production build web (exit 0) — фиксируется в записи плана.

## 6. Rollback

```sh
./deploy.sh production <previous-tag>     # предыдущий тег печатался при деплое
curl -s https://<domain>/api/ready | jq .checks   # DB ok
```

Миграции формального пути в rollback не откатываются автоматически
(additive-политика миграций — [DATABASE-MIGRATIONS.md](DATABASE-MIGRATIONS.md));
при проблемном миграционном пакете восстановление — из pre-deploy бэкапа
([BACKUP-RESTORE.md](BACKUP-RESTORE.md)).
