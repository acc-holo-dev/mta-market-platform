# PLAN-015 — MTA Market Experience Architecture & Visual System (выполнен)

Дата: 2026-09-12. Статус: IMPLEMENTATION COMPLETE.
Спека: `documents/development/active/PLAN-015.md`. Карта реализации:
`documents/development/active/PLAN-015-IMPLEMENTATION-MAP.md`.

## 1. Что сделано (по фазам)

### Phase B — Foundation
- **Две первоклассные темы** (§10): `globals.css` реструктурирован — light
  `:root` (нейтральный фон 220 20% 97%, белые surfaces, сдержанные линии,
  затемнённый accent для контраста AA) + `.dark` (значения PLAN-013 без
  изменений). Имена токенов идентичны; dark — не инверсия light.
- **Theme system**: `components/layout/theme.tsx` (ThemeProvider, localStorage
  `mta-theme`, system-fallback + подписка на media change), inline no-FOUC
  скрипт в `layout.tsx`; `ThemeToggle` — единственный переключатель.
- Новые токены: `--on-accent` (заменил raw `text-white` в Button/MessageThread),
  `--star` (звёзды рейтинга — убрана сырая amber-палитра из Rating), `--hero-from`.
- Tailwind config: `on-accent`, `star`; `mta-anim-fade` для popover/sheet.

### Phase C — Global Shell (§5–§9, §33)
- `layout/AppShell` = Topbar + [Sidebar | Content] + Footer; skip-link «Перейти
  к содержимому»; Navbar.tsx заменён (DELETE).
- **Sidebar** (§6): expanded `w-60` / collapsed `w-14` icons-only с tooltip,
  персистентность `mta-sidebar-collapsed`, без hover-авторасширения. Секции:
  Primary (Главная/Маркетплейс/Серверы/Сообщество/Новости), Личное
  (Подписки `/me/following`, Уведомления с unread), Продавец (реальные
  продавцы → `/seller?tab=…`), Модерация (ADMIN/MODERATOR отдельно).
  Mobile: left-sheet drawer с тем же nav.
- **Topbar** (§7): sidebar-toggle, logo MTA MARKET, GlobalSearch, ContextCreate,
  LiveChip (`/activity`, скрывается при ошибке — не врёт), ThemeToggle, bell с
  unread, стабильная видимая кнопка «Выход» (контракт E2E `uiLogin`),
  AccountMenu (аватар + имя + баланс `formatRub(me.balance.available)`;
  меню: Баланс, Покупки, Подписки, Кабинет продавца, Профиль, Админ, Выход).
- **GlobalSearch** (§8): дропдаун над реальным `GET /search`; группы
  Ресурсы/Серверы/Обсуждения/Статьи; combobox-семантика, ↑↓/Enter/Esc,
  хоткей «/», debounce 300ms, loading/empty/error, «Все результаты (N)».
- **ContextCreate** (§9): метка по разделу (Опубликовать / Продать ресурс /
  Добавить сервер / Новая тема / Новая статья; на Home — меню из 4 типов);
  скрыто для гостей.

### Phase D — Home (§12–§15)
- Последовательность §12: hero «Что происходит в MTA прямо сейчас?» + LiveStrip
  → PromotionHero (featured) → «Популярное» → «Новинки»/«Популярное у
  покупателей»/«Бесплатные ресурсы» → «Новости серверов»+«Обсуждения» →
  «Активность». Заголовки E2E-контракта («Популярное», «Активность», «Новинки»,
  «Смотреть всё») сохранены.
- **PromotionHero** (§13/§38): placement-архитектура `PromotionItem`
  (kind/placement/priority/status/startAt/endAt/creative), ротация с
  reduced-motion guard; контент — реальные сущности (топ-сервер по онлайну,
  популярный ресурс), метка «Рекомендуем», не «Sponsored» (рекламного домена
  нет — §41 честность).
- **LiveStrip** (§14): компактная полоса «N игроков онлайн · N серверов
  онлайн → Все серверы» из реальных агрегатов; текстовые узлы «значение+
  подпись» в одном элементе (контракт E2E plan006).
- **ActivityFeed/LiveStrip/PopularSection** — единый queryKey `["activity","snapshot"]`
  (было 3 отдельных fetch одного эндпоинта); компоненты принимают snapshot.
- **RightRail** (§12): «Активные авторы» (честная агрегация авторов реальных
  публикаций, без топ-creators API), «Лента событий» (компактная активность),
  secondary placement; скелетон во время загрузки (не пустое состояние).

### Phase E — Market (§16–§17, §24–§25)
- `/resources`: вкладки **Ресурсы | Услуги** (`?tab=services` → реальный
  `GET /services`, впервые использованный; раньше endpoint был dead export).
  Каталог контейнер `max-w-[1400px]`, плотнее сетки.
- **ResourceCard** (§17): иерархия Title → Creator → Trust → описание →
  Price/Rating; trust-строка только из реальных сигналов.
- **ServiceCard** (§25): собственный вид услуг (цена + срок доставки), не
  форсируется в ресурсный UI.
