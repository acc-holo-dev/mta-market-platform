
PRODUCT-MODEL.md — MTA Market Product Model

STATUS: FOUNDATIONAL
TYPE: PRODUCT MODEL
SCOPE: PLATFORM-WIDE

==================================================
0. PURPOSE
==========

PRODUCT-MODEL.md определяет основные сущности MTA Market,
их состояния, владельцев, visibility, permissions и связи.

VISION отвечает:

"Зачем существует MTA Market?"

PRODUCT-ARCHITECTURE отвечает:

"Какие части существуют?"

PRODUCT-MODEL отвечает:

"Как именно эти части живут и взаимодействуют?"

DEVELOPMENT PLAN отвечает:

"Что из этого мы делаем сейчас?"

Этот документ не является database schema.

Одна продуктовая сущность не обязана напрямую соответствовать
одной таблице базы данных.

==================================================

1. CORE ENTITIES
   ==================================================

Основные сущности:

USER
SERVER
COMMUNITY
RESOURCE
SELLER
ARTICLE
NEWS
FORUM THREAD
REVIEW
DEAL
PURCHASE
LICENSE
NOTIFICATION
REPUTATION
BADGE
BLACKLIST ENTRY

Вторичные/system entities:

PAYMENT
LEDGER TRANSACTION
MODERATION EVENT
SERVER VERIFICATION
REVIEW TOKEN
MEDIA
INSTALLATION

==================================================
2. USER
=======

User — центральная identity платформы.

Один человек имеет один основной User account.

User может одновременно быть:

- Player;
- Server Owner;
- Developer;
- Seller;
- Article Author;
- Forum Member;
- Community Member.

==================================================
2.1 User states
===============

ACTIVE
SUSPENDED
BANNED

Точные states зависят от существующей identity architecture.

==================================================
2.2 User visibility
===================

Public:

- username;
- display name;
- avatar;
- public roles;
- badges;
- public resources;
- public servers;
- public articles;
- public forum identity.

Private:

- email;
- authentication data;
- purchases;
- private balance data;
- private deals;
- private messages;
- security information.

==================================================
3. SERVER
=========

Server — зарегистрированный MTA:SA сервер.

Server принадлежит владельцу/User.

==================================================
3.1 Server lifecycle
====================

CREATED
→ PENDING_VERIFICATION
→ VERIFIED
→ ACTIVE

Возможны:

OFFLINE
SUSPENDED
ARCHIVED

Важно:

OFFLINE не означает удаление.

Это operational state.

==================================================
3.2 Server ownership
====================

Один или несколько пользователей могут иметь административное отношение
к серверу в соответствии с будущей permission model.

Первоначально должен существовать один подтверждённый owner.

==================================================
3.3 Server public data
======================

По умолчанию:

- name;
- logo;
- cover;
- description;
- online;
- max online;
- status;
- public statistics;
- public news;
- reviews;
- external links.

==================================================
3.4 Server private data
=======================

По умолчанию private:

- internal resources;
- staff;
- technical configuration;
- private integrations;
- player internals;
- private telemetry.

==================================================
3.5 Server opt-in
=================

Owner может явно разрешить публикацию:

- used resources;
- technical stack;
- staff;
- additional stats;
- community information.

Без opt-in информация остаётся private.

==================================================
4. SERVER MONITORING
====================

Monitoring является частью Server.

Основные значения:

current online
max online
last seen
uptime
peak

Исторические metrics:

24h
7d
30d

могут появиться позднее.

==================================================
5. SERVER VERIFICATION
======================

Server Verification подтверждает:

"Этот пользователь имеет право управлять этим сервером".

Verification не означает:

"Этот сервер хороший".

Она только подтверждает ownership/control.

==================================================
6. SERVER REVIEW
================

Server Review — отзыв пользователя о сервере.

Review может быть создан:

ONLY AFTER VALID INTERACTION PROOF

Основной механизм:

Server
→ issue token
→ Player receives token
→ Player opens MTA Market
→ token verification
→ review creation

==================================================
6.1 Review token
================

Review token должен иметь:

- server binding;
- expiration;
- replay protection;
- cryptographic/server validation;
- minimal data exposure.

Главная цель:

Prevent fake reviews.

Не:

Track players.

==================================================
6.2 Verified review
===================

Review может содержать:

✓ Verified Interaction

Этот badge означает только:

"Interaction with this server was cryptographically/technically verified."

==================================================
7. COMMUNITY
============

Community — группа пользователей вокруг определённой темы/сервера.

