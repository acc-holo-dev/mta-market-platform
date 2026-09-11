STATUS: FOUNDATIONAL
TYPE: PRODUCT SURFACE MAP
SCOPE: PLATFORM-WIDE

==================================================
0. PURPOSE
==========

Этот документ описывает все основные пользовательские поверхности MTA Market.

Он отвечает на вопросы:

- Какие экраны существуют?
- Для кого они предназначены?
- Что человек видит?
- Что он может сделать?
- Какие данные ему доступны?
- Что видят другие пользователи?
- Какие состояния существуют?
- Куда ведут действия?
- С какими сущностями связан экран?

Документ не определяет:

- конкретный frontend framework;
- API;
- database schema;
- конкретный дизайн;
- сроки разработки.

==================================================

1. GLOBAL USER TYPES
   ==================================================

GUEST
Неавторизованный посетитель.

USER
Авторизованный пользователь.

PLAYER
Пользователь, взаимодействующий с MTA-серверами.

SERVER OWNER
Владелец/управляющий сервером.

SELLER / CREATOR
Разработчик, продающий или распространяющий ресурсы/услуги.

COMMUNITY MEMBER
Активный участник сообщества.

MODERATOR
Пользователь с moderation permissions.

ADMIN
Полный platform control.

Один человек может одновременно иметь несколько ролей.

==================================================
2. GLOBAL NAVIGATION
====================

Основные поверхности:

HOME
COMMUNITY
SERVERS
CONTENT
MARKET
TRUST

Справа:

SEARCH
NOTIFICATIONS
BALANCE
PROFILE

Conditional:

MY STORE
ADMIN

Не выводить все возможности пользователя в navigation одновременно.

Navigation должна зависеть от context.

==================================================
3. HOME
=======

URL:

/

Audience:

Guest
User

Purpose:

Главная точка входа в экосистему.

Home должна показывать жизнь MTA Market, а не только продавать ресурсы.

---

3.1 Main blocks
---------------

- Hero;
- search;
- current community activity;
- server highlights;
- latest news;
- popular resources;
- latest discussions;
- creators;
- optional events.

---

3.2 Guest
---------

Guest может:

- browse;
- search;
- open server;
- open resource;
- open article;
- read public discussion;
- register/login.

---

3.3 User
--------

User дополнительно:

- follow;
- react;
- review if eligible;
- purchase;
- join community;
- receive notifications.

---

3.4 Main CTA
------------

Не одна универсальная CTA.

Главное действие зависит от контекста homepage.

Primary:

Discovery.

==================================================
4. SEARCH
=========

Global Search.

Изначально может искать:

- resources;
- servers;
- users/creators;
- articles;
- news;
- forum threads.

Search result type должен быть очевиден.

Пример:

Search:

"Hud"

Results:

Resources
Servers
Creators
Articles
Discussions

Не создавать отдельные независимые search experiences без причины.

==================================================
5. COMMUNITY
============

URL:

/community

Purpose:

Главный community hub.

---

5.1 Sections
------------

- Forum;
- Discussions;
- Members;
- Activity;
- Communities.

---

5.2 User actions
----------------

- browse;
- search;
- create discussion;
- reply;
- react;
- follow;
- report.

==================================================
6. FORUM
========

URL:

/community/forum

Structure:

Category
→ Thread
→ Posts

---

6.1 Forum homepage
------------------

Показывает:

- categories;
- latest discussions;
- active discussions;
- pinned;
- unanswered;
- followed topics.

---

6.2 Thread
----------

URL:

/community/forum/thread/[id]

Показывает:

- title;
- author;
- posts;
- reactions;
- metadata;
- moderation state.

Actions:

- reply;
- quote;
- react;
- report;
- follow.

Author actions:

- edit;
- delete where permitted.

Moderator:

- pin;
- lock;
- moderate.

==================================================
7. COMMUNITY PAGE
=================

Community может быть:

- global;
- server-based;
- creator-based;
- event-based.

