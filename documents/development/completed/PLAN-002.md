PLAN-002 — Product Experience Foundation

Контекст проекта:
- acc-holo-dev/mta-market-site
- acc-holo-dev/mta-market-module
- acc-holo-dev/mta-market-document

PLAN-001 завершён и зафиксирован как Initial Product Release.

Теперь не нужно спасать архитектуру и не нужно заново строить backend. Текущий продукт уже работает: регистрация/вход, Discord, профиль, баланс, Marketplace, seller flow, artifact upload, moderation, admin, free/paid purchase, licenses и существующая DRM-инфраструктура.

Проблема следующего уровня — продукт пока визуально и UX-ощущением слабый. Интерфейс сейчас выглядит как функциональный MVP/internal tool, а не как законченный современный marketplace.

Цель PLAN-002:

Превратить работающий Initial Product Release в цельный, понятный, современный и визуально сильный Marketplace Experience.

Главный принцип:

НЕ добавлять множество новых backend-функций.
НЕ переписывать существующую архитектуру без необходимости.
НЕ начинать новые большие feature-проекты.
Основной фокус — frontend, UX, information architecture, visual design, product consistency и реальное использование уже существующих backend возможностей.

==================================================
1. DEFINITION OF PLAN-002
==================================================

PLAN-002 считается завершённым не тогда, когда написаны все UI-задачи.

Он считается завершённым, когда MTA Market визуально и логически воспринимается как единый marketplace-продукт.

Пользователь должен:

1. с первого взгляда понимать, что такое MTA Market;
2. видеть, что здесь продаются/раздаются реальные ресурсы;
3. понимать, где Marketplace;
4. легко находить ресурс;
5. понимать, чем ресурсы отличаются друг от друга;
6. видеть цену, автора, рейтинг и другую важную информацию;
7. понимать основное действие на каждом экране;
8. легко переходить между Marketplace, покупками, профилем и своим магазином;
9. нормально пользоваться сайтом с desktop и mobile;
10. не сталкиваться с ощущением «технической панели вместо продукта».

Продавец должен:

1. понимать состояние своего магазина;
2. видеть свои ресурсы;
3. видеть модерацию;
4. создавать ресурс без ощущения сырой формы;
5. понимать каждый шаг создания;
6. видеть результат действий.

Администратор должен:

1. быстро понимать состояние платформы;
2. видеть задачи, требующие действий;
3. удобно модерировать;
4. управлять существующими сущностями без хаотичной навигации.

==================================================
2. ЧТО НЕ ВХОДИТ В PLAN-002
==================================================

Не реализовывать в рамках этого плана:

- Live Demo;
- Asset Studio;
- Leak Radar;
- Watermark forensic system;
- subscriptions;
- новый payment provider;
- пополнение баланса;
- seller analytics;
- seller API;
- seller webhooks;
- A/B listings;
- bundles;
- wishlist;
- advanced compatibility intelligence;
- release channels;
- MTA Market Manager;
- сложный search infrastructure;
- новую DRM архитектуру;
- новую payment архитектуру;
- глобальный backend refactor.

Если в процессе работы возникает идея, которая не нужна для улучшения текущего продукта, она не становится автоматически частью PLAN-002.

Такие идеи должны оставаться в IDEAS.

==================================================
3. ОСНОВНОЕ НАПРАВЛЕНИЕ
==================================================

Нужно мыслить не страницами, а продуктом.

Главный объект MTA Market — Resource.

Не balance.
Не DRM.
Не seller.
Не admin.

Пользователь приходит за ресурсом.

Поэтому визуальная и информационная иерархия должна строиться вокруг:

Resource
→ Discovery
→ Resource Details
→ Purchase / Acquisition
→ License

А уже вокруг этого строятся:

Account
Seller
Admin

==================================================
4. WORKSTREAM A — PRODUCT INFORMATION ARCHITECTURE
==================================================

A-001 — Определить окончательную пользовательскую навигацию

Сформировать понятную глобальную структуру.

Базово:

- Marketplace
- Покупки
- Профиль
- Мой магазин / Продавец
- Админ — только для соответствующих ролей

Не добавлять меню только ради количества пунктов.

Каждый пункт должен иметь понятную пользовательскую ценность.

---

A-002 — Разделить пользовательские и административные сценарии

Обычный пользователь не должен ощущать административные сущности как часть обычной навигации.

Seller и buyer должны восприниматься как роли/возможности аккаунта, а не как разные приложения.

Admin остаётся отдельной operational area.

---

A-003 — Определить главный CTA каждого экрана

Для каждого основного экрана определить одно главное действие:

Marketplace:
найти/открыть ресурс.

Resource:
купить/получить.

Account:
управлять аккаунтом.

Seller:
управлять магазином/ресурсами.

Create Resource:
завершить создание и отправить на модерацию.

Admin:
выполнить административное действие.

Не допускать ситуации, когда на экране 5 одинаково важных кнопок.

==================================================
5. WORKSTREAM B — DESIGN SYSTEM
==================================================

B-001 — Сформировать единый визуальный язык MTA Market

Сохранить общую идею текущей темы:

- dark/deep navy;
- blue accent;
- светлая основная типографика.

Но перестать использовать цвет как единственный инструмент иерархии.

Не превращать весь сайт в набор синих блоков.

---

B-002 — Определить design tokens

Создать единые значения для:

- background;
- surface;
- surface-hover;
- border;
- text-primary;
- text-secondary;
- muted;
- primary;
- success;
- warning;
- danger;
- spacing;
- radius;
- shadow;
- typography scale.

---

B-003 — Расширить базовые UI components

Существующая база:

- Button;
- Card;
- Input;
- States;
- StatusBadge.

Использовать её как фундамент.

При необходимости добавить:

- Tabs;
- Select;
- Dropdown;
- Modal/Dialog;
- Toast;
- Avatar;
- Badge;
- Breadcrumbs;
- Table;
- Pagination;
- Sidebar;
- Drawer;
- Progress;
- FileUpload;
- ResourceCard;
- Price;
- Rating;
- EmptyState;
- Skeleton;
- ConfirmDialog.

Не создавать визуально одинаковые компоненты несколько раз.

---

B-004 — Установить правила компонентов

Один и тот же компонент должен выглядеть одинаково во всём приложении.

Например:

Button primary в Marketplace и Admin не должен быть разным компонентом только из-за страницы.

==================================================
6. WORKSTREAM C — GLOBAL LAYOUT & NAVIGATION
==================================================

C-001 — Переделать глобальный Navbar

Текущий Navbar функционален, но слишком простой.

Нужно сделать его продуктовым.

Desktop:

MTA Market
Marketplace
Покупки
Профиль
Мой магазин
Admin conditional

Справа:

Balance
User
Logout

Для анонимного пользователя:

Войти
Регистрация

---

C-002 — Mobile navigation

Текущая desktop navigation не должна просто исчезать на mobile.

Создать нормальную mobile navigation:

- hamburger/menu;
- drawer или другое понятное решение;
- основные разделы;
- account;
- balance;
- seller;
- admin conditional;
- logout.

---

C-003 — Header states

Проверить состояние:

- anonymous;
- authenticated;
- seller;
- moderator;
- admin.

Не должно быть визуальных скачков и поломки layout после восстановления session.

==================================================
7. WORKSTREAM D — HOMEPAGE
==================================================

D-001 — Полностью переработать homepage

Текущий экран является преимущественно landing page:

Hero
→ Почему MTA Market?
→ CTA

Это больше не соответствует зрелости продукта.

Homepage должна стать marketplace-oriented.

---

D-002 — Новый Hero

Hero должен быстро объяснить:

что такое MTA Market;
что здесь можно найти;
что пользователь может сделать.

Пример направления:

"Ресурсы для твоего MTA:SA сервера"

+
короткое объяснение

+
поиск

+
основной CTA Marketplace

Не копировать этот текст буквально — разработать лучший вариант самостоятельно.

