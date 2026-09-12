# PLAN-015 — Implementation Map (Phase A audit)

Дата: 2026-09-12. Источник: прямой аудит `site/web/src/**` (все routes/components/lib/store),
`tailwind.config.js`, `globals.css`, `tests/e2e/**`, `documents/architecture/DESIGN-SYSTEM.md`.
Статус: рабочий документ фазы A; обновляется по ходу выполнения.

---

## 1. Инвентарь приложения

### 1.1 Маршруты (site/web/src/app)

| Файл | URL | Роль | Данные (API) |
|---|---|---|---|
| `page.tsx` | `/` | Home: hero «Сейчас в MTA» + LiveLine + search-форма + trust-strip + Активность + Популярное + маркетплейс-секции (newest/popular/free) | `/resources/homepage`, `/activity` |
| `resources/page.tsx` | `/resources` | Маркетплейс-каталог: search/type/price/sort/page в URL | `GET /resources` |
| `resources/[slug]/page.tsx` | `/resources/[slug]` | Карточка ресурса: галерея, buy-flow (balance/QR), версии, отзывы | `/resources/:slug`, `/versions`, `/reviews`, `view-counter` |
| `services/[slug]/page.tsx` | `/services/[slug]` | Карточка услуги + заказ | `/services/:slug` |
| `services/orders/page.tsx` | `/services/orders` | Заказы услуг (buyer/seller) | `/services/orders/my` |
| `servers/page.tsx` | `/servers` | Каталог серверов (поиск, сортировки) | `/servers` |
| `servers/[slug]/page.tsx` | `/servers/[slug]` | Страница сервера: Обзор/Live/Новости/Обновления/Отзывы/Сообщество | `/servers/:slug`, `/statistics`, `/news`, `/updates`, `/reviews`, `/community` |
| `servers/[slug]/manage/page.tsx` | `/servers/[slug]/manage` | Управление сервером (staff, приватность, токен) | `/servers/:slug/manage` |
| `servers/[slug]/news/[id]/page.tsx` | `/servers/[slug]/news/[id]` | Новость сервера + тред обсуждения | `/servers/:slug/news/:id` |
| `servers/create/page.tsx` | `/servers/create` | Мастер регистрации сервера | `POST /servers` |
| `community/page.tsx` | `/community` | Хаб сообщества: категории/свежие/активные/закреплённые | `/community` |
| `community/forum/[category]/page.tsx` | `/community/forum/[category]` | Треды категории | `/community/categories/:slug/threads` |
| `community/forum/thread/[id]/page.tsx` | `…/thread/[id]` | Тред: посты, ответы, реакции, follow | `/community/threads/:id` |
| `news/page.tsx` | `/news` | Лента новостей/обновлений серверов (all/news/updates) | `/news` |
| `content/page.tsx` | `/content` | Хаб статей | `/content` |
| `content/articles/[slug]/page.tsx` | `/content/articles/[slug]` | Статья + связанные ресурсы/серверы + тред | `/content/articles/:slug` |
| `content/new/page.tsx`, `content/mine/page.tsx` | — | Создание/мои статьи | `POST /content`, `/content/mine` |
| `search/page.tsx` | `/search` | Глобальный поиск: resources/servers/threads/articles | `/search` |
| `dashboard/page.tsx` | `/dashboard` | «Покупки» + NowSummary (с последнего визита) + following-виджеты | `/purchases/my`, `/dashboard/now`, `/dashboard/community` |
| `account/page.tsx` | `/account` | Профиль + баланс + идентичности | `/auth/me`, `/auth/identities` |
| `notifications/page.tsx` | `/notifications` | Центр уведомлений (all/unread) | `/notifications` |
| `profile/[username]/page.tsx` | `/profile/[username]` | Публичный профиль (бейджи, серверы, ресурсы, статьи) | `/profiles/:username` |
| `sellers/[username]/page.tsx` | `/sellers/[username]` | Витрина продавца | `/sellers/:username` |
| `seller/page.tsx` | `/seller` | Кабинет продавца: ресурсы, услуги, заказы, аналитика, споры | `/resources/my`, `/services/my`, `/seller/analytics`, … |
| `seller/new/page.tsx` | `/seller/new` | Публикация ресурса (draft → versions → submit) | `POST /resources`, `/versions`, `/media` |
| `disputes/page.tsx`, `disputes/[id]/page.tsx` | `/disputes` | Споры | `/disputes/my` |
| `admin/page.tsx` | `/admin` | Админ-панель (stats, resources, servers, sellers, content, reports, community) | `/admin/*` |
| `auth/login|register|callback` | — | Аутентификация | `/auth/*` |

### 1.2 Shell сейчас

