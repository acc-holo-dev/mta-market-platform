
VISION.md — MTA Market Platform Vision

STATUS: FOUNDATIONAL
TYPE: PRODUCT VISION
SCOPE: LONG-TERM PRODUCT DIRECTION

==================================================
0. PURPOSE
==========

Этот документ определяет, чем MTA Market должен стать как продукт и как
экосистема.

VISION.md не является:

- roadmap;
- task list;
- технической документацией;
- обязательным списком функций;
- обещанием реализовать все описанные возможности.

Development Plans создаются на основе этой Vision, но не обязаны реализовывать
всю Vision сразу.

Любая конкретная функция становится обязательной только после того, как она
включена в отдельный Development Plan.

==================================================

1. MISSION
   ==================================================

MTA Market создаётся для объединения MTA:SA-сообщества в едином цифровом
пространстве.

Главная идея:

MTA Market должен быть местом, где человек может найти практически всё,
что связано с его жизнью в MTA:SA:

- людей;
- серверы;
- ресурсы;
- статьи;
- новости;
- обсуждения;
- услуги;
- отзывы;
- безопасные сделки;
- репутацию;
- информацию о серверах;
- полезные инструменты.

Пользователь не должен постоянно переключаться между десятками разрозненных
площадок.

MTA Market стремится стать центральной точкой экосистемы MTA:SA.

==================================================
2. PRODUCT DEFINITION
=====================

MTA Market — не просто marketplace.

MTA Market — не просто форум.

MTA Market — не просто server monitor.

MTA Market — не просто новостной портал.

MTA Market — это объединённая платформа:

Community
+
Content
+
Servers
+
Market
+
Trust
+
Identity

Все эти части должны усиливать друг друга.

==================================================
3. NORTH STAR
=============

Главный продуктовый принцип:

"Всё, что связано с жизнью MTA:SA-сообщества, должно иметь естественное место
внутри MTA Market."

Пользователь должен приходить не только тогда, когда ему нужно что-то купить.

Он должен возвращаться потому, что здесь происходит жизнь сообщества.

==================================================
4. PRODUCT PILLARS
==================

MTA Market строится вокруг шести основных pillars.

COMMUNITY
SERVERS
CONTENT
MARKET
TRUST
IDENTITY

Каждый pillar является самостоятельной ценностью, но максимальная ценность
возникает на пересечении этих частей.

==================================================
5. COMMUNITY
============

Community — социальная основа платформы.

Сюда относятся:

- форум;
- обсуждения;
- темы;
- комментарии;
- сообщения;
- участники;
- активности;
- подписки;
- уведомления;
- сообщества серверов.

Главный принцип:

Форум не должен ощущаться отдельным сайтом внутри MTA Market.

Он должен быть частью общей экосистемы.

==================================================
6. FORUM
========

Форум должен поддерживать:

- категории;
- темы;
- ответы;
- цитирование;
- редактирование;
- реакции;
- закрепление;
- закрытие;
- модерацию;
- поиск;
- уведомления.

Но forum content должен иметь возможность быть связанным с другими сущностями.

Примеры:

Resource
→ Discussion

Server
→ Discussion

News
→ Discussion

Article
→ Discussion

Deal
→ Dispute

Это не означает, что каждая сущность обязана иметь форумную тему.

Связь должна появляться, когда она имеет смысл.

==================================================
7. SERVER PLATFORM
==================

Server — одна из главных сущностей MTA Market.

Сервер не должен быть просто:

name + IP + online.

Сервер должен иметь собственную страницу и собственное пространство.

Пример:

Server
├── Overview
├── Live
├── Statistics
├── News
├── Updates
├── Community
├── Forum
├── Reviews
└── External Links

В будущем могут появиться дополнительные sections.

==================================================
8. SERVER OWNERSHIP
===================

Создатель/владелец сервера должен иметь возможность подтвердить владение сервером.

После подтверждения он получает возможность:

- редактировать сервер;
- публиковать новости;
- публиковать обновления;
- настраивать визуальный профиль;
- управлять отображением информации;
- получать server dashboard;
- управлять community;
- получать server-specific tools.

Ownership verification должен быть отдельной логикой и не должен основываться
только на заявлении пользователя.

==================================================
9. SERVER PRIVACY / VISIBILITY
==============================

Очень важный принцип:

MTA Market НЕ должен автоматически раскрывать техническое содержимое
чужого сервера.

Владелец сервера сам определяет, что публиковать.

Например:

Public:

- название;
- logo;
- description;
- online;
- statistics;
- news;
- reviews.

Optional:

- used resources;
- technical stack;
- staff;
- server technical information;
- additional integrations.

Если владелец не разрешил публикацию:

информация не отображается.

Никакой автоматической публичной связи:

Resource
→ Server

без явного opt-in владельца сервера.

==================================================
10. SERVER MONITORING
=====================

Monitoring является частью Server Platform.

Минимально:

- online/offline;
- current players;
- max players;
- server version;
- uptime;
- last seen.

В будущем:

- 24h graph;
- 7d graph;
- 30d graph;
- peak;
- averages;
- uptime history;
- status incidents.

Мониторинг должен быть основан на реально полученных данных.

Нельзя показывать фиктивные значения.

==================================================
11. SERVER REVIEWS
==================

Отзывы серверов должны быть максимально защищены от накрутки.

Основной принцип:

Обычный пользователь не должен просто иметь возможность написать:

"★★★★★ лучший сервер"

без какого-либо подтверждения взаимодействия.

Verification flow (реализован в PLAN-005):

Server
→ generate/release review token
→ player opens MTA Market
→ token passed
→ server/player interaction verified
→ review allowed

Токен должен быть:

- ограниченного срока;
- одноразового или с контролируемым reuse;
- криптографически/серверно проверяемого;
- привязанного к конкретному серверу.

MTA Market должен знать ровно столько, сколько необходимо для проверки.

Не собирать лишние персональные данные.

==================================================
12. VERIFIED PLAYER
===================

После успешной проверки review flow можно выдавать label:

"Verified Player"

или:

"Подтверждённое взаимодействие с сервером"

Это не означает:

- что игрок хороший;
- что игрок согласен с сервером;
- что отзыв положительный.

Это означает только факт подтверждённого взаимодействия.

==================================================
13. SERVER NEWS
===============

Server News — полноценный content type.

Владелец сервера может публиковать:

- новости;
- объявления;
- события;
- обновления;
- devlogs;
- changelogs.

News может отображаться:

- на странице сервера;
- в общей ленте;
- в dashboard подписчиков;
- в связанных обсуждениях.

Один News object должен быть источником данных.

Не создавать одинаковый материал отдельно для нескольких surfaces.

==================================================
14. SERVER COMMUNITY
====================

Каждый сервер может иметь собственное community space.

Например:

Server Community
├── Members
├── News
├── Forum
├── Reviews
├── Events
└── Discussions

Это не обязательно отдельный форумный сайт.

Это community layer внутри MTA Market.

==================================================
15. CONTENT
===========

Content layer включает:

- статьи;
- новости;
- гайды;
- tutorials;
- changelogs;
- editorial publications;
- community publications.

Контент должен иметь автора, дату, category/tags и возможность обсуждения.

==================================================
16. ARTICLES
============

Статьи должны существовать не только для SEO.

Их цель:

- объяснять;
- обучать;
- информировать;
- создавать полезный контент для сообщества;
- связывать пользователей с другими частями платформы.

Пример:

Article
→ discussion
→ related resources
→ related servers
→ author profile

Связи должны отображаться только если они явно определены и действительно
релевантны.

==================================================
17. NEWS
========

News имеет два уровня:

GLOBAL NEWS
и
ENTITY NEWS.

GLOBAL NEWS:

- новости MTA;
- новости сообщества;
- новости платформы.

ENTITY NEWS:

- новости конкретного сервера;
- новости конкретного creator;
- новости конкретного продукта.

News feed должен быть источником активности, а не просто архивом статей.

==================================================
18. MARKET
==========

Marketplace — один из pillars, но не вся платформа.

Marketplace предназначен для:

- ресурсов;
- услуг;
- коммерческих продуктов;
- безопасных сделок.

Главный объект:

Resource.

Существующая архитектура marketplace должна продолжать развиваться, но
Marketplace не должен поглощать остальные части платформы.

==================================================
19. RESOURCE
============

Resource — коммерческий/контентный объект.

Он может быть:

- бесплатным;
- платным;
- временно недоступным;
- опубликованным;
- приостановленным;
- обновляемым;
- лицензируемым.

Resource должен иметь понятную product presentation.

Будущая модель:

Resource
├── Identity
├── Media
├── Description
├── Seller
├── Versions
├── Reviews
├── Compatibility
├── License
└── Purchase State

==================================================
20. RESOURCE METRICS
====================