---

D-003 — Показывать реальные ресурсы на homepage

Homepage должна использовать существующие backend data.

Минимальные секции:

- Популярное;
- Новинки;
- Бесплатные ресурсы;
- возможно Featured.

Если соответствующей статистики пока нет, использовать доступные данные без создания новой analytics subsystem.

---

D-004 — Seller CTA

Отдельно оставить понятный путь:

"Стать продавцом"

но он не должен визуально доминировать над Marketplace.

---

D-005 — Footer

Привести footer в профессиональное состояние.

Проверить:

- актуальный год;
- ссылки;
- terms;
- privacy;
- documentation;
- отсутствие битых ссылок;
- единый visual style.

Не оставлять старые значения вроде `2025`, если текущий год другой.

==================================================
8. WORKSTREAM E — MARKETPLACE
==================================================

E-001 — Перестроить страницу Marketplace

Текущая страница уже функциональна:

- ресурс list;
- free/paid;
- type filter;
- pagination.

Сохранить backend functionality.

Переделать presentation.

---

E-002 — Search area

На первом этапе не строить Meilisearch.

Можно создать визуально и архитектурно подготовленное поле поиска, но backend search должен добавляться только если реально необходим для PLAN-002.

Не имитировать поиск, который ничего не делает.

---

E-003 — Filters

Сделать фильтры более понятными:

- Цена:
  - Все;
  - Бесплатные;
  - Платные.

- Тип:
  - Все;
  - Scripts;
  - Maps;
  - Models;
  - Textures;
  - Sounds;
  - Gamemodes.

Использовать реальные enum/domain values.

---

E-004 — Sorting

Если backend already позволяет безопасно определить порядок, использовать его.

Если sorting отсутствует — не изобретать сложный ranking backend.

Можно подготовить UI architecture под:

- Новые;
- Популярные;
- Цена;
- Рейтинг.

Но не показывать неработающую сортировку.

---

E-005 — Resource grid

Marketplace должен визуально восприниматься как магазин.

На desktop:
3–4 колонки в зависимости от viewport.

На mobile:
1 колонка.

---

E-006 — Resource Card

Текущая card должна быть переработана.

Минимально отображать:

- cover/preview;
- title;
- type;
- seller;
- rating;
- review count where available;
- price;
- free state;
- version/update information where useful;
- основной CTA или переход на detail.

Не перегружать карточку всеми возможными данными.

Основная задача карточки:

понять что это;
понять кто сделал;
понять стоит ли посмотреть;
понять сколько стоит.

---

E-007 — Resource visual model

Проверить существующую backend модель на наличие подходящего image/cover/screenshot поля.

Если такого поля пока нет:

не создавать большую media subsystem автоматически.

Сформировать минимальный путь, необходимый для будущего cover system, и отдельно зафиксировать любой backend gap.

Не использовать фейковые картинки как окончательное решение.

---

E-008 — Empty state

Если Marketplace пустой:

не показывать просто "Пока нет опубликованных ресурсов".

Создать нормальный marketplace empty state.

---

E-009 — Loading state

Использовать skeletons там, где это делает UI лучше.

Не ограничиваться текстом "Загрузка...".

---

E-010 — Error state

Ошибки должны быть понятными человеку и иметь retry/action там, где это уместно.

==================================================
9. WORKSTREAM F — RESOURCE DETAIL
==================================================

F-001 — Сделать Resource Page центральным экраном покупки

Resource page должна ощущаться как полноценная product page.

---

F-002 — Hero area

В верхней части:

- cover;
- title;
- seller;
- rating;
- type;
- price;
- primary CTA;
- version;
- ключевая compatibility information where available.

---

F-003 — Description

Разделить информацию визуально:

- Overview;
- Description;
- Features;
- Requirements;
- Compatibility;
- Versions;
- Reviews.

Использовать только реально существующие данные.

---

F-004 — Purchase area

Для paid:

Купить.

Для free:

Получить бесплатно.

После получения:

Уже приобретено / соответствующий state.

