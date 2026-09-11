
PRODUCT-ARCHITECTURE.md — MTA Market

STATUS: FOUNDATIONAL
TYPE: PRODUCT ARCHITECTURE
SCOPE: PLATFORM-WIDE

==================================================
0. PURPOSE
==========

Этот документ описывает структуру MTA Market как единой продуктовой системы.

Он является связующим слоем между:

VISION.md
↓
PRODUCT-ARCHITECTURE.md
↓
DEVELOPMENT PLANS
↓
CODE

VISION отвечает:

"Кем должен стать MTA Market?"

PRODUCT-ARCHITECTURE отвечает:

"Из чего состоит MTA Market и как эти части взаимодействуют?"

DEVELOPMENT PLAN отвечает:

"Что именно мы реализуем сейчас?"

Этот документ не является:

- roadmap;
- task list;
- API reference;
- database schema;
- implementation specification.

Архитектура должна оставаться достаточно стабильной, чтобы development plans
могли меняться без разрушения общего представления о продукте.

==================================================

1. PLATFORM MODEL
   ==================================================

MTA Market — единая экосистема MTA:SA.

Она состоит из шести основных продуктовых слоёв:

COMMUNITY
SERVERS
CONTENT
MARKET
TRUST
IDENTITY

Системные возможности поддерживают все эти слои:

PLATFORM INFRASTRUCTURE

- authentication;
- authorization;
- media;
- search;
- notifications;
- payments;
- ledger;
- licensing;
- DRM;
- moderation;
- audit;
- analytics.

Общая модель:

                         MTA MARKET
                              │
       ┌──────────────┬───────┼────────┬──────────────┐
       │              │       │        │              │
   COMMUNITY       SERVERS  CONTENT  MARKET         TRUST
       │              │       │        │              │
       └──────────────┴───────┼────────┴──────────────┘
                              │
                           IDENTITY
                              │
                    PLATFORM INFRASTRUCTURE

Identity находится над отдельными pillars, потому что один и тот же человек
может участвовать сразу во всех частях системы.

==================================================
2. CORE ENTITIES
================

Главные продуктовые сущности:

1. User
2. Server
3. Community
4. Resource
5. Seller
6. Article
7. News
8. Forum Thread
9. Review
10. Deal
11. Purchase
12. License
13. Notification
14. Reputation
15. Badge
16. Blacklist Entry

Канонический список сущностей (включая secondary: Payment, Ledger
Transaction, Moderation Event, Server Verification, Review Token, Media,
Installation) и их жизненные циклы — в PRODUCT-MODEL §1; при расхождении
этого перечня с ним ориентир — PRODUCT-MODEL.

Не каждая сущность обязана существовать как отдельный database model.

Здесь описывается продуктовая модель.

==================================================
3. USER
=======

User — единая identity человека внутри платформы.

Один User может иметь несколько ролей и сценариев.

Например:

User
├── Player
├── Server Owner
├── Developer
├── Seller
├── Article Author
└── Community Member

Не создавать отдельный account для каждой роли.

---

3.1 User properties
-------------------

Минимально:

- username;
- email;
- displayName;
- avatar;
- role/status;
- connected identities;
- reputation;
- badges;
- activity.

Не все поля являются публичными.

---

3.2 User visibility
-------------------

Публично:

- username;
- display name;
- avatar;
- public roles;
- badges;
- public resources;
- public servers;
- public articles;
- public community activity where applicable.

Приватно:

- email;
- authentication data;
- private transactions;
- private purchases;
- private messages;
- private deal information.

==================================================
4. SERVER
=========

Server — самостоятельная сущность платформы.

Server owner создаёт или регистрирует сервер на MTA Market.

---

4.1 Server lifecycle
--------------------

CREATED
→ PENDING_VERIFICATION
→ VERIFIED
→ ACTIVE

Возможны:

SUSPENDED
ARCHIVED

Monitoring-состояния (ONLINE / OFFLINE / UNKNOWN) — отдельная ось,
не стадия lifecycle. UNKNOWN ≠ OFFLINE: отсутствие сигнала не означает
выключенный сервер.