Пример:

/community/night-city-rp

Показывает:

- name;
- cover;
- description;
- members;
- news;
- discussions;
- events.

==================================================
8. SERVERS
==========

URL:

/servers

Purpose:

Server discovery.

---

8.1 Server List
---------------

Card:

- logo;
- name;
- status;
- online/max;
- rating;
- short description;
- region;
- verified badge;
- action.

Filters:

- online/offline;
- type where available;
- region;
- popularity;
- activity.

Не добавлять фильтры без соответствующих данных.

==================================================
9. SERVER PAGE
==============

URL:

/servers/[slug]

Это одна из центральных страниц платформы.

---

9.1 Hero
--------

- server banner;
- logo;
- name;
- status;
- online;
- max online;
- rating;
- verified badge;
- actions.

Actions:

- connect/play;
- Discord;
- website;
- follow.

---

9.2 Overview
------------

Показывает:

- description;
- server information;
- current online;
- uptime;
- recent activity.

---

9.3 Live
--------

Показывает:

- current players;
- current status;
- last update.

Позже:

- live graph.

---

9.4 Statistics
--------------

Показывает:

- 24h;
- 7d;
- 30d;
- peak;
- average;
- uptime.

Только реальные metrics.

---

9.5 News
--------

Показывает server news.

Каждая News:

- title;
- date;
- cover;
- author;
- preview;
- discussion link.

---

9.6 Updates
-----------

Показывает:

- update history;
- changelog;
- release date.

---

9.7 Reviews
-----------

Показывает:

- rating;
- distribution;
- reviews;
- verified interaction badge.

Review form появляется только если user eligible.

---

9.8 Community
-------------

Показывает:

- members;
- discussions;
- activity;
- events.

---

9.9 Optional technical information
----------------------------------

Может показываться только при owner opt-in:

- used resources;
- technical stack;
- staff;
- additional metrics.

DEFAULT:

PRIVATE.

==================================================
10. SERVER OWNER DASHBOARD
==========================

URL:

/server/manage

или equivalent.

Purpose:

Управление сервером.

---

10.1 Overview
-------------

Показывает:

- online;
- uptime;
- reviews;
- followers;
- latest news;
- alerts.

---

10.2 Server Settings
--------------------

Owner может:

- name;
- description;
- logo;
- banner;
- external links;
- visibility.

---

10.3 Privacy
------------

Owner управляет:

- resource visibility;
- staff visibility;
- technical information;
- statistics;
- community data.

Default:

private.

---

10.4 News Management
--------------------

Owner:

- create;
- edit;
- publish;
- archive.

---

10.5 Community Management
-------------------------

Owner/moderator:

- manage community;
- moderation;
- members.

==================================================
11. SERVER REGISTRATION
=======================

URL:

/servers/create

Flow:

Create
→ Verify ownership
→ Configure
→ Publish

---

11.1 Basic
----------

- server name;
- description;
- links.

---

11.2 Branding
-------------

- logo;
- cover;
- banner;
- optional animated media.

---

11.3 Connection
---------------

- address;
- port;
- verification data.

Не показывать public technical data автоматически.

---

11.4 Visibility
---------------

Owner selects what is public.

---

11.5 Verification
-----------------

Server ownership is verified.

После verification:

✓ Verified Server

==================================================
12. SERVER REVIEW FLOW
======================

На сервере:

[Оставить отзыв]

Если user не eligible:

показывается объяснение.

Если eligible:

review form.

---

12.1 Token flow
---------------

Server integration
→ issue token
→ user opens MTA Market
→ validate token
→ review allowed.

---

12.2 Review state
-----------------

CREATED
→ VERIFIED
→ PUBLISHED

Alternative:

FLAGGED
→ MODERATION

==================================================
13. CONTENT HUB
===============

URL:

/content

Content включает:

- articles;
- guides;
- news;
- creator publications;
- community publications.

---

13.1 Content homepage
---------------------