Не создавать фиктивные состояния.

---

F-005 — Reviews

Сделать отзывы визуально полноценными:

- average rating;
- distribution if data allows;
- review list;
- author;
- date;
- content.

Backend reviews уже существуют — задача здесь в presentation.

---

F-006 — Versions

Сделать историю версий читаемой.

Не выводить технический массив данных как обычный текст.

==================================================
10. WORKSTREAM G — ACCOUNT EXPERIENCE
==================================================

G-001 — Переделать /account

Текущая account page объединяет профиль, balance, identities, purchases и disputes.

Оставить одну account area, но создать внутри логические секции/tabs.

Например:

Overview
Profile
Security / Connections
Balance
Purchases
Licenses

Не обязательно создавать отдельный маршрут для каждой секции.

---

G-002 — Profile section

Сделать визуально сильнее:

- avatar;
- username;
- email;
- display name;
- role;
- connected accounts.

---

G-003 — Balance section

Показывать:

- current balance;
- состояние;
- понятное объяснение, что top-up ещё не доступен.

Не делать fake "Пополнить".

---

G-004 — Purchases

Покупки должны выглядеть как история покупок, а не как технический список объектов.

Показать:

- resource;
- date;
- amount;
- status;
- license;
- action.

---

G-005 — License state

Состояние лицензии должно быть понятно без технических знаний:

Active
Expired
Revoked
и т.д., если такие states реально существуют.

==================================================
11. WORKSTREAM H — SELLER STUDIO
==================================================

H-001 — Переименовать концепцию seller area

Вместо ощущения:

"Продавец"

ориентироваться на концепцию:

"Мой магазин"

или эквивалентное продуктово понятное название.

---

H-002 — Seller dashboard

Сделать настоящую стартовую страницу магазина.

Минимальные показатели:

- количество ресурсов;
- опубликованные;
- на модерации;
- draft;
- существующие доступные финансовые значения.

Не добавлять analytics subsystem.

---

H-003 — Resource management

Основной экран:

Мои ресурсы

Состояния:

Draft
Pending moderation
Published
Suspended
Rejected

Сделать state visually obvious.

---

H-004 — Create Resource

Использовать существующий 4-step wizard.

Нужно улучшить:

- визуальную структуру;
- progress;
- explanation;
- validation feedback;
- file upload;
- summary before submit;
- final confirmation.

---

H-005 — Artifact upload

Существующий backend pipeline не переписывать.

UI должен показывать:

- selected file;
- upload state;
- validation;
- success;
- failure.

---

H-006 — Moderation feedback

Seller должен понимать:

"На модерации"

или

"Отклонено"

и видеть причину, если она существует.

Не показывать внутренние технические enum values как основной UI.

==================================================
12. WORKSTREAM I — ADMIN EXPERIENCE
==================================================

I-001 — Admin Panel information architecture

Существующий backend/admin функционал сохранить.

Сформировать понятную admin architecture:

Dashboard
Moderation
Resources
Sellers
Users
Orders
Payments
Disputes
Versions

Не обязательно реализовывать отсутствующие backend sections только ради меню.

Раздел должен появляться только когда за ним есть реальная функция.

---

I-002 — Dashboard

Сейчас stats уже существуют.

Использовать их как real dashboard.

Показывать:

- users;
- resources;
- published;
- pending;
- reviews;
- revenue/financial data only where existing data is reliable.

---

I-003 — Moderation

Сделать очередь визуально удобной.

Каждая запись должна позволять быстро понять:

- что за ресурс;
- кто продавец;
- когда отправлен;
- что нужно решить.

---

I-004 — Resource Review

При открытии ресурса администратор должен видеть:

- product data;
- seller;
- artifact/version;
- validation;
- current state;
- moderation history where useful.

---

I-005 — Approve / Reject

Actions должны быть визуально очевидны.

Reject должен запрашивать reason там, где backend это поддерживает.

---

I-006 — Seller management

Использовать существующий functionality.

Не превращать page в таблицу сырых DB records.

