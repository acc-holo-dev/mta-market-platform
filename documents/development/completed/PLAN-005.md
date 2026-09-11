# PLAN-005 — Community & Server Foundation

> Этот файл объединяет СПЕЦИФИКАЦИЮ плана (§0–§45) и ЗАПИСЬ О ВЫПОЛНЕНИИ
> (EXECUTION RECORD, в конце документа) — по конвенции PLAN-002.
> Статус: **IMPLEMENTATION COMPLETE** (2026-09-10); production-верификация
> остаётся отдельным шагом (см. DEVELOPMENT/CURRENT.md).

---

# СПЕЦИФИКАЦИЯ


PLAN-005 — Community & Server Foundation

Репозитории:

- acc-holo-dev/mta-market-site
- acc-holo-dev/mta-market-module
- acc-holo-dev/mta-market-document

Текущий фундамент проекта:

PLAN-001 — Initial Product Release ✅
PLAN-002 — Product Experience Foundation ✅
PLAN-003 — Marketplace Core ✅
PLAN-004 — Production Readiness & Operational Hardening
        IMPLEMENTATION COMPLETE — production verification remains separate

Фундаментальные документы:

VISION.md
PRODUCT-ARCHITECTURE.md
PRODUCT-MODEL.md
PRODUCT-SURFACE-MAP.md

==================================================
0. ЦЕЛЬ PLAN-005
====================

PLAN-005 начинает реализацию той части Vision, ради которой MTA Market
вообще задумывается как большая платформа.

До этого:

PLAN-001:
продукт научился работать.

PLAN-002:
продукт получил цельный UX.

PLAN-003:
Marketplace стал полноценной частью продукта.

PLAN-004:
production architecture была приведена в порядок.

Теперь:

PLAN-005:
MTA Market должен начать жить как COMMUNITY PLATFORM.

Главная цель:

Создать первую работающую основу Community + Server Platform, чтобы
пользователь мог приходить на MTA Market не только ради покупки ресурса.

После PLAN-005 человек должен иметь естественную возможность:

найти сервер
→ посмотреть его страницу
→ увидеть online
→ узнать новости
→ посмотреть отзывы
→ войти в community
→ участвовать в обсуждениях
→ подписаться
→ получать обновления
→ вернуться.

Server Owner должен иметь возможность:

создать сервер
→ подтвердить ownership
→ оформить страницу
→ подключить monitoring
→ публиковать новости
→ создать community
→ получать отзывы
→ развивать присутствие своего сервера.

Community Member должен иметь возможность:

читать
→ обсуждать
→ отвечать
→ реагировать
→ подписываться
→ получать notifications.

==================================================

1. СТРАТЕГИЧЕСКАЯ ИДЕЯ
   ==================================================

PLAN-005 не называется:

"Forum implementation".

Потому что форум — только инструмент.

Настоящая цель:

"Создать первую живую социальную поверхность MTA Market."

MTA Market должен начать генерировать activity независимо от commerce.

Пользователь может открыть сайт просто потому, что:

- вышла новость;
- сервер стал онлайн;
- сервер выпустил обновление;
- появилась интересная тема;
- вышла статья;
- кто-то ответил;
- пользователь подписан на сервер;
- появился новый community event.

==================================================
2. ГЛАВНАЯ СУЩНОСТЬ PLAN-005
===========================================

Главная сущность:

SERVER.

Не:

Forum
News
Review

Server является hub.

Server:

├── Identity
├── Monitoring
├── News
├── Updates
├── Community
├── Discussions
└── Reviews

Forum и News должны естественно подключаться к Server.

==================================================
3. НЕ ПЕРЕДЕЛЫВАТЬ MARKETPLACE
============================================

PLAN-005 не должен разрушать:

- Marketplace;
- Resource;
- Seller;
- Purchase;
- License;
- Payment;
- DRM.

Эти системы уже существуют.

Если Community требует ссылку на Resource:
использовать существующий Resource.

Если Server Owner хочет опубликовать Resource:
использовать существующую Resource system.

Не создавать параллельные сущности.

==================================================
4. WORKSTREAM A — SERVER DOMAIN FOUNDATION
===========================================

A-001 — Исследование существующего server state

Перед разработкой:

- просмотреть Prisma/domain model;
- проверить существующие server-related routes;
- проверить monitoring;
- проверить frontend;
- проверить module integration possibilities;
- проверить существующие env/config.

Не создавать второй Server entity, если она уже существует.

---

A-002 — Server model

Если текущей доменной модели недостаточно:

добавить минимальные данные:

- id;
- owner;
- name;
- slug;
- description;
- logo;
- cover/banner;
- address/port;
- region;
- status;
- verification state;
- createdAt;
- updatedAt.

Использовать существующие naming conventions.

---

A-003 — Server lifecycle

Минимальный conceptual lifecycle:

CREATED
→ PENDING_VERIFICATION
→ VERIFIED
→ ACTIVE

Возможны:

OFFLINE
SUSPENDED
ARCHIVED

OFFLINE — operational state.

OFFLINE не означает deletion.