Реализованная модель (PLAN-005) совпадает с PRODUCT-MODEL §3.1.
Состояния должны определяться реальными business rules.

---

4.2 Server public profile
-------------------------

Публичная серверная страница может содержать:

- name;
- logo;
- cover/banner;
- description;
- online;
- max online;
- uptime;
- statistics;
- server reviews;
- news;
- updates;
- community;
- external links;
- optional technical information.

---

4.3 Server owner controls
-------------------------

Owner управляет:

- profile;
- branding;
- visibility;
- news;
- updates;
- community;
- links;
- optional technical data.

---

4.4 Server privacy
------------------

Владелец сам определяет:

- показывать ли используемые ресурсы;
- показывать ли staff;
- показывать ли technical stack;
- показывать ли дополнительные server metrics;
- показывать ли дополнительные community details.

DEFAULT:

PRIVATE.

Никакой автоматической публикации server internals.

==================================================
5. SERVER MONITORING
====================

Основные monitoring data:

- online/offline;
- current players;
- max players;
- last seen;
- uptime;
- peak.

Позже:

- 24h graph;
- 7d graph;
- 30d graph;
- average online;
- historical incidents.

Все metrics должны основываться на реальных данных.

Никаких fake online counters.

==================================================
6. SERVER VERIFICATION
======================

MTA Market должен иметь механизм подтверждения владения сервером.

Verification может использовать:

- server-side integration;
- unique token;
- challenge;
- module;
- controlled server interaction.

Конкретная реализация выбирается отдельным Development Plan.

Результат:

✓ Verified Server

не означает:

- сервер хороший;
- сервер честный;
- сервер популярен.

Означает:

ownership/integration подтверждены.

==================================================
7. SERVER REVIEWS
=================

Отзывы серверов должны быть защищены от простой накрутки.

Основной flow (реализован в PLAN-005):

Server
→ generate review token
→ player receives interaction token
→ player opens MTA Market
→ token verification
→ review allowed

Token должен быть:

- ограниченным по времени;
- одноразовым или контролируемо повторно используемым;
- связанным с конкретным server;
- защищённым от подделки.

MTA Market должен подтверждать взаимодействие без раскрытия лишних
персональных данных.

---

7.1 Verified Review
-------------------

Review может иметь label:

✓ Verified Interaction

Это означает:

"система подтвердила факт взаимодействия игрока с сервером".

Это не означает:

"отзыв достоверен во всём".

==================================================
8. COMMUNITY
============

Community — социальный слой платформы.

Community может существовать:

- глобально;
- вокруг сервера;
- вокруг ресурса;
- вокруг статьи;
- вокруг события.

Основные элементы:

- forum;
- discussions;
- comments;
- members;
- activity;
- subscriptions;
- notifications.

==================================================
9. SERVER COMMUNITY
===================

Server может иметь собственное community space.

Пример:

Server Community
├── Overview
├── Members
├── News
├── Discussions
├── Reviews
└── Events

Это не отдельный сайт.

Это community layer внутри MTA Market.

==================================================
10. FORUM
=========

Forum — единая community subsystem.

Основные сущности:

Category
→ Thread
→ Post

Поддержка:

- threads;
- replies;
- editing;
- reactions;
- mentions;
- moderation;
- pinned threads;
- closed threads;
- search;
- notifications.

---

10.1 Contextual discussions
---------------------------

Discussion может быть связана с:

- Server;
- Resource;
- Article;
- News;
- Event;
- Deal.

Связь создаётся только если она действительно полезна.

Не каждая сущность должна автоматически порождать forum thread.

==================================================
11. CONTENT
===========

Content layer включает:

- Articles;
- News;
- Guides;
- Tutorials;
- Devlogs;
- Changelogs;
- Community publications.

Главная задача Content:

- знания;
- новости;
- discovery;
- community activity.

==================================================
12. ARTICLE
===========

Article:

- author;
- title;
- content;
- cover/media;
- tags;
- category;
- publish date;
- discussion;
- reactions/comments where applicable.

Article может ссылаться на:

- Resource;
- Server;
- Creator;
- Community.

Но связи должны быть явными.

==================================================
13. NEWS
========

News подразделяется на:

GLOBAL NEWS
и
ENTITY NEWS.

Global:

- MTA ecosystem;
- major community news;
- platform news.

Entity:

- Server news;
- Creator news;
- Resource news.

News не должны дублировать одну и ту же запись в нескольких системах.

Один News object → много представлений.

==================================================
14. MARKET
==========

Market содержит коммерческую часть платформы.

Основные области:

- Resources;
- Services;
- Stores;
- Deals.

Marketplace является важной частью MTA Market, но не определяет всю платформу.

==================================================
15. RESOURCE
============

Resource — единица MTA-контента, которая может распространяться:

- бесплатно;
- платно;
- с лицензией;
- через DRM;
- через direct delivery;
- через Guarantee Deal.

Resource lifecycle:

DRAFT
→ PENDING_REVIEW
→ PUBLISHED

Возможны:

SUSPENDED
YANKED
ARCHIVED

в соответствии с существующей domain model.

---

15.1 Resource public presentation
---------------------------------

Минимально:

- title;
- description;
- type;
- cover;
- screenshots;
- seller;
- rating;
- review count;
- sales count where public;
- version;
- requirements;
- compatibility;
- purchase/get state.

==================================================
16. RESOURCE METRICS
====================

Допустимые public aggregate metrics:

- total sales;
- reviews;
- rating;
- buyers count where business rules allow;
- version;
- last update.

Не раскрывать:

- конкретных покупателей;
- private orders;
- private license identifiers.

Пример:

"1 482 продажи"

допустимо.

"Вот список 1 482 покупателей"

нет.

==================================================
17. SELLER
==========

Seller — product identity разработчика внутри Market.

Seller является частью User.

Не является отдельным человеком/аккаунтом.

Seller может:

- создавать resources;
- публиковать products;
- обновлять versions;
- получать reviews;
- видеть sales;
- участвовать в deals;
- накапливать reputation.

==================================================
18. SELLER STOREFRONT
=====================

Public storefront:

- avatar;
- name;
- description;
- badges;
- rating;
- sales;
- resources;
- reviews.

Storefront должен восприниматься как identity creator.

Позже:

- collections;
- featured resources;
- analytics;
- creator activity.

==================================================
19. PURCHASE
============

Purchase — факт приобретения конкретного resource/version.

Важно:

Purchase
≠ Payment
≠ License

Это разные сущности.

Payment подтверждает финансовое событие.

Purchase отражает приобретение.

License предоставляет право использования.

==================================================
20. LICENSE
===========

License — entitlement пользователя.

Может иметь:

ACTIVE
REVOKED
EXPIRED

License может быть связана с:

- Purchase;
- Version;
- Installation;
- DRM.

==================================================
21. DRM
=======

DRM является внутренней infrastructure layer.

DRM не должен быть отдельным пользовательским продуктом.

Пользователь видит:

✓ Licensed
✓ Verified
✓ Active

а не:

Ed25519
challenge
lease
DEK

DRM protocol v2 является отдельным technical contract и не должен изменяться
только ради UX.

==================================================
22. DEAL
========

Deal — безопасная transaction abstraction для сделок между участниками.

Она может использоваться для:

- resource sale;
- service;
- custom development;
- other supported deliverables.

Не каждая Deal требует DRM.

---

22.1 Deal lifecycle
-------------------

CREATED
→ BUYER_JOINED
→ FUNDED
→ DELIVERY
→ VERIFICATION
→ COMPLETED

Alternative:

→ DISPUTED
→ RESOLVED

Возможны дополнительные состояния.

==================================================
23. GUARANTEE
=============

Guarantee — механизм удержания средств и контроля исполнения сделки.

Сценарий:

Seller
→ creates deal
→ Buyer joins
→ Buyer funds deal
→ platform holds money
→ Seller delivers
→ Buyer verifies
→ Buyer confirms
→ Seller receives funds

При конфликте:

Dispute
→ freeze transaction
→ evidence
→ moderation
→ resolution.

