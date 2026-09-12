# Production Deployment Runbook (PLAN-004, Workstream T)

Operational document. Целевое время полного прохода: ~1 час.
Политики: backup/restore — `docs/operations/backup-restore.md`, миграции —
`docs/operations/database-migrations.md`.

## 1. Подготовить сервер

```bash
# Требования: Ubuntu 22.04+, Docker Engine + compose plugin, 2 vCPU/4GB минимум.
sudo apt update && sudo apt install -y docker.io docker-compose-plugin
# Пользователь в группе docker, репозиторий склонирован в /srv/mta-market-platform
```

## 2. Настроить secrets

```bash
cp .env.example .env
# Заполнить PROD: REQUIRED значения (см. комментарии в .env.example):
#   JWT_SECRET, POSTGRES_PASSWORD, DISCORD_*, DRM_SERVER_PRIVATE_KEY,
#   DRM_MASTER_KEY (openssl rand -base64 32), ARTIFACT_SIGNING_PRIVATE_KEY,
#   S3_* (S3_ENABLED=true), YOOKASSA_* , SMTP_*, EMAIL_FROM,
#   GITHUB_REPOSITORY (org/repo для ghcr), IMAGE_TAG.
chmod 600 .env
```

`deploy.sh`/`backup.sh` требуют `BACKUP_ENCRYPTION_KEY` (для зашифрованного
.env-бэкапа) — экспортируется в окружении cron/сессии оператора.

## 3. Настроить database

Управляемый Postgres или bundled-контейнер
(`infrastructure/docker/compose/production.yml`).
Проверка: `docker compose -f infrastructure/docker/compose/production.yml up -d
postgres && docker compose -f infrastructure/docker/compose/production.yml exec
postgres pg_isready`.

## 4. Настроить Redis

Bundled-контейнер. Роль — только rate-limit счётчики (M-003, ephemeral,
persistence не требуется). Security-лимитеры fail-closed (M-002).

## 5. Настроить S3/R2

1. Приватный бакет (public access запрещён).
2. CORS-политика бакета — только домены приложения (для media через CDN).
3. `MEDIA_PUBLIC_BASE_URL` — опциональный CDN-база (B-002), иначе backend
   стримит объекты сам.
4. Lifecycle-правила бакета (B-007): не удалять объекты, на которые
   ссылаются активные версии/лицензии; temp-префикс — expiry 7 дней.

## 6. Выполнить migration

Автоматически в `deploy.sh` (backup → `prisma db update --confirm` → deploy).
Ручной вариант — только по процедуре из database-migrations.md.

## 7–8. Deploy backend + frontend

```bash
./scripts/deployments/deploy.sh production sha-<commit>   # immutable CI tag (K-003/K-004)
```

Скрипт: backup → migrate → `up -d --wait` (health-gate K-006) → при провале
автоматический rollback на предыдущий тег.

## 9. Запустить Nginx

Входит в compose. Проверки:

- DNS A/AAAA домена → сервер (S-002);
- сертификаты в `./ssl/` (или certbot reissue); обновить домен в
  `nginx.conf` (там, где по умолчанию `localhost|mtamarket.local` — H-001);
- `curl -I https://<domain>/health` → 200.

## 10. Проверить health

```bash
curl -s https://<domain>/api/ready | jq   # DB ping обязателен
curl -s https://<domain>/api/live
docker compose -f infrastructure/docker/compose/production.yml ps   # все healthy
```

## 11. Проверить OAuth

- Discord callback URL в Discord Developer Portal =
  `https://<domain>/auth/discord/callback` (S-003).
- Браузер: Login with Discord → редирект назад → сессия выживает reload.

## 12. Проверить payments

1. YooKassa: shop id/secret в `.env`, webhook URL
   `https://<domain>/api/payments/webhook` зарегистрирован в ЛК YooKassa,
   notification password совпадает.