Может быть:

- global;
- server-based;
- topic-based;
- creator-based;
- event-based.

==================================================
7.1 Community membership
========================

Пользователь может:

- join;
- leave;
- follow;
- participate.

Membership не обязана быть публичной.

==================================================
8. FORUM THREAD
===============

Forum Thread:

Category
→ Thread
→ Posts

Thread может принадлежать:

- глобальной community;
- server;
- resource;
- article;
- news;
- event.

Не создавать автоматический Thread для каждой сущности.

==================================================
9. POST
=======

Post:

- author;
- content;
- createdAt;
- updatedAt;
- reactions;
- moderation state.

Важные действия:

- edit;
- delete;
- quote;
- report.

==================================================
10. RESOURCE
============

Resource — MTA content product.

Resource может распространяться:

- free;
- paid;
- licensed;
- DRM protected;
- directly delivered;
- through Guarantee Deal.

==================================================
10.1 Resource lifecycle
=======================

DRAFT
→ PENDING_REVIEW
→ PUBLISHED

Possible:

SUSPENDED
YANKED
ARCHIVED

==================================================
10.2 Resource ownership
=======================

Resource belongs to Seller/creator.

Buyer does not become owner of the product itself.

Buyer gets:

Purchase
+
License/entitlement

==================================================
10.3 Resource public data
=========================

- title;
- description;
- cover;
- screenshots;
- seller;
- type;
- price;
- rating;
- review count;
- sales count;
- version;
- compatibility;
- changelog.

==================================================
10.4 Resource private data
==========================

- private buyers;
- internal moderation data;
- private security metadata;
- signing secrets;
- internal fraud signals.

==================================================
11. RESOURCE SALES METRICS
==========================

Public aggregate:

"1 482 продажи"

allowed.

Private:

"покупатели: [user list]"

not allowed.

==================================================
12. SELLER
==========

Seller — capability/identity layer над User.

Seller не является отдельным account.

Seller получает:

- storefront;
- resources;
- sales;
- reviews;
- reputation;
- seller permissions.

==================================================
12.1 Seller lifecycle
=====================

USER
→ APPLICATION
→ REVIEW
→ APPROVED
→ SELLER

Возможны:

SUSPENDED
REJECTED

==================================================
13. SELLER STOREFRONT
=====================

Storefront публично показывает:

- avatar;
- creator name;
- description;
- badges;
- resources;
- ratings;
- sales count.

Можно позже добавить:

- collections;
- featured;
- creator updates.

==================================================
14. ARTICLE
===========

Article — long-form content.

Типичный lifecycle:

DRAFT
→ REVIEW
→ PUBLISHED
→ ARCHIVED

Author:

User.

Article может ссылаться на:

- Server;
- Resource;
- Community;
- Creator.

==================================================
15. NEWS
========

News — time-oriented content.

Types:

GLOBAL
SERVER
CREATOR
RESOURCE
PLATFORM

News может иметь:

- comments;
- discussion;
- media;
- links;
- update metadata.

==================================================
16. DISCUSSION
==============

Discussion — contextual community interaction.

Примеры:

Resource Discussion
Server Discussion
Article Discussion
News Discussion

Не дублировать content.

Один объект Discussion может отображаться в разных context surfaces.

==================================================
17. REVIEW
==========

Review — пользовательская оценка сущности.

Possible targets:

- Resource;
- Server;
- Seller.

Но каждая разновидность Review должна иметь собственную verification policy.

Resource Review:

обычно tied to purchase.

Server Review:

tied to server interaction token.

Seller Review:

может быть tied to completed transaction.

==================================================
18. REVIEW ANTI-FRAUD
=====================

Review system должен предотвращать:

- mass duplicate;
- bots;
- self-review;
- obvious abuse;
- review farming.

Не пытаться решить все anti-fraud задачи ML-моделью на раннем этапе.

Основные ограничения:

identity
+
ownership
+
interaction proof
+
rate limits
+
moderation.

==================================================
19. PURCHASE
============

Purchase фиксирует факт приобретения Resource.

Purchase не является payment.

Lifecycle:

PENDING
→ COMPLETED

или:

FAILED
REFUNDED
DISPUTED

==================================================
20. PAYMENT
===========

Payment фиксирует взаимодействие с provider.

Payment может:

- exist without completed purchase;
- fail;
- succeed;
- be refunded.

Payment state не должен напрямую использоваться как License state.

==================================================
21. LICENSE
===========

License даёт пользователю право использовать resource.

License:

ACTIVE
REVOKED
EXPIRED