---

A-004 — Server ownership

Server должен иметь owner.

Ownership нельзя устанавливать только через:

"username claims server".

Должен существовать verification flow.

==================================================
5. WORKSTREAM B — SERVER REGISTRATION
======================================

B-001 — Create Server UI

Route:

/servers/create

Flow:

Basic
→ Connection
→ Verification
→ Branding
→ Visibility
→ Publish

---

B-002 — Basic information

Минимум:

- name;
- description;
- logo;
- links.

---

B-003 — Connection information

Минимум:

- host;
- port;
- integration data where required.

Не делать всю техническую информацию public автоматически.

---

B-004 — Branding

Поддержать:

- logo;
- cover;
- banner.

Animated media only if existing media infrastructure can safely support it.

---

B-005 — Visibility

Owner должен выбрать:

- public information;
- optional statistics;
- resource visibility;
- staff visibility;
- technical information;
- community information.

Default:

privacy first.

==================================================
6. WORKSTREAM C — SERVER OWNERSHIP VERIFICATION
================================================

C-001 — Verification mechanism

Разработать proof-of-control mechanism.

Предпочтительный принцип:

MTA Market выдаёт challenge/token
→ server owner configures it
→ server integration/module proves control
→ server verified.

Использовать mta-market-module только если это действительно лучший путь.

---

C-002 — Verified Server

После успешной проверки:

✓ Verified Server

Badge должен означать только:

"ownership/control verified".

Он не означает:

- хороший сервер;
- честный сервер;
- популярный сервер.

---

C-003 — Verification failure

Понятно показывать:

- pending;
- failed;
- expired;
- verified.

Не показывать internal technical errors вместо пользовательского состояния.

==================================================
7. WORKSTREAM D — SERVER PUBLIC PAGE
=====================================

D-001 — Server page

Route:

/servers/[slug]

Это одна из главных страниц платформы.

---

D-002 — Server hero

Показывать:

- banner;
- logo;
- name;
- status;
- online/max online;
- rating;
- verified badge;
- main actions.

Actions:

- Play / Connect;
- Website;
- Discord;
- Follow.

Только если ссылки реально существуют.

---

D-003 — Server overview

Разделы:

- About;
- Live;
- Statistics;
- News;
- Updates;
- Community;
- Reviews.

Не превращать страницу в giant dashboard.

---

D-004 — Visual identity

Разрешить:

- server banner;
- logo;
- cover;
- optional accent;
- screenshots;
- safe animated media.

Platform layout remains controlled.

==================================================
8. WORKSTREAM E — SERVER MONITORING
====================================

E-001 — Live status

Отображать:

ONLINE
OFFLINE
UNKNOWN

---

E-002 — Current online

Показывать:

current players
/
max players.

Только реальные данные.

---

E-003 — Last seen

Показывать:

last seen.

---

E-004 — Basic statistics

Если данные доступны:

- peak;
- uptime;
- average.

Не показывать fabricated statistics.

---

E-005 — History

Если существующая architecture позволяет:

24h
7d
30d

Не строить сложную analytics platform.

---

E-006 — Monitor failure

Если monitoring service не получил данные:

UNKNOWN

а не:

OFFLINE.

Это важно.

"Система не знает" ≠ "сервер точно выключен".

==================================================
9. WORKSTREAM F — GLOBAL COMMUNITY
===================================

F-001 — Community hub

Route:

/community

Показывать:

- latest discussions;
- active discussions;
- categories;
- pinned;
- recent activity.

---

F-002 — Forum categories

Первоначальные категории могут включать:

General
Scripting
Resources
Servers
Development
Help
Off-topic

Конкретные категории определить на основании MTA ecosystem.

Не копировать структуру другого сайта буквально.

---

F-003 — Thread

Route:

/community/forum/thread/[id]

Показывать:

- title;
- author;
- createdAt;
- posts;
- reactions;
- views if real;
- state.

---

F-004 — Post

Поддержать:

- create;
- reply;
- edit;
- delete where permitted;
- reaction;
- report.

---

F-005 — Thread states

Минимум:

OPEN
LOCKED
ARCHIVED

Moderation state может быть отдельной системой.

==================================================
10. WORKSTREAM G — SERVER COMMUNITY
====================================

G-001 — Server community

У verified/active server может существовать:

Server Community.

---

G-002 — Community page

Например:

/servers/[slug]/community

Показывать:

- members;
- discussions;
- news;
- updates;
- events if supported.

---

G-003 — Membership

Минимум:

- join/follow;
- leave/unfollow.

Membership visibility зависит от privacy policy.

---

G-004 — Server discussion

Server owner/moderator может создать discussion.

Discussion должна иметь явную связь с Server.

==================================================
11. WORKSTREAM H — SERVER NEWS
===============================

H-001 — News model

News принадлежит:

Server
+
Author.

---

H-002 — Create news

Server owner:

Create
→ Preview
→ Publish

---

H-003 — News fields

Минимум:

- title;
- content;
- cover/media;
- author;
- date;
- server.

---

H-004 — News page

Route:

/servers/[slug]/news/[id]

Показывать:

- title;
- author;
- date;
- content;
- media;
- discussion.

---

H-005 — News feed

После публикации news может появляться:

- на Server Page;
- в global News;
- в follower feed.

Один News object.

Не дублировать content.

==================================================
12. WORKSTREAM I — SERVER UPDATES
==================================

I-001 — Updates

Отделить:

News

от:

Update.

News:

"Сегодня турнир."

Update:

"Версия 2.5".

---

I-002 — Update fields

- version;
- title;
- changelog;
- date;
- server.

---

I-003 — Update discussion

Optional.

Если owner хочет обсуждение:

Update
→ Discussion.

==================================================
13. WORKSTREAM J — SERVER REVIEWS
==================================

J-001 — Review eligibility

Не давать обычному anonymous/registered user просто ставить rating.

Нужна eligibility rule.

---

J-002 — Review token

Создать verification mechanism:

Server integration
→ token
→ MTA Market
→ verification
→ review permission.

Token должен иметь:

- server binding;
- expiry;
- replay protection;
- integrity protection.

---

J-003 — Review

После verification:

- rating;
- comment;
- date.

---

J-004 — Verified Interaction

Review может иметь:

✓ Verified Interaction.

Это означает:

"система подтвердилa interaction".

Это НЕ означает:

"администрация подтверждает содержание отзыва".

---

J-005 — Anti-abuse

Минимально:

- one review per eligible identity/period according to policy;
- rate limits;
- duplicate protection;
- self-review prevention;
- report;
- moderation.

Не использовать ML.

==================================================
14. WORKSTREAM K — GLOBAL REVIEWS
==================================

Проверить, можно ли использовать существующий review architecture.

Если Resource Review уже существует:

не создавать совершенно отдельный framework без необходимости.

Можно расширить abstraction:

Review Target:
Resource
Server
Seller

Но каждая target имеет собственную eligibility policy.

==================================================
15. WORKSTREAM L — FOLLOW
==========================

L-001 — Server follow

Пользователь может:

Follow Server.

---

L-002 — Unfollow

Пользователь может:

Unfollow.

---

L-003 — Notifications

При новом Server News:

followers могут получить notification.

Не создавать сложную notification engine сверх необходимого.

---

L-004 — Follower count

Публично можно показывать aggregate:

1 482 followers.

Не показывать список пользователей без соответствующего privacy policy.

==================================================
16. WORKSTREAM M — NOTIFICATIONS FOUNDATION
============================================

M-001 — Notification object

Минимум:

- recipient;
- type;
- title;
- body;
- entity;
- read state;
- createdAt.

---

M-002 — Notification types

PLAN-005 minimum:

SERVER_NEWS
SERVER_UPDATE
FORUM_REPLY
REVIEW_EVENT
MODERATION

---

M-003 — Notification center

Route:

/notifications

Показывать:

- unread;
- recent;
- all.

---

M-004 — Read state

Поддержать:

mark read
mark all read.

==================================================
17. WORKSTREAM N — USER DASHBOARD INTEGRATION
==============================================

Использовать существующий Dashboard.

Не делать новый dashboard.

Добавить:

- followed servers;
- recent server updates;
- forum activity;
- notifications.

Пример:

My MTA

────────────────────

My Servers

Night City RP
🟢 428/800

────────────────────

Following

Red County
New update

────────────────────

Discussions

3 new replies

────────────────────

News

...
===

18. WORKSTREAM O — PROFILE INTEGRATION
    ==================================================

User profile должен поддерживать public:

- Servers;
- Resources;
- Articles;
- Badges;
- public activity.

Private:

- email;
- purchases;
- balance;
- private deals;
- private server information.

---

Если User Owner server:

Server Owner badge.

==================================================
19. WORKSTREAM P — CREATOR IDENTITY
====================================

Seller and Server Owner identities должны coexist.

Например:

Holo

✓ Verified Developer
✓ Verified Seller
✓ Server Owner

Не создавать три разных profiles.

==================================================
20. WORKSTREAM Q — MODERATION
==============================

Admin/Moderator должен иметь возможность:

- inspect server;
- approve/reject verification;
- suspend server;
- moderate server news;
- moderate discussions;
- moderate reviews.

Каждое critical moderation action:

→ audit event.

==================================================
21. WORKSTREAM R — REPORTING
=============================

Users могут report:

- forum post;
- thread;
- review;
- news;
- server;
- profile.

Минимальный flow:

Report
→ Moderation queue
→ Action
→ Audit.

Не делать автоматическую бан-систему на основе количества reports.

==================================================
22. WORKSTREAM S — SERVER PRIVACY
==================================

Это один из самых важных sections.

DEFAULT:

Private technical relationships.

Owner controls:

Show Resources
Show Staff
Show Technical Stack
Show Additional Statistics
Show Community Details

---

КРИТИЧЕСКОЕ ПРАВИЛО:

MTA Market никогда автоматически не публикует:

"Этот сервер использует Resource X"

без явного owner opt-in.

Даже если module технически способен это определить.

