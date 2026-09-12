# AUTH — аутентификация и сессии

Область: `site/server/src/routes/auth.ts`,
`site/server/src/lib/{jwt,cookies,tokenSecurity,tokenCrypto,identityProvider}.ts`,
провайдеры `site/server/src/lib/providers/{discord,yandex,google,vk,telegram}.ts`.
Общие условия (envelope ошибок, лимиты, middleware): [README](README.md).

## Токены и сессии

- Access: JWT `type:"access"`, payload `{userId, email, role}`, TTL
  `JWT_ACCESS_EXPIRY` (по умолчанию `15m`). Передаётся в `Authorization: Bearer`.
- Refresh: JWT `type:"refresh"` + `jti` (random 16 байт), TTL
  `JWT_REFRESH_EXPIRY` (по умолчанию `7d`). Различие типов проверяется
  (`verifyAccessToken` отвергает refresh и наоборот) — `lib/jwt.ts`.
- Cookie `refresh_token`: HttpOnly, `path=/`, `maxAge` 7д; `secure=true` в
  production и при `COOKIE_SAMESITE=none`; `sameSite` = env `COOKIE_SAMESITE`
  (`lax` по умолчанию, продакшн-топология same-origin за nginx — `lib/cookies.ts`).
- Access-токен в cookie не хранится: frontend после OAuth-callback обменивает
  cookie на access через `POST /auth/refresh` и держит токен в памяти
  (`site/web/src/lib/api.ts`, single-flight refresh).

### Ротация и защита от переиспользования (`lib/tokenSecurity.ts`)

- В БД хранится только `refreshTokenHash` = SHA-256 токена (сравнение
  `crypto.timingSafeEqual`).
- Каждая сессия — строка `Session` с `tokenFamily` (hex 32 байта) и флагом
  `reuseDetected`.
- **Ротация**: каждый `POST /auth/refresh` создаёт НОВУЮ сессию (новый
  refresh-токен, тот же `tokenFamily`) и помечает старую строку
  `reuseDetected: true`. Значит, старый токен дальше никогда не валиден.
- **Детекция реюза**: попытка refresh уже использованным токеном (сессия
  помечена `reuseDetected`) ревокает ВСЕ сессии tokenFamily (удаление в
  цикле, т.к. контрактный ORM удаляет по одной строке), очищает cookie и
  возвращает `401 {"error":"Token reuse detected","message":"All sessions
  revoked for security. Please log in again."}`.
- Просроченная сессия удаляется, cookie очищается, `401 {"error":"Session expired"}`.

## Локальная учётка

### POST /auth/register

Лимит: `authRateLimit`. Тело:

```json
{"username": "john", "email": "j@example.com", "password": "8+ символов", "confirmPassword": "необязательно"}
```

Валидация (zod): username 3–30, `^[a-zA-Z0-9_-]+$`; password ≥8, ≤200.
Ответ `201`:

```json
{"accessToken": "...", "user": {"id","email","username","displayName","avatar","role","status","createdAt","balance":{"available":0,"currency":"RUB"}}}
```

Ошибки: `400 {code:"VALIDATION_ERROR"}`; `400 {code:"PASSWORD_MISMATCH"}`;
`409 {code:"USERNAME_TAKEN"}` / `409 {code:"EMAIL_TAKEN"}`. Пароль — bcrypt
(cost 10); `passwordHash`; баланс создаётся сразу (`UserBalance`, available 0,
RUB — PLAN-001 C-002). Ответ одновременно логинит (сессия + cookie).

### POST /auth/login

Лимит: `authRateLimit` + per-user 10/мин (`LOGIN_RATE_LIMIT_MAX`).
Тело `{"login": "<username|email>", "password": "…"}`. `login` с `@`
ищется по email, иначе по username. Единая ошибка для «нет пользователя» и
«неверный пароль»: `401 {code:"INVALID_CREDENTIALS"}`. Не-ACTIVE аккаунт:
`403 {code:"ACCOUNT_DISABLED", message:"Account is <status>"}`.
Успех — тот же ответ, что у register (`200`).

### POST /auth/refresh

Лимит: `authRateLimit` + per-user 30/мин (`REFRESH_RATE_LIMIT_MAX`).
Тело пустое; токен берётся из cookie. Ответ `200`:

```json
{"accessToken": "...", "expiresIn": "15m"}
```

Новый refresh кладётся в cookie (ротация). Ошибки: 401 (нет cookie,
невалидный токен, сессия не найдена, реюз, просрочка).

### POST /auth/logout

Лимит: `authRateLimit`. Удаляет сессию по хэшу cookie-токена и очищает cookie.
Без cookie — `400`. Ответ `200 {"message":"Logged out successfully"}`.

### GET /auth/me (`authenticate`)

Профиль текущего пользователя + баланс (`ensureUserBalance` гарантирует строку):

```json
{"id","email","username","displayName","avatar","role","status","createdAt",
 "balance":{"available":0,"currency":"RUB"}}
```

### PATCH /auth/me (`authenticate`)

Редактируются **только** `displayName` и `avatar`; остальные поля (role,
status, email, username) отклоняются. Пустой набор —
`400 {code:"NOTHING_TO_UPDATE", message:…, rejectedFields:[…]}`.

### PATCH /auth/password (`authenticate`, PLAN-016 A-008)

Смена локального пароля. Тело `{"currentPassword": "…", "newPassword": "…"}`:

- `newPassword` ≥8 и ≤200 символов, иначе `400 {"error":"Invalid password payload"}`;
- аккаунт без локального пароля (OAuth-only, `passwordHash = null`) →
  `409 {"error":"Account has no local password"}` — установка пароля здесь
  намеренно не добавляет credential без доказательства владения;
- `bcrypt.compare(currentPassword)` не совпал → единая
  `401 {code:"INVALID_CREDENTIALS"}` (тот же контракт, что у login —
  anti-enumeration);
- успех: пароль перехэширован bcrypt (cost 10), **все прочие сессии
  ревоцированы** (каждая `Session` пользователя удаляется, кроме сессии
  текущего refresh-cookie — вызывающий остаётся залогиненным); ответ
  `200 {"message":"Password updated","revokedSessions":N}`.
- Смена пароля по email (password reset) не реализована — вне скоупа
  PLAN-016 (см. §15 плана: боевой SMTP — решение владельца).

## OAuth-провайдеры (Discord / Yandex / Google / VK ID) + Telegram direct-login

Реестр-паттерн: интерфейс `IIdentityProvider`
(`lib/identityProvider.ts`), реализации саморегистрируются side-effect
импортами в `routes/auth.ts` из
`lib/providers/{discord,yandex,google,vk,telegram}.ts`. Провайдер недоступен
без env (client id/secret + redirect; у Telegram — `TELEGRAM_BOT_TOKEN`) —
маршруты отвечают `404 {"error":"Provider not available"}`.

Два режима (PLAN-016 A-005):