==================================================
13. WORKSTREAM J — RESPONSIVE / MOBILE
==================================================

J-001 — Mobile-first verification

Проверить основные страницы:

- homepage;
- marketplace;
- resource detail;
- login;
- register;
- account;
- seller;
- seller creation;
- admin.

---

J-002 — Touch interaction

Все основные:

- buttons;
- tabs;
- filters;
- cards;
- forms

должны иметь удобные touch targets.

---

J-003 — Mobile content hierarchy

Не просто уменьшать desktop layout.

Перестроить:

- navigation;
- grids;
- cards;
- filters;
- resource information;
- admin tables.

==================================================
14. WORKSTREAM K — UX STATES
==================================================

K-001 — Loading

Основные страницы должны использовать осмысленные loading states.

---

K-002 — Empty

Каждый важный empty state должен:

- объяснять ситуацию;
- давать context;
- по возможности иметь action.

---

K-003 — Errors

Ошибки должны быть:

- понятными;
- локализованными;
- не техническими;
- recoverable, если возможно.

Не показывать raw server errors пользователю.

---

K-004 — Success states

Особенно для:

- resource creation;
- moderation;
- purchase;
- profile update.

Пользователь должен понимать, что действие действительно завершено.

==================================================
15. WORKSTREAM L — ACCESSIBILITY
==================================================

L-001 — Semantic HTML

Использовать правильные:

- headings;
- labels;
- buttons;
- links;
- forms.

---

L-002 — Keyboard navigation

Проверить:

- login;
- registration;
- Marketplace;
- filters;
- resource page;
- dialogs;
- seller wizard;
- admin actions.

---

L-003 — Contrast

Проверить dark theme на читаемость.

Не использовать приглушённый текст, который фактически теряется на фоне.

---

L-004 — Focus states

Интерактивные элементы должны иметь видимый focus.

==================================================
16. WORKSTREAM M — CONTENT QUALITY
==================================================

M-001 — Убрать generic marketing claims

Текст должен соответствовать реальному продукту.

Не обещать функциональность, которая не проверена.

Например утверждение о мгновенных production payouts нельзя оставлять как безусловное обещание, если production payment flow ещё не прошёл настоящий контур.

---

M-002 — Терминология

Использовать единые термины:

- Marketplace;
- Resource;
- Seller;
- Buyer;
- License;
- Balance;
- Purchase;
- Moderation.

Русские UI-формулировки должны быть консистентными.

---

M-003 — Даты

Проверить старые даты и copyright.

==================================================
17. WORKSTREAM N — FRONTEND ARCHITECTURE QUALITY
==================================================

N-001 — Reuse existing components

Перед добавлением нового компонента искать существующий аналог.

---

N-002 — Remove dead imports/code

Убрать:

- unused imports;
- dead components;
- старые UI fragments;
- legacy visual code.

---

N-003 — Avoid page-specific visual duplication

Если один UI pattern встречается 2+ раза — рассмотреть создание shared component.

---

N-004 — API consistency

Не менять backend API без реальной необходимости.

При несовпадении frontend/backend контрактов сначала определить source of truth и исправлять минимально необходимую сторону.

==================================================
18. WORKSTREAM O — PRODUCT DATA / MOCK CONTENT
==================================================

O-001 — Использовать реальные данные

Homepage и Marketplace должны работать через существующий API.

Не зашивать demo resources непосредственно в React как production content.

---

O-002 — Development seed content

Если для красивой демонстрации нужны ресурсы, создать аккуратный dev seed.

Seed должен быть явно development-only.

---

O-003 — Demo data quality

Demo resources должны выглядеть как настоящие товары:

- нормальные названия;
- описания;
- типы;
- цены;
- версии;
- seller.

Не использовать названия вида "Demo Resource 1" как финальный showcase.

==================================================
19. WORKSTREAM P — TESTING
==================================================

P-001 — Existing PLAN-001 E2E сохраняется

Не ломать существующие 12 browser E2E.

---

P-002 — Добавить UI regression coverage

