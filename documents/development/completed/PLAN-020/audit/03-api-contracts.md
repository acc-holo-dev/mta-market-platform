# PLAN-020 — 03 API Contracts Audit (разделы D-001..D-005, P-001..P-004)

Аудит-only. Зона: `site/server/src/routes/` (48 файлов), `app.ts`, `middleware/`, `lib/errors.ts`/`dbErrors.ts`,
канонический контракт (`contracts/api/`), фронт-клиенты (`site/web/src/lib/api.ts`, `api-ext.ts`, `lib/api/*`, `queries.ts`),
observability (`lib/logger.ts`, `lib/metrics.ts`, `requestId`). Все утверждения снабжены `файл:строка`.

Метод: полный extract 333 маршрутов из 48 роутеров (perl multiline по `router.<verb>("...")`), сравнение с 6 YAML-инвентаризациями
`contracts/api/` и вызовами клиента (`grep` по `api.<verb>(` в `site/web/src`), сплошной подсчёт форм ошибок, clamp'ов пагинации
и call-sites метрик.

Сводка: **17 находок — 0 critical, 5 high, 7 medium, 5 low.**

---

## D-001.1 — Канонический OpenAPI — пустой стаб (paths: {}), контракт ≠ машиночитаем

- severity: high
- verdict: REPLACE
- current: `contracts/api/openapi.yaml:45` — `paths: {}`; файл сам признаёт «formalization in progress» (openapi.yaml:1-4).
  Вместо path items — 6 YAML-инвентаризаций произвольного формата (`domain:`/`endpoints:`, например
  `contracts/api/marketplace.yaml:4-6`), не валидируемых как OpenAPI. Единственная схема — `ErrorEnvelope` (openapi.yaml:29-44);
  ни одного request/response schema, статус-кодов, auth-требований per-endpoint. Скриптов синхронизации и тестов на дрейф нет
  (`grep -rln "openapi" scripts/ site/server/scripts/` — пусто; tests не ссылается на contracts/api).
- change: генерировать OpenAPI 3.1 из реализации (zod-схемы уже есть: `lib/validation.ts`, per-router zod в deals/subscriptions/adminPlatform —
  `zod-openapi`/`@asteasolutions/zod-to-openapi` на этапе сборки), пути брать из дерева `app.ts`; инвентаризации `contracts/api/*.yaml`
  вывести из генератора, а не руками. Добавить CI-тест «routes ↔ openapi» (supertest-обход списка маршрутов против спеки).
- reason: сейчас «контракт» нельзя ни закодогенерить, ни прогнать drift-тестом; единственная поддерживаемая вручную инвентаризация
  устарает при каждом PR (уже устарела — см. D-001.2).
- risk: генерация с первого раза не покроет root-mounted роутеры (`app.ts:246-255` — favorites/alerts/subscriptions/deals/demo/feedback/follows
  смонтированы на `/` с абсолютными путями внутри) — tree-парсер app.ts даст неполный список; нужно явное дерево маунтов.
- verification: `pnpm --filter server exec tsc --noEmit` + новый тест `contracts/api/openapi.yaml` содержит все 333 маршрута;
  `npx @redocly/cli lint contracts/api/openapi.yaml` — 0 ошибок.

## D-001.2 — ~93 эндпоинта Wave-6/PLAN-017 вне контракта; 6 существующих инвентаризаций уже разошлись с кодом

- severity: high
- verdict: FIX
- current: инвентаризации покрывают только 6 доменов (auth/marketplace/commerce/servers/community/content, `contracts/api/*.yaml`,
  derived 2026-09-11 по заголовку `openapi.yaml:2-4`). Вне контракта целиком: deals (10), subscriptions (9), favorites (10), alerts (4),
  feedback (4), demo (5), leak (4), trust (2), updates (2), discounts (6), sellerPayouts (3), advertising (6), adminPlatform (12),
  adminFinance (5), adminPremium (4), adminAdvertising (6), config (1), media (1), upload (4: `/upload/avatar`, `/upload/screenshot`
  не описаны даже в marketplace.yaml — там только resource/media). Итого ~93 маршрута без единой записи о контракте.
  Дрейф в существующих инвентаризациях:
  - authentication.yaml:9-23 не содержит `GET /auth/sessions` (auth.ts:438), `DELETE /auth/sessions/:id` (auth.ts:470),
    `DELETE /auth/sessions` (auth.ts:499) — при этом web их использует (`site/web/src/lib/api/identity.ts:105-119`).
  - commerce.yaml:13-22 не содержит `GET /payments/transactions/mine` (payments.ts:836-843).
  - marketplace.yaml versions/reviews не содержит `POST /resources/:slug/rollback` (versions.ts:245-249),
    `GET /resources/:slug/versions/:version/download` (versions.ts:376-380), `DELETE /resources/:slug/reviews` (reviews.ts:186).
  - servers.yaml:12-20 не содержит staff CRUD (servers.ts:574, 614), resources-attach (servers.ts:771, 852), follow (servers.ts:898, 926).
