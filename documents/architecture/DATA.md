# DATA — архитектура данных

Область: PostgreSQL 16 + Prisma 8 contract ORM + Redis + объектное хранилище.
Процедура миграций: [DATABASE-MIGRATIONS](../operations/DATABASE-MIGRATIONS.md)
(пути legacy-репозитория сайта в ней устарели; фактически `site/server/...`).
Продуктовая модель сущностей: [PRODUCT-MODEL](../product/PRODUCT-MODEL.md).

## PostgreSQL через Prisma 8 contract ORM

- **Единственная схема** — `site/server/src/prisma/contract.prisma`:
  **68 моделей и 44 enum'а**. Из неё генерируются клиент и типы
  (`contract.d.ts` / `contract.json`) командой `pnpm contract:emit`
  (`prisma contract emit`, корневой алиас `pnpm db:emit`).
- Конфиг: `site/server/prisma.config.ts`
  (`definePrismaConfig` + `@prisma/orm-postgres`); клиент создаёт node-postgres
  Pool (`DATABASE_URL`). Это **не** классический Prisma migrate: у Prisma 8 два
  пути применения схемы (quick `db update --confirm` — только локальный dev;
  формальный `migration plan` + `db migrate` — staging/production).
- Доступ из кода — контрактный ORM (`db.orm.public.<Model>` в
  `site/server/src/prisma/db.ts`), идентификаторы UUID v4 (PSL v1 диалект,
  `@default(uuid())`).
- Особенности ORM, влияющие на код: нет OR-комбинатора (поиск объединяется
  по id), `update()` игнорирует не-ключевые поля where — условные переходы
  делаются через `updateAndCount` (compare-and-set), `delete()` удаляет одну
  строку за вызов.

## Миграции

- Пакеты: `site/server/migrations/app/<ts>_<slug>/` (`migration.json`,
  `migration.ts`, `ops.json`) + снимки `site/server/migrations/snapshots/`
  (обязательны в git). Актуальные пакеты: `baseline`, `migration`,
  `plan005_community_server`, `plan006_daily_experience`,
  `plan007_content_foundation`, `plan008_follow_expansion`,
  `plan009_thread_follow`, `plan010_creator_analytics` (сентябрь 2026).
- Рабочий цикл изменения схемы: правка `contract.prisma` →
  `prisma contract emit` → `prisma migration plan` → (заполнить
  `migration.ts` при placeholder) → коммит схемы + пакета; применение на
  прод — `prisma db migrate` из образа (deploy.sh: backup → migration →
  verification → deploy). Откат схемы — только восстановлением бэкапа
  (down-миграций нет).
- CI смоук-путь «контракт → БД» на чистой БД — при каждом push
  (`contract emit && prisma db update`; см. [TESTING](TESTING.md)).

## Redis

Использование (клиент — `site/server/src/lib/redis.ts`, ioredis,
`REDIS_URL`):

| Назначение | Ключи | Поведение при недоступности |
|---|---|---|
| Rate limiting | `rl:standard|strict|auth:<ip>`, `rlu:<action>:<user>` | fail-open для bulk (`standard`, по умолчанию), fail-closed (503) для security-групп — M-002 |
| Activity-кэш | `plan006:activity:live:v1`, `plan006:activity:snapshot:v1:<limit>` | TTL 45 c, fail-open; инвалидация `bustActivityCache()` на высокоценных мутациях |

Сессии в Redis **не хранятся** — сессии в PostgreSQL (`Session`); в Redis
только счётчики и кэш. Прочее (кэш запросов, очереди) не используется.

## Объектное хранилище

Двухрежимный слой (`site/server/src/lib/{storage,s3,upload}.ts`):

- **S3/R2** (`S3_ENABLED=true`): артефакты версий — ключ объекта в `fileUrl`
  (никогда публичный URL), скачивание только через
  `GET /resources/:slug/versions/:version/download` с short-lived signed URL
  (TTL из `lib/s3.ts`); медиа — `media/<name>`, раздача
  `GET /media/:name` через 302 на `MEDIA_PUBLIC_BASE_URL` или стрим из
  приватного бакета.
- **Локальный режим (dev)**: каталог `UPLOAD_DIR` (по умолчанию `./uploads`,
  в production — volume `uploads_data`); артефакт — opaque имя
  `/uploads/<random>`, стриминг только из авторизованного endpoint; медиа —
  `media-<hex>.<ext>` в том же каталоге, раздаётся `/media/:name`.

Инвариант: paid-артефакты никогда не доступны по постоянному публичному URL;
nginx-локация `/uploads` отсутствует намеренно (G-006).

## Обзор сущностей (68 моделей, `contract.prisma`)

### Идентичность и сессии

`User`, `Account` (OAuth-провайдер-привязки), `Session` (refresh-хэш,
tokenFamily, reuseDetected), `UserBalance`.

### Маркетплейс: ресурсы и версии

`Resource`, `ResourceMedia`, `ResourceVersion` (releaseStatus: CANDIDATE/
VERIFIED/PUBLISHED/DEPRECATED/YANKED), `ResourceDependency`,
`ResourceViewDaily` (resource×day просмотры), `Review`.

### Заказы, скидки, покупки, лицензии

`Order`, `OrderItem` (иммутабельные priced lines), `DiscountCampaign`,
`DiscountUsage`, `Purchase`, `License`, `Installation` (DRM-установки),
`Service`, `ServiceOrderItem`, `ServicePurchase`, `ServiceOrderMessage`,
`ServiceDelivery`, `ServiceRevision`.

### Платежи, ledger, refunds

`Payment`, `PaymentProviderEvent` (идемпотентный webhook-лог),
`FinancialTransaction` (legacy-строки для кэша баланса), `SellerBalance`,
`Refund`, `LedgerAccount`, `LedgerEntry` (append-only double-entry).

### DRM / артефакты

`PublisherKey`, `ArtifactSignature`, `ArtifactEncryption` (DEK-конверт),
`ServerSigningKey`, `Lease`, `SandboxRun`.

### Модерация и аудит

`ModerationEvent`, `AuditLog`, `ReconciliationReport`, `ReconciliationMismatch`,
`CompatibilityReport`.

### Продавцы

`SellerProfile` (PENDING/APPROVED/REJECTED, payoutEnabled).

### Серверы и интеграция

`Server`, `ServerMember`, `ServerStatusSample`, `ServerResource`,
`ServerReviewToken`, `ServerReviewEligibility`, `ServerReview`, `ServerNews`,
`ServerUpdate`, `ServerFollow`.

### Форум и сообщество

`ForumCategory`, `ForumThread` (serverId/newsId/articleId — явные связи),
`ForumPost`, `ForumReaction`, `ForumThreadFollow`, `SellerFollow`,
`ResourceFollow`, `Notification`, `Report`.

### Контент

`Article`, `ArticleResourceLink`, `ArticleServerLink`.

## Схемные конвенции

- Идентификаторы: UUID v4 строкой; везде opaque (маршруты не принимают
  числовые id).
- Деньги: целые копейки, валюта RUB; снапшоты цен — в `OrderItem`/`Purchase`
  (иммутабельны), расчёт всегда от base price.
- Времена: ISO 8601 строки.
- Мягкие удаления — там, где нужна восстанавливаемость модерации
  (`ForumPost.deletedAt`); серверы и ресурсы удаляются/архивируются
  по-разному (архив — lifecycle, ресурс — физическое удаление с чисткой медиа).
- Связи follow (`ServerFollow`, `SellerFollow`, `ResourceFollow`,
  `ForumThreadFollow`) — приватные: публично только агрегаты.
