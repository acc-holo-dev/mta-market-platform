# PLAN-004 — Production Readiness & Operational Hardening (COMPLETED)

Дата выполнения: 2026-09-10.
Финальный статус: **IMPLEMENTATION COMPLETE — PRODUCTION NOT VERIFIED**.

---

## 1. Цель

Перевести MTA Market из «working development product» в «production-ready
service»: реальный сервер должен работать с настоящими пользователями,
деньгами и ресурсами без ручных dev-only процедур. Без новых marketplace
features, без переписывания архитектуры, без «нового DRM».

## 2. Исходное production gap state (аудит до работ)

Выполнено 7 независимых аудитов (config/startup/rate/redis/passwords;
db/migrations/backup; payments/ledger; DRM; security; infra/nginx/CI/контейнеры;
email/retention/scalability). Сводка найденного:

**P0 (блокирует production):**
1. Межрепозиторный протокольный баг DRM: клиент (`mta-market-module`)
   подписывал challenge как ASCII base64-строку, сервер верифицирует
   подпись над декодированными 32 байтами → live-флоу гарантированно падал
   с 401 DRM_INVALID_CHALLENGE_RESPONSE; обе локальные тестовые системы
   это не ловили.
2. `DRM_MASTER_KEY` (envelope-шифрование DEK) не передавался в
   docker-compose.prod.yml и не проверялся на старте → DEK-релиз в проде
   падал в runtime (EncryptionNotConfiguredError).
3. Uploads volume `/app/uploads` создавался Docker'ом от root при
   non-root процессе (uid 1001) → все загрузки в проде падали EACCES.
4. В production-деплое не было шага применения схемы БД (свежий деплой =
   пустая БД; образы публиковались без зависимости от тестов).
5. S3 media contract: `/upload/media` возвращал абсолютный S3 URL, который
   resource media endpoints (`isOwnMediaUrl`) отвергали → обложки/скриншоты
   в S3-режиме были нерабочими.

**P1 (selected):** settlement вне транзакции завершения без идемпотентного
re-запуска (crash-window), `payment.canceled` не обрабатывался (PENDING
навсегда; canceled→succeeded давал вечный 500), знак кэша баланса продавца
при REFUND_FROM_SELLER противоположен ledger, CSP `unsafe-inline/unsafe-eval
https:` (декоративный), нет HSTS в nginx, `/uploads/`-локация как латентный
bypass, CI публиковал образы независимо от тестов/security, `pnpm audit ||
true`, healthchecks на статическом `/health`, deploy.sh без миграций и с
prune предыдущего образа (rollback невозможен), security-заголовки терялись
в nginx-локациях, fail-open rate limiting при Redis outage, глобального
error-middleware не было (async-ошибка крэшила процесс), login 300/15мин в
прод-дефолтах, uploads не бэкапились (скрипт читал несуществующий хостовый
путь), 23 high/critical уязвимости зависимостей.

**P2:** HTTP-редирект по attacker-controlled Host, WebSocket-директивы без
websockets, admin status/role без enum-валидации, canceled→FAILED маппинг в
reconciliation, notification password только в NODE_ENV=production,
`.env.example` без prod-переменных (GITHUB_REPOSITORY, POSTGRES_PASSWORD),
дубли индексов, мёртвые email-шаблоны и т.д.

## 3. Что исправлено

### Workstream B — Storage
- `site/server/src/lib/s3.ts`: `uploadToS3` принимает явный object key
  (`key`), медиа кладётся под `media/<media-name>`.
- `site/server/src/routes/upload.ts`: единый helper `storeMediaObject()`;
  `/upload/media`, `/upload/avatar`, `/upload/screenshot` работают через
  magic-byte-валидированный pipeline и возвращают `/media/<name>` во всех
  режимах (легаси-эндпоинты avatar/screenshot раньше валидировали только
  декларативный Content-Type).
- `site/server/src/routes/media.ts`: S3-доставка — 302 на
  `MEDIA_PUBLIC_BASE_URL` (CDN) либо стриминг объекта из приватного бакета;
  name-policy (`media-<hex>` only) независима от хранилища.