Показывает:

- latest;
- popular;
- featured;
- categories;
- creators.

"Featured" использовать только при наличии реальной editorial logic.

==================================================
14. ARTICLE PAGE
================

URL:

/content/articles/[slug]

Показывает:

- cover;
- title;
- author;
- date;
- content;
- related content;
- discussion;
- linked entities.

Возможные links:

Resource
Server
Creator
Community

Только если связь задана.

==================================================
15. NEWS FEED
=============

URL:

/news

Показывает:

- global news;
- platform news;
- server updates;
- creator updates;
- resource updates.

Фильтр:

Global
Servers
Creators
Resources

==================================================
16. NEWS PAGE
=============

Показывает:

- title;
- author;
- date;
- content;
- media;
- discussion;
- related entity.

==================================================
17. MARKET
==========

URL:

/market

Это commerce hub.

Содержит:

Resources
Services
Stores
Deals

==================================================
18. RESOURCE MARKETPLACE
========================

URL:

/resources

Главный catalog.

---

18.1 Discovery
--------------

- search;
- categories;
- filters;
- sorting;
- pagination.

---

18.2 Card
---------

Показывает:

- cover;
- title;
- type;
- seller;
- rating;
- review count;
- sales count where appropriate;
- price;
- ownership state.

==================================================
19. RESOURCE PAGE
=================

URL:

/resources/[slug]

Показывает:

Hero
Gallery
Description
Features
Requirements
Compatibility
Versions
Reviews
Seller
Purchase

---

19.1 Primary action
-------------------

Free:

Получить.

Paid:

Купить.

Owned:

Уже приобретено.

Unavailable:

Unavailable state.

==================================================
20. SELLER PAGE
===============

URL:

/creators/[username]

Показывает:

- avatar;
- banner;
- name;
- badges;
- description;
- rating;
- sales;
- resources;
- reviews;
- articles;
- public activity.

Privacy respected.

==================================================
21. MY STORE
============

URL:

/store

Доступно Seller.

---

21.1 Dashboard
--------------

Показывает:

- resources;
- published;
- pending;
- drafts;
- sales;
- available financial data.

---

21.2 Resources
--------------

States:

Draft
Pending
Published
Suspended
Rejected

---

21.3 Sales
----------

Показывает:

- completed sales;
- revenue;
- resources.

Advanced analytics later.

==================================================
22. RESOURCE CREATION
=====================

URL:

/store/resources/new

Flow:

1. Basic
2. Presentation
3. Price
4. Artifact
5. Compatibility
6. Preview
7. Submit

---

22.1 Basic
----------

- title;
- description;
- category/type.

---

22.2 Presentation
-----------------

- cover;
- screenshots.

---

22.3 Price
----------

Free/Paid.

---

22.4 Artifact
-------------

Upload and validation.

---

22.5 Compatibility
------------------

Only real supported data.

---

22.6 Preview
------------

Show exactly how product will look publicly.

---

22.7 Submit
-----------

Creates:

PENDING_REVIEW.

==================================================
23. PURCHASES
=============

URL:

/purchases

User sees:

- purchases;
- resources;
- dates;
- amounts;
- statuses;
- licenses;
- updates.

==================================================
24. LICENSES
============

Can exist inside Purchases or separate section.

Shows:

- active;
- expired;
- revoked;
- installation count;
- version.

Never expose private identifiers unnecessarily.

==================================================
25. BALANCE
===========

URL:

/balance

Shows:

Current Balance

Transactions

Future:

Top Up
Payouts

Balance is financial state, not merely visual header decoration.

==================================================
26. DEALS
=========

URL:

/deals

Shows:

- active;
- completed;
- disputed;
- archived.

---

26.1 Deal Room
--------------

URL:

/deals/[id]

Shows:

- seller;
- buyer;
- subject;
- amount;
- timeline;
- current state;
- delivery;
- actions;
- dispute.

==================================================
27. GUARANTEE FLOW
==================