==================================================
24. DISPUTES
============

Dispute относится к Trust Layer.

Причины:

- delivery problem;
- fraud suspicion;
- non-performance;
- quality issue;
- transaction disagreement.

Dispute должен иметь:

- participants;
- subject;
- state;
- evidence;
- messages;
- decision;
- timestamps.

==================================================
25. REPUTATION
==============

Reputation строится на подтверждаемых действиях.

Примеры signals:

- completed deals;
- successful sales;
- verified ownership;
- published resources;
- reviews;
- community contribution;
- dispute history.

Не использовать необъяснимое "магическое" trust score.

Если score когда-нибудь появится:

каждый пользователь должен понимать, из чего он складывается.

==================================================
26. BADGES
==========

Badges являются визуальным representation реальных статусов.

Примеры:

✓ Verified Developer
✓ Verified Seller
✓ Verified Server
✓ Server Owner
✓ Trusted Seller
✓ Community Contributor

Badge должен иметь понятное условие получения.

Не превращать MTA Market в RPG.

==================================================
27. BLACKLIST
=============

Blacklist — moderation/trust subsystem.

Запись:

- subject;
- reason;
- evidence;
- date;
- decision;
- status.

Публикация записи требует moderation.

Пользователь не может самостоятельно объявить другого человека мошенником
путём создания public blacklist entry.

==================================================
28. VERIFIED SYSTEM
===================

MTA Market должен поддерживать несколько независимых verified states.

Например:

Verified User
Verified Server
Verified Seller
Verified Resource
Verified Interaction
Verified Deal

Каждый badge означает конкретный проверяемый факт.

Verified ≠ "хороший человек".

==================================================
29. NOTIFICATIONS
=================

Notifications соединяют разные части платформы.

Примеры:

- forum reply;
- server update;
- article publication;
- resource update;
- purchase event;
- seller approval;
- moderation decision;
- deal action;
- dispute event;
- review interaction.

Notification должна быть actionable.

Например:

"Resource updated"
→ Open Resource

==================================================
30. DASHBOARD
=============

После входа пользователь может иметь персональный dashboard:

My MTA

Содержимое зависит от пользователя.

Возможны:

- following;
- server updates;
- forum activity;
- purchases;
- resources;
- seller activity;
- notifications;
- balance.

Dashboard должен показывать наиболее важную текущую информацию, а не
становиться свалкой всех сущностей пользователя.

==================================================
31. FOLLOW / SUBSCRIBE
======================

Пользователь может подписываться на:

- server (реализовано в PLAN-005: follow + счётчик + уведомления);
- creator;
- resource;
- discussion;
- topic.

Подписка создаёт notifications.

Не каждая сущность обязана иметь follow.

==================================================
32. PRIVACY
===========

Privacy by default.

Особенно:

Server technical data
Purchase history
Deal details
Private messages
Player information
Staff information

не становятся public автоматически.

Каждая public relationship должна иметь понятную причину.

==================================================
33. ENTITY RELATIONSHIP MATRIX
==============================

USER → SERVER
может быть owner/staff/member/follower.

USER → RESOURCE
может быть author/seller/buyer/reviewer.

USER → ARTICLE
может быть author/reader/commenter.

USER → FORUM
может быть author/member/moderator.

USER → DEAL
может быть buyer/seller/participant.

SERVER → COMMUNITY
может иметь собственное community.

SERVER → NEWS
может публиковать.

SERVER → REVIEW
может получать.

SERVER → RESOURCE
PRIVATE BY DEFAULT.
PUBLIC ONLY WITH OWNER OPT-IN.

RESOURCE → SELLER
обязательная связь.

RESOURCE → REVIEW
может иметь.

RESOURCE → PURCHASE
может иметь.

RESOURCE → LICENSE
может иметь.

RESOURCE → SERVER
не публикуется автоматически.

ARTICLE → DISCUSSION
может иметь.

NEWS → DISCUSSION
может иметь.

DEAL → DISPUTE
может иметь.

==================================================
34. RESOURCE ↔ SERVER PRIVACY RULE
===================================