- `site/server/src/lib/media.ts`: `isMediaName()` экспортирован; cleanup
  удаляет S3-объекты (best-effort) вместе с локальными.
- nginx: `location /uploads/` удалён (B-005/G-006 — закрыт латентный bypass
  платных артефактов; бэкенд статических /uploads не имеет и не имел).

### Workstream A / M / O — Configuration
- `docker-compose.prod.yml`: добавлены `DRM_MASTER_KEY`,
  `MEDIA_PUBLIC_BASE_URL`, `CORS_ORIGINS`, `COOKIE_SAMESITE`, `TRUST_PROXY`,
  все `*_RATE_LIMIT_MAX`, `RATE_LIMIT_FAIL_CLOSED`,
  `REDIS_ENABLE_OFFLINE_QUEUE`, `LOG_FORMAT/LEVEL`, `CORS_ORIGINS`;
  rate-limit дефолты: AUTH=100/15мин, STANDARD=300, STRICT=10, LOGIN=10,
  REFRESH=30.
- `.env.example` (root) и `site/server/.env.example` переписаны как полная
  env-матрица с пометками PROD: REQUIRED/secret и командами генерации.
- Startup validation: `DRM_MASTER_KEY` обязателен в production + проверка
  «base64 ровно 32 байта» (тесты обновлены/добавлены).
- Redis fail-closed для `strictRateLimit`/`authRateLimit`/`userRateLimit`
  (503 при недоступности Redis), global standard — fail-open (осознанное
  решение зафиксировано в коде и docs).

### Workstream D / E — Payments & Ledger
- `ledger.ts`: REFUND_FROM_SELLER теперь УМЕНЬШАЕТ `availableAmount` (было
  противоположно ledger-у) — знак синхронизирован с double-entry.
- `ledger.ts`: settlement transactionId детерминирован
  (`settle:purchase:<id>` / `settle:service_purchase:<id>`) → идемпотентный
  re-settlement.
- `commerce.ts`: в ветке `alreadyCompleted` settlement дозапускается
  (repair crash-window: падение между завершением покупки и ledger-проводкой
  больше не оставляет постоянный разрыв).
- `payments.ts`: `payment.canceled` обрабатывается — Payment→CANCELED,
  PENDING-покупка закрывается (FAILED); поздний `payment.succeeded` чинит
  FAILED→PENDING (CAS) и завершает покупку (provider truth wins, деньги
  захвачены — entitlement выдаётся); локальная запись Payment не создаётся
  для чужих объектов и т.д.
- `reconciliation/service.ts`: `canceled` маппится в CANCELED (как в state
  machine), а не в FAILED — убраны ложные STATUS_MISMATCH.

### Workstream F — DRM
- `module/src/drm/license_client.cpp`: challenge подписывается
  по декодированным байтам (`base64_decode` → `ed25519_sign`), соответствует
  серверу (`verifyChallengeResponse` над `Buffer.from(challenge,'base64')`)
  и спеке («signature over the raw challenge bytes»).
- `tests/module/drm/main.cpp`: новый interop-блок — challenge декодируется в 32
  байта, подпись поверх декодированных байт верифицируется, подпись над
  ASCII-текстом отвергается (регрессионная защита).
- `docker-compose.prod.yml` + startup validation: `DRM_MASTER_KEY` передаётся
  и проверяется (32 байта base64).

### Workstream G / K — Security & CI
- `scripts/audit-gate.sh`: blocking dependency audit (high/critical),
  waivers в `.github/audit-exceptions.txt` с датой ревью (просроченные
  не действуют); `|| true` убран из `.github/workflows/ci.yml`.
- CI `docker` job: `needs: [test, security, lint, build-backend,
  build-frontend]`; теги образов `type=sha,format=long`.
- Все 23 high/critical уязвимости закрыты: next 15.1.3→15.5.24, pnpm
  overrides для hono/@hono/node-server/lodash/qs/valibot/postcss/sharp;
  фронтенд type-check + build на новой версии проходят.
- `.dockerignore`: `**/.env`, `**/.env.*`, `**/*.pem`, `**/*.key`, `.keys` —
  вложенные env/ключи больше не попадают в build context (в dev-.env лежал
  реальный ARTIFACT_SIGNING_PRIVATE_KEY).