Проверить основные критические UI states.

---

P-003 — Responsive verification

Проверить desktop/mobile viewport для основных страниц.

---

P-004 — Visual consistency

Проверить:

- typography;
- spacing;
- cards;
- buttons;
- forms;
- colors;
- navigation.

---

P-005 — Product flow regression

После redesign должен продолжать работать:

register
→ login
→ Marketplace
→ resource
→ seller
→ moderation
→ purchase
→ license.

---

P-006 — Build/typecheck/tests

После завершения:

- server typecheck;
- web typecheck;
- web production build;
- backend tests;
- Playwright E2E.

==================================================
20. WORKSTREAM Q — DOCUMENTATION
==================================================

PLAN-002 не создаёт полную техническую энциклопедию.

Обновить только:

- PROJECT.md;
- DEVELOPMENT/CURRENT.md;
- PLAN-002 record после завершения.

Если появились новые продуктовые понятия — кратко зафиксировать их в PROJECT.md.

==================================================
21. WORKSTREAM R — CODE / PRODUCT AUDIT DURING IMPLEMENTATION
==================================================

Каждое обнаруженное противоречие классифицировать:

BUG
UX GAP
MISSING FEATURE
BACKEND GAP
DOCUMENTATION GAP
IDEA

Не превращать каждую находку в новую крупную задачу.

---

Если обнаружена backend-функция, которая уже существует, не создавать её заново.

Если frontend не использует существующую backend-функцию и она полезна для продукта — подключить её.

Если функция требует большой backend subsystem и не нужна для текущего Product Experience — оставить за рамками PLAN-002.

==================================================
22. ОЖИДАЕМАЯ ИНФОРМАЦИОННАЯ АРХИТЕКТУРА
==================================================

Ожидаемая пользовательская модель примерно такая:

MTA Market

├── Marketplace
│   ├── All
│   ├── Scripts
│   ├── Maps
│   ├── Models
│   ├── Textures
│   ├── Sounds
│   └── Gamemodes
│
├── Purchases
│   ├── Orders
│   └── Licenses
│
├── Profile
│   ├── Overview
│   ├── Personal data
│   ├── Connected accounts
│   └── Balance
│
├── My Store
│   ├── Overview
│   ├── Resources
│   ├── Create Resource
│   ├── Sales
│   └── Settings
│
└── Admin
    ├── Dashboard
    ├── Moderation
    ├── Resources
    ├── Sellers
    ├── Users
    ├── Payments
    ├── Disputes
    └── Versions

Это целевая product architecture, а не требование реализовать все перечисленные разделы как отдельные routes.

==================================================
23. VISUAL DIRECTION
==================================================

Не делать простой "Tailwind facelift".

Нужен полноценный product redesign поверх существующей функциональности.

Основные принципы:

1. Dark marketplace.
2. Глубокий navy background.
3. Blue accent.
4. Контрастные surfaces.
5. Чёткая typographic hierarchy.
6. Много воздуха.
7. Небольшое количество действительно важных accent elements.
8. Resource imagery играет важную роль.
9. Card hierarchy должна быть заметной.
10. CTA должен быть очевидным.
11. Admin должен выглядеть частью того же продукта, но более utilitarian.
12. Mobile должен быть спроектирован, а не просто уменьшен.

Избегать:

- чрезмерных gradients;
- огромного количества blue buttons;
- одинаковых Cards на каждой странице;
- чрезмерных rounded containers;
- текста вместо визуальной информации;
- декоративных элементов без функции;
- generic SaaS aesthetic;
- ощущения шаблонного Tailwind demo.

==================================================
24. PRODUCT QUALITY RULE
==================================================

Каждый экран должен отвечать на вопросы:

1. Где я?
2. Что здесь происходит?
3. Что здесь главное?
4. Что мне делать дальше?
5. Что произойдёт после нажатия?

Если пользователь не может ответить на эти вопросы без чтения технического текста — интерфейс требует доработки.

==================================================
25. ПОРЯДОК РЕАЛИЗАЦИИ
==================================================