Это отдельное архитектурное правило.

MTA Market НЕ должен автоматически определять или публиковать:

"Этот сервер использует следующие ресурсы"

только потому, что эти ресурсы технически обнаружены.

Если Server Owner хочет:

"Мы используем Advanced Inventory"

он включает:

Show Resource Usage
→ explicit opt-in.

После этого relationship становится public.

До этого:

PRIVATE.

==================================================
35. SERVER REVIEW VERIFICATION MODEL
====================================

Модель должна обеспечивать:

Real server interaction
→ proof
→ review permission.

Она не должна превращаться в surveillance system.

Основная задача:

prevent fake reviews.

Не задача:

собирать максимум player telemetry.

==================================================
36. COMMUNITY CONTENT RELATIONSHIPS
===================================

Контент может создавать ecosystem discovery.

Например:

Article
→ related Resource

Server News
→ Discussion

Resource Release
→ Discussion

Creator Post
→ Creator Profile

Это нужно использовать для связности платформы.

Но не превращать каждую страницу в набор из 30 related links.

==================================================
37. PRODUCT DISCOVERY
=====================

Внутри MTA Market discovery может работать через:

- homepage;
- marketplace;
- server list;
- news;
- articles;
- forum;
- creators;
- communities.

Пользователь может попасть в систему через любую точку.

Платформа должна помогать ему находить следующий полезный объект.

Пример:

News
→ Server
→ Community
→ Resource
→ Creator

или:

Article
→ Resource
→ Seller
→ Reviews

==================================================
38. HOME
========

Главная страница — центральная точка ecosystem.

Она не должна быть только:

"Marketplace Hero".

На ней могут существовать:

- current community activity;
- server highlights;
- latest news;
- popular resources;
- discussions;
- creators;
- events.

Главная должна отражать текущую жизнь платформы.

==================================================
39. DAILY RETURN LOOP
=====================

Главная retention-модель:

User
→ sees activity
→ finds relevant content
→ interacts
→ follows server/creator/discussion
→ receives notification
→ returns.

Не делать ставку только на commerce.

==================================================
40. SERVER OWNER LOOP
=====================

Server Owner:

Register
→ Verify
→ Create Server
→ Customize
→ Monitor
→ Publish News
→ Build Community
→ Receive Reviews
→ Grow.

==================================================
41. SELLER LOOP
===============

Developer:

Register
→ Become Seller
→ Create Resource
→ Submit
→ Publish
→ Sell
→ Receive Reviews
→ Release Update
→ Build Reputation
→ Sell more.

==================================================
42. BUYER LOOP
==============

Buyer:

Discover
→ Evaluate
→ Trust
→ Purchase/Get
→ License
→ Use
→ Update
→ Review
→ Return.

==================================================
43. DEAL LOOP
=============

Seller
→ Create Deal
→ Buyer joins
→ Fund
→ Deliver
→ Verify
→ Complete

or

Dispute
→ Resolve.

==================================================
44. PLATFORM TRUST LOOP
=======================

Verification
→ Transactions
→ Reviews
→ Reputation
→ Trust
→ More transactions.

==================================================
45. PLATFORM ECONOMICS
======================

Основной потенциальный источник дохода:

transaction commission.

Пример:

Sale
→ Platform fee
→ Seller revenue

Также потенциально:

- paid promotion;
- premium seller tools;
- advanced services;
- infrastructure services.

Но эти модели не являются обязательными для текущего implementation.

==================================================
46. VISUAL ARCHITECTURE
=======================

MTA Market должен одновременно иметь:

Unified Platform Identity
+
Entity Identity.

Unified:

- navigation;
- typography;
- spacing;
- components;
- layout.

Entity identity:

- server themes;
- creator profiles;
- badges;
- covers;
- media;
- custom visual elements.

Customization не должна ломать platform usability.

==================================================
47. MEDIA ARCHITECTURE
======================

Media используется несколькими pillars:

- server;
- resource;
- creator;
- article;
- news;
- community.

Не создавать отдельный storage system для каждого типа.

Использовать единый media infrastructure layer.