- change: дополнить инвентаризации (или сгенерировать — см. D-001.1) для всех 18 вне-контрактных роутеров и 4 дрейфов выше;
  `last_verified` в `contracts/compatibility/api.yaml:3` обновлять скриптом, а не вручную.
- reason: контракт заявлен источником истины (`site/shared/src/types.ts:4-7`), но для 2/3 поверхности это неверно; клиенты и
  модуль-клиенты (`contracts/module/`) сверяются с устаревшим списком.
- risk: правки маршрутов будут проходить незамеченными; сторонний интегратор по contracts/ получит 404.
- verification: дифф маршрутов (`routes-map` extract) против `contracts/api/*.yaml` — 0 расхождений; скрипт в CI.

## D-001.3 — Дрейф клиент→сервер: админ-UI вызывает несуществующие эндпоинты (гарантированные 404)

- severity: high
- verdict: FIX
- current:
  - `site/web/src/lib/api/resources.ts:478-481` — `adminVersionCompatibility()` делает `GET /admin/versions/${id}/compatibility`;
    бэкенд имеет только `POST /admin/versions/:id/verify` (`site/server/src/routes/admin.ts:640-648`), GET-эндпоинта compatibility нет
    нигде (`grep -rn "compatibility" site/server/src/routes/` — только verify-запись и trust/updates-проекции). Вызов в мутации
    `site/web/src/features/admin/versions/VersionsSection.tsx:38`.
  - `site/web/src/lib/api/commerce.ts:253-256` — `adminTransitionDispute()` делает `POST /admin/disputes/${id}/transition`;
    бэкенд имеет только `POST /disputes/:id/transition` с `requireRole("ADMIN")` (`routes/disputes.ts:258`), маунт `/disputes`
    (`app.ts:202`) — путь `/admin/disputes/...` попадает в 404-handler (`app.ts:279-281`). Вызов:
    `site/web/src/features/admin/disputes/DisputesSection.tsx:40`.