- **TrustBadges** (§19): единый примитив (VERIFIED_SERVER/VERIFIED_CREATOR/
  VERIFIED_INTERACTION/MODERATED/OFFICIAL/COMMUNITY); per-page бейдж-дизайны
  унифицированы.
- Серверы: каталог переведён на контейнер shell, hero уплотнён.

### Phase F — Entities
- Resource/Server/Creator/Community/News страницы: доменная логика не тронута
  (§47); restyle через токены, контейнеры под shell, trust-бейджи в карточках.
  Resource page уже имел галерею/версии/отзывы; будущие табы (Live Demo, 3D)
  не добавлены — бэкенда нет (§18/§37).

### Phase G — Personal (§31–§33)
- `/dashboard` → **My MTA**: h1 «My MTA», первым блоком DashboardNow («Сейчас/
  С вашего прошлого визита»), затем Покупки+Аккаунт, затем «Сообщество»
  (Мои серверы/Подписки/Обсуждения/Уведомления). Русская плюрализация починена
  («новое обновление» вместо «новый update»).
- **`/me/following`** — новая страница подписок на реальных API
  (`/me/follows/creators|resources|threads`): Авторы / Ресурсы / Обсуждения.
- **Notifications** (§32): группировка «Сегодня»/«Ранее», вложенный
  интерактивный элемент устранён (a11y: раньше `role=button` внутри button).
- Баланс: в topbar (AccountMenu) и `/account#balance` — без дублирования
  финансовых поверхностей.

### Phase H — Creator Studio (§35)
- `/seller`: заголовок «Кабинет продавца» (канон терминологии), вкладки
  Обзор/Ресурсы/Услуги/Заказы/Аналитика через `?tab=` (синхронизированы с
  сайдбаром), первичное действие **«Опубликовать»** → `/seller/new`.

### Phase I — QA
- `pnpm type-check` — чисто; `pnpm --filter @mta-market/web build` — ✓
  Compiled successfully (25/25 страниц); lint — только pre-existing warnings
  (в файлах, не тронутых планом, либо унаследованные).
- **Unit: 392/392** (vitest). **E2E: 59/59** (Playwright, реальный браузер,
  web :3002 + API :3001 + Postgres/Redis Docker + seed plan-003 + heartbeat).
- Браузерная верификация: скриншоты 1440×900 и 1920×1080, light+dark
  (home/market/servers/community/news/dashboard/account-menu/search-dropdown/
  collapsed sidebar/seller-apply/following). Проверено §54: бренд читается за
  5 сек, live-агрегаты видны, платное/бесплатное/услуги различимы, баланс без
  dashboard, сайдбар без визуального шума, обе темы намеренные.

## 2. Коммиты (§51)
Логические коммиты по фазам: design system → shell → home → market →
personal/notifications → creator studio → tests → docs (см. git log).

## 3. Честность (§41/§52) — что НЕ реализовано
- **Favorites** и **Premium**: навигационных элементов нет — бэкенда нет.
- **Sponsored/реклама**: домена нет; есть placement-контракт + реальные
  featured-сущности. Метка «Sponsored» появится только с кампаниями.
- **Compatibility/Health UI** (§20/§22): полей в публичном контракте ресурса
  нет — UI-компоненты не рисуют фиктивные статусы. Слот подготовлен
  (TrustBadges), включится с появлением данных.
- **Live Demo / 3D Studio / Leak Radar / bundles / promocodes / subscriptions**:
  НЕ реализованы; зарезервированы места (resource page tabs слот, Market
  структура, Creator Studio), навигация не раздута (§37).
- Top-up баланса и payouts: по-прежнему future (документ PROJECT.md).

## 4. Известные ограничения / housekeeping
- `documents/development/active/` содержит устаревшие спеки PLAN-012/013/014;
  PLAN-013 не имеет итоговой записи (выявлено аудитом PLAN-015). Отдельная
  уборка не входила в цель плана.
- Dev-оверлей Next.js (кнопка «N») визуально перекрывает нижний левый угол
  сайдбара в dev-режиме; в production-сборке отсутствует.
- Часть legacy-warnings ESLint (unused imports в admin/thread/manage) —
  вне скоупа плана, файлы не тронуты.
- Модальные фокус-трапы (ConfirmDialog/Gallery/drawer) — унаследованный долг
  PLAN-013; PLAN-015 не добавил новых модалок без трапа.

## 5. Приёмка (Definition of Done §53)
Global shell ✓ · Sidebar 2 состояния ✓ · Topbar ✓ · Search ✓ · Account+Balance ✓ ·
Один theme toggle ✓ · Light ✓ · Dark ✓ · Home ✓ (hero/live/popular/new/free/
news/discussions/activity/rail) · Market ✓ (ресурсы/услуги/фильтры/сортировки) ·
Resource/Server/Creator/Community/News ✓ · My MTA ✓ (purchases/licenses/
notifications/balance) · Creator Studio ✓ · Loading/Empty/Error ✓ ·
A11y (skip-link, combobox-семантика, focus-ring, reduced-motion) ✓ ·
Desktop QA 1440/1920 ✓ · Light QA ✓ · Dark QA ✓ · Browser E2E 59/59 ✓ ·
Build/typecheck/lint ✓ · Documentation updated ✓.