Для public Marketplace допустимы агрегированные метрики.

Например:

- продажи;
- рейтинг;
- количество отзывов;
- количество покупателей;
- дата обновления;
- версия;
- популярность.

Информация о конкретных покупателях должна оставаться приватной.

Количество продаж является нормальной публичной marketplace metric,
если бизнес-логика платформы не требует обратного.

==================================================
21. SELLER
==========

Seller — не просто пользователь, который загрузил файл.

Seller является creator identity внутри marketplace.

Seller должен иметь возможность:

- публиковать ресурсы;
- управлять товарами;
- выпускать обновления;
- получать отзывы;
- видеть продажи;
- участвовать в безопасных сделках;
- формировать собственную reputation.

В будущем seller должен восприниматься как "creator/store", а не как
административная роль.

==================================================
22. SELLER STOREFRONT
=====================

У seller должна быть публичная storefront/profile presentation.

Минимально:

- avatar;
- name;
- description;
- badges;
- resources;
- rating;
- sales count;
- reviews.

Позже:

- creator collections;
- featured resources;
- activity;
- analytics.

==================================================
23. TRUST
=========

Trust Layer — одна из ключевых отличительных возможностей MTA Market.

Он включает:

- verified identities;
- verified servers;
- verified resources;
- verified reviews;
- reputation;
- guarantee;
- disputes;
- blacklist;
- moderation.

Главный принцип:

"Платформа должна снижать риск взаимодействия внутри сообщества."

==================================================
24. REPUTATION
==============

Reputation не должна быть одним магическим числом.

Каждое значимое значение должно иметь понятную причину.

Например:

42 completed deals
12 published resources
4.91 average rating
0 unresolved disputes
1 verified server

Это лучше, чем:

"Trust Score: 97"

без объяснения.

==================================================
25. BADGES
==========

Badges являются частью identity system.

Примеры:

- Verified Developer;
- Verified Seller;
- Verified Server;
- Server Owner;
- Top Creator;
- Community Contributor;
- Trusted Seller.

Badge должен отражать реальное условие.

Не создавать десятки игровых achievements только ради gamification.

==================================================
26. VISUAL IDENTITY
===================

MTA Market должен быть визуально запоминающимся.

Он не должен выглядеть как обычная dashboard SaaS template.

Возможные visual elements:

- server banners;
- animated backgrounds;
- GIF/WebP media;
- avatars;
- custom icons;
- creator badges;
- profile frames;
- resource covers;
- screenshots;
- themed sections.

Но visual customization должна быть ограниченной и контролируемой.

Пользовательский контент не должен ломать:

- layout;
- readability;
- performance;
- security;
- brand identity.

==================================================
27. PLATFORM UI VS USER IDENTITY
================================

Разделять:

PLATFORM UI

и

USER-GENERATED IDENTITY.

Platform UI:

- navigation;
- controls;
- layout;
- typography;
- components;
- forms.

Оно контролируется MTA Market.

User identity:

- server cover;
- creator avatar;
- server banner;
- screenshots;
- badges;
- media;
- optional accent.

Она может быть более свободной.

Таким образом каждый сервер и creator может иметь собственную атмосферу,
но весь MTA Market сохраняет единый визуальный язык.

==================================================
28. GUARANTEE
=============

Guarantee — один из самых важных потенциальных сервисов платформы.

Он предназначен для P2P transactions.

Основной сценарий:

Seller
→ Create Deal
→ Invite Buyer
→ Buyer enters
→ Buyer deposits funds
→ MTA Market holds funds
→ Seller provides deliverable
→ Buyer verifies
→ Buyer confirms
→ Seller receives funds

Если возникает проблема:

Dispute
→ transaction frozen
→ evidence
→ moderation/admin decision
→ settlement.

==================================================
29. GUARANTEE IS NOT JUST A PAYMENT
===================================

Гарант должен рассматриваться как отдельный transaction lifecycle.

Deal:

CREATED
→ BUYER_JOINED
→ FUNDED
→ DELIVERY_PENDING
→ VERIFICATION
→ COMPLETED

или:

...
→ DISPUTED
→ RESOLVED

В зависимости от типа сделки могут существовать другие состояния.

==================================================
30. DRM IN GUARANTEE
====================

DRM может использоваться как способ временной controlled delivery для
поддерживаемых ресурсов.

Пример:

Seller uploads resource
→ MTA Market stores protected artifact
→ Buyer receives temporary access
→ Buyer verifies
→ Deal completes
→ permanent license/state assigned.

