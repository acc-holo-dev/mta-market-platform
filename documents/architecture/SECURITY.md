# SECURITY — архитектура безопасности site/

Область: `site/server` (+edge nginx). Все утверждения выведены из кода;
файлы указаны. API-контекст: [API README](../api/README.md).

## Аутентификация

| Механизм | Реализация |
|---|---|
| Пароли | bcrypt, cost 10 (`site/server/src/routes/auth.ts`) |
| Access-токен | JWT, `type:"access"`, TTL `JWT_ACCESS_EXPIRY` (дефолт 15 м); передаётся только `Authorization: Bearer` |
| Refresh-токен | JWT `type:"refresh"` с уникальным `jti`, TTL 7 д; HttpOnly cookie `refresh_token` (`lib/cookies.ts`: `secure` в prod/при `SameSite=none`, `path=/`) |
| Хранение | в БД только SHA-256 хэш refresh-токена (`lib/tokenSecurity.ts`), сравнение `timingSafeEqual` |
| Ротация | каждый refresh создаёт новую Session (новый токен, тот же `tokenFamily`) и помечает старую `reuseDetected` |
| Детекция реюза | refresh использованным токеном → ревокация **всей tokenFamily** + очистка cookie + 401 (`routes/auth.ts`) |
| Разграничение типов | refresh не принимается как access и наоборот (`lib/jwt.ts`) |
| Anti-enumeration | единая ошибка `INVALID_CREDENTIALS` для «нет пользователя» и «неверный пароль»; логи разделены (`login_failed_unknown_identity` / `login_failed_bad_password`) |
| OAuth | CSRF-cookie `oauth_state` (10 мин) с проверкой на callback; email-матч только для `verified` провайдер-имейлов; синтетические `.local`-email не могут захватить аккаунт |

## Авторизация

- **Роль-мидлварь**: `authenticate` (401), `requireRole(role)` (403) в
  `lib/auth.ts`; роли `USER | ADMIN | MODERATOR`.
- **Админ-гейт**: в `routes/admin.ts`/`adminCommunity.ts`/`adminContent.ts`
  `adminOnly` пропускает ADMIN и MODERATOR; в `routes/seller.ts` список
  заявок — `requireRole("ADMIN")`.
- **Проверки владения** — в каждом мутирующем маршруте: ресурсы/версии/отзывы
  (`sellerId`/`buyerId`), покупки (`buyerId`), споры (участники), статьи
  (`authorId`), серверы — через `lib/serverAccess.ts` (`loadStaffRole`:
  OWNER — источник истины `ownerId`; canManage = OWNER/ADMIN;
  canModerateCommunity = +MODERATOR). Фильтрация приватных полей сервера —
  в бэкенде (`publicServerFields`, showStats/showResources/showStaff/showCommunity).
- **Капабилити-гейт листингов**: `canCreateListings` (`lib/permissions.ts`) —
  создавать ресурсы/услуги может только APPROVED SellerProfile (или
  модерация); self-review бан (`K-001`): продавец не отзывался на свой
  ресурс; самоподписка/само-отзыв на сервере запрещены.
- **Audit trail** (`lib/audit.ts`): append-only `AuditLog` для чувствительных
  изменений (модерация, seller approve/reject, споры, server lifecycle,
  ключи) с actor/ip/requestId; failures не ломают основной поток.

## Rate limiting + fail-closed (M-002)

`lib/rateLimit.ts`; группы и поведение при отказе Redis —
[API README](../api/README.md):

- security-критичные (auth, strict, per-user) — **fail-closed**: недоступный
  Redis → `503 Rate limiter temporarily unavailable` (brute-force защита не
  деградирует в «без лимита»);
- bulk (`standard`) — fail-open по умолчанию; `RATE_LIMIT_FAIL_CLOSED=true`
  переводит в fail-closed;
- per-account лимиты (`userRateLimit`) дополняют IP-лимиты — один аккаунт
  не может брутфорсить refresh/checkout/reviews ротацией IP;
- production-значения пиннутся в `infrastructure/docker/compose/production.yml`
  (dev/E2E-значения не протекают);
- edge-дубль: nginx `limit_req` (api 10 r/s, auth 5 r/s).

## Upload pipeline

`routes/upload.ts` + `lib/upload.ts` + `lib/media.ts`:

- **Лимиты**: медиа — 5 МБ (`MEDIA_MAX_BYTES`), артефакт — 100 МБ
  (multer `fileSize`); edge-кап `client_max_body_size 100M` (nginx, H-006 —
  равен multer-лимиту); JSON-тело — 10 МБ (`express.json`).
- **Magic bytes**: `sniffImageType`/`validateImageBuffer` — тип определяется
  содержимым, а не заголовком; несоответствие/неподдерживаемый формат → 400,
  temp-файл удаляется.
