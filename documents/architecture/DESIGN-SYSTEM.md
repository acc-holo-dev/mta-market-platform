# DESIGN-SYSTEM — визуальная система MTA Market

Статус: source of truth для PLAN-013 (Visual System & UX Redesign).
Дата: 2026-09-11.

Документ описывает единый визуальный язык платформы: tokens, компоненты,
layout, responsive rules, motion, accessibility. Каждый frontend-изменённый
файл обязан соответствовать этой системе; никакие значения цветов/отступов
не дублируются вне tokens.

---

## 1. ПРИНЦИПЫ

1. **Одна платформа** — все поверхности (Home, Market, Server, Community,
   Content, Profile, Seller, Admin, Commerce, DRM) читаются как части одного
   продукта, а не набор CRUD-страниц.
2. **Dark premium** — единственная тема (тёмная), high-contrast, без
   light-theme в текущем цикле.
3. **Система, а не recolor** — цвета, отступы, типографика, радиусы,
   тени, motion задаются токенами; никакие значения не дублируются
   в компонентах.
4. **Функция, а не декор** — каждый визуальный элемент отвечает на вопрос
   «где я? / что главное? / что я могу сделать?»; элементы без UX-функции
   удаляются.
5. **Ничего не ломаем** — редизайн не меняет селекторы, тексты, роли ARIA
   и структуру данных, от которых зависят Playwright E2E.

---

## 2. ЦВЕТОВАЯ СИСТЕМА (tokens)

Все цвета — HSL-каналы в CSS custom properties (`globals.css`), одинаковый
синтаксис `H S% L%` без alpha; прозрачность через Tailwind `bg-accent/40`.

### Backgrounds

| Токен | Назначение |
|---|---|
| `--background` | базовый фон страницы (самый тёмный) |
| `--surface` | карточка / панель |
| `--surface-hover` | hover-состояние поверхности |
| `--surface-raised` | поднятая панель (модалки, выпадашки, сайдбары) |
| `--surface-inset` | утопленные блоки (input-фоны, code, timeline) |

### Lines (границы)

| Токен | Назначение |
|---|---|
| `--line` | дефолтная граница |
| `--line-strong` | акцентная граница, инпуты |
| `--line-accent` | граница в брендовом цвете (active tab, hero-frame) |

### Text

| Токен | Назначение |
|---|---|
| `--text-primary` | основной текст |
| `--text-secondary` | второстепенный текст |
| `--muted` | metadata, подписи, дизейблы |

### Brand / semantic

| Токен | Назначение |
|---|---|
| `--primary` / `--primary-strong` / `--primary-soft` | бренд, кнопки, ссылки |
| `--success` / `--success-soft` | онлайн, завершено, активна |
| `--warning` / `--warning-soft` | на модерации, ожидание |
| `--danger` / `--danger-soft` | ошибки, опасные действия, revoked |
| `--info` / `--info-soft` | информация, DRM/лицензии |
| `--verified` | verified-бейджи (дублирует success-семейство, отдельный токен для trust-системы) |

Правила:
- сырая палитра Tailwind (slate/blue/red/green/…) в компонентах ЗАПРЕЩЕНА —
  только токены через tailwind config;
- все `dark:` варианты legacy удаляются (тема одна);
- status-цвета едины: ONLINE=success, OFFLINE=neutral/muted, UNKNOWN=muted,
  PENDING=warning, DISPUTED/FAILED=danger, VERIFIED=verified.

---

## 2a. ТЕМПЕРАТУРА ПАЛИТРЫ (decision)

Бренд-акцент MTA Market — холодный electric blue (`--primary: 217 91% 57%`)
на почти чёрном синем фоне. Акцентные暖-цвета (amber) допустимы ТОЛЬКО для
warning/pending и звёзд рейтинга. Никаких неоновых градиентов, никакого
cyberpunk.

---

## 3. ТИПОГРАФИКА

Шрифт: системный стек (`system-ui, -apple-system, "Segoe UI", Roboto,
sans-serif`) — без веб-шрифтов (PERF-принцип PLAN-013 §55).

| Роль | Класс | Описание |
|---|---|---|
| Display | `text-4xl md:text-5xl font-extrabold tracking-tight` | Home hero |
| H1 | `text-3xl font-bold tracking-tight` | заголовок страницы |
| H2 | `text-2xl font-bold` | секция |
| H3 | `text-lg font-semibold` | карточный заголовок |
| Body | `text-sm text-content-secondary` | основной текст |
| Small | `text-sm` | плотные списки |
| Caption | `text-xs text-content-muted` | метаданные, время |
| Label | `text-xs font-semibold uppercase tracking-wide` | ярлыки полей/фильтров |
| Numeric | `tabular-nums` | деньги, счётчики, статистика |

Правила: H1 не может выглядеть как H3 (гарантируется классами); числа в
таблицах/картах — `tabular-nums`; metadata (дата, автор) — caption, не body.

---

## 4. SPACING (шкала)

Единая шкала Tailwind: `1 (4px) · 2 (8) · 3 (12) · 4 (16) · 5 (20) · 6 (24)
· 8 (32) · 10 (40) · 12 (48) · 16 (64)`. Произвольные значения (17px, 19px,
27px) запрещены. Компонентные конвенции:

- карточка: padding `p-5` (внутри плотных админ-списков `p-4`);
- секция страницы: `py-8` / `py-12`;
- между карточками в гриде: `gap-4`;
- hero: `py-16 md:py-24`.

---

## 5. LAYOUT SYSTEM

- Контентная ширина: **один контейнер** `mx-auto max-w-7xl px-4 sm:px-6 lg:px-8`
  (компонент `Container`). Max-width админки и каталога не различаются;
  плотность задаёт компонент, не ширина.
- `Page` — вертикальная композиция: `PageHeader` (breadcrumbs + h1 +
  description + actions), `PageContent` (главный контент), опциональный
  `PageToolbar`.
- Сайдбар-макеты (ресурс-страница, каталог с фильтрами): `lg:grid-cols-[240px,1fr]`,
  на мобиле сайдбар превращается в bottom-sheet.

---

## 6. КОМПОНЕНТЫ (ui kit)

Расположение: `site/web/src/components/ui/`. Все — token-based, `cn()` для
склейки классов.

| Компонент | API (ключевое) |
|---|---|
| `Button` | variant: primary/secondary/ghost/danger/success/icon; size sm/md/lg; loading; aria-обязателен |
| `Input` / `Textarea` / `Select` / `SearchInput` | label, error, hint, disabled, loading |
| `Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardFooter` | поверхностная база |
| `Badge` / `StatusBadge` | семантические токены (trust-система: Verified/Online/Offline/Unknown/Pending/…) |
| `Tabs` | underline-стиль, активный — brand-подчёркивание + текст, aria-pressed |
| `Modal` / `ConfirmDialog` / `ReportDialog` | unified overlay, Esc, focus trap |
| `Skeleton` / `LoadingSpinner` / `Progress` | loading-система |
| `EmptyState` / `ErrorState` | единые empty/error UX с action |
| `Avatar` | img с fallback инициала, размеры sm/md/lg |
| `Gallery` | cover + thumbs + lightbox |
| `Price` / `Rating` | денежный формат, звёзды |
| `SectionHeader` | заголовок секции + action |
| `ResourceCard` / `ServerCard` / `ThreadRow` | domain-карточки |

Domain-карточки визуально родственны (одна Card-база), но не одинаковы:
ResourceCard — product-карточка (cover доминирует), ServerCard —
identity-карточка (banner + logo + статус), ThreadRow — community-строка
(заголовок + счётчики).

---

## 7. NAVIGATION

- `Navbar` — sticky, h-16, единый `Container`; desktop-меню + mobile right-sheet.
- Состав: Logo · Главная навигация (Маркетплейс, Серверы, Статьи,
  Сообщество) · Search trigger → /search · для аутентифицированных:
  Balance chip, Notifications bell с unread badge, Профиль-меню (Кабинет,
  Мой магазин, Выход), для ADMIN/MODERATOR — Админ.
- Guests: Войти + Регистрация.
- Active state: `bg-surface-hover text-content` + нижний accent-бордер.
- Footer: бренд · Разделы · Сообщество · Аккаунт · © + правовой блок.

---

## 8. RESPONSIVE RULES

| Breakpoint | Поведение |
|---|---|
| mobile (<768) | single column; hamburger → right-sheet; фильтры — bottom-sheet; табы — overflow-x-auto; hero py-16 |
| tablet (≥768) | 2-col гриды; сайдбар скрыт до lg |
| desktop (≥1024) | 3-col каталоги; sticky-сайдбары; полная навигация |
| wide (≥1280) | 3-4 col гриды; max-w-7xl не расширяется |

Модалки: `sm:max-w-lg`; таблицы админки — horizontal scroll на mobile.

---

## 9. MOTION

- transitions: `transition-colors duration-150` (hover/focus/active) — дефолт;
- fade/slide для модалок и мобильных sheet'ов (`duration-200`);
- skeleton `animate-pulse`; live-индикатор — ping-точка;
- НЕ допускаются: бесконечные анимации, parallax, анимации на скролле.
- `prefers-reduced-motion` — отключение pings/pulses.

---

## 10. ACCESSIBILITY

- фокус: глобальный `:focus-visible` ring (2px accent-strong, offset 2);
- клавиатура: все интеракции — button/a с role/aria; модалки — Esc + focus;
- контраст: текст-secondary ≥ 4.5:1 на surface;
- screen-reader семантика: `role="alert"` у ошибок, `aria-label` у иконочных
  кнопок, `aria-pressed` у табов/фильтров;
- изображения: значимый `alt` (Е2E завязан на alt-маркеры обложек).

---

## 11. ICONS / IMAGES

- Иконки: lucide-react, единый stroke-стиль, размеры 16/20/24.
- Медиа: обложки `aspect-video`, аватары круг 1:1, баннер 3:1; lazy-loading
  для всех изображений; typographic fallback для отсутствующих обложек.

---

## 12. CHECKLIST СООТВЕТСТВИЯ

Изменяя frontend-файл, проверяешь:
- [ ] нет сырых Tailwind-палитр (slate/blue/green/red/emerald/amber/…) вне ui-токенов;
- [ ] нет `dark:` вариантов (тема единственная);
- [ ] отступы — только шкала §4;
- [ ] тексты и роли совпадают с E2E-селекторами (см. tests/e2e);
- [ ] loading/empty/error — через `Skeleton`/`EmptyState`/`ErrorState`;
- [ ] focus/aria не потеряны.