2. Sandbox: тестовый платёж → webhook получен → purchase COMPLETED → license
   ACTIVE → reconciliation-цикл без MISMATCH.
3. Повторная доставка webhook'а → одна бизнес-операция (D-003).

## 13. Проверить media

Загрузка cover через seller wizard → URL `/media/media-<hex>.png` → объект
доступен через `https://<domain>/media/<name>`; прямой доступ к
`/uploads/<artifact>` → 404 (B-005 — bypass закрыт).

## 14. Проверить DRM

```bash
pnpm --filter @mta-market/server drm:test-installation
```

Плюс: клиент покупает ресурс → регистрирует installation → verify → activate
→ lease подписан → DEK релизится только с валидным lease (F-001).

## 15. Проверить rollback

```bash
./scripts/deployments/deploy.sh production <previous-tag>
curl -s https://<domain>/api/ready | jq .checks   # DB ok
```

(deploy.sh хранит предыдущий тег и поддерживает откат одной командой.)

## Observability (I)

- логи: `docker compose logs backend` — JSON с request-id;
- метрики: `curl backend:3001/metrics` (внутренняя сеть);
- внешний uptime: на публичный `/health` (раз в минуту, алерт на 3 промаха);
- алерты (I-005): app down, /ready failing, 5xx spike, payment failures,
  reconciliation failed, DB недоступна, storage failure, SSL expiry ≤ 14 дней.

### Пороги алертов (PLAN-018 P-003)

Практические порты по сериям `/metrics` (внутренняя сеть, scrapе раз в
30–60 c). Значения стартовые — калибруются по факту нагрузки (P-002
slow-endpoint report после первого боевого прогона).

| Метрика | Условие | Действие |
|---|---|---|
| `http_5xx_total` | рост > 5/мин или доля > 2% | дежурный смотрит `docker logs` по request_id; откат при корреляции с деплоем |
| `http_latency_ms` (max/avg) | p-тренд ×3 за 10 мин | slow-endpoint разбор (DB time vs external) |
| `db_latency_ms` | max > 2 c за 5 мин | проверить postgres (`pg_isready`, connection count), медленные запросы |
| `redis_latency_ms` / fail-closed 503 | 503 на `/auth/*` | поднять Redis (fail-closed лимитеры, см. INCIDENT-RESPONSE §3.2) |
| `payment_webhook_lag_ms` | max > 60 c | проверить backlog провайдера; идемпотентность повторной доставки уже включена |
| `payment_success_total` | падение к нулю при живом трафике checkout | проверить провайдерский контур + webhooks |
| `outbox_depth` | > 500 устойчиво | воркер не успевает/завис — `docker logs worker`, рестарт воркера |
| `outbox_dead_letter_total` | рост > 0 | разбор FAILED-событий (dead-letter, без повторов) вручную |
| `license_verify_failures_total` | всплеск ×5 за 15 мин | возможен DRM-инцидент — INCIDENT-RESPONSE §4 |
| `download_failures_total` | всплеск | проверить entitle-цепочку и хранилище |
| `sandbox_failures_total` | всплеск | INCIDENT-RESPONSE §3.6 |
| `email_failures_total` | > 50% попыток | SMTP-контур (учёт: email off в dev/staging — нулевой трафик норма) |

Дополнительно: reconciliation-джоба сама пишет FAILED-отчёты и
MISMATCH-строки (`ReconciliationReport` / `ReconciliationMismatch`) —
алерт по их появлению эквивалентен «ledger mismatch» из P-003.

## Известные границы (честный список)

- Реальный money-платёж и YooKassa webhook на боевом провайдере — pending
  (sandbox-шаги в §12; боевой прогон — отдельная операция D-007).
- DRM на Windows — сборка/флоу не выполнялись в этом окружении (F-003).
- Внешний uptime-мониторинг — настройка на стороне оператора (§ выше).
- Load-тест — baseline снят локально; прод-числа снимаются после deploy.