- `admin.ts`: status/role валидируются против enum (было: произвольные
  строки в БД).
- nginx: CSP `default-src 'self'; script-src 'self'; style-src 'self'
  'unsafe-inline'; img-src 'self' data: blob:; ...` (без `https:`/
  unsafe-eval/unsafe-inline в script-src), HSTS `max-age=31536000;
  includeSubDomains` в 443-блоке, Permissions-Policy, заголовки дублируются
  в локациях с add_header, `server_tokens off`, X-Frame-Options DENY
  выровнен, X-XSS-Protection убран, Connection upgrade через `map`.

### Workstream H / L / J — Infra & Runtime
- `nginx.conf`: Host-инъекция в HTTP-редиректе закрыта (allowlist доменов +
  444 для чужих Host; требует вписать production-домен при deploy — шаг в
  runbook), WebSocket-директивы удалены (websockets в коде нет), keep-alive
  восстановлен.
- `site/server/Dockerfile`: `mkdir -p /app/uploads && chown nodejs:nodejs`
  до USER (P0 — иначе uploads volume root-owned и все загрузки EACCES).
- `docker-compose.prod.yml`: backend healthcheck → `/ready` (реальная проверка
  БД) вместо статического `/health`, `start_period: 30s`.
- `index.ts`: graceful shutdown закрывает Redis + DB pool, обработчик
  `unhandledRejection`; `app.ts` — глобальный error-middleware (Express 4
  async-ошибки больше не крэшат процесс).

### Workstream K — Deploy pipeline
- `scripts/deploy.sh` переписан: backup (abort при провале) → миграции
  (`npx prisma db update --confirm` внутри backend-образа) → deploy exact
  `IMAGE_TAG` → `docker compose up -d --wait` (health-gate) → auto-rollback
  на предыдущий тег при провале → prune только образов старше 7 дней.
- `docker-compose.prod.yml`: `IMAGE_TAG` для backend/frontend (`:latest`
  только как локальный дефолт).

### Workstream C / Q — Backup & Recovery
- `scripts/backup.sh`: uploads бэкапятся из named volume
  (`mta-market-site_uploads_data`) через helper-контейнер (раньше читался
  несуществующий хостовый `./uploads` — бэкап был пустым), pg_dump использует
  переопределяемые POSTGRES_USER/DB, `docker compose` v2.
- **Migration formal path создан** (аудит G-01/G-02): в репо не было ни одного
  миграционного пакета — схема применялась только dev-only `db update`.
  Выполнен `prisma migration plan`: создан baseline-пакет (215 операций —
  вся схема) + пакет PLAN-003 медиа (5 additive-операций); `db migrate`
  применён на dev-БД (marker совпадает, `migration status` = "Up to date");
  пакеты и snapshots закоммичены.
- `scripts/deploy.sh` выполняет `npx prisma db migrate` (formal path —
  «production must run a reviewed, hashed migration» по собственной доке
  Prisma-8 скилла репо) внутри backend-образа; quick-path `db update`
  запрещён для production (docs/operations/database-migrations.md §2).
- `.gitignore`: убрана строка `site/server/migrations/` — закоммиченный ref
  указывал на незакоммиченный snapshot (`MIGRATION.SNAPSHOT_MISSING` на
  свежем клоне); все 9 snapshots + 2 пакета staged в git.
- Документация: `docs/operations/database-migrations.md` (Prisma 8 contract
  workflow: quick vs formal path, миграционный процесс, rollback policy,
  connection limits — пул дефолт 10/процесс при max_connections=100),
  `docs/operations/backup-restore.md` (policy, restore drill на staging-клоне,
  disaster scenario, RPO 24h / RTO 4h),
  `docs/operations/production-runbook.md` (15-шаговый runbook: server →
  secrets → DB → Redis → S3 → migrate → deploy → nginx → health → OAuth →
  payments → media → DRM → rollback).

### Остальное
- Tests: `startup-policy.test.ts` — добавлены DRM_MASTER_KEY-кейсы,
  acceptance-тест детерминирован (явно пустой `JWT_SECRET` вместо delete —
  dotenv больше не подставляет dev-секрет; исторически падавший тест теперь
  стабильно зелёный), `n-block8` out-of-order сценарий обновлён под
  GAP-1-семантику.