Не делать всё одновременно.

Рекомендуемый порядок:

Phase 1:
Design System + Global Layout

Phase 2:
Homepage

Phase 3:
Marketplace + Resource Card

Phase 4:
Resource Detail

Phase 5:
Account

Phase 6:
Seller Studio

Phase 7:
Admin

Phase 8:
Mobile / Responsive

Phase 9:
Accessibility / UX states / Content

Phase 10:
Regression / E2E / Final polish

После каждой большой phase приложение должно оставаться runnable.

==================================================
26. IMPORTANT DEVELOPMENT RULE
==================================================

Не начинать с глобального переписывания `apps/web`.

Работать итеративно.

Перед изменением существующей страницы:

1. прочитать её код;
2. посмотреть какие API она использует;
3. посмотреть существующие shared components;
4. понять, что уже работает;
5. определить UI/UX gap;
6. изменить только необходимое;
7. прогнать typecheck/build/tests.

==================================================
27. BACKEND RULE
==================================================

Backend нельзя менять только потому, что frontend можно было бы сделать красивее.

Backend изменение допускается только если:

- существующих данных объективно недостаточно для продукта;
- найден реальный bug;
- есть несовместимость contract;
- требуется минимальная поддержка нового UI.

Любой новый backend endpoint должен иметь конкретную product причину.

==================================================
28. ACCEPTANCE CRITERIA
==================================================

PLAN-002 считается выполненным, когда:

- [ ] homepage выглядит как marketplace, а не просто landing;
- [ ] Marketplace выглядит как магазин;
- [ ] resources визуально различимы;
- [ ] Resource Card является полноценной товарной карточкой;
- [ ] Resource Detail является полноценной product page;
- [ ] navigation логична;
- [ ] account area логично организована;
- [ ] seller area воспринимается как магазин/студия;
- [ ] admin воспринимается как control center;
- [ ] mobile navigation работает;
- [ ] основные страницы responsive;
- [ ] loading states качественные;
- [ ] empty states качественные;
- [ ] error states понятные;
- [ ] основные controls keyboard accessible;
- [ ] terminology consistent;
- [ ] marketing claims соответствуют реальности;
- [ ] existing product functionality не сломана;
- [ ] PLAN-001 browser E2E продолжает проходить;
- [ ] backend tests проходят;
- [ ] frontend typecheck проходит;
- [ ] production build проходит;
- [ ] нет критического UI blocker в buyer/seller/admin flow.

==================================================
29. FINAL PRODUCT WALKTHROUGH
==================================================

Перед завершением PLAN-002 агент обязан пройти продукт как минимум в следующих ролях.

BUYER:

Homepage
→ Marketplace
→ Filter
→ Resource Card
→ Resource Detail
→ Purchase/Get
→ Purchases
→ License
→ Profile
→ Balance

SELLER:

Login
→ My Store
→ Create Resource
→ Wizard
→ Artifact Upload
→ Review
→ Submit
→ Pending Moderation
→ Published/Rejected state

ADMIN:

Login
→ Admin
→ Dashboard
→ Moderation
→ Open Resource
→ Approve/Reject
→ Seller management
→ Disputes
→ Versions

MOBILE:

Повторить ключевые сценарии в мобильном viewport.

==================================================
30. IMPORTANT FINAL RULE
==================================================

Не считать PLAN-002 завершённым только потому, что страницы стали красивее.

Цель — не "новый дизайн".

Цель:

"Пользователь открывает MTA Market и чувствует, что это настоящий marketplace."

В результате должно быть ощущение:

- здесь есть товары;
- здесь есть продавцы;
- здесь есть покупки;
- здесь есть лицензии;
- здесь есть мой магазин;
- здесь есть порядок;
- здесь всё понятно;
- здесь хочется пользоваться продуктом.

После завершения PLAN-002 не создавать автоматически PLAN-003.

Сначала зафиксировать фактическое состояние продукта в mta-market-document.

Только после этого отдельно определить следующий Development Plan.