Seller:

Create Deal

Buyer:

Join
→ Fund

Seller:

Deliver

Buyer:

Verify

Buyer:

Confirm

System:

Settlement

Alternative:

Dispute.

==================================================
28. DISPUTE PAGE
================

URL:

/disputes/[id]

Shows:

- participants;
- subject;
- amount;
- evidence;
- timeline;
- messages;
- current status.

Authorized admin can resolve.

==================================================
29. TRUST HUB
=============

URL:

/trust

Contains:

- verified entities;
- reputation;
- reviews;
- guarantee;
- blacklist;
- disputes.

Не обязательно делать всё одной страницей.

Это conceptual hub.

==================================================
30. BLACKLIST
=============

URL:

/trust/blacklist

Shows:

- confirmed cases;
- reason;
- evidence summary;
- decision;
- date;
- status.

Нельзя использовать blacklist как публичную доску обвинений.

==================================================
31. REPUTATION PAGE
===================

URL:

/users/[username]/reputation

Показывает:

- completed deals;
- sales;
- reviews;
- verified identities;
- badges;
- disputes where publicly relevant.

Не раскрывать приватные детали.

==================================================
32. USER PROFILE
================

URL:

/profile/[username]

Public:

- avatar;
- banner;
- name;
- roles;
- badges;
- public activity;
- public servers;
- public resources;
- public articles.

Private:

- email;
- purchases;
- balance;
- security;
- private deals.

==================================================
33. MY DASHBOARD
================

URL:

/dashboard

Personal ecosystem view.

Показывает:

- notifications;
- followed servers;
- followed creators;
- recent news;
- recent discussions;
- purchases;
- seller activity;
- balance;
- updates.

Dashboard should be contextual.

Не показывать пустые блоки только ради заполнения страницы.

==================================================
34. NOTIFICATIONS
=================

URL:

/notifications

Types:

- forum;
- server;
- resource;
- purchase;
- seller;
- deal;
- dispute;
- moderation.

Каждое notification должно вести к соответствующему объекту.

==================================================
35. GLOBAL USER SETTINGS
========================

URL:

/settings

Разделы:

Profile
Security
Connected Accounts
Privacy
Notifications
Preferences

==================================================
36. ADMIN
=========

URL:

/admin

Admin-only.

---

36.1 Dashboard
--------------

Показывает:

- users;
- servers;
- resources;
- sales;
- disputes;
- pending moderation;
- platform activity.

---

36.2 Moderation
---------------

Moderate:

- resources;
- sellers;
- servers;
- reviews;
- content;
- blacklist.

---

36.3 Users
----------

Admin может:

- inspect;
- suspend;
- ban;
- manage relevant permissions.

---

36.4 Servers
------------

Admin может:

- verify;
- suspend;
- inspect;
- moderate.

---

36.5 Deals / Payments
---------------------

Authorized staff:

- inspect;
- dispute;
- refund;
- reconcile.

---

36.6 Audit
----------

Critical actions visible through audit trail.

==================================================
37. GUEST EXPERIENCE
====================

Guest should be able to:

Home
→ Search
→ Servers
→ Resources
→ News
→ Articles
→ Public Forum
→ Public Profiles

without forced registration.

Registration is required for:

- reviews;
- purchases;
- seller application;
- server management;
- forum posting;
- deals.

==================================================
38. PLAYER EXPERIENCE
=====================

Player:

Home
→ Server
→ Live
→ Reviews
→ Community
→ Follow
→ Play
→ Verified Review

==================================================
39. SERVER OWNER EXPERIENCE
===========================

Server Owner:

Create Server
→ Verify
→ Customize
→ Publish
→ Monitor
→ Publish News
→ Community
→ Reviews
→ Statistics

==================================================
40. SELLER EXPERIENCE
=====================

Seller:

Apply
→ Approved
→ Store
→ Resource
→ Media
→ Artifact
→ Preview
→ Moderation
→ Sales
→ Update
→ Reputation