Но не каждая сделка должна использовать DRM.

Например:

- services;
- design;
- custom development;
- physical transfer;

могут требовать другого delivery mechanism.

==================================================
31. BLACKLIST
=============

Blacklist должен быть системой trust, а не стеной позора.

Запись должна иметь:

- subject;
- reason;
- evidence;
- date;
- status;
- moderation decision.

Не публиковать обвинения без moderation/evidence policy.

Не позволять пользователям бесконтрольно добавлять людей в blacklist.

==================================================
32. DISPUTES
============

Dispute system является частью Trust + Market.

Основные сценарии:

Buyer dispute
Seller dispute
Guarantee dispute
Purchase dispute

Для каждой категории должна существовать понятная state machine.

Evidence должна храниться в рамках разумных privacy limits.

==================================================
33. IDENTITY
============

Один пользователь = одна platform identity.

Один человек может иметь:

- player role;
- server owner role;
- seller role;
- developer role;
- article author role;
- community member role.

Не создавать отдельные аккаунты для каждой функции.

==================================================
34. USER PROFILE
================

Профиль должен отражать участие человека в экосистеме.

Например:

Holo

Developer
Seller
Server Owner

Resources
Servers
Articles
Forum Activity
Reviews
Deals

Не все данные обязаны быть публичными.

Пользователь должен иметь контроль privacy settings.

==================================================
35. DASHBOARD
=============

Dashboard после login должен быть личным окном в MTA Market.

Не просто:

"Account settings".

Он может показывать:

- интересующие новости;
- подписанные servers;
- активности форума;
- новые releases;
- purchases;
- seller activity;
- balance;
- notifications.

Dashboard должен адаптироваться под роль пользователя.

==================================================
36. FEED
========

В будущем MTA Market может иметь unified activity feed.

Например:

New server update
New article
Forum reply
Resource release
Creator publication
Community event

Но feed не должен превращаться в бесконтрольный social-media clone.

Главное — полезность.

==================================================
37. NOTIFICATIONS
=================

Notification system должен связывать ecosystem.

Примеры:

- server published update;
- followed discussion got reply;
- purchased resource updated;
- seller resource approved;
- deal requires action;
- dispute updated;
- moderation decision;
- forum mention.

Уведомления должны быть actionable.

==================================================
38. RELATIONSHIPS BETWEEN ENTITIES
==================================

MTA Market должен позволять сущностям связываться.

Базовые связи:

User
↔ Server

User
↔ Resource

User
↔ Article

User
↔ Forum

User
↔ Deal

Server
↔ News

Server
↔ Forum

Server
↔ Reviews

Resource
↔ Seller

Resource
↔ Reviews

Resource
↔ Purchase

Resource
↔ License

Но связь:

Server
↔ Resource

является PRIVATE BY DEFAULT.

Она становится публичной только через explicit owner opt-in.

==================================================
39. PRIVACY PRINCIPLE
=====================

MTA Market должен придерживаться принципа:

"Не показывай то, на раскрытие чего владелец не соглашался."

Это особенно важно для:

- server resources;
- staff;
- player information;
- technical configuration;
- purchase history;
- private deals;
- private communications.

Публичные агрегаты могут существовать без раскрытия персональных данных.

==================================================
40. COMMUNITY LOOP
==================

Платформа должна поддерживать цикл:

User
→ reads news
→ discovers server
→ joins community
→ discusses
→ discovers resource
→ buys/gets resource
→ writes review
→ returns for update.

Это создаёт organic ecosystem.

==================================================
41. SERVER OWNER LOOP
=====================

Server Owner:

Register
→ Verify Server
→ Customize Server Page
→ Publish News
→ Build Community
→ Receive Players
→ Receive Verified Reviews
→ Monitor Server
→ Publish Updates
→ Return.

==================================================
42. SELLER LOOP
===============

Developer:

Register
→ Become Seller
→ Create Resource
→ Publish
→ Receive Sales
→ Receive Reviews
→ Release Update
→ Existing buyers receive update
→ Build reputation
→ Release next resource.

==================================================
43. BUYER LOOP
==============

Buyer:

Discover
→ Evaluate
→ Verify Seller/Resource
→ Buy/Get
→ Receive License
→ Use Resource
→ Receive Updates
→ Review
→ Return.

==================================================
44. TRUST LOOP
==============

Trust:

Verification
→ Transaction
→ Review
→ Reputation
→ More trust
→ More transactions.