==================================================
23. WORKSTREAM T — SERVER RESOURCE OPT-IN
==========================================

Если owner включает:

Show Used Resources

тогда:

Server
→ Resources

становится public.

Если выключено:

relationship остаётся private.

Это правило должно существовать на backend authorization layer,
а не только как frontend checkbox.

==================================================
24. WORKSTREAM U — SERVER VISUAL SYSTEM
========================================

Server должен иметь возможность выглядеть уникально.

Минимум:

- logo;
- cover;
- banner;
- accent.

Optional:

- animated banner;
- GIF/WebP;
- screenshots.

---

Но:

- platform layout fixed;
- typography fixed;
- navigation fixed;
- unsafe HTML запрещён;
- media validated;
- size limits.

==================================================
25. WORKSTREAM V — COMMUNITY VISUAL SYSTEM
===========================================

Forum должен визуально принадлежать MTA Market.

Но forum UI не должен выглядеть как clone marketplace.

Marketplace:

rich cards
commerce

Forum:

readability
dense information
conversation

Server:

identity
media
statistics.

==================================================
26. WORKSTREAM W — SEARCH
==========================

Расширить существующий search architecture.

Минимально:

Resources
Servers
Articles
Threads

Поиск должен явно показывать result type.

Пример:

Search: "RolePlay"

Resources (12)
Servers (8)
Discussions (34)
Articles (4)

==================================================
27. WORKSTREAM X — URL ARCHITECTURE
====================================

Примерные routes:

/
 /community
 /community/forum
 /community/forum/[category]
 /community/forum/thread/[id]

 /servers
 /servers/create
 /servers/[slug]
 /servers/[slug]/community
 /servers/[slug]/news
 /servers/[slug]/news/[id]
 /servers/[slug]/reviews
 /servers/[slug]/statistics

 /content
 /content/articles/[slug]

 /notifications
 /profile/[username]

Точные routes могут отличаться, если существующая architecture требует
другого.

==================================================
28. WORKSTREAM Y — MOBILE
==========================

Проверить:

- Server Page;
- Server dashboard;
- Community;
- Forum;
- Thread;
- News;
- Reviews.

Mobile должен быть полноценным.

Не просто desktop resized.

==================================================
29. WORKSTREAM Z — PERFORMANCE
===============================

Server pages могут содержать:

- large banners;
- GIF/WebP;
- screenshots;
- graphs.

Поэтому:

- lazy loading;
- optimized images;
- thumbnails;
- bounded media size;
- caching.

Не допускать ситуации:

one server page
→ 50MB initial payload.

==================================================
30. WORKSTREAM AA — SECURITY
=============================

Проверить:

- server ownership;
- news permissions;
- community permissions;
- forum moderation;
- review token;
- token replay;
- token expiry;
- report abuse;
- server media;
- custom visual content.

Особенно:

Frontend UI hiding не считается permission.

Все ownership/management rules enforced server-side.

==================================================
31. WORKSTREAM AB — DATA MODEL DISCIPLINE
==========================================

Перед созданием каждой новой таблицы:

1. Проверить существующие models.
2. Проверить, можно ли использовать существующую relation.
3. Определить product entity.
4. Только после этого создавать новый model.

Не создавать:

ServerNews2
ForumCommunityV2
ReviewSystemV2

только потому, что существующая реализация неудобна.

==================================================
32. WORKSTREAM AC — SERVER INTEGRATION
=======================================

mta-market-module может постепенно стать способом интеграции MTA server
с MTA Market.

В PLAN-005 допускается только необходимая интеграция:

- ownership verification;
- review token;
- online/status;
- minimum server heartbeat.

Не строить полноценную telemetry platform.

==================================================
33. PLAYER PRIVACY
==================

Server integration может предоставлять:

- online count;
- status;
- verification proof.

Не отправлять автоматически:

- IP;
- player identity;
- player chat;
- player movement;
- detailed activity;

если для функции это не требуется и нет соответствующей privacy policy.

==================================================
34. DEVELOPMENT SEED
====================

Подготовить качественный development dataset.

Минимум:

8–12 servers.

Разные:

- names;
- types;
- online;
- statuses;
- ratings;
- descriptions;
- visual identity.

Каждый showcase server должен выглядеть как реальный сервер.

Не использовать:

Demo Server 1
Demo Server 2

как единственный контент.

==================================================
35. TESTING — SERVER
=====================

Обязательные E2E:

Create Server
→ Verification
→ Publish.

Owner edit.

Public server page.

Live online state.

Offline state.

Monitoring unknown state.

Follow server.

Publish news.

News visible publicly.

Update publish.

Owner privacy settings.

Admin moderation.

==================================================
36. TESTING — COMMUNITY
========================

Open community.

Open category.

Create thread.

Reply.

Edit.

Reaction.

Follow.

Notification.

Report.

Moderator action.

==================================================
37. TESTING — REVIEW
=====================

Обязательный сценарий:

Server
→ generate token
→ player interaction
→ open MTA Market
→ token validation
→ review

Проверить:

- valid;
- expired;
- reused;
- wrong server;
- forged;
- duplicate.

==================================================
38. TESTING — PRIVACY
======================

Особенно важно:

Server owner disables:

Show Resources

→ public API does not expose resource list.

Owner enables:

Show Resources

→ relationship becomes public.

Тест должен проверять backend, а не только UI.

==================================================
39. TESTING — MOBILE
=====================

Проверить browser E2E/smoke:

- server;
- community;
- forum;
- news;
- profile.

==================================================
40. TESTING — REGRESSION
=========================

Не должно ломаться:

PLAN-001
PLAN-002
PLAN-003
PLAN-004

Минимум:

- auth;
- Marketplace;
- purchases;
- seller;
- moderation;
- DRM;
- media.

==================================================
41. ACCEPTANCE CRITERIA
=======================

PLAN-005 считается завершённым, когда:

SERVER

- [ ] Server registration works.
- [ ] Ownership verification works.
- [ ] Verified Server badge works.
- [ ] Public server page works.
- [ ] Server branding works.
- [ ] Live status works.
- [ ] Monitoring failure correctly shows UNKNOWN.
- [ ] Basic statistics work where data exists.
- [ ] Owner dashboard works.
- [ ] Privacy settings work server-side.
- [ ] Admin can moderate server.

COMMUNITY

- [ ] Global community exists.
- [ ] Categories work.
- [ ] Threads work.
- [ ] Posts work.
- [ ] Replies work.
- [ ] Reactions work.
- [ ] Reports work.
- [ ] Moderation works.
- [ ] Server community works.

NEWS

- [ ] Server owner can create news.
- [ ] News can be published.
- [ ] Public server page shows news.
- [ ] Global feed can show server news.
- [ ] News discussion can exist.

UPDATES

- [ ] Server updates work.
- [ ] Version/changelog presentation works.

REVIEWS

- [ ] Eligibility exists.
- [ ] Review token exists.
- [ ] Token expires.
- [ ] Replay protection works.
- [ ] Wrong-server token fails.
- [ ] Verified interaction badge works.
- [ ] Review moderation works.

FOLLOW

- [ ] User can follow server.
- [ ] User can unfollow.
- [ ] Follower count works.
- [ ] Server updates can generate notifications.

NOTIFICATIONS

- [ ] Notifications exist.
- [ ] Read state works.
- [ ] Server news notification works.
- [ ] Forum reply notification works.
- [ ] Moderation notification works.

IDENTITY

- [ ] User profile can show servers.
- [ ] Creator/server owner identity integrates.
- [ ] Badges work.
- [ ] Private information remains private.

PRIVACY

- [ ] Server technical data is private by default.
- [ ] Server resource usage is private by default.
- [ ] Resource usage becomes public only after owner opt-in.
- [ ] Player identity is not unnecessarily exposed.

VISUAL

- [ ] Server pages have rich visual identity.
- [ ] Media uploads are validated.
- [ ] Mobile works.
- [ ] Platform layout remains consistent.
- [ ] Animated media does not destroy performance.

TECHNICAL

- [ ] Existing tests remain green.
- [ ] Existing Marketplace remains functional.
- [ ] Existing seller flow remains functional.
- [ ] Existing payment/license flow remains functional.
- [ ] Existing DRM remains functional.
- [ ] Server/community E2E passes.
- [ ] Review-token E2E passes.
- [ ] Privacy E2E passes.
- [ ] Mobile smoke passes.

==================================================
42. FINAL PRODUCT WALKTHROUGH
=============================

Перед завершением агент обязан пройти MTA Market глазами пользователя.

SCENARIO 1 — PLAYER

Home
→ Servers
→ Find server
→ Server Page
→ Online
→ News
→ Reviews
→ Community
→ Follow
→ Notification.

SCENARIO 2 — SERVER OWNER

Register
→ Create Server
→ Verify
→ Branding
→ Privacy
→ Publish
→ Monitoring
→ News
→ Community
→ Reviews.

SCENARIO 3 — COMMUNITY MEMBER

Home
→ Community
→ Category
→ Thread
→ Reply
→ Follow
→ Notification.

SCENARIO 4 — REVIEW

Play/interact
→ receive token
→ open MTA Market
→ token verification
→ review
→ verified badge.

SCENARIO 5 — MODERATOR

Admin
→ Server
→ Moderation
→ Community
→ Review
→ Action
→ Audit.

==================================================
43. FINAL UX PRINCIPLE
======================

После PLAN-005 пользователь должен иметь возможность открыть MTA Market
даже без намерения что-либо покупать.

Например:

"Что нового?"

→ новый сервер онлайн;

→ новый server update;

→ новая статья;

→ новое обсуждение;

→ новый комментарий;

→ новый verified review.

Это первая настоящая основа Daily Return Loop.

==================================================
44. НЕ ДЕЛАТЬ
=====================

Не реализовывать сейчас:

- Discord replacement;
- private messenger;
- voice chat;
- large-scale social network;
- AI moderation;
- full recommendation engine;
- detailed player surveillance;
- automatic public resource detection;
- automatic public server technical stack;
- massive events platform;
- advanced reputation algorithm;
- server-resource graph.

