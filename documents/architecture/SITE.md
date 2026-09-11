# SITE — архитектура веб-компонента (site/)

Область: `site/web` (Next.js) + `site/server` (Express API).
Поверхность API: [API](../api/README.md); схема данных: [DATA](DATA.md).

## Server: слоение

```
site/server/src/
├── index.ts          — boot: enforceEnvironmentValidation → createApp → listen :3001
│                       + jobs (reconciliation, serverMonitoring) + graceful shutdown
├── app.ts            — фабрика Express: middleware-цепочка и монтаж роутеров
├── routes/           — HTTP-слой: валидация входа (zod/validateCuid), авторизация,
│                       вызовы lib-сервисов, формирование ответов/ошибок
├── lib/              — сервисы домена и утилиты (auth, commerce, ledger, drm,
│                       follows, activity, serverAccess, …), 30+ модулей
├── middleware/       — requestId, observability (метрики + security headers),
│                       validate (zod), validateCuid (UUID v4)
├── prisma/           — contract.prisma (единственная схема), сгенерированный
│                       клиент (contract.d.ts/json), db.ts (подключение)
├── jobs/             — reconciliation, serverMonitoring (setInterval-планировщики)
├── cli/              — drm.ts: keygen / test-installation / generate-nonce / info
└── scripts/, sandbox/, migrations/, tests/
```

Правило направления зависимостей: `routes → lib → prisma`; lib-сервисы не
импортируют Express. Данные всегда через contract ORM
(`db.orm.public.<Model>`), идентификаторы — UUID v4.

Модели: **68 моделей** в `site/server/src/prisma/contract.prisma` (полный
список по доменам — [DATA](DATA.md)).

### Middleware-цепочка (`app.ts`)

1. `trust proxy 1` (если `TRUST_PROXY !== "false"`)
2. `express.json({limit:"10mb"})`
3. `cookieParser()`
4. `requestIdMiddleware` — `req.id`, структурированные логи
5. `observabilityMiddleware` — метрики (`http_requests_total`, `http_5xx_total`,
   `http_latency_ms`) + security headers/CSP (`middleware/observability.ts`)
6. CORS — allowlist `CORS_ORIGINS`, `credentials:true`
7. `standardRateLimit` (Redis)
8. Доменные роутеры (порядок — [API README](../api/README.md))
9. Глобальный error handler (4-аргументный, JSON 500)
10. JSON 404 handler

Boot-валидация окружения: `lib/startupValidation.ts` — обязательные
prod-переменные (JWT_SECRET, DATABASE_URL, Discord OAuth), сильный
JWT_SECRET в production, предупреждения по рекомендованным.

## Server: фоновые jobs (`index.ts`, `jobs/`)

| Job | Интервал | Что делает |
|---|---|---|
| `jobs/reconciliation.ts` | `RECONCILIATION_INTERVAL_MS`, по умолчанию 24 ч | финансовая сверка: платежи/рефонды/provider events/internal ledger (`lib/reconciliation/`); no-op в test; ручные команды `reconciliation:run`, `reconciliation:summary` |
| `jobs/serverMonitoring.ts` | `SERVER_MONITORING_INTERVAL_MS`, по умолчанию 60 c (первый прогон через 15 c после старта) | sweep: stale heartbeat → UNKNOWN (никогда OFFLINE), истёкшие review-токены → EXPIRED (`lib/serverMonitoring.ts`); выключается `SERVER_MONITORING_ENABLED=false` |

Оба планировщика: single-flight guard, отключены при `NODE_ENV=test`,
останавливаются в graceful shutdown.

## Web: структура (`site/web/src/app`, app router)

| Маршрут | Файл |
|---|---|
| `/` (Home: live + activity + marketplace) | `page.tsx` |
| `/resources`, `/resources/[slug]` | `resources/page.tsx`, `resources/[slug]/page.tsx` |
| `/sellers/[username]`, `/seller`, `/seller/new` | `sellers/[username]/page.tsx`, `seller/page.tsx`, `seller/new/page.tsx` |
| `/services/[slug]`, `/services/orders` | `services/[slug]/page.tsx`, `services/orders/page.tsx` |
| `/servers`, `/servers/create`, `/servers/[slug]`, `/servers/[slug]/manage`, `/servers/[slug]/news/[id]` | `servers/**` |
| `/community`, `/community/forum/[category]`, `/community/forum/thread/[id]` | `community/**` |
| `/content`, `/content/articles/[slug]`, `/content/new`, `/content/mine` | `content/**` |
| `/news`, `/search`, `/profile/[username]` | `news/page.tsx`, `search/page.tsx`, `profile/[username]/page.tsx` |
| `/notifications`, `/dashboard`, `/disputes`, `/disputes/[id]` | соответствующие `page.tsx` |
| `/auth/login`, `/auth/register`, `/auth/callback` | `auth/**` |
| `/account`, `/admin` | `account/page.tsx`, `admin/page.tsx` |

Служебный код: `src/lib/` (`api.ts` — axios-клиент; `api-ext.ts` — типизированные
хелперы и типы; `domain.ts`; `utils.ts`), `src/store/auth.ts` (zustand:
accessToken в памяти, user, `clearAuth`), `src/components/`.
Зависимости: axios, @tanstack/react-query, zustand 5, Next 15.5, React 19,
Tailwind 3; workspace-пакет `@mta-market/shared` (transpilePackages).

## Web → API

`site/web/src/lib/api.ts`:

- **baseURL**: `NEXT_PUBLIC_API_URL` (дефолт `http://localhost:3001`);
  `withCredentials: true` (HttpOnly refresh cookie ходит всегда).
- **Request interceptor**: подставляет `Authorization: Bearer <accessToken>`
  из zustand-стора (токен только в памяти).
- **Refresh interceptor (single-flight)**: на любой `401` (кроме самого
  `/auth/refresh`) — один общий `POST /auth/refresh` (параллельные 401 ждут
  одну и ту же promise), затем ровно один ретрай исходного запроса с новым
  токеном; при провале — `clearAuth()` и редирект на
  `/auth/login?error=session_expired`.
- **bootstrapSession()** — обмен cookie на access-токен + `GET /auth/me`
  при загрузке приложения.
- **Rewrite-режим same-origin**: при `NEXT_PUBLIC_API_URL="/api"` Next.js
  проксирует `/api/:path*` → `API_PROXY_TARGET` (дефолт `http://127.0.0.1:3001`)
  (`site/web/next.config.ts`) — тот же паттерн, что nginx в production:
  браузер не покидает origin, CORS и cross-site cookie не нужны.

Производственный вариант этой же топологии — nginx (см.
[SYSTEM](SYSTEM.md)); префикс `/api` стрипается до бэкенда.

## Связанные документы

- Аутентификация/сессии: [AUTH](../api/AUTH.md).
- Безопасность слоёв: [SECURITY](SECURITY.md).
- Фоновые сверки и миграции: [DATABASE-MIGRATIONS](../operations/DATABASE-MIGRATIONS.md).