Blacklist and disputes должны снижать риск, а не быть центральной
формой взаимодействия.

==================================================
45. BUSINESS MODEL
==================

На первом этапе потенциальная основная бизнес-модель:

Marketplace / Guarantee transaction fee.

То есть:

Successful transaction
→ seller revenue
→ MTA Market commission.

Покупатель не должен платить просто за сам факт существования аккаунта.

В будущем возможны:

- promoted listings;
- advanced seller services;
- subscriptions;
- payment services;
- infrastructure services.

Но они не являются обязательной частью текущего ядра.

==================================================
46. ECONOMIC PRINCIPLE
======================

Платформа должна зарабатывать тогда, когда создаёт ценность.

Особенно предпочтительна модель:

"Если продавец заработал — MTA Market заработал."

Это лучше соответствует marketplace philosophy, чем обязательная плата
за сам факт размещения для раннего этапа.

==================================================
47. WHAT MAKES MTA MARKET DIFFERENT
===================================

Главным преимуществом не должен быть:

"у нас красивее".

И не:

"у нас есть магазин".

И не:

"у нас есть DRM".

Главная идея:

MTA Market объединяет:

Community
+
Servers
+
Content
+
Market
+
Trust
+
Identity

в одной системе.

Особенно важны:

- безопасные сделки;
- verified interactions;
- server identity;
- resource lifecycle;
- unified community.

==================================================
48. COMPETITIVE POSITION
========================

MTA Market не должен пытаться буквально копировать:

- форумы;
- resource catalogs;
- server monitors;
- standalone stores.

Смысл платформы:

объединить лучшие части существующей экосистемы и связать их
в единый пользовательский lifecycle.

Пользователь должен получать преимущество именно от интеграции.

==================================================
49. WHAT MTA MARKET SHOULD NOT BECOME
=====================================

Не превращать платформу в:

- обычную социальную сеть;
- обычный форум;
- обычный магазин;
- копию Steam;
- рекламную биржу;
- cluttered portal;
- бесконечную систему gamification.

Широта платформы не должна приводить к потере фокуса.

==================================================
50. DESIGN PHILOSOPHY
=====================

MTA Market должен быть:

Modern
Visual
Community-driven
Trust-oriented
Information-rich
Fast
Understandable
Distinctive

Он может быть ярким, атмосферным и насыщенным.

Но информация всегда важнее декоративности.

==================================================
51. ARCHITECTURAL PHILOSOPHY
============================

Платформа должна строиться модульно.

Примерно:

Community
Servers
Content
Market
Trust
Identity

должны иметь собственные domain boundaries, но использовать общие:

- identity;
- authorization;
- notifications;
- media;
- payments;
- moderation;
- audit;
- search where appropriate.

Не создавать отдельную мини-платформу внутри каждого pillar.

==================================================
52. PRODUCT FOUNDATION
======================

Общие системные возможности:

Identity
Authorization
Media
Search
Notifications
Moderation
Payments
Ledger
Licensing
Audit

могут использоваться несколькими pillars.

Это позволит расширять проект без дублирования инфраструктуры.

==================================================
53. FUTURE PLATFORM CAPABILITIES
================================

Возможное дальнейшее развитие:

- public status;
- events;
- advanced server analytics;
- recommendation;
- compatibility intelligence;
- creator analytics;
- server subscriptions/follows;
- resource update subscriptions;
- richer notification system;
- mobile PWA;
- official integrations;
- external API;
- webhooks.

Они остаются будущими возможностями.

Не входят автоматически в ближайший Development Plan.

==================================================
54. VISUAL FUTURE
=================

В будущем визуальный язык MTA Market должен позволять создавать:

SERVER WORLDS
CREATOR IDENTITIES
RESOURCE SHOWCASES
COMMUNITY SPACES

с помощью:

- animated media;
- banners;
- covers;
- badges;
- themed sections;
- custom illustrations;
- creator identity.

Каждая такая возможность должна проходить через:

Performance
Security
Moderation
Accessibility

==================================================
55. SCALE PRINCIPLE
===================

В начале:

несколько серверов
+
несколько creators
+
десятки resources

должны работать просто.

Когда количество пользователей и сущностей растёт:

- search;
- ranking;
- caching;
- indexing;
- analytics;
- media delivery;

могут переходить на более мощную инфраструктуру.

Не строить enterprise-scale architecture до появления реальной нагрузки.

==================================================
56. PRODUCT MATURITY MODEL
==========================