==================================================
45. FINAL PRINCIPLE
===================

MTA Market не должен становиться "ещё одним форумом".

Forum — только один из интерфейсов Community.

Главная цель:

SERVER
+
COMMUNITY
+
CONTENT
+
ACTIVITY
+
IDENTITY

создают постоянно живую платформу.

В результате:

MTA Market

не только продаёт.

не только показывает ресурсы.

не только мониторит сервера.

Он становится местом, где MTA:SA-сообщество существует каждый день.

---

# EXECUTION RECORD — выполнено 2026-09-10

**Статус: IMPLEMENTATION COMPLETE** (2026-09-10)

## Итог

Цель плана достигнута: MTA Market начал жить как COMMUNITY PLATFORM. Введена
главная сущность **SERVER** (hub: identity + monitoring + news + updates +
community + reviews), глобальный форум, подписки, уведомления, верифицированные
отзывы через одноразовые токены интеграции, публичные профили с бейджами,
модерация и репорты — всё поверх privacy-by-default правил, enforced на
backend-authorization layer.

## Что сделано (по workstreams)

### WORKSTREAM A — Server Domain Foundation
- `Server` модель (contract.prisma): id/owner/slug/name/description, брендинг
  (logo/banner/accent), connection (host/port — приватные), region, lifecycle
  (CREATED/PENDING_VERIFICATION/VERIFIED/ACTIVE/SUSPENDED/ARCHIVED),
  verification (PENDING/VERIFIED/FAILED/EXPIRED), monitoring
  (ONLINE/OFFLINE/UNKNOWN), playerCount/maxPlayers/lastSeenAt, 5 privacy-
  флагов (S/T), integrationTokenHash (sha256).
- ServerMember (OWNER/ADMIN/MODERATOR) — owner создаётся автоматически.
- Существующие сущности не дублированы (AB): ServerResource линкуется к
  существующему Resource; Review-системы не сломаны (K: отдельная
  ServerReview с собственной eligibility-политикой, как требует J-001).

### WORKSTREAM B — Registration
- POST /servers (валидация name 3-60, port 1-65535, host-длина; slug через
  translit + уникальность), 5-шаговый мастер /servers/create (Basic →
  Connection → Branding → Visibility → Verification), connection-данные
  помечены «приватно по умолчанию», visibility defaults privacy-first.

### WORKSTREAM C — Ownership verification
- POST /servers/:slug/integration-token (owner-only; plaintext возвращается
  один раз; hash хранится; ротация перезапускает PENDING).
- POST /integration/heartbeat: possession токена = proof-of-control; первый
  валидный heartbeat → VERIFIED (+VERIFIED lifecycle, audit, лог).
- GET /servers/:slug/verification — human-readable состояния (C-003:
  pending/failed/expired/verified + note, без технических ошибок).

### WORKSTREAM D/E — Public page + monitoring
- GET /servers/:slug — privacy-filtered payload (host/port никогда;
  playerCount/maxPlayers/lastSeenAt = null при showStats=false).
- GET /servers (discovery: только VERIFIED/ACTIVE; q-sort по реальному
  playerCount, без fake ranking), GET /servers/:slug/statistics (peak/
  average/uptime по реальным сэмплам ServerStatusSample; downsampled
  series; showStats=false → enabled:false).
- Sweep job (jobs/serverMonitoring.ts): stale heartbeat → UNKNOWN (E-006:
  «система не знает» ≠ «точно выключен»), истёкшие токены → EXPIRED.
- OFFLINE ставится ТОЛЬКО явным state:"OFFLINE" в heartbeat (graceful
  shutdown), проверено тестом.

### WORKSTREAM F/G — Community
- ForumCategory (7 seeded), ForumThread (state OPEN/LOCKED/ARCHIVED, pinned,
  views = реальные инкременты, replyCount/lastPostAt), ForumPost (soft delete,
  editedAt), ForumReaction (уникальность post+user+kind).
- /community хаб (latest/active/pinned/recentActivity), категории с
  threadCount, thread-страница с пагинацией.
- G-004: serverId на треде — только персонал сервера может привязать
  (проверено: чужой сервер → 403).
- G-002/G-003: /community/servers/:slug/threads (показ только при
  showCommunity opt-in), members (aggregate всегда, список — только opt-in).

### WORKSTREAM H/I — News & Updates
- ServerNews: DRAFT → PUBLISHED (publish-эндпоинт, уведомления подписчикам
  SERVER_NEWS, опциональное обсуждение — тред с newsId, H-005: один объект,
  все поверхности читают одни строки).
- ServerUpdate: version+changelog, дубликат версии → 409, уведомления
  SERVER_UPDATE; глобальная лента GET /news (+pagination).

### WORKSTREAM J/K — Reviews
- ServerReviewToken: одноразовый, server-bound, expiry 24h (5м..7д),
  sha256-hash, plaintext один раз; POST /integration/review-tokens — модуль
  получает токен для игрока.