- `layout.tsx`: `<html lang="ru" className="dark">` — **тема захардкожена тёмной**; Providers(react-query) → Navbar → main → Footer.
- `Navbar.tsx` (377 строк): sticky topbar, logo, 4 desktop-ссылки (Маркетплейс/Серверы/Статьи/Сообщество), search-trigger → `/search` (только ссылка + kbd `/`, хоткей не реализован), balance-chip (клик → /account), bell → /notifications, «Покупки», аватар → /account, logout-кнопка (E2E завязан на `button "Выход"`), mobile right-sheet. Админ-ссылка — только в mobile drawer.
- `Footer.tsx`: бренд/разделы/сообщество/аккаунт.
- **Сайдбара нет.** Темы нет (dark-only). Глобального поиска-дропдауна нет. Context-create нет.

### 1.3 Data layer

- `lib/api.ts`: axios, cookie-refresh + single-flight, `bootstrapSession()`.
- `lib/api-ext.ts` (1700 строк): типизированные хелперы всех доменов. Ключевое для PLAN-015:
  - `fetchActivity()` → `{ live: {playersOnline, serversOnline}, items[], popular: {servers[], discussions[]} }` — **Live MTA и Activity уже есть**;
  - `fetchHomepage()` → `{newest, popular, free}`; `fetchNewsFeed(kind,page)`; `fetchCommunityHub()` → categories/latest/active/pinned/recentActivity;
  - `search(q)` → `{resources, servers, threads, articles}` — **групповой поиск уже есть**;
  - `fetchDashboardNow()` → «с последнего визита»: unread, serverUpdates/News, discussionReplies, purchasedUpdates, creatorUpdates, followed*;
  - follows: `fetchMyCreatorFollows/fetchMyResourceFollows/fetchMyThreadFollows`, followServer/unfollowServer;
  - seller: `fetchMyResources/fetchMyServices/fetchMyServiceOrders/fetchSellerAnalytics/fetchSellerProfile`;
  - серверная статистика `fetchServerStatistics(slug, range)` → peak/average/uptime/samples (24H/7D/30D — §27 есть).
- `store/auth.ts`: zustand, access-token в памяти, bootstrap через refresh-cookie.

### 1.4 Design system сейчас (PLAN-013)

- `globals.css`: HSL-токены (background/surface×4/line×3/text×3/primary×3/semantic×6 + radius/shadow/motion), dark-only, `:root` без light-значений.
- `tailwind.config.js`: semantic-алиасы (accent/ok/warn/bad/info/verified…), `darkMode: "class"` (не используется), радиусы card/lg/pill, тени card/raised/accent.
- Типографика: системный стек; роли Display/H1/H2/H3/Body/Caption/Label из DESIGN-SYSTEM §3.
- Нарушения токенов, найденные аудитом: `Rating.tsx` → `text-amber-400 fill-amber-400` (сырая палитра); в отдельных местах `text-white` на accent-кнопках (допустимо как контраст-константа, но оформим как токен `--on-accent`).

### 1.5 ui-kit сейчас

`Button, Card(+Header/Title/Description/Content/Footer), Input(+Textarea/Select/SearchInput), Avatar, Gallery, Price, Rating, ResourceCard, ResourceCover, SectionHeader, Skeleton(+ResourceCardSkeleton), States(LoadingSpinner/EmptyState/ErrorState), StatusBadge(+ErrorText/SuccessText), Tabs, ConfirmDialog`.

### 1.6 E2E-зависимости (tests/e2e, seed plan-003)

Стабильные селекторы: `heading "Маркетплейс"/"Активность"/"Популярное"/"Статьи"/"Уведомления"/"Профиль"`, `button "Выход"`, `link "Войти"`, `label "Поиск ресурсов"/"Поиск серверов"`, `button "Фильтры"` + `dialog "Фильтры"`, `button "Сбросить всё"`, табы сервера (role=button Обзор/Live/…), «Следить»/«Не следить», «Смотреть всё». **Shell-редизайн обязан сохранить эти роли/имена.**

---

## 2. Implementation map (EXISTING → REUSE/MODIFY/REPLACE/DELETE)