Сохранять:

- ownership;
- validation;
- moderation;
- size limits;
- safe delivery.

==================================================
48. SEARCH ARCHITECTURE
=======================

Search должна потенциально работать по:

- resources;
- servers;
- users/creators;
- articles;
- forum threads;
- news.

Но не обязательно реализовывать global search сразу.

Архитектура должна позволять постепенно расширять поиск.

==================================================
49. MODERATION ARCHITECTURE
===========================

Moderation распространяется на:

- resources;
- sellers;
- servers;
- articles/news;
- forum;
- reviews;
- blacklist;
- deals/disputes.

Общий принцип:

Content
→ moderation state
→ audit
→ public visibility.

==================================================
50. AUDIT
=========

Критические изменения должны оставлять audit trail.

Например:

- seller approval;
- resource publish/reject;
- server verification;
- blacklist decision;
- dispute decision;
- financial correction;
- license revocation.

Audit должен быть append-oriented и защищённым от обычного пользовательского
редактирования.

==================================================
51. PAYMENTS & LEDGER
=====================

Финансовый слой должен оставаться централизованным.

Он обслуживает:

- Marketplace purchases;
- Guarantee;
- seller revenue;
- platform fees;
- refunds;
- future payouts.

Payment
≠ Purchase
≠ Ledger
≠ Balance.

Каждый слой имеет собственную state machine.

==================================================
52. LICENSE & DELIVERY
======================

Для поддерживаемых ресурсов:

Purchase
→ Entitlement
→ License
→ Installation
→ DRM

Не каждый product должен использовать DRM.

Разные delivery mechanisms могут coexist.

==================================================
53. SERVER INTEGRATION
======================

mta-market-module является integration point между MTA сервером
и MTA Market.

Через него реализовано (PLAN-005, market_client):

- server verification (possession-токен + heartbeat);
- review token generation;
- server status (только агрегаты: онлайн/слоты/статус).

Целевое состояние (не реализовано):

- license verification;
- resource lifecycle;
- updates;
- telemetry only with explicit policy.

Module не должен автоматически становиться системой слежения за игроками.

==================================================
54. PLAYER DATA PRINCIPLE
=========================

Минимизировать player telemetry.

Собирать только то, что необходимо для:

- verification;
- anti-fraud;
- licensing;
- requested server features.

Не строить систему массового отслеживания игроков только потому, что технически
это возможно.

==================================================
55. NOTIFICATIONS ARCHITECTURE
==============================

Notification system должен быть централизованным.

Sources:

Forum
Server
News
Resource
Purchase
Seller
Deal
Dispute
Moderation

Destinations:

- in-app;
- email where appropriate;
- future external integrations.

==================================================
56. PLATFORM ADMIN
==================

Admin Control Center является отдельным operational layer.

Admin может управлять:

- users;
- servers;
- sellers;
- resources;
- reviews;
- moderation;
- disputes;
- deals;
- payments;
- versions;
- trust.

Но обычный пользователь не должен видеть административные данные.

==================================================
57. PRODUCT BOUNDARIES
======================

MTA Market не должен автоматически становиться:

- полноценной социальной сетью общего назначения;
- универсальной CMS;
- cloud hosting platform;
- payment bank;
- generic file storage service;
- enterprise CRM.

Каждая feature должна иметь прямую связь с MTA ecosystem.

==================================================
58. DEVELOPMENT BOUNDARY
========================

Development Plan может реализовывать только часть этой architecture.

Пример:

PLAN-005
→ Community & Server Foundation (ВЫПОЛНЕН 2026-09-10)

включал форум и уведомления, потому что ecosystem loop
SERVER → COMMUNITY → FOLLOW → NOTIFICATION → RETURN
нельзя проверить без них; при этом сделки, статьи и гарантии
в план не входили.

Пример границы: название плана не означает

Forum
+ Chat
+ Social Network
+ Everything.

Он реализует конкретно выбранный scope.

==================================================
59. MATURITY MODEL
==================

Возможная модель развития:

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
Trust

LEVEL 8
Integrated Ecosystem

Это не строгая последовательность.