=================================================
31. EXECUTION RECORD (заполнено по завершении)
=================================================

Статус: выполнен 2026-09-10.

Что сделано по фазам:

- Phase 1 (Design System + Layout): design tokens в globals.css + tailwind.config.js
  (bg-surface, border-line, text-content, accent, ok/warn/bad, rounded-card, darkMode
  class, html.dark); Button/Card/Input(+Textarea/Select)/States переведены на токены;
  новые компоненты: Tabs, ConfirmDialog, Avatar, Skeleton(+ResourceCardSkeleton),
  Rating, Price, ResourceCard, SectionHeader, Avatar, lib/domain (терминология типов).
- Phase 1 (Layout): Navbar перестроен (desktop links, баланс, аватар, Выход; mobile
  drawer с разделами/балансом/админом/выходом; активные состояния; sticky+blur);
  глобальный Footer (актуальный год, без битых ссылок).
- Phase 2 (Homepage): marketplace-oriented — hero + реальные секции (Новинки /
  Высокий рейтинг / Бесплатные) через GET /resources, skeleton loading, empty state
  каталога, seller CTA не доминирует. Generic marketing claims убраны
  («мгновенные выплаты» и т.п.).
- Phase 3 (Marketplace): сетка 1→4 колонки, фильтры (цена segmented control, тип
  select с русскими подписями), ResourceCard (типографический cover, цена, рейтинг,
  продавец), skeletons, два empty state, pagination, aria-атрибуты.
- Phase 4 (Resource Detail): product page — breadcrumbs, hero (тип, название,
  описание, продавец, рейтинг, дата), DRM-блок, описание, таймлайн версий,
  полноценные отзывы, purchase sidebar («Уже приобретено» / «Получить» / «Купить
  сейчас», промокод, статусы).
- Phase 5 (Account): вкладки Профиль/Обзор/Подключения/Баланс/Покупки; профиль с
  аватаром/ролью/датой регистрации/балансом; баланс без fake-кнопки «Пополнить»
  (честное пояснение); постоянная история покупок с лицензиями и спорами.
- Phase 6 (Seller): «Мой магазин» — дашборд (ресурсы/опубликовано/на модерации/
  черновики/продано копий), ресурсы с наглядными статусами и действиями, услуги
  с Select реальных типов ServiceType, заказы с русской терминологией шагов.
- Phase 7 (Admin): «Панель управления» — вкладки Модерация/Продавцы/Споры/Версии,
  статистика как dashboard, русские подписи переходов споров, человекочитаемые
  события модерации (вместо JSON-дампа), userId в заявках продавцов.
- Phase 8-9 (Mobile/a11y/состояния): mobile drawer, touch targets ≥40px, focus-visible
  глобально, aria-label/aria-pressed/role в ключевых местах, skeletons вместо
  текста «Загрузка...», empty states с действием, локализованные ошибки
  (raw server errors не показываются).
- Phase 10 (Регрессия): Playwright E2E PLAN-001 — 12/12 после редизайна;
  web/server typecheck чистые; production build web проходит; backend 253/254
  (startup-policy acceptance падает по таймауту процесса в dev-окружении,
  воспроизводится на дереве до PLAN-002 — не является регрессией).

Backend-изменения (минимальные, по правилу Backend Rule):
- resources.ts: enrichResourceCard() — аддитивные поля seller{username,displayName,
  avatar}, rating, reviewCount в GET /resources и GET /resources/:slug для карточек
  и product page (E-006/E-007). Контракт не ломает существующие клиенты.

Зафиксированные backend gaps (осознанно НЕ закрыты в PLAN-002):
- Отсутствие cover/screenshot поля у Resource (карточки используют типографический
  cover; фейковые картинки не использовались).
- Отсутствие серверного sorting/filtering параметров у GET /resources (фильтры и
  подбор секций homepage — клиентские, поверх существующих данных).

Dev seed (O-002) не потребовался: marketplace E2E создаёт реальные ресурсы,
homepage использует живые данные API.