- **Opaque имена**: `tmp-<hex>` на время валидации → `media-<hex>.<ext>`
  для картинок, `<random>` для артефактов; имена файлов пользователя
  никогда не попадают в путь; `GET /media/:name` обслуживает только
  `media-<hex>`-имена (артефакты через этот роут недостижимы физически).
- **Статическая sandbox-валидация** (`lib/sandbox/{static,service,runner}.ts`):
  каждый артефакт версии валидируется до входа в пайплайн публикации;
  FAILED-валидация блокирует публикацию ресурса (`routes/admin.ts`);
  sandbox-исполнение — Docker (`site/server/sandbox/`), опционально.
- **Владение**: медиа-URL, привязываемые к ресурсу, обязаны быть загружены
  этим API (`isOwnMediaUrl`); произвольные URL отвергаются; удаление
  ресурса/замена обложки чистит файлы (`cleanupMediaUrl`).
- Публичная раздача платных артефактов отсутствует: скачивание только через
  entitlement-checked endpoint (S3 signed URL или авторизованный стрим);
  nginx-локация `/uploads` удалена (G-006).

## DRM-ключи

`site/server/src/lib/drm/*` + [DRM](../api/DRM.md):

- приватный ключ подписи сервера — env `DRM_SERVER_PRIVATE_KEY` (отдаётся
  оператору один раз при `drm:keygen`); публичные ключи — БД
  (`ServerSigningKey`), раздача через `/drm/v2/public-keys` (ACTIVE+PREVIOUS).
- мастер-ключ DEK — env `DRM_MASTER_KEY`; wrap/unwrap только на сервере;
  клиент получает raw DEK только по possession-proof + валидному lease.
- приватный ключ установки **никогда не передаётся** (INV-010, key store
  модуля); владение доказывается подписью challenge.
- ключ артефактов — env `ARTIFACT_SIGNING_PRIVATE_KEY` (Ed25519-подписи
  манифестов, `lib/artifact/signing.ts`).

## CORS и заголовки

- **CORS allowlist** (`app.ts`): `CORS_ORIGINS` (csv); wildcard запрещён
  (credentials); нет Origin (curl/same-origin) — разрешено; production
  same-origin за nginx — allowlist по умолчанию пуст.
- **Security headers** (`middleware/observability.ts`, каждый ответ):
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Permitted-Cross-Domain-Policies: none`,
  `CSP: default-src 'none'; frame-ancestors 'none'; form-action 'self'` (API
  не раздаёт скрипты/стили), HSTS в production.
- **Edge-заголовки** ([nginx.conf](../../infrastructure/nginx/nginx.conf)):
  HSTS (1 год, includeSubDomains), строгий CSP фронтенда
  (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:; …; object-src 'none'`), Permissions-Policy,
  `server_tokens off`, `X-Frame-Options: DENY`; HTTP→HTTPS redirect с
  защитой от Host-header injection (444 на неизвестный Host).

## Платёжный webhook

`/payments/webhook` — публичный, но: провайдер не сконфигурирован → 503;
транспортная подлинность — IP-allowlist + HTTP Basic (E-006); бизнес-проверки
— re-fetch платежа у провайдера, сверка суммы/валюты/привязки, quarantine
события при несовпадении (`routes/payments.ts`); идемпотентность через
`PaymentProviderEvent` (см. [COMMERCE](../api/COMMERCE.md)).

## Секреты и окружение

- Все секреты — только env: `JWT_SECRET` (обязателен, валидируется на старте
  — `lib/startupValidation.ts`), `DRM_*`, `YOOKASSA_*`, `SMTP_*`,
  `S3_*`, OAuth client secret'ы. Список — `.env.example` (без значений).
- `.env*` в `.gitignore` (кроме `!.env.example`); каталог `secrets/` игнорируется.
- `server_tokens off`; `POST /payments/:id/simulate` не компилируется в
  production; `dev-admin.ts` отказывается работать при
  `NODE_ENV=production` без явного `ALLOW_ADMIN_BOOTSTRAP=true` (каждое
  использование логируется).
- Идентификационные секреты модуля: интеграционный токен сервера и
  review-токены хранятся только хэшами (SHA-256), plaintext показывается
  один раз (`lib/serverIntegration.ts`).

## CI-гейты

Workflows: `.github/workflows/{validate,tests,security,contracts,site,module,e2e,release}.yml`
(созданы в PLAN-011). Гейт `gitleaks` — `security.yml`; dependency-audit gate
(`scripts/maintenance/audit.sh`, waivers в `.github/audit-exceptions.txt`);
E2E — блокирующий gate (`e2e.yml`).
