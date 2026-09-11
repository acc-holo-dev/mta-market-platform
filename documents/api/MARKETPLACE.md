# MARKETPLACE — ресурсы, версии, отзывы, продавцы, загрузки

Область: `site/server/src/routes/{resources,versions,reviews,seller,sellers,upload,search}.ts`,
`routes/media.ts`, плюс релизный lifecycle из `routes/admin.ts`.
Общие условия: [README](README.md).

## Ресурсы (`routes/resources.ts`)

Состояния листинга: `DRAFT → PENDING_REVIEW → PUBLISHED / SUSPENDED`.
Матрица переходов — `lib/moderation.ts`: продавец может только
`DRAFT→PENDING_REVIEW` (submit) и `PENDING_REVIEW→DRAFT` (withdraw);
publish/suspend/unsuspend/unpublish — только модерация
(`PATCH /admin/resources/:id/status`, см. [Админ-поверхность](#админ-поверхность-маркетплейса-routesadmints)).

Цена — целое в копейках, валюта всегда RUB.

### GET /resources

Лимит: standard. Query-контракт:

| Параметр | Значения |
|---|---|
| `q` | подстрока по title / description / имени продавца (ILIKE; ветки объединяются по id — у ORM нет OR) |
| `type` | enum `SCRIPT\|MAP\|MODEL\|TEXTURE\|SOUND\|GAMEMODE` |
| `price` | `free` (=0) / `paid` (>0) |
| `sort` | `newest` (дефолт) / `rating` / `price_asc` / `price_desc` / `popular` |
| `page`, `limit` | пагинация, лимит ограничен `paginationSchema` |

Всегда только `PUBLISHED`. Ответ: `{data:[card], pagination:{page,limit,total,pages}}`,
карточка = ресурс + `seller{username,displayName,avatar}` + `rating` (округлённый
avg отзывов, `null` при их отсутствии) + `reviewCount`. `rating`/`popular`
сортируют выборку, ограниченную 1000 id, в памяти (агрегаты отзывов/покупок);
`popular` = число завершённых покупок (COMPLETED).

### GET /resources/homepage

Один запрос с трёх секций: `newest` (8), `popular` (8; при отсутствии покупок
деградирует в высокий рейтинг отзывов — честный сигнал), `free` (8).
Формат карточек — как в `GET /resources`.

### GET /resources/my (`authenticate`)

Все ресурсы текущего продавца (`{data, total}`), новые сверху.

### GET /resources/:slug

Публичная карточка: базовые поля + `resourceFollowers` (агрегат, список
подписчиков не отдаётся) + `screenshots[]` (`{id,url,position}` по возрастанию
`position`). Не-PUBLISHED для не-владельца = 404.

### POST /resources (`authenticate`)

Требуется **APPROVED** SellerProfile (`lib/permissions.ts`, PLAN L-002):
иначе `403 {error: sellerGateMessage(), code:"seller_approval_required"}`.
Тело: `title, description, type, price, slug` (валидация — `createResourceSchema`).
Уникальность slug — `409`. Создаётся со статусом `DRAFT`. Ответ `201`.

### PATCH /resources/:slug (`authenticate`, владелец)

Обновляет `title, description, price` (в копейки через `Math.round(price*100)`);
`status` — только переходы продавца (см. выше), иная попытка —
`403 {"error":"Forbidden status transition", message:…}`.

### DELETE /resources/:slug (`authenticate`, владелец)

Удаляет ресурс + best-effort чистит медиа-файлы (обложка и скриншоты).

### POST /resources/:slug/view

Публичный честный счётчик просмотров (PLAN-010): инкремент `ResourceViewDaily`
(`resource × day`), без идентичностей зрителя. Только для PUBLISHED, иначе 404.
Ответ `{ok:true}`. Значения видит только продавец (`GET /seller/analytics`).

## Медиа ресурса (`routes/resources.ts`, медиа-блок)

URL-контракт: все URL обязаны ссылаться на ранее загруженное через
`POST /upload/media` (`/media/<name>`; произвольные URL отклоняются).
Редактирование доступно только в статусах `DRAFT | PENDING_REVIEW` — иначе
`409 {"error":"Оформление опубликованного ресурса изменить нельзя…"}`.
Владелец — всегда. Максимум 8 скриншотов (`MAX_SCREENSHOTS_PER_RESOURCE`).

| Маршрут | Действие |
|---|---|
| `PUT /resources/:slug/media/cover` | `{url}` — установить/заменить обложку; старый файл удаляется |
| `DELETE /resources/:slug/media/cover` | снять обложку |
| `POST /resources/:slug/media/screenshots` | `{url}` — добавить скриншот (`201`); дубликат/превышение лимита — 409 |
| `DELETE /resources/:slug/media/screenshots/:mediaId` | удалить; позиции нормализуются |
| `PUT /resources/:slug/media/screenshots/order` | `{ids:[…]}` — полный порядок, иначе 400 |
| `GET /resources/:slug/media` (владелец) | `{coverUrl, screenshots[], editable}` — состояние для редактора |

Публичная раздача: `GET /media/:name` — только имена
`media-<hex>.<png|jpg|jpeg|webp|gif>`; S3-режим: 302 на
`MEDIA_PUBLIC_BASE_URL/media/<name>` или стрим из приватного бакета;
immutable-кэширование (`routes/media.ts`).

## Версии (`routes/versions.ts`) и релизный lifecycle

Release-статусы `ResourceVersion.releaseStatus`:
`CANDIDATE → VERIFIED → PUBLISHED`, плюс `DEPRECATED`, `YANKED`.

- Создание версии — `POST /resources/:slug/versions` (владелец): тело
  `{version, changelog?, fileUrl, fileSize, fileChecksum, dependencies?[]}`.
  `fileUrl` обязан ссылаться на артефакт, загруженный через
  `POST /upload/resource` (внешние URL — `400`). Pipeline: статическая
  валидация (+sandbox при доступном Docker, `lib/sandbox/service.ts`) →
  провал валидации откатывает версию (`422 {error:"Artifact validation failed",
  validation:…}`) → канонический манифест + SHA-256 + Ed25519 подпись
  (`lib/artifact/signing.ts`). Заявленные зависимости пишутся в
  `ResourceDependency`. Если ресурс уже PUBLISHED — система возвращает его в
  `PENDING_REVIEW` (re-moderation, `ModerationEvent`), ответ содержит
  `reenteredReview: true`, `artifactHash`, `manifestHash`. Ответ `201`.
- `GET /resources/:slug/versions` — публичный список версий PUBLISHED-ресурса,
  новые сверху.
- `GET /resources/:slug/versions/:version/download` (`authenticate`):
  право — COMPLETED покупка этого пользователя. Текущая политика: строгий
  матч версии (`purchase.versionId === resourceVersion.id`), иначе
  `403 {"error":"Version not entitled", …, purchasedVersion, requestedVersion}`
  (обновления отдельно не включены — честная пометка в коде: TODO update
  policy). Результат: в S3-режиме JSON
  `{downloadUrl, version, fileSize, checksum, expiresIn}` (short-lived signed
  URL, TTL из `lib/s3.ts`); в локальном dev — файл стримится через этот
  endpoint; в production без S3 — `500 {"error":"S3 must be enabled in production"}`.
- Верификация совместимости и yank — админские:
  `POST /admin/versions/:id/verify` (`{status: VERIFIED|PARTIALLY_VERIFIED|UNKNOWN|FAILED, mtaVersion?, os?, architecture?, notes?}` →
  создаёт `CompatibilityReport`; VERIFIED-отчёт двигает `CANDIDATE→VERIFIED`) и
  `POST /admin/versions/:id/yank` (`{reason}` обязателен → `YANKED`; YANKED
  блокирует **новые** lease, старые доживают до истечения — [DRM](DRM.md)).
- `PUBLISHED`-статус версии проставляется массово при одобрении ресурса
  модерацией (для `CANDIDATE`/`VERIFIED` версий), с уведомлениями покупателям
  и подписчикам (`routes/admin.ts`).

## Отзывы на ресурсы (`routes/reviews.ts`)

- `GET /resources/:slug/reviews` — публично, `{data, stats:{total, averageRating},
  pagination}`; avg считается по всем отзывам, а не по странице.
- `POST /resources/:slug/reviews` (`authenticate`, per-user 20/ч): требуется
  COMPLETED покупка (403 иначе); продавец не может отзываться на себя
  (PLAN K-001, 403); один отзыв на пользователя (409). `rating` 1..5.
- `PATCH /resources/:slug/reviews` / `DELETE` — правка/удаление своего отзыва.

## Продавец (`routes/seller.ts`)

- `GET /seller/profile` — свой SellerProfile (`{profile: …|null}`).
- `POST /seller/apply` — заявка `{displayName?, supportInfo?}` → статус
  `PENDING`, `payoutEnabled=false`. Повтор — `409` (возвращает существующий).
- `PATCH /seller/profile` — только `displayName`, `supportInfo`; статус не
  меняется (модерация пересматривает изменения — политика L-003);
  `payoutEnabled` платформенно-контролируемый.
- `GET /seller/analytics` (`authenticate`) — аналитика создателя (PLAN-010):
  за 30 дней `views30d` (из `ResourceViewDaily`, приватные агрегаты), `purchases30d`
  (COMPLETED), `conversionPct` по каждому PUBLISHED-ресурсу; итоги
  `{days, totalViews, totalPurchases, byResource[]}`.
- Модераторские (смонтированы в том же роутере): `GET /seller/list?status=`
  (`requireRole("ADMIN")`), `POST /seller/:userId/approve` (ADMIN; →
  `APPROVED`, `payoutEnabled=true`, audit), `POST /seller/:userId/reject`
  (ADMIN; `{reason}` обязателен).

## Публичная витрина продавца (`routes/sellers.ts`)

`GET /sellers/:username` — публичная карточка: `{seller:{username, displayName,
avatar, supportInfo (только APPROVED), memberSince, resourceCount,
creatorFollowers (агрегат)}, resources[]}` (только PUBLISHED, с rating/
reviewCount). Витрина 404, если нет APPROVED-профиля и нет опубликованных
ресурсов.

## Загрузки (`routes/upload.ts`)

| Маршрут | Лимит | Тело (multipart) | Ответ |
|---|---|---|---|
| `POST /upload/media` (`authenticate`, strict) | 5 МБ, только картинки (magic-byte sniff) | поле `file` | `201 {url:"/media/<name>", mimeType, sizeBytes, storage:"s3"\|"local"}` |
| `POST /upload/resource` (`authenticate`, strict) | 100 МБ | поле `file` | `201 {fileUrl, fileKey, fileName, fileSize, fileChecksum(sha256), mimeType, storage}`; S3-режим сохраняет ключ объекта, не публичный URL |
| `POST /upload/avatar` (standard) | 5 МБ, картинки | поле `avatar` | `201 {avatarUrl:"/media/<name>", storage}`; аватар в БД пока **не** сохраняется (TODO в коде) |
| `POST /upload/screenshot` (standard) | 5 МБ, картинки | поле `screenshot` | `201 {screenshotUrl:"/media/<name>", storage}` — legacy-алиас media-пайплайна |

Пайплайн безопасности (magic bytes, opaque-имена, 100 МБ кап nginx):
[SECURITY](../architecture/SECURITY.md).

## Поиск (`routes/search.ts`)

`GET /search?q=&limit=` — минимум 2 символа (400 иначе), `limit ≤ 20` (дефолт 5).
Типизированные группы: `resources` (title, PUBLISHED), `servers`
(name/description, lifecycle VERIFIED/ACTIVE), `threads` (title, любое
состояние), `articles` (title, PUBLISHED — PLAN-007). Каждая группа:
`{count, data[]}` с полями для карточек. Ресурсная часть `q`-поиска в
`GET /resources` — [выше](#get-resources).

## Админ-поверхность маркетплейса (`routes/admin.ts`)

- `GET /admin/resources?status=&page=&limit=` — очередь модерации (ADMIN/MODERATOR).
- `GET /admin/resources/:id` — карточка «как увидит покупатель» (cover,
  скриншоты, версии с artifact-инфой).
- `PATCH /admin/resources/:id/status` — модерация lifecycle: публикация
  требует подписи всех версий, разрешённого графа зависимостей и отсутствия
  FAILED-валидаций; иначе `409`. Переходы — матрица `lib/moderation.ts`.
  При публикации: версии `→PUBLISHED`, уведомления покупателям/подписчикам,
  email продавцу, сброс activity-кэша, `ModerationEvent` + audit.
- `DELETE /admin/reviews/:id` — удаление отзыва модерацией.
- `GET /admin/stats` — платформенные счётчики (users/resources/purchases/reviews).
- Версии: см. [Версии](#версии-routesversionsts-и-релизный-lifecycle).