==================================================
41. BUYER EXPERIENCE
====================

Buyer:

Discover
→ Evaluate
→ Trust
→ Purchase
→ License
→ Use
→ Update
→ Review

==================================================
42. COMMUNITY MEMBER EXPERIENCE
===============================

Member:

Read
→ Follow
→ Discuss
→ Publish
→ React
→ Return

==================================================
43. DEAL EXPERIENCE
===================

Seller
→ Deal
→ Buyer
→ Fund
→ Delivery
→ Verification
→ Complete

Alternative:

Dispute
→ Resolution.

==================================================
44. CROSS-SURFACE NAVIGATION
============================

Important transitions:

Homepage
→ Server

Homepage
→ Resource

Homepage
→ News

Homepage
→ Discussion

Server
→ Community

Server
→ News

Server
→ Reviews

Server
→ Owner Profile

Resource
→ Seller

Resource
→ Reviews

Resource
→ Purchase

Resource
→ Discussion

Article
→ Resource

Article
→ Server

Article
→ Discussion

Creator
→ Resources

Creator
→ Articles

Creator
→ Server

Deal
→ User

Deal
→ Resource

==================================================
45. VISIBILITY MATRIX
=====================

RESOURCE

Guest:
public data.

Buyer:
own purchase/license.

Seller:
own resource private data.

Admin:
moderation/internal data.

SERVER

Guest:
public profile.

Owner:
full configuration.

Users:
only public data.

Admin:
full operational data.

PURCHASE

Buyer:
own purchase.

Seller:
aggregate sales + relevant transaction state.

Admin:
full.

DEAL

Participants:
full.

Admin:
full.

Public:
none.

REVIEW

Public:
published review.

Author:
own review.

Admin:
moderation data.

==================================================
46. USER-GENERATED VISUAL CONTENT
=================================

Possible:

- avatar;
- banner;
- cover;
- screenshots;
- GIF/WebP;
- custom badge.

Правила:

- size limits;
- format validation;
- moderation;
- ownership;
- storage lifecycle;
- performance controls.

==================================================
47. EMPTY STATES
================

Every major surface needs meaningful empty states.

Examples:

No servers found
No resources
No purchases
No notifications
No discussions
No seller resources
No reviews

Each should explain:

what happened;

what user can do next.

==================================================
48. ERROR STATES
================

Errors should be:

- understandable;
- localized;
- actionable.

Never expose raw stack trace.

==================================================
49. LOADING STATES
==================

Use:

- skeleton;
- progress;
- optimistic UI where safe.

Especially:

Marketplace
Server list
Resource page
Dashboard
Forum.

==================================================
50. MOBILE SURFACES
===================

Every primary surface must work on mobile:

- Home;
- Search;
- Servers;
- Server;
- Community;
- Forum;
- Resource;
- Purchase;
- Profile;
- Store;
- Deal.

==================================================
51. ACCESSIBILITY
=================

Each surface must support:

- keyboard;
- focus;
- semantic headings;
- labels;
- alt text;
- contrast;
- reduced motion where appropriate.

==================================================
52. PERFORMANCE
===============

Animated media must not automatically autoplay heavy assets everywhere.

Use:

- optimized images;
- lazy loading;
- thumbnails;
- responsive images;
- sensible media limits.

Homepage must remain fast despite rich visual content.

==================================================
53. PRODUCT PRINCIPLE — NO DEAD ENDS
=====================================

Every major surface should offer a logical next step.

Example:

Server Page
→ Community
→ Reviews
→ Follow

Resource Page
→ Seller
→ Similar resources
→ Purchase

Article
→ Discussion
→ Related content

Forum
→ Related topic
→ Server/Resource context

==================================================
54. PRODUCT PRINCIPLE — NO INFORMATION DUMP
============================================

Не показывать всё сразу.

Страница должна иметь hierarchy:

Primary
Secondary
Optional

Пользователь сначала видит:

"что это"

потом:

"почему мне это интересно"

потом:

"куда идти дальше".

==================================================
55. PRODUCT PRINCIPLE — CONTEXTUAL UI
======================================

Интерфейс должен учитывать:

Guest
User
Seller
Server Owner
Moderator
Admin.

Не показывать admin controls обычному пользователю.

Не перегружать buyer интерфейс seller tools.

==================================================
56. PRODUCT PRINCIPLE — ENTITY OWNERSHIP
=========================================

Каждый объект должен иметь понятного владельца:

Resource
→ Seller

Server
→ Server Owner

Article
→ Author

Community
→ Owner/Moderators

Deal
→ Participants

Review
→ Author

==================================================
57. PRODUCT PRINCIPLE — PUBLIC BY DESIGN, PRIVATE BY DEFAULT
=============================================================

Каждая сущность должна иметь осознанную visibility policy.

Особенно:

Server technical details
Resource usage by server
Purchase details
Deal details
Player information.

==================================================
58. PRODUCT PRINCIPLE — VERIFIED CLAIMS
========================================

Каждый badge/claim:

Verified Seller
Verified Server
Verified Review
Verified Resource

должен соответствовать реальному проверяемому событию.

==================================================
59. PRODUCT PRINCIPLE — REAL METRICS
=====================================

Все:

- online;
- sales;
- rating;
- users;
- uptime;
- popularity

должны рассчитываться из real data.

==================================================
60. PRODUCT PRINCIPLE — PLATFORM UNITY
=======================================

Forum
Servers
Resources
News
Deals
Profiles

должны выглядеть как части одного продукта.

Не создавать отдельные visual ecosystems.

==================================================
61. FIRST RELEASE VS FUTURE
===========================

Не все перечисленные surfaces обязаны существовать одновременно.

Surface Map описывает конечную/целевую продуктовую модель.

Development Plans выбирают subset.

==================================================
62. FUTURE SURFACES
===================

Возможны:

- Events;
- Status;
- Creator collections;
- Server events;
- Advanced analytics;
- Global recommendation;
- Wishlist;
- Bundles;
- subscriptions;
- external API;
- mobile/PWA;
- MTA Market Manager.

Они не входят автоматически в текущую разработку.

==================================================
63. FINAL PLATFORM EXPERIENCE
=============================

Пользователь должен иметь возможность двигаться:

HOME
↓
SERVER
↓
COMMUNITY
↓
NEWS
↓
RESOURCE
↓
MARKET
↓
PURCHASE
↓
LICENSE
↓
REVIEW
↓
RETURN

или:

HOME
↓
ARTICLE
↓
DISCUSSION
↓
CREATOR
↓
RESOURCE

или:

SERVER
↓
COMMUNITY
↓
REVIEW
↓
FOLLOW
↓
NOTIFICATION
↓
RETURN

или:

SELLER
↓
STORE
↓
RESOURCE
↓
DEAL
↓
REPUTATION

==================================================
64. FINAL PRODUCT IDEA
======================

MTA Market должен ощущаться как единое место, где пользователь:

узнаёт,
ищет,
общается,
играет,
создаёт,
продаёт,
покупает,
проверяет,
доверяет,
следит
и возвращается.

Не:

"сайт с несколькими разделами".

А:

"единая цифровая среда MTA:SA".

==================================================
65. FINAL RULE
==============

Перед созданием любого нового крупного экрана необходимо ответить:

1. Какую проблему пользователя решает экран?
2. Какая сущность находится в центре?
3. Для какой роли он нужен?
4. Что здесь главное действие?
5. Какие данные пользователь должен увидеть?
6. Какие данные должны быть скрыты?
7. Откуда пользователь сюда пришёл?
8. Куда он должен перейти дальше?
9. Какие другие части MTA Market усиливаются через этот экран?
10. Можно ли реализовать это на существующей инфраструктуре?

экран не должен автоматически становиться частью разработки.