- **redirect** — Discord, Yandex, Google, VK ID: authorization-code flow,
  CSRF-cookie `oauth_state`, провайдер-токены сохраняются (шифрованно, см.
  [ниже](#шифрование-oauth-токенов-провайдеров-plan-016-a-009));
- **direct** — Telegram Login Widget: подписанный payload постится прямо в
  бэкенд (`POST /auth/telegram/callback`), без authorization code, без
  `oauth_state` и без провайдер-токенов.

VK ID (`lib/providers/vk.ts`) — OAuth 2.0 против `id.vk.com`
(`/authorize` → JSON-обмен кода на `id.vk.com/oauth2/auth` →
`/oauth2/user_info`); email-флаг `email_verified` маппится в `verified` —
аккаунт по email-матчу соперничает только при верифицированном email, иначе
создаётся синтетический `<providerId>@vk.local` (anti-takeover сохранён).
Env: `VK_CLIENT_ID` / `VK_CLIENT_SECRET` / `VK_REDIRECT_URI`.

### GET /auth/providers — discovery включённых провайдеров (PLAN-016 A-001)

Публичный (без `authenticate`); зарегистрирован **до** generic `/:provider`
маршрутов, чтобы не быть съеденным параметризованным матчем. Ответ:

```json
{"providers":[{"provider":"discord","displayName":"Discord","mode":"redirect"},
              {"provider":"telegram","displayName":"Telegram","mode":"direct","botName":"<TELEGRAM_BOT_NAME>"}]}
```

- список — только `isEnabled()`-провайдеры; без env провайдер просто
  отсутствует в списке (честное отсутствие, A-010 — никогда «available but
  broken»);
- `mode` — `"redirect" | "direct"`; `botName` отдаётся только direct-провайдеру
  (для монтирования Telegram Login Widget, `data-telegram-login`);
- никакой конфигурации не утекает: redirect URI, client id/secret и прочие
  env не включаются в ответ.

### Маршруты провайдеров

| Маршрут | Назначение |
|---|---|
| `GET /auth/providers` | discovery (см. выше) |
| `GET /auth/:provider` | редирект на authorize URL; ставит CSRF-cookie `oauth_state` (HttpOnly, 10 мин); при Bearer-заголовке дополнительно ставит `link_user` (link-режим). direct-провайдер → `404 {"error":"Direct login provider: use POST /auth/:provider/callback"}` |
| `GET /auth/:provider/link` (`authenticate`) | явный link-режим: cookie `link_user` = свежий access-токен |
| `POST /auth/:provider/link/start` (`authenticate`) | браузерный запуск link-режима (PLAN-016 A-006): ставит `link_user` cookie и возвращает `{"authorizationUrl"}` для клиентского перехода (навигация браузера не может нести `Authorization`-заголовок) |
| `GET /auth/:provider/callback` | обмен `code` на токены; проверка `state` против cookie (`400 {"error":"Invalid state"}` при несовпадении, cookies очищаются). direct-провайдер → 404 (см. выше) |
| `POST /auth/telegram/callback` | direct-login Telegram (см. ниже) |

Callback, **login-режим**:

- `Account` по `(provider, providerAccountId)`: если найден — вход
  существующего пользователя, токены провайдера обновляются.
- Нет `Account`: match по email допустим **только** при
  `user.verified === true`; иначе создаётся новый User (email — реальный при
  verified, иначе синтетический `<providerId>@<provider>.local`; username —
  санитизированный + суффикс hex при коллизии), `emailVerified` ставится при
  verified-email, welcome-письмо отправляется на реальный email (best-effort).
- Сессия: refresh-токен в HttpOnly cookie, БД — хэш, новый `tokenFamily`.
  Провайдер-токены сохраняются только в зашифрованном виде (см.
  [Шифрование OAuth-токенов](#шифрование-oauth-токенов-провайдеров-plan-016-a-009)).
- Ответ: редирект `${FRONTEND_URL}/auth/callback`.

Callback, **link-режим** (есть cookie `link_user`):

- `409 {"error":"Identity already linked to another account"}` — идентичность
  занята другим пользователем; повторный link идемпотентен (редирект
  `/account/identities?linked=1`); иначе создаётся `Account` и редирект туда же.

### POST /auth/telegram/callback — direct-login (PLAN-016 A-005)

Публичный, лимит `authRateLimit`. Тело — подписанный payload Telegram Login
Widget (`id`, `first_name`, `auth_date`, `hash`, …); авторизация-кода нет,
`oauth_state` не используется. Верификация целиком в провайдере
(`lib/providers/telegram.ts`, `verifyTelegramLoginPayload`/`verifyDirectLogin`):

- **Подпись**: data-check-string (все поля кроме `hash`, отсортированные,
  пары `key=value` через `\n`), HMAC-SHA256 с ключом
  `SHA256(TELEGRAM_BOT_TOKEN)`; сравнение `crypto.timingSafeEqual`.
- **Свежесть**: `auth_date` в пределах ±24 ч от часов сервера.
- **Replay dedup**: пара `(id, auth_date)` — ключ in-memory кэша (TTL 24 ч,
  капа 10 000 записей); повтор того же payload → `401`.
- **Rate limit**: `authRateLimit` (fail-closed группа) на маршруте.
- Email Telegram боту не отдаётся → синтетический `<providerId>@telegram.local`.
- Провайдер-токенов нет — в `Account` пишутся `null` (шифрование неприменимо).
- Link-режим работает так же: тот же POST с cookie `link_user` →
  `handleLinkingCallback` (редирект `/account/identities?linked=1`).
- Любая ошибка верификации (подпись/свежесть/replay) → `401 {"error": …}`;
  выключенный провайдер → `404 {"error":"Provider not available"}`.
- `GET /auth/telegram` и `GET /auth/telegram/callback` отвечают 404 с
  подсказкой «use POST /auth/:provider/callback» — direct-провайдер не имеет
  authorize URL.

Подпись виджета — единственный транспортный факт: ни IP-allowlist, ни cookie,
ни провайдер-токены в этой схеме не участвуют (подробности —
[SECURITY](../architecture/SECURITY.md)).

## Внешние идентичности (link/unlink) и страница `/account/identities`

Привязка/отвязка внешних идентичностей — через link-режим выше
(`POST /auth/:provider/link/start` → authorize-переход → callback с cookie
`link_user`; для Telegram — тот же `POST /auth/telegram/callback` с cookie) и
endpoints ниже. Страница `/account/identities` использует `GET /auth/providers`
+ эти endpoints; серверный link-callback всегда возвращает на
`/account/identities?linked=1` (мёртвый redirect закрыт, PLAN-016 A-006).

### GET /auth/identities (`authenticate`)

Список привязок текущего пользователя; **токены провайдеров никогда не
отдаются**: `[{id, provider, providerAccountId}]`.

### DELETE /auth/identities/:id (`authenticate`)

Отвязка своей идентичности. Нельзя отвязать последний метод входа:
`409 {"error":"Cannot unlink the only login method"}`; чужая/несуществующая
— 404.

## Шифрование OAuth-токенов провайдеров (PLAN-016 A-009)

`lib/tokenCrypto.ts` — access/refresh/id-токены провайдеров в `Account`
шифруются at rest:

- **Алгоритм**: AES-256-GCM; ключ — env `OAUTH_TOKEN_ENCRYPTION_KEY`
  (base64 ровно 32 байта, `openssl rand -base64 32`). Конверт
  `v1:<ivB64>:<tagB64>:<ctB64>` (IV 12 байт); plaintext никогда не логируется.
- **Запись**: `encryptProviderToken` при каждом login/link callback
  (`Account.accessToken` / `refreshToken`); direct-провайдер (Telegram)
  хранит `null`. В dev без ключа plaintext сохраняется как есть (честность
  dev-режима).
- **Чтение**: `decryptProviderToken` — единственный путь расшифровки.
  Зарезервирован под будущий provider-refresh flow; **refresh токенов
  провайдера пока не реализован** — функция в рабочих маршрутах не
  вызывается. Legacy-plaintext (строки без префикса `v1:`) читается как есть.
- **Startup sweep**: `sweepLegacyStoredTokens` — идемпотентная разовая
  перешифровка legacy-plaintext строк `Account` (accessToken/refreshToken/
  idToken) при старте сервера (`index.ts`); выполняется только при наличии
  ключа, чистое развёртывание сходится к no-op; ошибка не блокирует старт
  (логи `oauth_tokens_reencrypted` / `oauth_token_sweep_failed`).
- **Production**: startup validation (`lib/startupValidation.ts`) требует
  ключ, когда сконфигурирован хотя бы один OAuth-провайдер (client id любого
  из Discord/Yandex/Google/VK или `TELEGRAM_BOT_TOKEN`); ключ не base64-32
  байта → ошибка старта. Частично сконфигурированный провайдер — warning,
  провайдер остаётся честно выключенным.
- **Компрометация ключа**: сменить ключ **и** инвалидировать все
  провайдер-токены (пользователи перелогиниваются через провайдеров; старые
  шифротексты под новым ключом не расшифровываются — `decryptProviderToken`
  возвращает `null`, а не «открывается»). Процедура —
  [SECURITY](../architecture/SECURITY.md), § «Секреты и окружение».

## Дизайнерские заметки (реальное состояние)

- Uniform-ошибка логина и bcrypt — anti-enumeration; email-матч без verified
  запрещён (PREVENT account takeover через непроверенный email провайдера).
  Для VK ID флаг `email_verified` — тот же инвариант.
- Зарегистрированные провайдеры: Discord, Yandex, Google, VK ID (redirect) и
  Telegram (direct-login). Apple/Sber остаются примерами в интерфейсе
  `IIdentityProvider`, но **не реализованы**.
- Refresh токенов провайдера не реализован (интерфейсный `refreshToken?` не
  используется); провайдер-токены перезаписываются только новым логином/link.
- Список сессий устройства/«выйти со всех устройств» не реализован (сессии
  управляются только refresh/logout/реюзом; смена пароля ревоцирует все
  прочие сессии).
