# SERVERS — серверный домен, интеграция, отзывы с токенами

Область: `site/server/src/routes/{servers,serverNews,serverReviews,integration}.ts`,
`site/server/src/lib/{serverAccess,serverIntegration,serverMonitoring}.ts`.
Общие условия: [README](README.md).

Роли на сервере (`lib/serverAccess.ts`): `OWNER` (источник истины —
`Server.ownerId`, member-строка дублирует), `ADMIN`, `MODERATOR`.
`canManage` = OWNER|ADMIN (новости/обновления/брендинг/приватность);
`canModerateCommunity` = OWNER|ADMIN|MODERATOR. Публичные lifecycle:
`VERIFIED`, `ACTIVE` (`PUBLIC_SERVER_LIFECYCLES`); скрытые — `CREATED`,
`PENDING_VERIFICATION`, `SUSPENDED`, `ARCHIVED`. Все приватные поля
(host/port, статистика при `showStats=false`) фильтруются **в бэкенде**,
не в UI.

## Регистрация и discovery (`routes/servers.ts`)

| Маршрут | Кто | Поведение |
|---|---|---|
| `GET /servers?page&limit&q&sort` | публично | только VERIFIED/ACTIVE; `q` по name/description; `sort=players` (дефолт) сортирует по реальному `playerCount` (без значения — в конец), `newest` — по createdAt; карточка = `publicServerFields` + `followerCount` + `rating` (по VISIBLE-отзывам) |
| `POST /servers` (`authenticate`, per-user 10/ч) | любой | `{name (3–60), description≤8000, host?, port? 1–65535, region?, websiteUrl?, discordUrl?}`; slug генерируется; lifecycle `CREATED`, verification `PENDING`, monitoring `UNKNOWN`; создаётся `ServerMember(OWNER)`; audit |
| `GET /servers/my` (`authenticate`) | владелец | серверы, где роль OWNER (по member-строкам) |
| `GET /servers/:slug` | публично | страница: `server` (приватность-фильтр: `playerCount/maxPlayers/lastSeenAt` = null при `showStats=false`), `caller{isStaff, role, following}`, `privacy{showStats, showStaff, showResources, showCommunity, showTechStack}`; не публичный сервер — 404 для не-персонала |
| `PATCH /servers/:slug` | OWNER/ADMIN | name/description; `logoUrl/bannerUrl` — только `/media/<name>`; `accentColor` — `#RRGGBB`; `websiteUrl/discordUrl` — http(s); host/port/region (приватные, никогда не рендерятся публично) |
| `DELETE /servers/:slug` | OWNER | архивирование: lifecycle→ARCHIVED, `playerCount=null`, monitoring UNKNOWN (строки не удаляются) |

## Приватность (`PATCH /servers/:slug/privacy`)

Только OWNER. Булевы переключатели `showResources`, `showStaff`,
`showTechStack`, `showStats`, `showCommunity`. Решение о видимости всегда
принимает бэкенд: статистика, персонал, ресурсы и сообщество при
`false` не отдаются вовсе (`{enabled:false}`), независимо от UI.

## Верификация владения (integration-token)

- `POST /servers/:slug/integration-token` (OWNER) — выпуск/ротация секрета
  модуля: `smk_` + 32 байта hex (`lib/serverIntegration.ts`); в БД — только
  SHA-256 (`integrationTokenHash`) + `integrationTokenIssuedAt`; plaintext
  возвращается **ровно один раз** (`201 {token, server}`). Перевыпуск
  VERIFIED-сервера сбрасывает verification в PENDING (note объясняет);
  CREATED → PENDING_VERIFICATION.
- `GET /servers/:slug/verification` (персонал) — `{verification, note,
  verifiedAt, issuedAt, hasToken}`.