License может быть:

- purchase-derived;
- tied to installation;
- DRM-backed.

==================================================
22. INSTALLATION
================

Installation — зарегистрированный экземпляр использования license.

Может содержать:

- public key;
- server serial;
- server name;
- module version;
- MTA version;
- status;
- heartbeat.

Installation information должна использоваться только согласно privacy policy.

==================================================
23. DRM
=======

DRM используется только там, где это действительно необходимо.

DRM не является универсальным способом доставки всех товаров.

Пример:

Paid Script
→ Purchase
→ License
→ Installation
→ DRM

Service
→ Purchase
→ Service workflow

Custom work
→ Deal
→ Delivery
→ Completion

==================================================
24. DEAL
========

Deal — защищённая P2P transaction.

Participants:

Seller
Buyer

Subject:

Resource
Service
Custom Work
Other supported deliverable

==================================================
24.1 Deal lifecycle
===================

CREATED
→ BUYER_JOINED
→ FUNDED
→ DELIVERY
→ VERIFICATION
→ COMPLETED

Alternative:

→ DISPUTED
→ RESOLVED

==================================================
25. GUARANTEE
=============

Guarantee — financial/transaction mechanism внутри Deal.

Основная идея:

Platform holds buyer funds until agreed completion conditions.

Важно:

MTA Market не является банком.

Все financial flows должны соответствовать applicable provider/legal constraints.

==================================================
26. DEAL DELIVERY
=================

Delivery mechanism зависит от предмета сделки.

Resource:

artifact/license.

Service:

delivery submission.

Custom development:

specified deliverable.

Не пытаться использовать DRM там, где он не подходит.

==================================================
27. DISPUTE
===========

Dispute — конфликт внутри Deal/Purchase.

Contains:

- participants;
- subject;
- evidence;
- messages;
- state;
- decision;
- timestamps.

Admin/moderator может:

- inspect;
- freeze;
- resolve;
- reject;
- refund;
- settle.

==================================================
28. BLACKLIST ENTRY
===================

Blacklist Entry — moderated trust record.

Содержит:

- subject;
- reason;
- evidence;
- createdAt;
- moderator;
- status;
- resolution.

Public entry создаётся только после moderation.

==================================================
29. REPUTATION
==============

Reputation состоит из observable signals.

Примеры:

- completed deals;
- sales;
- reviews;
- server ownership verification;
- published resources;
- community contribution.

Не скрывать основную логику в непрозрачном score.

==================================================
30. BADGE
=========

Badge — визуальный representation verified property.

Примеры:

Verified Seller
Verified Server
Verified Developer
Server Owner
Trusted Seller
Community Contributor

Badge должен иметь:

- clear criteria;
- source;
- state;
- revocation logic.

==================================================
31. NOTIFICATION
================

Notification связывает ecosystem.

Источники:

- Forum;
- Server;
- News;
- Resource;
- Purchase;
- Deal;
- Dispute;
- Moderation;
- Seller;
- Community.

Уведомление должно вести пользователя к действию.

==================================================
32. MEDIA
=========

Media — shared infrastructure entity.

Используется:

- Resource cover;
- Resource screenshots;
- Server cover;
- Server logo;
- User avatar;
- Article media;
- News media;
- Creator banner.

Media должна иметь:

- owner;
- type;
- size;
- storage key;
- visibility;
- moderation status.

==================================================
33. MODERATION
==============

Moderation может применяться к:

- Resource;
- Seller;
- Server;
- Article;
- News;
- Forum;
- Review;
- Blacklist;
- Deal.

Основной принцип:

User-generated object
→ moderation state
→ visibility.

==================================================
34. VISIBILITY MODEL
====================

Каждый объект должен иметь один из концептуальных уровней:

PUBLIC
PRIVATE
UNLISTED
MODERATOR_ONLY
DELETED

Конкретный набор зависит от сущности.

Не всё должно быть PUBLIC по умолчанию.

==================================================
35. PERMISSION MODEL
====================

Основные actors:

GUEST
USER
SELLER
SERVER_OWNER
MODERATOR
ADMIN

Один User может обладать несколькими capabilities.

Не считать role единственным источником разрешений.

Например:

User
+
owns Server
+
Seller

может иметь разные permissions в разных context.

==================================================
36. SERVER PERMISSIONS
======================

Server Owner может:

- edit server;
- publish news;
- manage server presentation;
- manage community;
- manage integrations;
- control public visibility.

Обычный USER:

- view;
- follow;
- review if verified;
- participate.

