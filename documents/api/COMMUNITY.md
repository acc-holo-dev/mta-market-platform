# COMMUNITY — форум, подписки, профили, уведомления, жалобы

Область: `site/server/src/routes/{community,follows,profiles,notifications,reports}.ts`,
`site/server/src/lib/{follows,notify}.ts`. Общие условия: [README](README.md).

Приватность подписок (DAILY-EXPERIENCE §42): отношения follow — приватные;
публично только агрегаты («N подписчиков»), списки не отдаются никогда.
`/me/follows/*` — только собственные списки.

## Форум (`routes/community.ts`)

Категории → темы → посты. Темы могут нести явные связи: `serverId`
(обсуждение сервера, G-004) или `newsId` (обсуждение новости, H-004) — связи
создаются только намеренно. Пагинация: `page`, `limit ≤ 50`.

- `GET /community` — хаб: `categories` (с threadCount), `latest` (10),
  `active` (OPEN с последними ответами), `pinned` (5), `recentActivity`
  (10 последних не-удалённых постов с автором и тредом).
- `GET /community/categories` — список категорий с `threadCount`.
- `GET /community/categories/:slug/threads` — список тем: pinned сверху,
  затем по `lastPostAt`; `{category, data[], pagination}`; карточка темы:
  `{id, title, state, pinned, replyCount, views, lastPostAt, createdAt, author}`.
- `POST /community/categories/:slug/threads` (`authenticate`, per-user 10/ч) —
  `{title 3–150, content 3–20000, serverId?}`: `serverId` разрешён только
  публичному серверу и только его персоналу (403 иначе). Создаёт тему + первый
  пост (position 0), ставит `lastPostAt`. Сброс activity-кэша.
- `GET /community/threads/:id` — тема + посты (`{followersCount, thread{…,
  author}, category, server, caller:{isModerator}, data[], pagination}`).
  `views` инкрементируется при реальных чтениях (fire-and-forget);
  `isModerator` — платформенный ADMIN/MODERATOR или персонал привязанного
  сервера. Пост: `{id, content|null (удалён), deleted, edited, position,
  createdAt, author, reactionCount, reactedByMe[]}` — реакции считаются по
  текущему пользователю (опциональный Bearer).
- `POST /community/threads/:id/posts` (`authenticate`, per-user 60/ч) — ответ;
  только OPEN (иначе 409); `content ≤20000`; position = max+1;
  `replyCount++`, `lastPostAt`; FORUM_REPLY-уведомления автору темы,
  участникам и подписчикам треда (dedup, actor исключён).
- `PATCH /community/posts/:id` (`authenticate`) — правка своего поста
  (`editedAt`).
- `DELETE /community/posts/:id` (`authenticate`) — мягкое удаление
  (`deletedAt`), доступно автору или модерации (платформенной или серверной);
  `replyCount--`; audit `forum.post.delete`.
- `PUT /community/posts/:id/reactions/:kind` (`authenticate`) — toggle
  собственной реакции (`kind ≤24 символов`, дефолт LIKE); ответ
  `{reacted: bool, kind}`.
- `POST /community/threads/:id/state` (`authenticate`) — модерация темы:
  `{state: OPEN|LOCKED|ARCHIVED, pinned?}`; платформенная модерация или
  персонал сервера; автор получает MODERATION-уведомление о смене state;
  audit `forum.thread.state`.

Серверные поверхности сообщества (приватность — в бэкенде):

- `GET /community/servers/:slug/threads` — треды сервера; `showCommunity=false`
  → `{enabled:false, data:[]}`.
- `GET /community/servers/:slug/members` — агрегат `followerCount` всегда;
  список (последние 50 подписчиков) — только при `showCommunity=true`.

## Follow тредов (`routes/community.ts`, PLAN-009)

- `POST /community/forum/thread/:id/follow` (`authenticate`, per-user 60/ч) —
  подписка на тему; повтор — 409; ответ `{following:true, followersCount}`.
- `DELETE /community/forum/thread/:id/follow` — отписка; не подписан — 404;
  ответ `{following:false, followersCount}`.

## Подписки на создателей и ресурсы (`routes/follows.ts`, PLAN-008)

Смонтировано в корень (абсолютные пути).

- `POST /creators/:username/follow` (`authenticate`) — цель: User с APPROVED
  SellerProfile (иначе 404 «не создатель»); самоподписка запрещена (400);
  дубликат 409. Ответ `201 {following:true, creatorFollowers}`.
- `DELETE /creators/:username/follow` — отписка (не подписан — 404).
- `POST /resources/:slug/follow` (`authenticate`) — цель: PUBLISHED ресурс;
  владелец не подписывается на себя (400); дубликат 409;
  `201 {following:true, resourceFollowers}`.
- `DELETE /resources/:slug/follow` — отписка.
- `GET /me/follows/creators` / `GET /me/follows/resources` /
  `GET /me/follows/threads` (`authenticate`) — только собственные списки
  (лимит 200), enrichment базовыми карточками.

События доставки (sync, в местах мутаций — `lib/follows.ts`):
публикация ресурса/версии и статьи создаёт `CREATOR_RESOURCE`,
`CREATOR_ARTICLE`, `RESOURCE_UPDATE` уведомления покупателям (§26), подписчикам
ресурса и создателя с dedup получателей (`deliverFollowNotifications`).

## Публичные профили (`routes/profiles.ts`)

`GET /profiles/:username` — публичная идентичность (только ACTIVE-пользователи;
email/покупки/баланс не отдаются):

```json
{"profile": {"username","displayName","avatar","memberSince"},
 "badges": ["SERVER_OWNER"|"VERIFIED_SERVER"|"VERIFIED_SELLER"...],
 "servers": [{id,slug,name,logoUrl,bannerUrl,monitoring,
              playerCount|maxPlayers (null при showStats=false),
              verification, followerCount}],
 "resources": [... до 24 PUBLISHED ...],
 "forumActivity": {"threadCount","postCount"},
 "articles": [... до 6 PUBLISHED ...]}
```

Бейджи отражают проверяемые условия: SERVER_OWNER (есть публичный сервер),
VERIFIED_SERVER (verification=VERIFIED), VERIFIED_SELLER (APPROVED SellerProfile).
Бейджей «за активность» нет.

## Уведомления (`routes/notifications.ts`, `lib/notify.ts`)

Типы: `SERVER_NEWS`, `SERVER_UPDATE`, `FORUM_REPLY`, `REVIEW_EVENT`,
`MODERATION`, `CREATOR_RESOURCE`, `CREATOR_ARTICLE`, `RESOURCE_UPDATE`.
Создание уведомлений best-effort и всегда с dedup получателя + исключением
актора.

- `GET /notifications?filter=all|unread&page&limit≤50` (`authenticate`) —
  `{data, unreadCount, pagination}`.
- `POST /notifications/:id/read` — отметить свою (404 иначе); `{read:true}`.
- `POST /notifications/read-all` — отметить все; `{updated: N}`.

## Жалобы (`routes/reports.ts`)

- `POST /reports` (`authenticate`, per-user 10/ч) — `{targetType:
  THREAD|POST|REVIEW|NEWS|SERVER|PROFILE|ARTICLE, targetId ≤80, reason
  3–2000}`; существование цели проверяется по типу (404). Статус `OPEN`.
- `GET /reports/my` — собственные репорты (лимит 50).
- Модерация: `GET /admin/reports?status=`, `POST /admin/reports/:id/resolve`
  (`routes/adminCommunity.ts`) — человеческое решение без автобанов;
  уведомление репортёру.