- Подтверждение владения — первый валидный heartbeat модуля:
  `verification PENDING → VERIFIED`, lifecycle `CREATED/PENDING_VERIFICATION →
  VERIFIED` (audit от actor `system`) — см. [Интеграция](#интеграция-module-routesintegrationts).

## Персонал (`/servers/:slug/staff`)

- `GET` — публично только при `showStaff=true` (иначе `{visible:false, data:[]}`);
  персонал видит всегда. Поля: `{userId, role, username, displayName, avatar}`.
- `POST` (OWNER) — назначить/обновить `{userId, role: ADMIN|MODERATOR}`
  (+уведомление MODERATION); `201`.
- `DELETE /servers/:slug/staff/:userId` (OWNER) — убрать (владельца убрать
  нельзя — 400).

## Управление (`GET /servers/:slug/manage`, персонал)

Дашборд владельца: `{server, staffRole, stats:{followerCount, reviewCount,
rating, draftNewsCount, resourceCount}, recentNews[5], recentUpdates[5],
heartbeat:{staleMs, fresh, lastSeenAt}}`. Свежесть heartbeat —
`lib/serverMonitoring.ts` (`SERVER_HEARTBEAT_INTERVAL_SECONDS`, по умолчанию 60 с).

## Связи «используемые ресурсы» (ServerResource)

- `POST /servers/:slug/resources` (OWNER/ADMIN) — `{resourceId?|displayName,
  note?}`: явная ссылка (может быть и без marketplace-ресурса);
  audit `server.resource.link`.
- `DELETE /servers/:slug/resources/:rowId` (OWNER/ADMIN).
- `GET /servers/:slug/resources` — публично только при `showResources=true`
  (иначе `{enabled:false, data:[]}`); marketplace-ресурсы резолвятся только в
  PUBLISHED (`{displayName, slug, coverUrl, note}`).

## Follow и статистика

- `POST /servers/:slug/follow` (`authenticate`, per-user 120/ч) — подписка
  (идемпотентна: повтор возвращает `{following:true}`); `DELETE` — отписка.
  Подписчики живут только в `ServerFollow`; публично — агрегат.
- `GET /servers/:slug/statistics?range=24h|7d|30d` — публично (VERIFIED/ACTIVE)
  при `showStats=true` (иначе `{enabled:false}`): peak/average/uptimePct по
  реальным `ServerStatusSample` за окно, сэмплы прореживаются до ≤200 точек;
  `{enabled, range:{hours,label}, data:{peak, average, uptimePct, sampleCount,
  current:{state, players, maxPlayers, lastSeenAt}, samples[]}}`.

## Новости и обновления сервера (`routes/serverNews.ts`)

Новость — один объект `ServerNews` для всех поверхностей (страница сервера,
глобальная лента, дашборд). Управление: `canManage` (OWNER/ADMIN) или автор.

| Маршрут | Поведение |
|---|---|
| `GET /servers/:slug/news` | публично PUBLISHED (персонал видит и DRAFT); пагинация |
| `POST /servers/:slug/news` | создать DRAFT: `{title 3–120, content ≤50000, coverUrl? /media/<name>}`; per-user 30/ч |
| `PATCH /servers/:slug/news/:id` | правка (canManage или автор) |
| `POST /servers/:slug/news/:id/publish` | DRAFT→PUBLISHED (`publishedAt`); опция `{createDiscussion:true}` создаёт форум-тред, связанный с сервером **и** новостью (H-004); уведомления подписчикам SERVER_NEWS (dedup, actor исключён); audit; сброс activity-кэша; ответ `{news, thread}` |
| `GET /servers/:slug/news/:id` | публичная страница новости (не-PUBLISHED — только персонал/автор); включает связанный тред и автора |
| `DELETE /servers/:slug/news/:id` | canManage или автор; audit |

Обновления (отдельная сущность `ServerUpdate`, I-001):

- `GET /servers/:slug/updates` — публичная история, пагинация.
- `POST /servers/:slug/updates` — публикация сразу: `{version ≤40,
  title 3–120, changelog 3–20000}`; дубликат версии — 409; опциональный
  тред обсуждения (только связь с сервером — dedicated FK нет); уведомления
  SERVER_UPDATE; per-user 30/ч.
- `DELETE /servers/:slug/updates/:id` — canManage.

## Отзывы сервера (`routes/serverReviews.ts`)

Отзыв возможен **только** после одноразового токена взаимодействия
(`✓ Verified Interaction` = подтверждённое взаимодействие, не оценка контента).

- `GET /servers/:slug/reviews` — публично, VISIBLE-отзывы; `{data[],
  stats:{total, averageRating, verifiedCount}, pagination}`.
- `GET /servers/:slug/reviews/eligibility` (`authenticate`) — `{eligible,
  reason, alreadyReviewed, verifiedInteraction}`; персоналу — запрет с
  объяснением.
- `POST /servers/:slug/review-token/claim` (`authenticate`, per-user 10/ч) —
  `{token}`: replay-protection — conditional update `ACTIVE→CONSUMED`
  (`consumedBy`); неизвестный/чужой сервер — `400` (один ответ, без утечки
  причины); уже использован/истёк — `409`; персонал — `403`. Успех: создаёт
  `ServerReviewEligibility(serverId, userId, tokenId)`, ответ `201 {eligible:true,
  verifiedInteraction:true}`.
- `POST /servers/:slug/reviews` (`authenticate`, per-user 5/ч) — требуется
  eligibility (403 иначе); `rating 1..5`, `comment ≤5000`; один отзыв на
  пользователя (409); уведомление владельцу REVIEW_EVENT.
- `PATCH` / `DELETE /servers/:slug/reviews` — правка/отзыв своего отзыва;
  eligibility сохраняется после удаления (анти-абьюз: отзыв не «сжигает» право).
- Скрытие/восстановление модерацией: `PATCH /admin/server-reviews/:id`
  ([COMMUNITY](COMMUNITY.md)).

## Интеграция module (`routes/integration.ts`)

Wire-протокол, который реализует нативный модуль (компонент `module/`)
([DRM-CLIENT](../module/DRM-CLIENT.md), market_client). Аутентификация —
possession интеграционного токена (`smk_…`); БД ищет сервер по
`integrationTokenHash`. Только агрегаты — никаких player identity/IP/чат (§33).

- `POST /integration/heartbeat` — `{token, state?: ONLINE|OFFLINE, players?,
  maxPlayers?}`. Эффекты: monitoring ONLINE (OFFLINE — только graceful-отчёт
  самого сервера), `lastSeenAt`, `playerCount`, `maxPlayers`, sample в
  `ServerStatusSample`; первый валидный heartbeat — верификация (см. выше).
  Ответ `{status:"ok", monitoring, verification}`. Ошибки: 401 (токен),
  403 (SUSPENDED/ARCHIVED).
- `POST /integration/review-tokens` — `{token, note?, ttlMinutes?}` (TTL
  клампится 5 мин … 7 дней, дефолт 24 ч): создаёт одноразовый review-токен
  (`rtk_…`), привязанный к серверу; в БД — хэш; ответ
  `201 {reviewToken, expiresAt}`. Токен выдаётся сервером игроку в игре;
  платформа никогда не узнаёт, кто игрок.
- Тишина heartbeat не считается OFFLINE: sweep-job (`site/server/src/jobs/
  serverMonitoring.ts`, интервал `SERVER_MONITORING_INTERVAL_MS` 60 с)
  переводит в UNKNOWN и гасит истёкшие токены; OFFLINE ставится только
  явным отчётом сервера.

## Админ-модерация серверов (`routes/adminCommunity.ts`, ADMIN/MODERATOR)

- `GET /admin/servers`, `GET /admin/servers/:id` — инспекция.
- `PATCH /admin/servers/:id/status` — lifecycle (ACTIVE/SUSPENDED/ARCHIVED/VERIFIED) + уведомление владельцу + audit.
- `PATCH /admin/servers/:id/verification` — approve/reject с причиной.
- `PATCH /admin/server-news/:id`, `PATCH /admin/server-reviews/:id` —
  unpublish/restore, hide/restore.
- Репорты на SERVER/NEWS/REVIEW — [COMMUNITY](COMMUNITY.md).