MTA Market будет развиваться слоями.

LEVEL 1
Working Product

LEVEL 2
Product Experience

LEVEL 3
Marketplace

LEVEL 4
Production

LEVEL 5
Community

LEVEL 6
Server Platform

LEVEL 7
Trust Platform

LEVEL 8
Integrated MTA Ecosystem

Это не обязательные sequential plans.

Это модель зрелости продукта.

==================================================
57. NORTH STAR METRIC
=====================

Главной метрикой не должно быть только количество продаж.

Для ecosystem platform важнее:

Weekly Active Community Members

или эквивалентная метрика meaningful weekly participation.

Meaningful action может включать:

- server interaction;
- forum participation;
- content interaction;
- resource purchase;
- review;
- seller activity;
- community activity.

Точную формулу необходимо определить позже на основании реальных данных.

==================================================
58. BUSINESS HEALTH METRICS
===========================

Отдельно отслеживать:

- active users;
- active servers;
- active sellers;
- published resources;
- successful deals;
- GMV;
- marketplace revenue;
- repeat buyers;
- repeat sellers;
- active discussions;
- new content;
- server engagement;
- review volume;
- dispute rate.

==================================================
59. TRUST METRICS
=================

Отдельно:

- verified servers;
- verified sellers;
- verified reviews;
- successful transactions;
- dispute rate;
- fraud reports;
- resolution time;
- repeat transaction rate.

Trust должен быть измеряемым.

==================================================
60. DEVELOPMENT PRINCIPLE
=========================

Каждый Development Plan должен отвечать:

"Какую часть Vision мы сейчас усиливаем?"

Например:

PLAN-005
Community & Server Foundation — ВЫПОЛНЕН (2026-09-10):
серверы как hub, форум, новости, токен-отзывы, подписки, уведомления.

Следующие планы определяются отдельным planning cycle; нумерация
продолжается с PLAN-006.

==================================================
61. ANTI-SCOPE-CREEP
====================

Vision не является разрешением разработать всё.

Если идея существует в Vision, это означает:

"Мы потенциально хотим иметь это когда-нибудь."

Не:

"Это нужно реализовать прямо сейчас."

Development Plan всегда имеет собственный scope.

==================================================
62. PRODUCT PRINCIPLES
======================

PRINCIPLE 1

Community first.

MTA Market существует ради сообщества, а не ради отдельных функций.

PRINCIPLE 2

Integration over duplication.

Связывать существующие возможности вместо создания параллельных систем.

PRINCIPLE 3

Trust by design.

Платформа должна снижать риск мошенничества и дезинформации.

PRINCIPLE 4

Privacy by default.

Публичность должна быть осознанной.

PRINCIPLE 5

Real data only.

Не показывать fake metrics и fake functionality.

PRINCIPLE 6

Quality over quantity.

Лучше меньше функций, но они реально работают.

PRINCIPLE 7

Visual identity matters.

Платформа должна иметь собственную атмосферу.

PRINCIPLE 8

User-generated content must be controlled.

Свобода customization не должна ломать платформу.

PRINCIPLE 9

Invisible complexity.

Техническая сложность должна быть скрыта от пользователя.

PRINCIPLE 10

One ecosystem.

Все основные функции должны ощущаться частью одного продукта.

==================================================
63. FINAL VISION
================

MTA Market должен стать местом, которое открывает человек, когда хочет
узнать, что происходит в MTA:SA.

Он может открыть его ради:

сервера;

новости;

статьи;

обсуждения;

ресурса;

отзыва;

сделки;

профиля;

статистики;

сообщества.

И в процессе он остаётся внутри одной экосистемы.

Финальная модель:

                    MTA MARKET
                         │
        ┌────────────────┼────────────────┐
        │                │                │
     COMMUNITY        SERVERS          CONTENT
        │                │                │
      Forum          Monitoring       Articles
      Users          Statistics       News
      Activity       Community        Guides
        │                │                │
        └────────────────┼────────────────┘
                         │
                      MARKET
                         │
                  Resources / Services
                         │
                       TRUST
                         │
          Guarantee / Reviews / Reputation
                  / Blacklist / Disputes
                         │
                      IDENTITY
                         │
           Profiles / Roles / Badges
                         │
                 PLATFORM INFRA
                         │
        Payments / Licenses / DRM / Media

Главный результат:

MTA Market должен стать не местом, где просто лежат ресурсы.

Он должен стать местом, где существует MTA-сообщество.