Это модель зрелости.

==================================================
60. PRINCIPLE — ENTITY FIRST
=============================

Каждая крупная функция должна быть привязана к сущности.

Пример:

Server News
→ Server + News

Seller Review
→ Seller + Review

Guarantee
→ Deal + Payment + Trust

Server Monitoring
→ Server

Marketplace
→ Resource

Forum
→ Community + Thread

Это помогает не создавать бессвязные features.

==================================================
61. PRINCIPLE — RELATIONSHIP VALUE
===================================

Ценность платформы растёт не только от количества сущностей.

Она растёт от полезных связей между ними.

Пример:

User
→ Server
→ News
→ Forum
→ Resource
→ Purchase
→ Review

Но только если каждая связь разрешена пользователем и имеет смысл.

==================================================
62. PRINCIPLE — PRIVACY BEFORE DISCOVERY
=========================================

Discovery не должна нарушать privacy.

Лучше не показать relationship вообще,
чем автоматически раскрыть приватную информацию ради красивого графа.

==================================================
63. PRINCIPLE — REALITY
========================

Каждая публичная метрика должна быть основана на реальных данных.

Запрещены:

- fake online;
- fake sales;
- fake reviews;
- fake verified status;
- fake popularity.

==================================================
64. PRINCIPLE — INVISIBLE COMPLEXITY
=====================================

Сложность инфраструктуры должна быть скрыта.

Пользователь видит:

Verified
Protected
Licensed
Purchased
Online
Trusted

Внутри работают:

- cryptography;
- DRM;
- payment state machines;
- audit;
- reconciliation;
- monitoring;
- security.

==================================================
65. PRINCIPLE — VISUAL QUALITY
===============================

MTA Market должен быть визуально заметным.

Разрешены:

- animated server banners;
- GIF/WebP;
- custom covers;
- creator identity;
- special badges;
- themed server pages;
- rich resource cards.

Но:

визуал не должен превращаться в хаос.

Platform UI остаётся контролируемым.

==================================================
66. NORTH STAR
==============

Главный стратегический результат:

MTA Market должен стать центральной точкой цифровой жизни MTA:SA-сообщества.

Пользователь должен иметь естественную причину открыть платформу ради:

- сервера;
- новости;
- статьи;
- обсуждения;
- ресурса;
- покупки;
- сделки;
- проверки;
- сообщества.

И продолжить взаимодействие с другими частями экосистемы.

==================================================
67. FINAL PLATFORM MODEL
========================

Финальная модель:

                              MTA MARKET
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
      COMMUNITY                 SERVERS                  CONTENT
          │                        │                        │
       Forum                   Monitoring                Articles
       Topics                  Statistics                 News
       Members                 Server Page               Guides
       Activity                Community                  Updates
          │                        │                        │
          └────────────────────────┼────────────────────────┘
                                   │
                                MARKET
                                   │
                       Resources / Services
                                   │
                                 TRUST
                                   │
                  Reviews / Guarantee / Reputation
                    Blacklist / Disputes / Verify
                                   │
                                IDENTITY
                                   │
                   Users / Creators / Badges
                                   │
                         PLATFORM INFRASTRUCTURE
                                   │
          Auth / Media / Search / Payments / Ledger / License
                         DRM / Audit / Notifications

Главный принцип:

MTA Market — это не набор отдельных сайтов внутри одного домена.

Это одна система, в которой:

Люди
↕
Сообщества
↕
Сервера
↕
Контент
↕
Ресурсы
↕
Сделки
↕
Доверие

связаны между собой, но только в тех местах, где связь полезна и разрешена.

==================================================
68. FINAL ARCHITECTURAL RULE
============================

Никогда не спрашивать только:

"Какую функцию добавить?"

Сначала спрашивать:

"Какую проблему пользователя она решает?"

Затем:

"К какой сущности она относится?"

Затем:

"Какие существующие части платформы она усиливает?"

И только после этого:

"Нужна ли для неё новая инфраструктура?"

Если новая функция не усиливает экосистему MTA Market,
она не должна автоматически попадать в Development Plan.