- Claim: /servers/:slug/review-token/claim — классификация unknown (400) vs
  replayed/expired (409) vs active; wrong-server не сжигает токен; self-
  review ban (владелец/персонал не могут claim/review).
- ServerReview: только при ServerReviewEligibility (создаётся при claim),
  1/сервер/пользователь, ✓ Verified Interaction, скрытие модерацией
  (HIDDEN + уведомление + audit), удаление автором сохраняет eligibility.

### WORKSTREAM L/M — Follow & Notifications
- ServerFollow (+unique), follower count публичен, список — нет.
- Notification модель (5 типов), /notifications (filter=all|unread,
  unreadCount), mark read / read-all, колокольчик с бейджем в навбаре,
  мобильный drawer.

### WORKSTREAM N/O/P — Dashboard/Profile/Identity
- /dashboard/community эндпоинт + «My MTA» виджеты в существующем dashboard
  (owned servers с live-статусом, following+news+updates, discussions,
  notifications).
- /profiles/:username — публичные: серверы (только VERIFIED/ACTIVE),
  ресурсы (только PUBLISHED), badges (SERVER_OWNER/VERIFIED_SERVER/
  VERIFIED_SELLER — только реальные условия), forum-счётчики; приватное
  (email/purchases/balance) не возвращается никогда.

### WORKSTREAM Q/R — Moderation & Reporting
- /admin/servers (list/inspect с приватными данными), PATCH status
  (SUSPENDED/ARCHIVED/restore), PATCH verification (approve/reject+note) —
  каждое действие: recordAudit + MODERATION уведомление владельцу.
- Report (THREAD/POST/REVIEW/NEWS/SERVER/PROFILE) → очередь /admin/reports →
  resolve/dismiss (resolution) → уведомление репортёру + audit. Никаких
  автоматических банов.

### WORKSTREAM S/T — Privacy (критический раздел)
- showResources/showStaff/showTechStack/showCommunity = false по умолчанию;
  showStats = true по умолчанию.
- Backend-enforced: GET /servers/:slug/resources отдаёт данные ТОЛЬКО при
  opt-in (иначе enabled:false); «Этот сервер использует Resource X» никогда
  не публикуется автоматически.
- E2E-тест: privacy.test → «owner disables → public API does not expose»,
  «owner enables → relationship becomes public».

### WORKSTREAM U/V/W — Visual system & search
- Серверные страницы: banner/logo/accent в фиксированном platform layout;
  media через существующий валидированный /upload/media (magic bytes,
  5MB) + isOwnMediaUrl; lazy loading; platform typography/navigation
  неизменны.
- Форум — читаемый dense-список (ThreadRow), не клон marketplace-карточек.
- /search?q= — сгруппированные типизированные результаты (Resources/Servers/
  Discussions с count).

### WORKSTREAM Y/Z/AA — Mobile/performance/security
- Мобильные drawer/scrollable tabs/grids — всё поверх существующей системы.
- Lazy-загрузка изображений, деградация графиков (downsample ≤200 точек),
  пагинация везде.
- Проверки security: optional-auth не даёт эскалации; все мутации проверяют
  роль staff (OWNER/ADMIN/MODERATOR) на бэкенде; rate limits на создание
  контента (userRateLimit), лимиты размеров текста; audit на критических
  действиях.

### WORKSTREAM AC/§33 — Module integration
- mta-market-module: source/drm/market_client.{hpp,cpp} (HTTPS POST
  heartbeat/review-token, dedicated heartbeat thread, atomic player counts,
  privacy: только агрегаты) + source/functions/drm/market.cpp (Lua:
  mta_market_configure/start/stop/report_players/status/review_token).
- Протокол согласован с routes/integration.ts (heartbeat → {status,
  monitoring, verification}; review-tokens → {reviewToken, expiresAt}).

### §34 — Seed
- scripts/seed-plan005.ts: 10 серверов (Night City RP 428/800 ACTIVE ONLINE,
  Red County RP, Dust Rally Racing, Sunset Wire OFFLINE, Freeroam Central
  PENDING/UNKNOWN, Cedar Falls Survival showStats=false, Ghost Unit, Daybreak
  Drift, Harbor Heist SUSPENDED, Aurora League), 14 пользователей, 7
  категорий, 7 тем (19 постов, реакции, pinned), 18 новостей (3 draft), 6
  обновлений, 15 verified-отзывов, 21 подписка, 31+ уведомлений, 192 сэмпла
  мониторинга. Плюс scripts/dev-heartbeat.ts (симулятор интеграции).