| Существующее | Роль сейчас | Решение |
|---|---|---|
| `layout.tsx` | root layout, dark hardcode | **MODIFY** — ThemeProvider + inline no-FOUC script, AppShell, skip-link |
| `Navbar.tsx` | topbar с inline-ссылками | **REPLACE** → `layout/AppShell` = `Sidebar` + `Topbar` (+ компактный mobile drawer сохранён) |
| `Footer.tsx` | футер | **REUSE** (минимальная правка токенов) |
| `globals.css` | токены dark-only | **MODIFY** — light `:root` + `.dark`, единые имена, focus/reduced-motion, star-токен |
| `tailwind.config.js` | semantic map | **MODIFY** — + `on-accent`, `star`, без структурных ломок |
| `ui/Button…States` | ui-kit | **REUSE** (точечные правки: loading у Button, on-accent) |
| `ui/Rating.tsx` | звёзды | **MODIFY** — убрать raw amber → токен `--star` |
| `ui/StatusBadge.tsx` | статусы | **REUSE** — расширить LABELS (VERIFIED, ONLINE, OFFLINE, UNKNOWN, compat) |
| `ui/ResourceCard.tsx` | карточка ресурса | **MODIFY** — иерархия §17 (title→creator→price→trust→rating) |
| `servers/ServerCard.tsx` | карточка сервера | **REUSE/MODIFY** — онлайновый блок §26 |
| `home/LiveLine.tsx` | live-чипы | **REUSE** → встроить в `LiveStrip` (компактная полоса §14) |
| `home/ActivityFeed.tsx` | активность | **REUSE** (+ вариант compact для right rail) |
| `home/PopularSection.tsx` | топ серверов/обсуждений | **REUSE** в Home-редизайне |
| `dashboard/NowSummary.tsx` | «с последнего визита» | **REUSE** в My MTA |
| `community/ThreadRow.tsx` | строка треда | **REUSE** |
| `layout/Footer.tsx` | футер | **REUSE** |
| `Search` (страница) | `/search` | **MODIFY** — групповая вёрстка + дропдаун в topbar |
| Отсутствует | — | **NEW**: `layout/AppShell`, `layout/Sidebar`, `layout/Topbar`, `layout/ThemeToggle`, `layout/AccountMenu`, `search/GlobalSearch`, `home/PromotionHero` (placement-архитектура §38), `home/RightRail`, `trust/TrustBadges`, `ui/Badge`, `me/FollowingPage` (подписки), `market/ServicesTab` |
| `page.tsx` (Home) | hero+секции | **REWRITE** по §12 (сохранить headings «Активность», «Популярное» для E2E) |
| `resources/page.tsx` | каталог | **MODIFY** — табы Ресурсы/Услуги/Бесплатные, плотнее грид, PageHeader |
| `dashboard/page.tsx` | Покупки | **MODIFY** → «My MTA» overview + секции (заголовок «Профиль»/purchases-логика сохраняются) |
| `notifications/page.tsx` | центр уведомлений | **MODIFY** — группировка «Сегодня», типовые иконки |
| `seller/page.tsx` | кабинет продавца | **MODIFY** — Creator Studio: Publish-кнопка, вкладки, аналитика |
| `admin/page.tsx` | админка | **REUSE** (отдельная навигация в sidebar для ADMIN/MODERATOR) |
| `servers/[slug]/page.tsx`, `resources/[slug]/page.tsx`, `community/*`, `news`, `content` | entity-страницы | **MODIFY** — trust/compat/версии-UI §18–§30, без смены доменной логики |

**DELETE:** нечего — рабочих доменных файлов, подлежащих удалению, нет (Navbar заменяется, не удаляется логика auth/notifications).

---

## 3. Решения по несуществующим фичам (честность §16/§41)

- **Favorites** — бэкенда нет → в сайдбаре не показываем; есть Подписки (creators/resources/threads/servers — реальные API).
- **Premium** — нет → не навигационный элемент.
- **Sponsored/Ads** — рекламного домена нет → `PromotionHero` строится как **placement-архитектура** (campaign/placement/priority/start/end/creative/status contract), источником контента сейчас реальные сущности (verified-сервер с максимальным онлайном, популярный ресурс, свежая новость) с честной меткой «Рекомендуем». Метка «Sponsored» появится только с реальными кампаниями.
- **Compatibility/Health UI** (§20/§22) — в публичном контракте ресурса полей нет → карточка/страница показывают только реально существующие поля (rating, reviews, versions, validation у версий); UI-компоненты готовятся, но не рисуют фиктивные статусы.
- **Trust**: реальные сигналы — верификация сервера (`verification`), verified-interaction отзывов (`verifiedInteraction`), модерация ресурсов (PUBLISHED), бейджи профиля. Единый `TrustBadges` рендерит только их.

## 4. Навигация (сайдбар)

- Primary: Главная `/`, Маркет `/resources`, Серверы `/servers`, Сообщество `/community`, Новости `/news`.
- Secondary: Подписки `/dashboard`-секция? → отдельная компактная страница `/me/following` (реальные `/me/follows/*`), Уведомления `/notifications` (badge).
- Creator (только для продавца/админа): Мои ресурсы `/seller?tab=resources`, Мои услуги, Заказы, Аналитика → `/seller` (вкладки). Упрощение: один пункт «Кабинет продавца» + «Опубликовать» в context-action, чтобы не раздувать сайдбар (§6: creator section появляется только там, где уместно).
- Admin: отдельная секция внизу (ADMIN/MODERATOR): `/admin`.
- Collapse: иконки + tooltip, состояние в localStorage, без hover-авторасширения.

## 5. Topbar

`Logo · GlobalSearch (input + dropdown, kbd /) · ContextCreate (по pathname) · LiveChip · ThemeToggle · NotificationsBell · AccountMenu (avatar + balance)`.

## 6. Порядок работ

B (токены light/dark + theme system + ui-точки) → C (AppShell/Sidebar/Topbar/Search/Account) → D (Home) → E (Market) → F (entities) → G (My MTA/notifications) → H (Creator Studio) → I (QA: typecheck/lint/build/unit/E2E/browser 1440×900/1920×1080 light+dark) → docs + логические коммиты (§51).
