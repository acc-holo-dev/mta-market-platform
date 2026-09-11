# API — справочник поверхности MTA Market API

Область: REST-поверхность Express API (`site/server`). Документы описывают
**реализованное** поведение; источники истины — файлы
`site/server/src/routes/*.ts` и `site/server/src/app.ts`.

Продуктовая модель сущностей: [PRODUCT-MODEL](../product/PRODUCT-MODEL.md).
Целевая продуктовая поверхность: [PRODUCT-SURFACE-MAP](../product/PRODUCT-SURFACE-MAP.md)
(там, где продуктовые документы описывают состояние дальше реализованного,
в доменных документах стоит пометка).

## Базовые URL

| Режим | URL | Комментарий |
|---|---|---|
| dev | `http://localhost:3001` | web на :3000 → API :3001 кросс-доменно; CORS и `COOKIE_SAMESITE=none` обязательны (`site/server/src/app.ts`, `site/server/src/lib/cookies.ts`) |
| dev, same-origin | `/api` на origin web :3000 | Next.js rewrite `/api/:path*` → `:3001/:path*` (`site/web/next.config.ts`, включается `NEXT_PUBLIC_API_URL="/api"`) |
| production | `https://<host>/api/*` | nginx стрипает префикс: `location /api/ { proxy_pass http://backend/; }` — `/api/auth/login` попадает в бэкенд как `/auth/login` ([nginx.conf](../../infrastructure/nginx/nginx.conf)) |

Прочие порты: API слушает `PORT` (по умолчанию 3001), web — 3000. Бэкенд
доверяет одному proxy-хопу (`trust proxy 1`), пока `TRUST_PROXY !== "false"` —
`req.ip` = реальный клиент для rate-limit и audit-полей.

Служебные маршруты (глобальные, до доменных): `GET /` (инфо-JSON),
`GET /health`, `GET /live` (только процесс), `GET /ready` (DB обязателен,
Redis опционален), `GET /metrics` (Prometheus text 0.0.4).

## Аутентификация

- **Access-токен** — JWT (`HS256`, секрет `JWT_SECRET`), `type: "access"`,
  TTL `JWT_ACCESS_EXPIRY` (по умолчанию 15 м). Передаётся заголовком
  `Authorization: Bearer <token>` (`site/server/src/lib/auth.ts`).
- **Refresh-токен** — JWT `type: "refresh"` с уникальным `jti`, TTL 7д
  (`JWT_REFRESH_EXPIRY`); хранится в HttpOnly cookie `refresh_token`,
  в БД — только SHA-256 хэш (`site/server/src/lib/tokenSecurity.ts`).
- Access- и refresh-токены структурно различны: refresh не принимается как
  access и наоборот (`site/server/src/lib/jwt.ts`).
- Payload: `{ userId, email, role }`, роли `USER | ADMIN | MODERATOR`.

Роль-гейты: `authenticate` (401), `requireRole(role)` (403);
`adminOnly`-паттерн в админских роутах пропускает `ADMIN` **и** `MODERATOR`.

## Ошибки (envelope)

Единый вид — JSON, поле `error`:

```json
{"error": "Too many requests"}                      // строка (исторический вид)
{"error": {"code": "VALIDATION_ERROR", "message": "…"}}  // структурный вид
```

Смешение форматов — реальное состояние кода: домены PLAN-001..007
(login/refresh/DMR/discounts/checkout) отдают `{code,message}`, старые
маршруты — строку. Глобальный обработчик (`app.ts`) отдаёт
`500 {"error":"Internal server error"}`, неизвестный маршрут —
`404 {"error":"Not found"}`. Частные случаи:

- Zod-валидация (`site/server/src/middleware/validate.ts`):
  `400 {"error":"Validation failed","details":[{path,message}]}`;
- валидация UUID-параметров (`validateCuid`, ids — UUID v4, имя middleware
  историческое): `400 {"error":"Invalid ID format","message":…}`;
- лимиты: `429 {"error":"Too many requests","retryAfter":<s>}`; при недоступном
  Redis у fail-closed групп — `503 {"error":"Rate limiter temporarily unavailable"}`.

## Rate limiting (`site/server/src/lib/rateLimit.ts`)

Ключ = IP (`req.ip`), счётчик Redis `INCR`+`PEXPIRE`; заголовки ответа
`X-RateLimit-Limit` / `X-RateLimit-Remaining`. Значения максимумов
конфигурируются env (в production пинятся в
[production.yml](../../infrastructure/docker/compose/production.yml)).

| Группа | Окно | max по умолчанию | Поведение при отказе Redis |
|---|---|---|---|
| `standardRateLimit` (глобальная, на все запросы) | 1 мин | 300 (`STANDARD_RATE_LIMIT_MAX`) | fail-open; `RATE_LIMIT_FAIL_CLOSED=true` переводит в fail-closed |
| `strictRateLimit` (DRM v2, `/upload/media`, `/upload/resource`) | 1 мин | 10 (`STRICT_RATE_LIMIT_MAX`) | fail-closed (503) |
| `authRateLimit` (login/register/refresh/logout/OAuth) | 15 мин | 300 (`AUTH_RATE_LIMIT_MAX`) | fail-closed (503) |
| `userRateLimit` (на аккаунт+действие, префикс `rlu:<action>`) | задаётся на месте | задаётся на месте | fail-closed (503); отключён при `NODE_ENV=test` |