==================================================
37. RESOURCE PERMISSIONS
========================

Seller:

- create;
- edit draft;
- upload media;
- upload artifact;
- submit moderation;
- release versions;
- view seller information.

Buyer:

- view;
- acquire;
- review after eligibility;
- manage own license.

Admin:

- moderate;
- publish;
- suspend;
- yank;
- inspect.

==================================================
38. COMMUNITY PERMISSIONS
=========================

Community Owner/Moderator:

- manage community;
- moderate posts;
- manage members.

Member:

- create post;
- reply;
- react;
- report.

Guest:

- read public content.

==================================================
39. DEAL PERMISSIONS
====================

Seller:

- create;
- deliver;
- accept resolution.

Buyer:

- join;
- fund;
- verify;
- dispute.

Admin:

- inspect;
- freeze;
- resolve.

==================================================
40. PRIVACY RULES
=================

Rule 1:

Do not reveal private information unless required.

Rule 2:

Server resource usage is private unless owner opts in.

Rule 3:

Buyer identities are not public by default.

Rule 4:

Deal information is private between participants and authorized platform staff.

Rule 5:

Player verification should not imply broad player tracking.

Rule 6:

Public statistics should be aggregate wherever possible.

==================================================
41. DISCOVERY MODEL
===================

MTA Market discovery happens through:

- Home;
- Marketplace;
- Servers;
- News;
- Articles;
- Forum;
- Creators;
- Communities.

One section should naturally lead to another.

Но discovery не должно разрушать privacy.

==================================================
42. CORE USER JOURNEYS
======================

PLAYER:

Home
→ Servers
→ Server
→ Community
→ Review
→ Follow

SERVER OWNER:

Register
→ Create Server
→ Verify
→ Customize
→ Monitor
→ Publish News
→ Build Community

DEVELOPER:

Register
→ Seller Application
→ Create Resource
→ Moderation
→ Publish
→ Sell
→ Update
→ Build Reputation

BUYER:

Discover Resource
→ Product Page
→ Purchase/Get
→ License
→ Use
→ Update
→ Review

DEAL:

Create
→ Invite
→ Fund
→ Deliver
→ Verify
→ Complete

or:

Dispute
→ Resolve

==================================================
43. DAILY PLATFORM LOOP
=======================

User:

Login
→ sees updates
→ opens server/news/forum/resource
→ interacts
→ follows
→ receives notification
→ returns.

==================================================
44. PLATFORM LOOP
=================

More users
→ more community activity
→ more content
→ more servers
→ more resources
→ more transactions
→ more reviews
→ more trust
→ more users.

==================================================
45. PRIVACY + TRUST BALANCE
===========================

MTA Market должен создавать доверие без превращения платформы
в систему массового наблюдения.

Trust должен строиться вокруг:

proof
+
verification
+
history
+
moderation

а не:

surveillance.

==================================================
46. PRODUCT RELATIONSHIP RULES
==============================

Every relationship must answer:

Why does this relationship exist?

What does it unlock?

Who controls visibility?

Who can modify it?

What happens when it is removed?

==================================================
47. SERVER → RESOURCE
======================

PRIVATE BY DEFAULT.

Only explicit owner opt-in makes it public.

Не использовать автоматическое отображение:

"This server uses these resources"

без согласия владельца.

==================================================
48. SERVER → NEWS
==================

Allowed.

Server owner controls publication.

==================================================
49. SERVER → COMMUNITY
=======================

Allowed.

Community may exist as server-centric space.

==================================================
50. SERVER → REVIEWS
=====================

Allowed.

Review requires eligible verified interaction where configured.

==================================================
51. RESOURCE → SELLER
======================

Required public relationship.

Users need to know who created/sells resource.

==================================================
52. RESOURCE → PURCHASE
========================

Internal/private relationship.

Public only through aggregate statistics.

==================================================
53. RESOURCE → LICENSE
=======================

Private buyer relationship.

Never publicly expose a buyer's license identifier.

==================================================
54. USER → SERVER
==================

Can represent:

Owner
Staff
Member
Follower

Each has different visibility.

==================================================
55. USER → RESOURCE
====================

Can represent:

Author
Seller
Buyer
Reviewer
Follower

==================================================
56. USER → COMMUNITY
=====================

Can represent:

Owner
Moderator
Member
Follower

==================================================
57. CONTENT → DISCUSSION
=========================

Optional.

Discussion should be attached where conversation adds value.

==================================================
58. SERVER → RESOURCE VISIBILITY EXAMPLE
=========================================

