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
| Anti-enumeration | единая ошибка `INVALID_CREDENTIALS` для «нет пользователя» и «неверный пароль»; логи разделены (`login_failed_unknown_identity` / `login_failed_bad_password`); тот же uniform-контракт в `PATCH /auth/password` |
| Смена пароля | `bcrypt`-проверка текущего пароля обязательна; после смены ревоцируются **все прочие** сессии (текущая refresh-сессия выживает — `routes/auth.ts`, A-008); OAuth-only аккаунты (без `passwordHash`) получают 409 — пароль не добавляется без доказательства владения |
| OAuth redirect | CSRF-cookie `oauth_state` (10 мин) с проверкой на callback; email-матч только для `verified` провайдер-имейлов (у VK ID — флаг `email_verified`); синтетические `.local`-email не могут захватить аккаунт |
| OAuth direct (Telegram) | подпись Login Widget — единственный транспортный факт: HMAC-SHA256 data-check-string, ключ `SHA256(TELEGRAM_BOT_TOKEN)`; `oauth_state` не используется; свежесть ±24 ч; replay dedup `(id, auth_date)` |
| Link-режим | `POST /auth/:provider/link/start` и `GET /auth/:provider/link` — только `authenticate` (cookie `link_user` ставится проверенному пользователю; Bearer-путь `GET /auth/:provider` тоже проверяет токен) |

## Telegram direct-login (PLAN-016 A-005)

`POST /auth/telegram/callback` (`lib/providers/telegram.ts`) — публичный
маршрут; transport-аутентичность виджета и есть вся защита:

- **HMAC**: data-check-string (все поля payload кроме `hash`, отсортированы,
  пары `key=value` через `\n`) подписывается HMAC-SHA256 с ключом
  `SHA256(bot_token)`; сравнение `crypto.timingSafeEqual` (length-guarded).
- **Свежесть**: `auth_date` в пределах ±24 ч от серверных часов (и будущее
  время тоже отклоняется — `Math.abs`).
- **Replay dedup**: пара `(id, auth_date)` — ключ module-level кэша (TTL
  24 ч, капа 10 000 записей, свип при вставке); повтор того же payload →
  401. Кэш in-memory — per-instance; при multi-instance доставке той же пары
  на другой экземпляр окно атаки остаётся ограниченным 24-часовой свежестью.
- **Rate limit**: `authRateLimit` (fail-closed группа, M-002) на маршруте.
- Нет `oauth_state`, нет провайдер-токенов, нет email (`verified: false` →
  синтетический `<providerId>@telegram.local`) — захват аккаунта через
  email-матч физически невозможен.

## Шифрование OAuth-токенов провайдеров (PLAN-016 A-009)

`lib/tokenCrypto.ts` — `Account.accessToken/refreshToken/idToken` шифруются
AES-256-GCM ключом `OAUTH_TOKEN_ENCRYPTION_KEY` (base64 32 байта), конверт
`v1:<iv>:<tag>:<ct>`; plaintext никогда не логируется. Расшифровка — только
`decryptProviderToken` (зарезервирована под будущий provider-refresh flow,
сейчас не вызывается). Startup sweep `sweepLegacyStoredTokens` идемпотентно
перешифрует legacy-plaintext строки (только при наличии ключа, ошибка не
блокирует старт). Production: ключ **обязателен**, когда сконфигурирован
хотя бы один OAuth-провайдер (включая `TELEGRAM_BOT_TOKEN`), иначе сервер
не стартует (`lib/startupValidation.ts`).

Компрометация ключа = утечка всех сохранённых провайдер-токенов. Процедура
ротации:

1. сгенерировать новый ключ (`openssl rand -base64 32`), положить в env;
2. инвалидировать все провайдер-токены: сессии/привязки продолжают работать,
   но сохранённые access/refresh провайдера считаются скомпрометированными —
   старые шифротексты под новым ключом не расшифровываются
   (`decryptProviderToken` → `null`, fail-closed), пользователи
   перелогиниваются через провайдеров, и при первом же login/link callback
   токены перезаписываются под новым ключом;
3. перезапустить сервер (sweep перешифрует то, что осталось legacy-plaintext);
4. скомпрометированный ключ вывести из оборота везде, где он мог храниться
   (env-файлы, секрет-менеджер, CI).

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

## Платёжные webhook'и (per-provider, PLAN-016 P-002)

`POST /payments/webhook/:provider` (+ legacy-алиас `/payments/webhook` на
дефолтного провайдера) — публичные, но: провайдер не сконфигурирован/не
включён → `503`; транспортная подлинность — `provider.verifyWebhook` (E-006):

| Провайдер | Верификация |
|---|---|
| YooKassa | IP-allowlist (`403`) + HTTP Basic (`401`) |
| T-Bank | notification-`Token` = SHA-256 по полям уведомления (ключи отсортированы, пары `${key}${value}`, terminal Password в конце), timing-safe + владение `TerminalKey` (`401`); IP/Basic нет — токен и есть проверка |
| Crypto (Cryptomus-класс) | `sign` = md5(base64(JSON без поля sign) + api key), timing-safe; любой отказ → `400` (`reason:"signature"`) |
| TEST (dev) | webhook-канала нет — delivery отклоняется на транспорте |

- **Raw-body**: `express.json({verify})` (`app.ts`) кладёт сырые байты в
  `req.rawBody` — маршрут отдаёт их в `verifyWebhook`/`parseWebhook`
  (крипто-адаптер переразбирает raw bytes для `sign`; T-Bank хэширует
  разобранные значения, сырые байты не требуются), `payloadHash` события —
  SHA-256 от raw-байтов.
- **Бизнес-проверки неизменны для всех провайдеров**: событие персистится
  до эффектов (`PaymentProviderEvent`), затем обязательный re-fetch платежа
  у провайдера, сверка суммы/валюты (RUB)/привязки провайдер-платежа к
  заказу; любое нарушение — quarantine (`PaymentProviderEvent.status=FAILED`,
  409) без выдачи entitlement (`routes/payments.ts`). Идемпотентность через
  `PaymentProviderEvent` (см. [COMMERCE](../api/COMMERCE.md)).

## Секреты и окружение

- Все секреты — только env: `JWT_SECRET` (обязателен, валидируется на старте
  — `lib/startupValidation.ts`), `DRM_*`, `YOOKASSA_*`, `SMTP_*`,
  `S3_*`, OAuth client secret'ы, `TELEGRAM_BOT_TOKEN`,
  `OAUTH_TOKEN_ENCRYPTION_KEY`, `TBANK_*`, `CRYPTO_*`. Список —
  `.env.example` (без значений).
- `OAUTH_TOKEN_ENCRYPTION_KEY` — production-требование при любом
  сконфигурированном OAuth-провайдере (base64 ровно 32 байта); процедура при
  утечке — выше, § «Шифрование OAuth-токенов провайдеров».
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
