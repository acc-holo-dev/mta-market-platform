
# PLAN-013 — MTA Market Visual System & UX Redesign

## 0. ЦЕЛЬ

MTA Market уже имеет значительный объём реальной функциональности:

* Identity;
* Profiles;
* Servers;
* Community;
* Content;
* Marketplace;
* Resources;
* Seller;
* Purchases;
* Payments;
* Licensing;
* DRM;
* Notifications;
* Follow;
* Activity;
* Analytics;
* Moderation;
* Administration.

Предыдущие планы в основном развивали product/backend capabilities.

PLAN-013 меняет другую часть системы:

> **визуальное восприятие, UX и design system всей платформы.**

Текущий сайт технически функционирует, но визуально выглядит слишком базово, разрозненно и близко к generic dashboard/application UI.

Необходимо провести полный visual + UX redesign существующего frontend.

---

# 1. ГЛАВНЫЙ ПРИНЦИП

Нельзя воспринимать задачу как:

```text
"поменять CSS"
```

или:

```text
"сделать красивее несколько страниц"
```

Задача:

```text
создать единую визуальную систему MTA Market
```

которая затем применяется ко всему продукту.

После PLAN-013 пользователь должен ощущать:

```text
"Я нахожусь внутри одной большой MTA-платформы."
```

а не:

```text
"Я нахожусь на наборе CRUD-страниц."
```

---

# 2. ИСТОЧНИКИ ДЛЯ РАБОТЫ

Перед реализацией обязательно изучить:

```text
documents/product/
documents/architecture/
documents/api/
documents/development/
documents/drm/
documents/module/

site/web/
site/server/

tests/
contracts/
```

Также использовать текущую фактическую UI реализацию.

Дополнительный visual reference:

в текущей задаче предоставлены screenshots текущих страниц MTA Market:

* Home;
* Admin;
* Server;
* Community.

Эти screenshots являются reference текущего состояния, а НЕ design target.

Нельзя просто копировать существующий UI.

---

# 3. ЧЕГО НЕЛЬЗЯ ДЕЛАТЬ

Не делать:

* простой recolor;
* случайные gradient;
* массовые border-radius без системы;
* декоративные элементы без UX-функции;
* excessive glassmorphism;
* чрезмерную анимацию;
* копирование чужого сайта;
* generic SaaS dashboard;
* generic Bootstrap-like design;
* перегруженный gaming UI;
* изменение бизнес-логики ради дизайна.

Никакая визуальная работа не должна ломать существующие functionality.

---

# 4. DESIGN DIRECTION

Целевое направление:

```text
Modern gaming platform
+
community platform
+
marketplace
+
MTA identity
```

Характер:

```text
Dark
Premium
Technical
Dynamic
Confident
Modern
Community-oriented
```

Но:

```text
не cyberpunk ради cyberpunk;
не neon everywhere;
не gaming HUD;
не перегруженность.
```

Визуальная система должна быть пригодна и для:

```text
Marketplace
Community
Servers
Articles
Profiles
Admin
Commerce
DRM
```

---

# 5. BRAND SYSTEM

Создать единый visual language.

Определить:

```text
Primary color
Secondary/accent
Background layers
Surface layers
Border system
Text hierarchy
Success
Warning
Danger
Info
Verified
Online
Offline
Unknown
Pending
```

Не использовать цвета хаотично.

Например:

```text
background
background-elevated
surface
surface-hover
surface-active
border
text-primary
text-secondary
text-muted
accent
success
warning
danger
```

Цветовая система должна быть централизованной.

---

# 6. TYPOGRAPHY SYSTEM

Определить:

```text
Display
H1
H2
H3
Body
Small
Caption
Label
Numeric
```

Задать:

```text
font-family
font-size
font-weight
line-height
letter-spacing
```

Не допускать страницы, на которых:

```text
H1 выглядит одинаково с H3
subtitle выглядит как body
metadata выглядит как normal text
```

---

# 7. SPACING SYSTEM

Создать единый spacing scale.

Например:

```text
4
8
12
16
20
24
32
40
48
64
80
96
```

Компоненты должны использовать системные spacing tokens.