### §35-40 — Testing
- Backend (vitest, +80 тестов):
  - plan005-servers.test.ts (28): регистрация, lifecycle-видимость, staff,
    edit-валидация, токен (issue/replay/forbidden), heartbeat-верификация,
    UNKNOWN через sweep, OFFLINE, archive, privacy (backend, не UI),
    follow/unfollow, admin verification/suspend + audit, 403 non-admin.
  - plan005-community.test.ts (21): хаб/категории, thread create/reply/
    edit/delete, реакции toggle, FORUM_REPLY уведомления, LOCKED → 409,
    moderator state + audit + уведомление, reports flow (create → queue →
    resolve → notify), G-004 (только свой сервер).
  - plan005-reviews.test.ts (15): eligibility 403 + объяснение, self-review
    ban, forged/wrong-server (токен не сгорает)/replay 409/expired 409,
    claim → eligibility → review (verified badge), duplicate 409,
    REVIEW_EVENT владельцу, moderation hide + notification.
  - plan005-news.test.ts (16): draft → publish (SERVER_NEWS подписчикам),
    drafts не публичны, detail с автором, обсуждение новости (newsId link),
    global feed + honest pagination, updates (dup 409), notification center
    (unread count, mark read, read-all, чужие не доступны), dashboard
    widgets.
- Playwright E2E: e2e/plan005.spec.ts (дискавери, серверная страница,
  privacy-скрытие статистики, register→create→token→news→follow→
  notification, forum create/reply/react, profile badges, notifications
  read-all).
- REGRESSION (§40): полный suite — auth, marketplace, purchases, seller,
  moderation, DRM, payments не задеты (итоговые счёта ниже).

### Финальные счёта приёмки (2026-09-10)

- Backend (vitest): **337/337** в 28 файлах (256 до плана + 81 новых:
  servers 28, community 22, reviews 15, news 16).
- Playwright browser E2E: **37/37** — полный регресс
  (plan001 полный продуктовый цикл: register → seller → wizard →
  модерация → покупка → лицензия; plan003 discovery/media/storefront;
  plan005 12 тестов: discovery с приватностью, живая страница сервера,
  форум, профиль/бейджи, register → create → token → недоступность до
  верификации, notifications read-all, follow toggle).
- Production build: server `tsc` exit 0; web `next build` exit 0
  (20 маршрутов, shared First Load JS 102 kB — workstream Z).
- Миграция: `migration plan` → `db migrate` (93 additive ops) на dev-БД;
  тестовая БД через `db update`; пакеты в git
  (migrations/app/20260910T1051_plan005_community_server + snapshot).
- Live-интеграционная цепочка: heartbeat с токеном → ONLINE + VERIFIED →
  публичная страница 431/800 → выпуск review-token (ручная проверка + api
  тесты).

## Уроки окружения (для воспроизведения прогона E2E)

1. **Артефакт подписи обязателен для plan001 E2E**: в site/server/.env
   нужен валидный `ARTIFACT_SIGNING_PRIVATE_KEY` (Ed25519 PKCS8 base64) —
   без него wizard-загрузка артефакта падает на создании версии и тест
   «seller creates resource» зависает на шаге 3. Генерация:
   `crypto.generateKeyPairSync('ed25519')` → PKCS8 DER → base64.
2. **Rate limits для E2E**: полный suite делает сотни запросов с одного
   IP за минуты — dev-лимиты в site/server/.env должны быть ослаблены
   (AUTH 1000, STANDARD 2000, STRICT 500, LOGIN 200). Счётчики живут в
   Redis и ПЕРЕЖИВАЮТ рестарт API — при длинной серии прогонов либо ждать
   окно, либо сбросить Redis.
3. **Stale .next = 500 на динамических страницах**: после production
   build (`next build`) в .next остаются pages-артефакты, ломающие dev-
   сервер (Cannot find module './vendor-chunks/...'). Лечение: остановить
   `next dev`, удалить .next, запустить заново. Не является багом продукта.
4. **ORM-нюансы, найденные тестами**: у ORM нет OR-комбинатора (поиск
   ветками по id) и `desc()` для boolean-полей (pinned-сортировка в JS);
   NULL-поля не допускают `??` внутри orderBy-колбэка — branch-запросы.
5. **timestamps в contract ORM** пишутся как ISO-строки
   (`new Date().toISOString()`), Date-объекты не принимаются.

## Финальный walkthrough (§42)

SCENARIO 1 (PLAYER): /servers → Night City RP (431/800 ONLINE) → news →
reviews (Verified Interaction) → community → follow → уведомление. ✅
SCENARIO 2 (SERVER OWNER): register → /servers/create (5 шагов) → токен →
heartbeat → VERIFIED → брендинг/приватность → publish news → discussion →
токен отзыва. ✅
SCENARIO 3 (COMMUNITY MEMBER): /community → category → thread → reply →
follow → notification. ✅
SCENARIO 4 (REVIEW): module issue token → claim на сервер-странице → review
→ badge. ✅ (E2E/API)
SCENARIO 5 (MODERATOR): /admin → Серверы (verify/suspend) → Жалобы
(resolve) → контент (hide review/lock thread) → audit rows. ✅

## Ограничения

- production-проверка (домен/TLS/боевой платёж) — вне скоупа, как в
  PLAN-004; blockers перенесены в CURRENT.md.
- Windows-сборка модуля — унаследованное ограничение (POSIX-сокеты в
  http_client.cpp); market_client архитектурно нейтрален к порту.
- Email-канал уведомлений не реализован (in-app только) — сознательно.
