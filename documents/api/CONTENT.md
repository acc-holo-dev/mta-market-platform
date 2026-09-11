# CONTENT — статьи, глобальная лента, activity, дашборд

Область: `site/server/src/routes/{content,news,activity,dashboard}.ts`,
`routes/adminContent.ts`, `site/server/src/lib/activity.ts`.
Общие условия: [README](README.md).

## Статьи (`routes/content.ts`, PLAN-007)

Категории: `GUIDES | NEWS | REVIEWS | OPINION`. Статусы:
`DRAFT → PENDING_REVIEW → PUBLISHED / ARCHIVED` (модерация —
`routes/adminContent.ts`). Контент — **plain text** (никакого HTML).
`excerpt` вычисляется автоматически (≤300 символов). Слаг генерируется из
заголовка + случайный суффикс.

Авторский флоу:

- `POST /content` (`authenticate`, per-user 20/ч) — создать черновик:
  `{title 3–120, content 30–20000, category?, tags? (строка ≤200),
  coverUrl? (/media/<name>), resourceIds? (≤5), serverIds? (≤3)}`.
  Связи (B-002, только явные): ресурсы — любые PUBLISHED (иначе 400);
  серверы — публичные и **только их персоналом** (403 иначе, прецедент G-004).
  Связи пишутся в `ArticleResourceLink` / `ArticleServerLink` (с `position`).
- `PATCH /content/:id` (`authenticate`, per-user 40/ч) — правка своего;
  `excerpt` пересчитывается; PUBLISHED/ARCHIVED при правке возвращаются в
  `PENDING_REVIEW` (re-moderation, `reviewNote` сбрасывается).
- `POST /content/:id/submit` (`authenticate`) — DRAFT/ARCHIVED →
  PENDING_REVIEW (иначе 409).
- `GET /content/mine` (`authenticate`) — свои статьи со статусами, `reviewNote`,
  связанным тредом обсуждения и `replyCount` (лимит 50).
- `POST /content/:id/discussion` (`authenticate`, per-user 10/ч) — создать
  тред обсуждения: автор PUBLISHED-статьи или модерация; один тред на статью
  (409 при повторе); категория «Servers» или первая по position; первый пост
  генерируется из excerpt.

Публичные поверхности:

- `GET /content?page&limit≤30&category=` — хаб PUBLISHED-статей:
  `{data:[{id,slug,title,excerpt,coverUrl,category,tags,publishedAt,author,
  replyCount}], pagination}`.
- `GET /content/articles/:slug` — страница PUBLISHED-статьи: полный контент,
  автор, тред обсуждения, `resources` (только остающиеся PUBLISHED) и
  `servers` (только публичные) — ссылки рендерятся, пока связанная сущность
  публична.

## Модерация контента (`routes/adminContent.ts`, ADMIN/MODERATOR)

- `GET /admin/content?status=PENDING_REVIEW|ALL` — очередь/список (лимит 100).
- `POST /admin/content/:id/approve` — PENDING_REVIEW → PUBLISHED
  (`publishedAt`, сброс `reviewNote`); уведомления подписчикам автора
  (CREATOR_ARTICLE), сброс activity-кэша.
- `POST /admin/content/:id/reject` — PENDING_REVIEW → DRAFT, `{reason
  3–500}` сохраняется в `reviewNote`.
- `POST /admin/content/:id/hide` — PUBLISHED → ARCHIVED с `{reason}`.

## Глобальная лента новостей (`routes/news.ts`)

`GET /news?page&limit≤50&kind=all|news|updates` — смешанная лента
PUBLISHED-новостей серверов (`kind NEWS`) и обновлений серверов
(`kind UPDATE`), отсортированная по `publishedAt`; каждая позиция содержит
`server{slug,name,logoUrl}` и `author`; totals честные (COUNT по каждому
типу). Один объект ServerNews/ServerUpdate обслуживает все поверхности —
дублирования контента нет.

## Activity (read layer, `routes/activity.ts` + `lib/activity.ts`)

Активность — **производный** слой агрегации поверх существующих таблиц
(Server/Resource/Forum/ServerNews/ServerUpdate/Review/Article); ничего не
пишет в домены. Окно `ACTIVITY_WINDOW_DAYS` (дефолт 7, кап 30);
кэш Redis TTL 45 с (`plan006:activity:*`), fail-open.

Типы событий и приоритеты (детерминированные, без ML):

| Тип | Приоритет |
|---|---|
| SERVER_UPDATE, RESOURCE_RELEASE | 6 |
| NEW_SERVER, NEW_ARTICLE | 5 |
| SERVER_NEWS, RESOURCE_UPDATE | 4 |
| SERVER_ONLINE, NEW_DISCUSSION | 3 |
| NEW_REVIEW | 2 |
| DISCUSSION_REPLY | 1 |

Публичность соблюдается на read-слое: только публичные состояния
(PUBLISHED, VISIBLE-отзывы, не-удалённые посты, VERIFIED/ACTIVE серверы);
`showStats=false` серверы не попадают в live-агрегаты; покупки/лайки/
просмотры/реакции никогда не становятся событиями.

- `GET /activity/live` — `{playersOnline, serversOnline, computedAt}`
  (только VERIFIED/ACTIVE + ONLINE + showStats=true).
- `GET /activity?limit=5..50` (дефолт 20) — Home-снимок: live-строка + лента
  высокоценных событий (items с `type, at, href, server|resource|article|
  thread|author, …`) + популярные блоки (`popular.servers` по реальному
  онлайну, `popular.discussions` по ответам/просмотрам).

Инвалидация кэша — на высокоценных мутациях (publish новости/обновления,
release ресурса, тема/ответ, отзыв, одобрение статьи) — `bustActivityCache()`.

## Дашборд (`routes/dashboard.ts`)

- `GET /dashboard/now` (`authenticate`) — сводка «Сейчас / За ночь»:
  измеряется от `User.dashboardSeenAt` (первый визит — окно 24 ч), затем
  baseline продвигается (awaited update, без race). Состав:

  ```json
  {"since","firstVisit","unreadNotifications",
   "serverUpdates": {"count","items[≤5]"},
   "serverNews": {"count","items[≤5]"},
   "discussionReplies": {"count","items[≤5]"},        // ответы в моих темах (чужие)
   "purchasedUpdates": {"count","items[≤5]"},         // новые версии купленных
   "creatorUpdates": {"count","items[≤5]"},           // версии создателей, на которых подписан
   "followedResourceUpdates": {"count","items[≤5]"},
   "followedThreadReplies": {"count","items[≤5]"}}
  ```

  Только реальные персональные факты (существующие связи) — без
  алгоритмической персонализации.

- `GET /dashboard/community` (`authenticate`) — виджеты «My MTA»:
  `ownedServers` (роль OWNER, ≤6, с live-статусом; приватность-фильтр
  `showStats`), `following` (подписки на серверы), `followedNews`,
  `updates` (подписки), `discussions` (мои темы), `unreadNotifications`.
