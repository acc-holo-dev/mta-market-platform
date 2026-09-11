# AUTH — аутентификация и сессии

Область: `site/server/src/routes/auth.ts`, `site/server/src/lib/{jwt,cookies,tokenSecurity,identityProvider}.ts`,
провайдеры `site/server/src/lib/providers/{discord,yandex,google}.ts`.
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

## OAuth-провайдеры (Discord / Yandex / Google)

Реестр-паттерн: интерфейс `IIdentityProvider`
(`lib/identityProvider.ts`), реализации саморегистрируются side-effect
импортами в `routes/auth.ts` из `lib/providers/{discord,yandex,google}.ts`.
Провайдер недоступен без env (client id/secret + redirect) — маршруты отвечают
`404 {"error":"Provider not available"}`.

| Маршрут | Назначение |
|---|---|
| `GET /auth/:provider` | редирект на authorize URL; ставит CSRF-cookie `oauth_state` (HttpOnly, 10 мин); при Bearer-заголовке дополнительно ставит `link_user` (link-режим) |
| `GET /auth/:provider/link` (`authenticate`) | явный link-режим: cookie `link_user` = свежий access-токен |
| `GET /auth/:provider/callback` | обмен `code` на токены; проверка `state` против cookie (`400 {"error":"Invalid state"}` при несовпадении, cookies очищаются) |

Callback, **login-режим**:

- `Account` по `(provider, providerAccountId)`: если найден — вход
  существующего пользователя, токены провайдера обновляются.
- Нет `Account`: match по email допустим **только** при
  `user.verified === true`; иначе создаётся новый User (email — реальный при
  verified, иначе синтетический `<providerId>@<provider>.local`; username —
  санитизированный + суффикс hex при коллизии), `emailVerified` ставится при
  verified-email, welcome-письмо отправляется на реальный email (best-effort).
- Сессия: refresh-токен в HttpOnly cookie, БД — хэш, новый `tokenFamily`.
- Ответ: редирект `${FRONTEND_URL}/auth/callback`.

Callback, **link-режим** (есть cookie `link_user`):

- `409 {"error":"Identity already linked to another account"}` — идентичность
  занята другим пользователем; повторный link идемпотентен (редирект
  `/account/identities?linked=1`); иначе создаётся `Account` и редирект туда же.

### GET /auth/identities (`authenticate`)

Список привязок текущего пользователя; **токены провайдеров никогда не
отдаются**: `[{id, provider, providerAccountId}]`.

### DELETE /auth/identities/:id (`authenticate`)

Отвязка своей идентичности. Нельзя отвязать последний метод входа:
`409 {"error":"Cannot unlink the only login method"}`; чужая/несуществующая
— 404.

## Дизайнерские заметки (реальное состояние)

- Uniform-ошибка логина и bcrypt — anti-enumeration; email-матч без verified
  запрещён (PREVENT account takeover через непроверенный email провайдера).
- Провайдеры Telegram/Apple/Sber упомянуты в интерфейсе `IIdentityProvider`
  как возможные, но **не реализованы** — зарегистрированы только 3 провайдера
  выше.
- Список сессий устройства/«выйти со всех устройств» не реализован (сессии
  управляются только refresh/logout/реюзом).