Некоторые per-action лимиты: login 10/мин, refresh 30/мин, checkout 30/мин,
отзыв ресурса 20/ч, тема форума 10/ч, пост 60/ч, репорт 10/ч, сервер 10/ч,
server_follow 120/ч, claim review-токена 10/ч, отзыв сервера 5/ч,
серверные новости 30/ч, обновления 30/ч, статьи 20/ч, правка статьи 40/ч.
Группы, определяющие auth-поверхность: см. [AUTH](AUTH.md).

На edge (nginx) дополнительно: `api_limit` 10 r/s burst 20 на `/api/`,
`auth_limit` 5 r/s burst 10 на `/api/auth/`, `client_max_body_size 100M`.

## Промежуточный слой — порядок из `app.ts`

```
trust proxy 1 (если TRUST_PROXY !== "false")
express.json({ limit: "10mb" })
cookieParser()
requestIdMiddleware            (req.id + логи)
observabilityMiddleware        (метрики http_requests_total/http_5xx_total/http_latency_ms
                                + security headers — см. [SECURITY](../architecture/SECURITY.md))
CORS (allowlist CORS_ORIGINS, credentials: true)
standardRateLimit
→ доменные роутеры (таблица ниже)
→ global error handler (4-аргументный; 500 JSON)
→ 404 JSON handler
```

Ссылка на SECURITY вне блока: [SECURITY](../architecture/SECURITY.md).

## Смонтированные роутеры (в порядке `app.ts`)

| Префикс | Файл | Документ |
|---|---|---|
| `/auth` | `routes/auth.ts` | [AUTH](AUTH.md) |
| `/resources` | `routes/resources.ts` + `routes/versions.ts` + `routes/reviews.ts` | [MARKETPLACE](MARKETPLACE.md) |
| `/drm` (v2 затем v1) | `routes/drm/v2.ts`, `routes/drm.ts` | [DRM](DRM.md) |
| `/purchases` | `routes/purchases.ts` | [COMMERCE](COMMERCE.md) |
| `/upload` | `routes/upload.ts` | [MARKETPLACE](MARKETPLACE.md) |
| `/media` | `routes/media.ts` | [MARKETPLACE](MARKETPLACE.md) |
| `/payments` | `routes/payments.ts` | [COMMERCE](COMMERCE.md) |
| `/services` | `routes/services.ts` | [COMMERCE](COMMERCE.md) |
| `/seller`, `/sellers` | `routes/seller.ts`, `routes/sellers.ts` | [MARKETPLACE](MARKETPLACE.md) |
| `/disputes` | `routes/disputes.ts` | [COMMERCE](COMMERCE.md) |
| `/admin` (3 роутера) | `routes/admin.ts`, `adminCommunity.ts`, `adminContent.ts` | по доменам: [MARKETPLACE](MARKETPLACE.md), [SERVERS](SERVERS.md), [COMMUNITY](COMMUNITY.md), [CONTENT](CONTENT.md) |
| `/servers` (3 роутера) | `routes/servers.ts`, `serverNews.ts`, `serverReviews.ts` | [SERVERS](SERVERS.md) |
| `/community` | `routes/community.ts` | [COMMUNITY](COMMUNITY.md) |
| `/notifications` | `routes/notifications.ts` | [COMMUNITY](COMMUNITY.md) |
| `/reports` | `routes/reports.ts` | [COMMUNITY](COMMUNITY.md) |
| `/integration` | `routes/integration.ts` | [SERVERS](SERVERS.md) |
| `/profiles` | `routes/profiles.ts` | [COMMUNITY](COMMUNITY.md) |
| `/search` | `routes/search.ts` | [MARKETPLACE](MARKETPLACE.md) |
| `/news` | `routes/news.ts` | [CONTENT](CONTENT.md) |
| `/dashboard` | `routes/dashboard.ts` | [CONTENT](CONTENT.md) |
| `/activity` | `routes/activity.ts` | [CONTENT](CONTENT.md) |
| `/content` | `routes/content.ts` | [CONTENT](CONTENT.md) |
| `/` (root mount) | `routes/follows.ts` — абсолютные пути `/creators/...`, `/resources/:slug/follow`, `/me/follows/...` | [COMMUNITY](COMMUNITY.md) |

Схема данных (`site/server/src/prisma/contract.prisma`, 68 моделей):
[DATA](../architecture/DATA.md).

## DRN-модуль и серверная интеграция

- DRM-протокол v2 (машинный API `/drm/v2/*`): [DRM](DRM.md).
- Интеграция MTA-сервера (heartbeat + review-токены, `/integration/*`):
  [SERVERS](SERVERS.md).
- Клиентская сторона в модуле: [DRM-CLIENT](../module/DRM-CLIENT.md),
  [RUNTIME](../module/RUNTIME.md), Lua API: [LUA-API](../module/LUA-API.md).