## 4. Что проверено (реальные окружения)

| Проверка | Результат | Окружение |
|---|---|---|
| Backend-тесты (vitest) | **256/256** | живой Postgres 16 + Redis 7 (Docker) |
| Browser E2E (Playwright) | **25/25** | Chromium против живых dev-серверов (Next :3000 + Express :3001 + Docker-инфра) |
| Server typecheck + build | чисто | tsc, локально |
| Web typecheck + production build | чисто | tsc + next build (15.5.24) |
| Lint (eslint server+web) | чисто | локально |
| Module unit-тесты (C++) | ALL TESTS PASSED | g++/OpenSSL Linux x64, включая challenge interop |
| Dependency audit gate | 0 high/critical | pnpm audit --prod против advisory DB |
| Migration formal path | baseline (215 ops) + media (5 ops) применены, status "Up to date" | `prisma migration plan` + `db migrate` против dev-Postgres |
| nginx config | syntax ok | docker run nginx:alpine nginx -t |
| compose prod | валиден | docker compose config |
| deploy.sh/backup.sh/audit-gate.sh | bash -n + локальный прогон gate | локальная shell |

## 5. НЕ VERIFIED (честно, причина: нет окружения)

| Пункт | Причина |
|---|---|
| Реальный YooKassa webhook на живом провайдере (D-002/D-007) | нет sandbox/боевого магазина и публичного HTTPS-домена; webhook lifecycle покрыт интеграционными тестами с re-fetch верификацией |
| DRM live E2E против работающего license-сервера (F-001/F-002) | нужен развернутый staging-сервер + покупка + запуск модуля |
| Windows-сборка/исполнение модуля (F-003) | Linux-окружение, MSVC/MinGW/DPAPI недоступны |
| Restore drill на staging-клоне (C-005/Q-002) | нет staging-инфраструктуры; процедуры документированы |
| Rollback drill на реальном деплое (K-005) | деплой не выполнялся; логика в deploy.sh проверена синтаксически/локально |
| Load baseline (R-004) | требуется развернутая система; замер не проводился |
| Production domain/DNS/TLS/OAuth-callbacks (S/H) | домен не выделен; nginx-шаблон требует вписать домен |
| Внешний uptime/alerting (I-004/I-005) | настройка на стороне инфраструктуры; эндпоинты /live, /ready, /metrics существуют |

## 6. Известные оставшиеся гэпы (за рамкой PLAN-004, зафиксированы)

- Payout flow (замкнуть начисление→выплату, SELLER_PAYOUT) — до реальных выплат.
- Password reset / смена пароля с инвалидацией сессий (O-001/O-003).
- SQL-агрегация rating/popular (сейчас in-memory кап 1000) — перед ростом
  каталога.
- Шифрование OAuth access/refresh/idToken в БД или отказ от хранения.
- Account deletion/anonymization.
- Reconciliation ledger-аудит, retry/backoff, distributed lock.
- pg_trgm GIN + индексы под сортировки.
- Автообновление TLS-сертификатов (certbot-контейнер) — процедура ручная,
  шаги в runbook.
- Email: production SMTP-провайдер, SPF/DKIM/DMARC.
- Offsite/расписание бэкапов (cron + выгрузка в object storage) — операция
  на стороне инфраструктуры, шаги в runbook/backup-restore.md.
- PgBouncer/тюнинг Postgres — при масштабировании >4 реплик backend
  (см. database-migrations.md §4).

## 7. Final production readiness verdict

**IMPLEMENTATION COMPLETE — PRODUCTION NOT VERIFIED.**

Кодовая база, конфигурация, CI/CD-гейты, процедуры деплоя/бэкапа/миграций и
операционная документация готовы; все известные P0-прорехи кода устранены и
покрыты тестами (256 backend + 25 browser E2E + модульные C++ тесты — зелёные).
Пункты, требующие реальной инфраструктуры (live-платежи, Windows DRM, restore/
rollback drill, домен, load baseline), честно помечены NOT VERIFIED и
перечислены как обязательные шаги перед public launch (см. CURRENT.md →
Blockers).