Не использовать случайные:

```text
17px
19px
27px
31px
```

без причины.

---

# 8. LAYOUT SYSTEM

Создать базовые layout primitives:

```text
Page
Container
Section
Stack
Grid
Sidebar
Split
Toolbar
```

Основной content width должен быть единообразным.

Не допускать:

```text
Home = 1200px
Community = 900px
Server = 1400px
Admin = 1300px
```

без UX-причины.

---

# 9. NAVIGATION REDESIGN

Текущий navbar выглядит слишком маленьким и utilitarian.

Переработать:

```text
Logo
Main navigation
Search
Notifications
Balance
Profile
Admin
Mobile navigation
```

Navigation должна быть частью brand identity.

Предусмотреть:

```text
active states
hover states
context states
mobile
collapsed state
authenticated state
guest state
seller state
server owner state
admin state
```

Не показывать пользователю все возможности одновременно.

Navigation должна оставаться визуально чистой.

---

# 10. GLOBAL HEADER

Создать reusable header system:

```text
GlobalHeader
DesktopHeader
MobileHeader
NavigationGroup
UserMenu
NotificationButton
BalanceIndicator
SearchTrigger
```

Все страницы должны использовать один header system.

---

# 11. GLOBAL FOOTER

Создать единый footer:

```text
Brand
Navigation
Community
Market
Support
Legal
Social / external links
```

Footer должен выглядеть как часть продукта, а не случайный набор ссылок.

---

# 12. PAGE SYSTEM

Создать reusable page architecture:

```text
Page
├── PageHeader
├── PageHero
├── PageTabs
├── PageToolbar
├── PageContent
└── PageFooter
```

Не каждый экран обязан использовать все элементы.

Главное:

> одна visual grammar для всех страниц.

---

# 13. CARD SYSTEM

Полностью пересмотреть cards.

Создать:

```text
ResourceCard
ServerCard
ArticleCard
ThreadCard
ReviewCard
CreatorCard
NotificationCard
StatCard
ActivityCard
AdminCard
```

Карточки должны быть визуально родственными.

Но не одинаковыми.

Например:

```text
ResourceCard
```

должен ощущаться как product card.

```text
ServerCard
```

как identity/profile card.

```text
ThreadCard
```

как community content card.

---

# 14. BUTTON SYSTEM

Создать:

```text
Primary
Secondary
Ghost
Danger
Success
Icon
Icon+Text
```

Со состояниями:

```text
default
hover
active
focus
disabled
loading
success
```

Кнопки не должны выглядеть как стандартные HTML controls.

---

# 15. INPUT SYSTEM

Создать:

```text
Input
Textarea
Select
SearchInput
UploadInput
DateInput
Checkbox
Switch
Radio
```

С едиными:

```text
label
hint
error
success
disabled
focus
loading
```

---

# 16. BADGES

Создать unified badge system:

```text
Verified
Online
Offline
Unknown
Admin
Moderator
Seller
Server Owner
New
Popular
Free
Paid
Licensed
DRM
Pending
```

Особенно важна система trust badges.

---

# 17. ICONOGRAPHY

Не смешивать случайные icon libraries.

Создать единый icon style.

Icons должны:

```text
have same visual weight
have same scale logic
have same stroke behavior
```

---

# 18. MOTION SYSTEM

Создать умеренную motion system.

Использовать:

```text
fade
slide
scale
hover
focus
page transition
loading
skeleton
```

Но:

```text
никаких бесконечных animations.
```

Motion должна усиливать UX.

---

# 19. HOME REDESIGN

Home — одна из главных задач PLAN-013.

Текущая Home функционально уже реализует:

```text
Live
Activity
Popular
News
Marketplace
```

Не менять этот product structure без необходимости.

Но полностью изменить presentation.

Цель:

```text
Home должен восприниматься как
главный портал MTA Market.
```

Hero должен стать значительно сильнее.

Предусмотреть:

```text
background visual
brand element
search
live status
featured content
dynamic activity
```

Важно:

не создавать fake data.

---

# 20. HOME HERO

Пересобрать hero.

Он должен отвечать:

```text
Что происходит в MTA?
```

и сразу показывать:

```text
Live players
Servers
Community activity
Discovery entry points
```

У Hero должна быть собственная visual identity.

Не оставлять большой бессмысленный пустой участок экрана.

---

# 21. HOME ACTIVITY

Activity cards сделать визуально более выразительными.

Использовать:

```text
icons
entity identity
time
category
status
deep link
```

Но не перегружать.

---

# 22. HOME POPULAR

Пересобрать:

```text
Popular Servers
Popular Discussions
Popular Resources
```

как настоящие content blocks.

Не оставлять один маленький card с большим количеством пустого пространства вокруг.

---

# 23. HOME NEWS

News должны визуально ощущаться как editorial content.

Использовать:

```text
cover
category
title
author
date
```

Не только плоские квадраты.

---

# 24. SERVER PAGE REDESIGN

Server page должна стать одной из strongest surfaces платформы.

Новая структура:

```text
Server Hero
├── Cover
├── Logo
├── Name
├── Status
├── Online
├── Rating
├── Verified
├── Follow
├── Discord
└── Connect
```

Hero должен визуально объединять:

```text
identity
status
community
activity
```

---

# 25. SERVER PAGE BODY

Использовать:

```text
Overview
Live
Statistics
News
Updates
Reviews
Community
```

Но tabs не должны выглядеть как стандартные HTML links.

Сделать их частью visual navigation system.

---

# 26. SERVER STATE VISUALIZATION

Статусы:

```text
ONLINE
OFFLINE
UNKNOWN
SUSPENDED
VERIFIED
```

должны быть мгновенно читаемыми.

Особенно:

```text
UNKNOWN ≠ OFFLINE
```

---

# 27. COMMUNITY REDESIGN

Community должна выглядеть как настоящая community platform.

Структура:

```text
Community Hero
Categories
Pinned
Latest
Active
Following
```

Нужно увеличить visual hierarchy.

Главное:

```text
Thread title
activity
author
replies
views
status
```

должны считываться мгновенно.

---

# 28. THREAD PAGE

Thread page должна стать полноценным reading experience.

Не просто:

```text
title
card
text
card
card
```

А:

```text
Thread header
Author identity
Main content
Replies timeline
Reactions
Follow
Reply composer
Moderation context
```

---

# 29. MARKET REDESIGN

Marketplace должен визуально отличаться от community.

Он должен ощущаться как:

```text
MTA Product Marketplace
```

а не список admin cards.

---

# 30. RESOURCE PAGE

Resource page должна стать одной из основных conversion surfaces.

Структура:

```text
Product Hero
Gallery
Description
Features
Requirements
Compatibility
Versions
Reviews
Creator
Purchase
```

Primary CTA:

```text
Get
Buy
Owned
Unavailable
```

должен визуально доминировать.

---

# 31. CREATOR / SELLER

Creator page должна ощущаться как creator identity.

Использовать:

```text
Avatar
Banner
Name
Verification
Badges
Stats
Resources
Articles
Reviews
Activity
```

---

# 32. ARTICLE DESIGN

Articles не должны выглядеть как обычная route page.

Создать editorial reading experience:

```text
Cover
Title
Author
Metadata
Content
Related content
Discussion
```

---

# 33. PROFILE REDESIGN

Профиль пользователя:

```text
Hero
Avatar
Identity
Badges
Activity
Servers
Resources
Articles
```

Приватная информация остаётся private.

---

# 34. DASHBOARD

Dashboard пользователя должен выглядеть как:

```text
My MTA
```

а не admin dashboard.

Разделить:

```text
Activity
Subscriptions
Purchases
Notifications
Servers
Creator activity
```

---

# 35. ADMIN REDESIGN

Admin может оставаться функционально dense, но визуально он должен соответствовать общей системе.

Сейчас Admin выглядит как отдельный software product.

Нужно:

```text
same header
same typography
same cards
same spacing
same controls
same status system
```

но с более dense information layout.

---

# 36. MOBILE

Не ограничиться:

```css
@media ...
```

Нужно продумать mobile UX.

Проверить:

```text
Home
Servers
Server
Community
Thread
Market
Resource
Profile
Admin
```

отдельно.

---

# 37. RESPONSIVE RULES

Определить:

```text
mobile
tablet
desktop
wide desktop
```

и:

```text
container behavior
grid behavior
navigation
hero
cards
tabs
tables
modals
forms
```

---

# 38. ACCESSIBILITY

Не потерять:

```text
keyboard navigation
focus
aria
contrast
reduced motion
screen-reader semantics
```

---

# 39. COMPONENT ARCHITECTURE

Создать единый frontend design system.

Например:

```text
site/web/src/
├── components/
│   ├── ui/
│   │   ├── Button/
│   │   ├── Input/
│   │   ├── Card/
│   │   ├── Badge/
│   │   ├── Modal/
│   │   ├── Tabs/
│   │   ├── Tooltip/
│   │   └── ...
│   │
│   ├── layout/
│   │   ├── Header/
│   │   ├── Footer/
│   │   ├── Container/
│   │   └── Page/
│   │
│   ├── market/
│   ├── servers/
│   ├── community/
│   ├── content/
│   ├── profile/
│   └── admin/
```

Не создавать компоненты только для одного pixel-level случая, если их можно переиспользовать.

---

# 40. DESIGN TOKENS

Цвета, spacing, typography, radius, shadows, motion должны быть centralized.

Например:

```text
theme/
├── colors
├── typography
├── spacing
├── radius
├── shadows
└── motion
```

Не дублировать значения по десяткам компонентов.

---

# 41. VISUAL CONSISTENCY

После redesign проверить все основные поверхности:

```text
/
/servers
/servers/[slug]
/community
/community/forum
/community/forum/thread/[id]
/content
/content/articles/[slug]
/news
/resources
/resources/[slug]
/creators/[username]
/profile/[username]
/purchases
/balance
/store
/deals
/notifications
/admin
```

Они должны визуально принадлежать одной системе.

---

# 42. BACKEND SAFETY

PLAN-013 не должен ломать:

```text
API
authentication
authorization
payments
DRM
licenses
purchases
moderation
servers
community
notifications
```

Не менять backend, если для visual redesign этого не требуется.

---

# 43. UX REGRESSION

Все существующие пользовательские flows должны продолжить работать:

```text
login
registration
logout
server browse
server follow
review
forum
article
resource browse
purchase
license
seller
moderation
admin
notifications
```

---

# 44. VISUAL QA

Для каждой ключевой страницы сделать browser screenshot после redesign.

Минимально:

```text
Home
Marketplace
Resource
Servers
Server
Community
Thread
Article
Profile
Seller
Dashboard
Admin
```

Сравнить:

```text
visual hierarchy
spacing
density
contrast
responsive behavior
empty states
loading
errors
```

---

# 45. EMPTY STATES

Создать единый empty-state system.

Например:

```text
Нет серверов
Нет ресурсов
Нет уведомлений
Нет покупок
Нет обсуждений
Нет активности
Нет статей
```

Не оставлять пустые белые/тёмные блоки.

---

# 46. LOADING STATES

Создать:

```text
skeleton
spinner
progress
button loading
page loading
```

Loading должен визуально соответствовать design system.

---

# 47. ERROR STATES

Создать единый UX:

```text
Inline error
Toast
Page error
Not found
Unauthorized
Forbidden
Conflict
Network error
```

---

# 48. TOAST / NOTIFICATION UI

Уведомления интерфейса должны иметь unified system.

Не использовать случайные browser alert-like patterns.

---

# 49. MODALS / DRAWERS

Создать unified:

```text
Modal
Dialog
Drawer
Sheet
```

с единым interaction model.

---

# 50. TABLES

Admin/analytics areas могут использовать tables.

Tables должны иметь отдельный density mode:

```text
normal
compact
```

но использовать те же visual tokens.

---

# 51. DO NOT DESTROY EXISTING DATA

Не менять production data.

Не менять database schema без необходимости.

Не создавать migration только ради CSS/UX.

---

# 52. DOCUMENTATION UPDATE

После завершения обновить:

```text
documents/architecture/SITE.md
documents/architecture/TESTING.md
documents/product/PRODUCT-SURFACE-MAP.md
```

если фактическая UX structure изменилась.

Добавить отдельный документ:

```text
documents/architecture/DESIGN-SYSTEM.md
```

Он должен описывать:

```text
tokens
components
layout
responsive rules
motion
accessibility
visual language
```

---

# 53. TESTING

Добавить/обновить:

```text
tests/e2e/
```

для visual-critical flows.

Также:

```text
tests/e2e/visual/
```

если выбран visual regression tooling.

Минимально проверять:

```text
Home
Server
Community
Market
Resource
Profile
Admin
```

---

# 54. VISUAL REGRESSION

Рассмотреть Playwright screenshot assertions.

Не делать pixel-perfect assertions на динамических данных без фиксации fixtures.

Использовать controlled fixtures.

---

# 55. PERFORMANCE

Redesign не должен:

```text
увеличивать initial JS без причины;
ломать image optimization;
добавлять тяжёлые animation libraries без необходимости;
создавать огромный CSS bundle;
загружать все изображения сразу.
```

Особенно контролировать:

```text
Home
Server hero
Market gallery
Article media
```

---

# 56. IMAGE SYSTEM

Создать единый подход к:

```text
cover
avatar
banner
gallery
thumbnail
hero
```

Определить:

```text
ratio
size
crop
fallback
loading
priority
```

---

# 57. FINAL UX PRINCIPLE

Каждый экран должен отвечать:

```text
Где я?
Что здесь находится?
Что главное?
Что я могу сделать?
Что произойдёт после действия?
```

Если визуальный элемент не помогает ответить на один из этих вопросов — проверить необходимость.

---

# 58. ACCEPTANCE CRITERIA

PLAN-013 считается завершённым только когда:

* [ ] создана единая design system;
* [ ] определены design tokens;
* [ ] обновлена global navigation;
* [ ] обновлён header;
* [ ] обновлён footer;
* [ ] обновлены buttons;
* [ ] обновлены inputs;
* [ ] обновлены cards;
* [ ] обновлены badges;
* [ ] обновлена typography;
* [ ] обновлён spacing;
* [ ] обновлён responsive system;
* [ ] Home полностью redesign;
* [ ] Marketplace полностью redesign;
* [ ] Resource page redesign;
* [ ] Server page redesign;
* [ ] Community redesign;
* [ ] Thread redesign;
* [ ] Content/Article redesign;
* [ ] Profile redesign;
* [ ] Creator/Seller redesign;
* [ ] Dashboard redesign;
* [ ] Admin redesign;
* [ ] loading states redesigned;
* [ ] empty states redesigned;
* [ ] error states redesigned;
* [ ] mobile UX проверен;
* [ ] accessibility проверена;
* [ ] existing backend functionality сохранена;
* [ ] existing E2E flows проходят;
* [ ] visual regression baseline создан;
* [ ] performance не деградировал критически;
* [ ] documentation обновлена.

---

# 59. ПОРЯДОК РЕАЛИЗАЦИИ

Не переделывать все страницы случайным образом.

Использовать порядок:

```text
1. Design tokens
2. Typography
3. Colors
4. Spacing
5. Icons
6. Core UI components
7. Header
8. Footer
9. Layout system
10. Home
11. Market
12. Resource
13. Servers
14. Server
15. Community
16. Thread
17. Content
18. Article
19. Profile
20. Creator
21. Dashboard
22. Admin
23. Mobile
24. Accessibility
25. Visual regression
26. Final QA
```

---

# 60. FINAL REPORT

После завершения предоставить:

```text
1. Старое визуальное состояние
2. Новая design system
3. Design tokens
4. Новые компоненты
5. Изменённые страницы
6. Responsive strategy
7. Accessibility changes
8. Performance impact
9. E2E result
10. Visual regression result
11. Files created
12. Files changed
13. Files removed
14. Documentation updated
15. Remaining visual debt
16. Final screenshots
17. Exact commits
```

Не заявлять PLAN-013 завершённым только по факту успешного build.

Для visual redesign обязательна browser-level проверка.