Owner chooses:

"Show resources used by this server"

OFF:

Visitors do not see the relationship.

ON:

Visitors may see:

"This server uses Advanced Inventory"

No information about private configuration is revealed.

==================================================
59. SERVER REVIEW EXAMPLE
=========================

Player enters server.

Server integration presents:

"Оставить отзыв"

Player opens MTA Market.

Token verifies interaction.

Player writes review.

Review receives:

✓ Verified interaction

Server does not automatically receive player's private identity details
unless policy explicitly allows it.

==================================================
60. RESOURCE REVIEW EXAMPLE
===========================

Buyer purchases resource.

Purchase becomes eligible for review.

Buyer reviews.

Review is connected to:

Buyer
+
Resource
+
Purchase

Public profile may show:

Verified Purchase

==================================================
61. DEAL EXAMPLE
================

Seller creates:

Custom resource
40 000 ₽

Buyer joins.

Buyer funds.

Funds are locked.

Seller delivers.

Buyer verifies.

Buyer confirms.

Deal completes.

Seller receives applicable payout.

Platform records:

transaction
+
reputation
+
audit.

==================================================
62. SERVER NEWS EXAMPLE
=======================

Server Owner publishes:

"Update 2.5"

The same News object may appear in:

Server Page
+
Global Feed
+
Follower Dashboard

Optional:

Discussion Thread

There should not be three independently maintained copies of the content.

==================================================
63. RESOURCE UPDATE EXAMPLE
===========================

Seller publishes:

v1.5

System:

creates version
→ validates
→ publishes
→ updates product

Existing eligible buyers receive notification.

License remains linked according to existing licensing policy.

==================================================
64. FAILURE MODEL
=================

Every important action must define:

SUCCESS
FAILURE
RETRY
CANCEL
TIMEOUT
DISPUTE

Especially:

- payment;
- deal;
- moderation;
- upload;
- review verification;
- license activation.

==================================================
65. AUDIT MODEL
===============

Audit significant state changes:

- seller approval;
- server verification;
- resource moderation;
- blacklist decision;
- deal resolution;
- payment correction;
- license revocation.

==================================================
66. PRODUCT INVARIANTS
======================

Invariant 1:

A user cannot publicly review a server without satisfying the review eligibility
policy.

Invariant 2:

A seller cannot self-publish a moderated resource.

Invariant 3:

A payment does not automatically imply a license until purchase conditions
are satisfied.

Invariant 4:

A purchase does not expose buyer identity publicly.

Invariant 5:

A server's private resource usage is never public without owner opt-in.

Invariant 6:

A revoked license cannot silently become active.

Invariant 7:

A completed guarantee deal cannot be settled twice.

Invariant 8:

Public metrics cannot be manually fabricated through client input.

==================================================
67. FUTURE EXTENSION
====================

This model must permit future:

- events;
- live server dashboards;
- advanced search;
- recommendations;
- creator analytics;
- subscriptions;
- bundles;
- wishlist;
- API/webhooks;
- MTA Market Manager;
- richer server communities.

But their absence does not make the core model incomplete.

==================================================
68. FINAL MODEL
===============

The complete conceptual graph:

                         MTA MARKET
                              │
                    ┌─────────┴─────────┐
                    │                   │
                  USER                COMMUNITY
                    │                   │
          ┌─────────┼──────────┐        │
          │         │          │        │
        SERVER    SELLER     PLAYER    FORUM
          │         │
          │      RESOURCE
          │         │
          │    PURCHASE
          │         │
          │      LICENSE
          │         │
          │        DRM
          │
       MONITORING
          │
       NEWS / COMMUNITY

                         TRUST
                           │
             ┌─────────────┼─────────────┐
             │             │             │
          REVIEWS        DEALS        REPUTATION
             │             │             │
         VERIFIED       GUARANTEE      BADGES
         INTERACTION      │
             │          DISPUTES
             │             │
             └────── BLACKLIST ──────────┘

CONTENT:
Article / News / Guide / Discussion

INFRASTRUCTURE:
Auth / Media / Payment / Ledger / License / DRM / Audit / Notifications

==================================================
69. FINAL RULE
==============

MTA Market развивается не от количества разделов.

Он развивается от качества связей между:

People
Servers
Community
Content
Resources
Deals
Trust
Identity

Каждая новая возможность должна усиливать хотя бы одну из этих связей.

Если она существует сама по себе и не усиливает ecosystem,
она не должна становиться приоритетом только потому, что технически
интересна.