- change: выбрать одну сторону на каждый случай: (а) клиент → `POST /admin/versions/:id/verify` и `POST /disputes/:id/transition`
  (гвард ADMIN уже на бэке), либо (б) добавить бэко-эндпоинты под задокументированные пути; в обоих — записать путь в контракт.
  Добавить CI-проверку «все пути из site/web/src/lib/api/* существуют на бэке» (extract как в D-001.1).
- reason: две фичи админки (запись верификации совместимости версии; смена статуса спора) сейчас неработоспособны из UI.
- risk: при смене путей на бэке сломаются внешние потребители; менять пути бэка не рекомендуется — править клиент.
- verification: `curl -X GET $API/admin/versions/<cuid>/compatibility` до/после; e2e SectionsSection/DisputesSection; drift-тест в CI.

## D-001.4 — Спот-чек 10 ключевых роутов: статус-коды и формы соответствуют инвентаризациям, кроме перечисленного

- severity: low
- verdict: KEEP
- current: спот-чек (auth, search, deals, subscriptions, adminPlatform, payments, resources, services, notifications, admin users) —
  статус-коды соответствуют поведению: auth refresh 401 на reuse (auth.ts:310-320), simulate 404/403/409/400 (payments.ts:957-971),
  disputes transition 409 на illegal transition (disputes.ts:269), deals 404 outsiders (deals.ts:48-53). Legacy-формы ответа:
  envelope `data`+`pagination` соблюдается в list-роутах (admin.ts:414-421, adminPlatform.ts:1161-1166, notifications.ts:47-53),
  но adminPlatform возвращает лишние дубли полей `total/page/limit` рядом с `pagination` (adminPlatform.ts:1161-1166) — см. D-004.2.
- change: фиксировать статус-коды в генерируемой спеке (D-001.1), отдельного рефакторинга не требует.
- reason: расхождений статус-кодов с инвентаризациями не найдено; документировать нечего.
- risk: нет.
- verification: contract-тесты по спеке (см. D-001.1).

## D-002.1 — Фронт-клиент не генерируется: ~149 ручных DTO против 6 типов в shared, codegen-инструментов нет

- severity: medium
- verdict: REPLACE
- current: `grep -c "export interface|export type"` по `site/web/src/lib/api/*.ts` = 149 объявлений (resources.ts — 43, finance.ts — 28,
  admin.ts — 21, advertising.ts — 19…); `site/shared/src/types.ts` — 6 типов (User, AuthResponse, Balance, MeUser, Pagination,
  Paginated), `api-ext.ts:33-39` реэкспортирует 5 из них. `Resource` дублируется web-стороной с комментарием «shared не определяет»
  (`lib/api/resources.ts:15-41`). Codegen отсутствует: в `site/web/package.json` нет openapi-typescript/orval/swagger (scripts: dev/build/
  start/lint/type-check), по repo `grep "openapi|codegen|orval" **/package.json` — 0 совпадений. Клиент — ручной fetch-обёртка
  `lib/api.ts:246-257` с `data: any` по умолчанию (`lib/api.ts:61-64`).
- change: после D-001.1 сгенерировать типы и paths-клиент из OpenAPI (openapi-typescript + openapi-fetch или orval) в пакет
  `@mta-market/api-types`; доменные модули `lib/api/*` оставить как тонкие обёртки (query-фичи, FormData), но их DTO импортировать из
  генерата. 149 интерфейсов сверить с серверными проекциями при переносе (Resource/ResourceVersion/Review — первые кандидаты).
- reason: ручные DTO уже показали дрейф (D-001.3) и «опциональные» поля на веру (`resources.ts:688-727` defensive-типы с
  `?: ... | null` вместо контракта).
- risk: генерированные типы строже — часть call-site'ов (any-кастов) не скомпилируется; мигрировать доменами, начиная с identity/payments.
- verification: `pnpm --filter web type-check` зелёный; `grep -c "export interface" site/web/src/lib/api/*.ts` падает к нулю по доменам.

## D-003.1 — Каноническая ошибка: lib/errors.ts — мёртвый код (0 импортёров), 733 legacy-ответа, 4 формы envelope

- severity: high
- verdict: FIX
- current: `lib/errors.ts:1-131` (ApiError, toErrorPayload, canonicalCodeForStatus) не импортирует ни один файл —
  `grep -rn "lib/errors" site/server/src site/web/src` → 0; `toErrorPayload` упоминается только в собственном определении
  (errors.ts:98). Реально в API 4 формы ошибок:
  1. `{error: "string"}` — 733 места в 46 файлах (grep `json({ error: "` по routes/) — доминирующая;
  2. `{error: {code, message}}` — только DRM v2 (24 места, `routes/drm/v2.ts:70-189`), без requestId;
  3. `{error: "string", code: "..."}` — 20+ мест: payments.ts:298,311,823,827,993,997; subscriptions.ts:44; advertising.ts:210,273;
     deals.ts (mapError, deals.ts:33-40); purchases.ts:83-87; services.ts:239; sellerPayouts.ts:40; adminFinance.ts:213; resources.ts:810;
  4. `{error: "string", retryAfter}` (429) — lib/rateLimit.ts:40-45; `{error, details}` (400) — middleware/validate.ts:22-26.
  Глобальный обработчик тоже legacy: `{error: "Internal server error"}` (app.ts:272), 404 `{error: "Not found"}` (app.ts:280-281).
  requestId не входит ни в один error payload (`grep -rn "requestId" routes/ | grep -v filter` — только поля аудита/фильтры SystemLog).
  Правило «две формы не смешиваются в одном роуте» (errors.ts:6-9) нарушает сам auth.ts: 44 legacy + 9 structured (auth.ts:240,255,263 против auth.ts:303-398).
- change: (1) подключить `toErrorPayload` в глобальный обработчик app.ts:262-275 и 404-handler (app.ts:279-281) с `requestIdOf(req)`
  (errors.ts:128-131 → заменить на req.id из middleware/requestId.ts); (2) конвертировать ApiError-броски вместо `res.status().json()`
  в тех же хелперах, где сейчас mapError-паттерн (deals.ts:33-40, subscriptions.ts:41-46, payments.ts:296-315 и т.п.); (3) мигрировать
  формы 1/3 на канон по одному роуту, начиная с auth.ts (44+9), payments (17), admin (…) — серийная замена grep'ом;
  (4) tighten `ErrorEnvelope` в shared (`site/shared/src/errors.ts:5-7`) и OpenAPI (openapi.yaml:29-44) до одной формы после миграции.
- reason: контракт `contracts/api/openapi.yaml:30-44` и план D-003 определяют `{error:{code,message,requestId}}`; фактически он
  существует только в DRM v2; `getErrorMessage` на фронте (`site/shared/src/errors.ts:14-30`) уже понимает обе формы — миграция
  на фронте не требуется.
- risk: клиенты, сравнивающие `error` как строку (`typeof raw === "string"` ветка в getErrorMessage), при каноне получат code вместо
  message — смягчается порядком чтения message→code в getErrorMessage (errors.ts:18-24); e2e-тесты на тексты ошибок потребуется обновить.
- verification: grep `json({ error: "` по routes/ → 0; интеграционный тест на любую ошибку проверяет `{code,message,requestId}`;
  `curl $API/resources/unknown-slug` → 404 canonical.

## D-003.2 — Утечка сырого исключения в ответе

- severity: medium
- verdict: FIX
- current: `routes/auth.ts:796` — `res.status(401).json({ error: error instanceof Error ? error.message : "Telegram login failed" })`:
  текст внутреннего исключения провайдера (verifyDirectLogin — HMAC/widget-валидация) уходит клиенту. Остальные 2 совпадения
  (drm/v2.ts:431, auth.ts:794) — поля логов, не ответы.
- change: заменить на фиксированное `{error:{code:"OAUTH_CALLBACK_FAILED", message:"Telegram login failed", requestId}}`;
  детали — в reqLog (auth.ts:794-795 уже пишет).
- reason: единственное место прямого `error.message` → response; правило errors.ts:95-97 «unknown errors collapse to 500 INTERNAL».
- risk: нет (сообщение константное).
- verification: `curl -X POST /auth/telegram/callback -d 'bad payload'` → сообщение не содержит internals; grep по routes/ на
  `error.message` в res.* → 0.

## D-004.1 — Пагинация фрагментирована: ≥6 схем clamp, 2 списка без лимита вовсе, план-список покрыт частично

- severity: high
- verdict: FIX
- current: единого контракта нет. Clamp-варианты (default/max): `paginationSchema` 20/100 (`lib/validation.ts:65-68` — использует
  только resources.ts:482), servers 12/50 (`servers.ts:23-28`), community 20/50 (`community.ts:20-24`), notifications 20/50
  (`notifications.ts:16`), serverNews 10/50 (`serverNews.ts:91,393`), serverReviews 10/50 (`serverReviews.ts:28`), news 12/50
  (`news.ts:15`), content 9/30 (`content.ts:335`), search 5/20 (`search.ts:104`), activity 5..50 (`activity.ts:26-27`),
  adminCommunity 20/100 (`adminCommunity.ts:33`), adminPlatform parsePage(20,100) на каждый вызов (`adminPlatform.ts:102-109`),
  deals/subscriptions zod max 100 без default (`deals.ts:110-114`), adminFinance 20..50/100 (`adminFinance.ts:80,94`),
  favorites константа 100 (`favorites.ts:20,234`). `admin.ts:390` — `Math.min(parseInt(limit),100)` без нижней границы
  (limit=0 → skip NaN). Проверка план-списка D-004 (users/resources/servers/activity/notifications/transactions/audit/search):
  paginated — admin users (×2 реализации: admin.ts:383-424, adminPlatform.ts:300+), resources (resources.ts:479-536), servers
  (servers.ts:92), activity (activity.ts:24-28), notifications (notifications.ts:12-53), audit (adminPlatform.ts:1137-1166),
  search (search.ts:104); transactions — `GET /payments/transactions/mine` жёстко BOUND=50 без page/limit «by design»
  (payments.ts:838-843) — не соответствует единому контракту пагинации (нет page/limit, нет cursor).
  Unbounded-эндпоинты (`.all()` без limit):
  - `GET /services` — services.ts:40-51;
  - `GET /services/my` — services.ts:53-64;
  - `GET /services/orders/my` — services.ts:248-261 (плюс N+1: Service.where(...).first() на каждую покупку, services.ts:252-255);
  - `GET /seller/list` (admin) — seller.ts:164-176;
  - `GET /seller/analytics` — seller.ts:35-41 (все ресурсы продавца + все view-строки за 30д без лимита).
- change: один хелпер `parsePaging(query, {defaultLimit, maxLimit})` + одна константа MAX_LIMIT=100 в `lib/validation.ts`;
  zod-схема `paginationSchema` — единственная точка; перенос clamp'ов на неё (12 файлов). Для 5 unbounded — `.limit(MAX_LIMIT)`
  с честным `pagination` или `total`; `/payments/transactions/mine` — добавить page/limit с default 50.
- reason: план D-004 требует «один контракт пагинации» и «reject unbounded list endpoints»; сейчас разные max → один и тот же
  limit=50 валиден для одних эндпоинтов и 400/игнор для других, unbounded — прямой DoS-вектор (таблица services/seller безлимитна).
- risk: у потребителей, зашитых на дефолтные размеры (content 9, search 5), ничего не меняется — менять только max-клампы и
  добавлять limit к unbounded; фронт `lib/api/*` уже передаёт page/limit.
- verification: grep `\.all\(\)` в routes/ — 0 без `.limit`/`.offset` на list-путях; один unit-тест на parsePaging (0/NaN/отрицательные);
  `curl '/services?limit=1000'` → ≤100.

## D-004.2 — Envelope списка: 7 вариантов ответа, включая дубли полей

- severity: medium
- verdict: MERGE
- current: базовый `{data, pagination}` (admin.ts:414-421, notifications.ts:47-53), плюс варианты: `{events, total, page, limit, pagination}`
  с дублированием total/page/level поверх pagination (adminPlatform.ts:1161-1166), `{users, total, page, limit}` без pagination
  (adminPlatform.ts:329, 384), `{entries, total}` (adminPlatform.ts:1111), `{type, items}` (adminPlatform.ts:1415),
  `{data, total}` без pagination (services.ts:49, seller.ts:172), `{payments, refunds, purchases}` — три плоских массива
  (payments.ts:843+), cursor-форма `{versions, nextCursor}` (updates.ts:241).
- change: один list-envelope `{data, pagination{page,limit,total,pages}}` (+ опционально `nextCursor` для updates как отдельный
  documented-вариант); убрать дубли total/page/limit в adminPlatform audit-events; транзакции/transactions/mine оставить вложенной
  группировкой, но добавить pagination.
- reason: два фронта-потребителя (admin.ts API-модуль, finance.ts) вынуждены знать 7 форм; генерация типов (D-002) невозможна
  без единого envelope.
- risk: админ-фронт читает `events`/`entries`/`users` — переименование в `data` затронет `lib/api/admin.ts:392+` и
  `features/admin/*`; мигрировать точечно, поля держать back-compat один релиз.
- verification: grep `res.json({ data: .* pagination` — все list-роуты; type-check web после переключения DTO.

## D-005.1 — Бюджеты ответов: карточки без проекции полей, 10mb body-лимит, дубль-агрегаты

- severity: medium
- verdict: FIX
- current: `cardsWithAggregates()` (resources.ts:404-410) не делает top-level `.select()` — карточки листинга несут полные строки
  Resource, включая `description` (до 5000 символов, `lib/validation.ts:14`), ×limit до 100 (paginationSchema) → до ~0.5MB на страницу
  листинга; то же для `/services` (полные строки, services.ts:41-45). `express.json` глобально 10mb (app.ts:107-113) — на порядок
  выше любого легитимного JSON-запроса API (максимальные body — changelog 10000 симв., `lib/validation.ts:33`). Замеры бюджета
  (size/query count) отсутствуют: ни теста, ни метрики.
- change: `.select(...)` для карточек ресурсов (id/slug/title/price/type/cover/rating/reviewCount/seller/discount) — поля, которые
  реально читает DTO `Resource` фронта (lib/api/resources.ts:17-41); снизить JSON-лимит до 1mb (webhook rawBody остаётся — лимит
  к ним не применяется отдельно, провайдерские payload'ы < 64kb); зафиксировать бюджет: list ≤ 100 записей/страница, тест на
  размер ответа `GET /resources?limit=100` (assert < 256KB).
- reason: план D-005 «measure response size and query count, set limits» — сейчас ни измерений, ни лимитов поля.
- risk: выпиливание description из карточек может задеть страницы, читающие description из списка — проверено: DTO `Resource`
  фронта объявляет description обязательным (lib/api/resources.ts:21), но карточные page-компоненты используют его только на
  детальной странице (`resources/[slug]`); прогнать e2e home/search.
- verification: `curl -s '/resources?limit=100' | wc -c` до/после; supertest-бюджет-тест в CI; `explain`-запросы не меняются.

## P-001.1 — request-id: обрыв на границе outbox→worker; отсутствует в error payload'ах и refund-аудите

- severity: medium
- verdict: FIX
- current: HTTP→логи — есть: requestIdMiddleware ставит req.id + child logger `{request_id}` (middleware/requestId.ts:21-29),
  доступ-лог пишет request_id (requestId.ts:31-40). HTTP→SystemLog/AuditLog — частично: `logUnhandled` берёт req.id
  (`lib/systemLog.ts:132`), маршруты передают `requestId: req.id` точечно (serverNews.ts:283, community.ts:576, admin.ts:179 и др.),
  НО: (1) ни один error payload не содержит requestId (grep по routes/ — только фильтры SystemLog, adminPlatform.ts:1148,1198);
  (2) outbox-события не несут request_id: `emitOutbox(dbOrTx, type, payload)` (lib/events.ts:108-119) — payload без requestId на всех
  3 call-sites (admin.ts:199, admin.ts:243, lib/commerce.ts:592); worker не биндит request_id вовсе (worker/index.ts:105-375 — нет
  logger.child с request id); (3) refund-аудит от «system» без requestId (lib/refunds.ts:358-363 — AuditInput без requestId,
  `lib/audit.ts:36-39` пишет null); (4) webhook-цепочка платежей сохраняет request-id вебхука только в логах текущего запроса —
  после emitOutbox (PAYMENT_SUCCEEDED) асинхронные уведомления теряют контекст.
- change: (1) включить requestId в канон ошибок (D-003.1 делает это автоматически через toErrorPayload+requestIdOf);
  (2) `emitOutbox` — добавить опциональный `requestId` в payload конвенцией `payload._requestId` (или колонку OutboxEvent.requestId)
  и биндить `logger.child({request_id})` в worker-диспетчере (worker/index.ts:230-310); (3) refund/commerce audit — пробрасывать
  requestId из вызова (payments.ts имеет req на момент вызова refunds).
- reason: план P-001 требует сквозной trace HTTP→логи→audit→worker→payment→notifications; сейчас цепочка рвётся ровно на
  асинхронной границе, и расследование «что случилось с этим платежом» невозможно по одному id.
- risk: добавление колонки OutboxEvent — миграция Prisma; payload-конвенция `_requestId` не требует миграции (рекомендуется
  начать с неё).
- verification: e2e-тест: web-запрос с X-Request-Id → создать покупку → найти SystemLog/outbox event/worker-лог по этому id;
  error-ответ содержит тот же id.

## P-002.1 — Структурные логи: ядро соответствует; access-log без errorCode; secrets-редактирование централизовано

- severity: low
- verdict: KEEP
- current: `lib/logger.ts:60-85` — каждый entry: `level, service ("mta-market-api"), timestamp (ISO), message` + bindings/fields;
  JSON-режим в production (logger.ts:58), pretty в dev. Access-log (middleware/requestId.ts:33-39): route, method, status,
  duration_ms, user_id — но нет `errorCode` (план P-002 требует). Редактирование секретов: центральный `redact()` по ключу
  (logger.ts:22-46: access/refresh token, password, secret, authorization, credentials, cookie, bearer). `console.*` вне логгера —
  70 мест, но все в CLI (`src/cli/drm.ts`) и startup-валидации (`lib/startupValidation.ts:212-233`); в request-path (routes/, lib/) — 0.
  Сырой dump `req.body`/headers в логи не найден (grep — только деструктурированные поля).
- change: добавить `errorCode` в access-log finish-хук: error-обработчик (app.ts:269) и ApiError-пути кладут `res.locals.errorCode`
  (или парсинг из payload при отправке), requestId.ts:31-40 пишет его в лог-строку.
- reason: соответствие P-002 почти полное; отсутствие errorCode мешает алертам по кодам (RATE_LIMITED vs INTERNAL).
- risk: нет.
- verification: `LOG_FORMAT=json pnpm dev` + `curl /resources/unknown` → в access-строке присутствует `errorCode:"NOT_FOUND"`.

## P-003.1 — Метрики: HTTP-набор и 5 доменных счётчиков живые; 6 объявленных серий никогда не инкрементятся (вечный 0)

- severity: medium
- verdict: FIX
- current: живые (реальные call-sites): http_requests_total / http_5xx_total / http_latency_ms (middleware/observability.ts:30-34),
  download_failures_total (routes/versions.ts:411), sandbox_failures_total (lib/sandbox/service.ts:50), email_failures_total
  (lib/email.ts:52), payment_success_total (routes/payments.ts:647,688). Мёртвые (объявлены, 0 call-sites — проверено grep по src):
  `incLicenseVerifyFailure` (metrics.ts:105-107 — DRM verify-фейлы не считаются), `recordOutboxDepth` / `incOutboxDeadLetter` /
  `incOutboxProcessed` (metrics.ts:135-157 — при этом комментарий metrics.ts:127-128 уверяет, что «worker reports depth each poll cycle»,
  но worker/index.ts не вызывает ни один метрик-хелпер), `payment_webhook_lag_ms`, `db_latency_ms`, `redis_latency_ms`
  (METRIC_HELP metrics.ts:95-97 — никогда не наблюдаются). Рендер печатает 0 для пустых серий (metrics.ts:64-66), поэтому
  /metrics выглядит живым, но по этим сериям статичен.
- change: либо подключить, либо удалить: (а) license_verify_failures — inc в drm/v2.ts ветках verify/heartbeat-failures;
  (б) outbox_* — worker/index.ts: poll-цикл вызывает recordOutboxDepth(claimBatch-длина), incOutboxProcessed/incOutboxDeadLetter
  в completeEvent/failEvent-путях (worker/index.ts:274-310); (в) webhook lag — payments.ts webhook-обработчик меряет
  `Date.now() - providerEventAt`; (г) db/redis latency — обёртки не добавлять (шум), удалить из METRIC_HELP честнее.
  Если серия оставлена «на потом» — пометить в комментарии и исключить из render до подключения.
- reason: P-003: «no fake/static metrics» — вечные нули хуже отсутствия серии (алерты по ним сработают как ложные «всё ок»/«0 ошибок»).
- risk: подключение outbox-метрик добавляет 1-2 записи в Redis-free registry — безрисково; удаление серий может сломать внешние
  дашборды, если они уже скрейпятся (проверить infra/ на алерты).
- verification: `curl -s :3001/metrics` — каждая серия имеет доказуемый инкремент: инициировать событие (например, сломанный
  verify-запрос DRM) и увидеть рост; grep-тест в CI: каждая константа METRIC_HELP/OUTBOX_HELP имеет ≥1 call-site.

## P-004.1 — OpenTelemetry отсутствует полностью; collector'а нет — рекомендация: не внедрять до появления бэкенда трасс

- severity: low
- verdict: DEFER
- current: зависимостей @opentelemetry/* нет в site/server/package.json (deps: express, ioredis, jsonwebtoken, multer, nodemailer,
  @prisma/*, zod — проверено cat site/server/package.json); кода трассировки нет (`grep -rn "opentelemetry|otel|traceparent|trace_" src/`
  → 0). Наблюдаемость держится на: structured logs (logger.ts) + Prometheus registry (metrics.ts, /metrics — app.ts:175-178) +
  SystemLog/AuditLog в БД. Запрос-id — собственный middleware, не W3C traceparent.
- change: ничего не внедрять сейчас. Условия для пересмотра: ≥2 реальных инцидента, где потребовался бы cross-service trace
  (worker↔API↔провайдер), и развёрнутый collector (Jaeger/Tempo/Grafana Agent) в docker-compose + решение хранить trace_id
  (тогда — заменить/дополнить request_id middleware на otel SDK, HTTP+DB+Redis+worker+providers — по плану P-004).
- reason: «observability infrastructure with no collector» — прямой анти-паттерн плана; текущий стек (single API + single worker,
  Redis, Postgres) полностью покрывается логами+метриками; otel SDK добавил бы ~10 зависимостей и cold-start-оверхед без потребителя.
- risk: при внедрении позже — request_id ↔ trace_id склейка потребует ретро-миграции логов; хранить request_id уже сейчас (P-001.1).
- verification: grep opentelemetry в lock-файле остаётся пустым до решения; при внедрении — спан HTTP/DB/Redis виден в collector.

## D-003.3 — Rate-limit/429 и 503 ответы вне канона; retryAfter в body, не в заголовке

- severity: low
- verdict: FIX
- current: `lib/rateLimit.ts:40-45` — `{error: "Too many requests", retryAfter: n}` (нет code/requestId; retryAfter телом, а не
  стандартным заголовком Retry-After); fail-closed 503 — `{error: "Rate limiter temporarily unavailable"}` (rateLimit.ts:54,
  133); per-account 429 — `{error: "Too many requests for this action"}` (rateLimit.ts:124-126).
- change: перевести на канон (429 `{code:"RATE_LIMITED"}` + заголовок Retry-After; 503 `{code:"SERVICE_UNAVAILABLE"}`) вместе с
  D-003.1 — helper'ы уже есть (errors.ts:60-61, 66-67).
- reason: 429/503 — самые частые не-200 ответы; их коды важны для клиента (single-flight refresh на фронте различает 401/429).
- risk: фронт не читает retryAfter-поле (grep site/web/src — 0 совпадений), ломаться нечему.
- verification: `curl -b` auth-bruteforce-тест → 429 c `Retry-After` header и canonical body.

## D-001.4b — Дублированная админ-поверхность с зависимостью от порядка маунта

- severity: medium
- verdict: MERGE
- current: `GET /admin/users` и `PATCH /admin/users/:id/role` реализованы дважды: adminPlatform.ts:300+ (permission-catalog,
  §37/§41) и admin.ts:383+ (role-based `adminOnly`, admin.ts:30-37). Достижимость legacy-версии зависит только от порядка
  регистрации (app.ts:203-210 — комментарий обязывает adminPlatform быть раньше); остальные legacy-пути (/admin/resources,
  /admin/stats, /admin/versions/*) остаются на admin.ts. Аналогично `/admin/deals*` живёт внутри root-mounted deals.ts
  (deals.ts:277-297), а не в admin*-роутерах; favorites/alerts/subscriptions/deals/demo/feedback/follows смонтированы на `/`
  с абсолютными путями (app.ts:246-255) — поверхность API не выводится из дерева маунтов без чтения каждого файла.
- change: перенести user-management adminPlatform → единственная реализация; удалить дубли из admin.ts (оставив
  не-пересекающиеся /admin/resources, /stats, /versions, /reviews); при генерации контракта (D-001.1) — фиксировать
  фактический полный URL каждого роутера в таблице маунтов (машиночитаемо, не комментарием).
- reason: два разных authz-гейта на одном пути (role-строка vs permission-каталог lib/permissions.ts) — расхождение прав
  в зависимости от порядка кода; для J-003-аудитов это минa.
- risk: удаление legacy-дублей затронет потребителей, вызывающих `PATCH /admin/users/:id/role` в ожидании legacy-семантики —
  пути совпадают, тело/ответ различаются (adminPlatform возвращает userProjection, admin.ts:623-623 — голый статус); сверить
  `site/web/src/lib/api/admin.ts` (использует /admin/users: оба варианта).
- verification: grep `router.(get|patch)("/users"` routes/ → 1 совпадение; интеграционный тест на оба права (USER.role=ADMIN
  vs permission users.view).

## D-004.3 — Contract-документированная фича «Idempotency-Key» фронтендом не используется

- severity: low
- verdict: DEFER
- current: сервер honoring `Idempotency-Key` на POST /purchases и /payments/create|refunds (routes/purchases.ts:21,
  routes/payments.ts:132,794,939 — lib/idempotency.js); контракт фиксирует это (contracts/api/commerce.yaml:16,19,22);
  фронт-клиент не отправляет ключ ни на одном call-site (`grep -rn "Idempotency" site/web/src` → 0).
- change: после стабилизации пагинации/ошибок — добавить генерацию ключа (uuid per checkout-попытку) в commerce-модуль
  `lib/api/commerce.ts` (createPurchase/createPayment) — защита от double-submit.
- reason: серверная часть уже есть и протестирована; клиентский сценарий «двойной клик по оплате» возвращает duplicate-payment
  через withIdempotency — но без ключа он не защищён.
- risk: нет (additive header).
- verification: двойной submit checkout в e2e → одна Payment-запись; network-трейс содержит Idempotency-Key.

---

## Приложение A — фактическая поверхность (extract из кода, 333 маршрута / 48 роутеров)

Домены вне контракта (D-001.2), число маршрутов: deals 10, subscriptions 9, adminPlatform 12, favorites 10, advertising 6,
adminAdvertising 6, discounts 6, serverNews 9(6 недокументированы), feedback 4, adminFinance 5, adminPremium 4, demo 5,
alerts 4, leak 4, follows 7 (community.yaml покрывает), sellerPayouts 3, trust 2, updates 2, config 1, integration 2
(servers.yaml покрывает), media 1, adminContent 4 (content.yaml покрывает), adminCommunity 9 (частично), DRM v1 4 + v2 8
(contracts/drm/v2/protocol.yaml — заморожен, вне зоны).

Формы ответов-ошибок: 4 (см. D-003.1). Формы list-envelope: 7 (см. D-004.2). Схемы clamp: 16 (см. D-004.1).

## Приложение B — что уже хорошо (не трогать)

- Единый request-id middleware с валидацией входящего заголовка и access-log (requestId.ts:18-43) — KEEP.
- Централизованный redact-список секретов в логгере (logger.ts:22-46) — KEEP.
- DRM v2 — единственный домен с каноническими ошибками {error:{code,message}} (24/24 мест, drm/v2.ts) и замороженным
  контрактом contracts/drm/v2/protocol.yaml — KEEP как эталон формы.
- fetch-клиент с single-flight refresh и axios-парностью ошибкой (site/web/src/lib/api.ts:179-239) — KEEP.
- React Query key-factory с политикой token-free ключей (site/web/src/lib/queries.ts:1-24) — KEEP.
- Honest-total пагинация через aggregate count (admin.ts:400-407, adminPlatform.ts:1152-1160) — KEEP.