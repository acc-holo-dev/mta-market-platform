
DAILY-EXPERIENCE.md — MTA Market Daily Experience Model

STATUS: PRODUCT DESIGN
TYPE: DAILY EXPERIENCE MODEL
PURPOSE: DEFINE USER RETURN LOOP

==================================================
1. ОСНОВНАЯ ИДЕЯ
==================================================

MTA Market должен быть полезен даже тогда, когда пользователь ничего
не покупает и ничего не продаёт.

Главная причина возвращения:

"Что нового происходит в MTA?"

Пользователь открывает MTA Market не ради конкретного раздела.

Он открывает:

MTA MARKET
→ чтобы увидеть жизнь экосистемы.

==================================================
2. ПЕРВЫЕ 30 СЕКУНД
==================================================

При открытии Home пользователь должен быстро понять:

1. Что сейчас происходит.
2. Какие серверы активны.
3. Какие новости вышли.
4. Что обсуждают.
5. Какие ресурсы/создатели активны.

Главный визуальный вопрос Home:

"Что происходит прямо сейчас?"

Не:

"Что мы можем тебе продать?"

==================================================
3. HOME — ЖИВАЯ ЛЕНТА
==================================================

Home должна содержать смесь:

LIVE
NEWS
COMMUNITY
SERVERS
CREATORS
RESOURCES

Например:

--------------------------------------------------
СЕЙЧАС В MTA
--------------------------------------------------

🟢 1 842 игрока онлайн
🟢 214 серверов онлайн

--------------------------------------------------
АКТИВНОСТЬ
--------------------------------------------------

Night City RP
→ выпустил обновление 2.5

Holo
→ выпустил Advanced Inventory 1.4

Обсуждение:
"Какой framework выбрать?"

Новая статья:
"Оптимизация MTA сервера"

Новый сервер:
"City Life RP"

--------------------------------------------------
ПОПУЛЯРНОЕ
--------------------------------------------------

Top Servers
Top Resources
Hot Discussions
Popular Creators
--------------------------------------------------

Home должен быть живым.

Не перегруженным.

==================================================
4. LIVE LAYER
==================================================

В платформе должен существовать ощущаемый слой:

LIVE

Он может отображать:

- серверы online;
- players online;
- новые releases;
- новые updates;
- активные discussions;
- recent activity.

Главное:

не превращать это в Twitch.

Это быстрый сигнал:

"что происходит сейчас".

==================================================
5. УТРЕННИЙ СЦЕНАРИЙ
==================================================

Пользователь открывает MTA Market утром.

Он видит:

"За ночь"

- 4 новых server updates;
- 2 новых resources;
- 3 интересных обсуждения;
- 1 новая статья;
- 6 серверов сейчас online.

Пользователь может открыть интересующее.

Не требовать полного просмотра.

==================================================
6. ВЕЧЕРНИЙ СЦЕНАРИЙ
==================================================

Вечером активность меняется.

Home может показывать:

- больше online servers;
- активные discussions;
- новые community posts;
- creator activity;
- server news.

Но это не означает, что нужен time-based personalization engine.

Сначала всё основано на реальной активности.

==================================================
7. PLAYER LOOP
==================================================

PLAYER

Home
↓
Servers
↓
Server Page
↓
Live
↓
Reviews
↓
Community
↓
Follow
↓
Return

После Follow:

Server Update
↓
Notification
↓
Server Page
↓
Community
↓
Return

==================================================
8. SERVER OWNER LOOP
==================================================

SERVER OWNER

Dashboard
↓
Server activity
↓
Publish News
↓
Followers notified
↓
Community discussion
↓
Reviews
↓
More activity
↓
Return

Главная ценность:

владелец получает собственное публичное пространство внутри MTA Market.

==================================================
9. CREATOR LOOP
==================================================

CREATOR

Create Resource
↓
Publish
↓
Marketplace
↓
Creator Profile
↓
Reviews
↓
Sales
↓
Update
↓
Notification
↓
Return

В будущем Creator может также публиковать:

- articles;
- updates;
- devlogs.

==================================================
10. COMMUNITY LOOP
==================================================

MEMBER

Read
↓
Discussion
↓
Reply
↓
Reaction
↓
Follow
↓
Notification
↓
Return

Главное:

обсуждение должно давать причину вернуться.

==================================================
11. CONTENT LOOP
==================================================

Article
↓
Reader
↓
Discussion
↓
Creator
↓
Resource / Server
↓
Follow
↓
Return

Контент должен быть частью ecosystem discovery.

==================================================
12. MARKET LOOP
==================================================

Resource
↓
Discovery
↓
Product Page
↓
Seller
↓
Reviews
↓
Purchase
↓
License
↓
Update
↓
Review
↓
Return

Marketplace остаётся частью daily experience,
а не всей платформой.

==================================================
13. SERVER LOOP
==================================================

Server:

Online
↓
Visible
↓
Players arrive
↓
News
↓
Community
↓
Reviews
↓
Followers
↓
Update
↓
Online again

Server должен постоянно генерировать новые причины для взаимодействия.

==================================================
14. NOTIFICATION LOOP
==================================================

Notification не должна быть просто:

"У тебя уведомление".

Она должна отвечать:

Что произошло?
Почему мне это важно?
Что я могу сделать?

Пример:

"Night City RP выпустил обновление 2.5"

→ [Открыть]

==================================================
15. PERSONAL DASHBOARD
==================================================

Dashboard после login:

MY MTA

--------------------------------------------------
Сейчас
--------------------------------------------------

3 новых уведомления

--------------------------------------------------
Мои серверы
--------------------------------------------------

Night City RP
🟢 428/800

--------------------------------------------------
Избранное / Following
--------------------------------------------------

2 обновления

--------------------------------------------------
Обсуждения
--------------------------------------------------

3 новых ответа

--------------------------------------------------
Покупки
--------------------------------------------------

1 новый update

--------------------------------------------------
Новости
--------------------------------------------------

...

Dashboard должен быть персональным входом
в экосистему.

==================================================
16. FOLLOW MODEL
==================================================

В будущем пользователь может follow:

- Server;
- Creator;
- Resource;
- Thread;
- Community.

Но порядок реализации:

1. Server
2. Creator
3. Resource
4. Thread
5. Community

Не реализовывать всё одновременно без необходимости.

==================================================
17. ACTIVITY MODEL
==================================================

Activity является derived layer.

Не самостоятельным источником истины.

Источники:

Server
→ status/update/news

Resource
→ release/update/sale

Creator
→ publication

Forum
→ thread/reply

Article
→ publication

Review
→ review

Activity агрегируется.

Каждый Activity item должен ссылаться
на конкретную реальную сущность.

==================================================
18. ACTIVITY TYPES
==================================================

Минимально:

SERVER_ONLINE
SERVER_UPDATE
SERVER_NEWS
NEW_SERVER

RESOURCE_RELEASE
RESOURCE_UPDATE

CREATOR_PUBLICATION

NEW_DISCUSSION
DISCUSSION_REPLY

NEW_ARTICLE
NEW_REVIEW

Не создавать десятки activity types заранее.

==================================================
19. ACTIVITY RANKING
==================================================

На первом этапе:

chronological + deterministic prioritization.

Не использовать ML.

Не пытаться создать TikTok-like ranking.

Можно иметь:

Latest
Popular
Trending

только если для них существует реальная metric.

==================================================
20. TRENDING
==================================================

Trending может позже учитывать:

- growth;
- interaction;
- sales;
- views;
- comments;
- online growth.

Но не создавать fake trending.

==================================================
21. GLOBAL FEED
==================================================

Potential route:

/activity
или
/feed

Feed может показывать:

- server updates;
- new resources;
- articles;
- discussions;
- creator activity;
- community activity.

Но Home и Feed не обязаны быть одинаковыми.

Home:

curated/high-value snapshot.

Feed:

continuous activity.

==================================================
22. "WHAT'S HAPPENING"
==================================================

Одна из потенциально ключевых UI surfaces:

"Что происходит в MTA"

Она может объединять:

LIVE
NEWS
DISCUSSIONS
SERVERS
CREATORS
RESOURCES

Пример:

--------------------------------------------------
Что происходит

🟢 Night City RP — 428 online
📰 Update 2.5
💬 28 новых сообщений в "Lua"
🆕 Advanced Inventory 1.4
🎮 City Life RP запустился
⭐ Новый отзыв сервера
--------------------------------------------------

Это может стать узнаваемым элементом MTA Market.

==================================================
23. TODAY IN MTA
==================================================

Потенциальная ежедневная surface:

Сегодня в MTA

- серверов онлайн;
- новых серверов;
- новых ресурсов;
- новых обновлений;
- популярных обсуждений;
- новых статей.

Это может появиться позже.

Не обязано входить в ближайший план.

==================================================
24. SERVER FOLLOWING
==================================================

После Follow:

Server
→ follower list count
→ activity appears in Dashboard
→ updates produce notifications.

Не раскрывать follower identities
без соответствующей privacy policy.

==================================================
25. CREATOR FOLLOWING
==================================================

Позже:

Creator
→ new resource
→ update
→ publication

Followers receive relevant notifications.

==================================================
26. RESOURCE FOLLOWING
==================================================

Позже:

Resource
→ new version
→ update notification.

Для покупателя это особенно важно,
но покупка уже сама создаёт relationship.

Follow — отдельная, необязательная relationship.

==================================================
27. RETURN WITHOUT NOTIFICATIONS
==================================================

Пользователь должен иметь причину вернуться даже без уведомлений.

Например:

- текущие online servers;
- trending discussions;
- new content;
- new resources;
- live activity.

Notification не должна быть единственным retention mechanism.

==================================================
28. RETURN THROUGH NOTIFICATIONS
==================================================

Notification → Deep Link

Server update
→ Server Page

Forum reply
→ Thread

Resource update
→ Resource Page

Review event
→ Review

Deal event
→ Deal Room

Это делает notification полезной.

==================================================
29. FIRST VISIT EXPERIENCE
==================================================

Guest должен получить:

- understanding of platform;
- discoverability;
- visible community;
- visible servers;
- visible content;
- visible marketplace.

Не требовать регистрации до просмотра основной информации.

==================================================
30. REGISTRATION MOMENT
==================================================

Регистрация должна открывать:

- Follow;
- Reviews;
- Forum interaction;
- purchases;
- seller;
- server management.

То есть:

Guest
→ discover
→ value
→ register

Не:

register
→ maybe there is value.

==================================================
31. SERVER OWNER ACQUISITION
==================================================

Server Owner должен понимать:

"Зачем мне регистрировать сервер?"

Ответ:

- public page;
- live online;
- statistics;
- news;
- community;
- reviews;
- followers;
- identity.

Позже:

- advanced analytics;
- promotions;
- monetization;
- integrations.

==================================================
32. CREATOR ACQUISITION
==================================================

Creator должен понимать:

"Зачем мне публиковаться здесь?"

Ответ:

- audience;
- marketplace;
- reputation;
- profile;
- sales;
- updates;
- trust.

==================================================
33. PLAYER ACQUISITION
==================================================

Player должен понимать:

"Зачем мне этот сайт?"

Ответ:

- найти server;
- узнать online;
- прочитать reviews;
- следить за сервером;
- читать новости;
- участвовать в community.

==================================================
34. COMMUNITY MEMBER ACQUISITION
==================================================

Community Member:

"Зачем мне писать здесь?"

Ответ:

- audience;
- discussions;
- knowledge;
- reputation;
- creator/server discovery.

==================================================
35. DAILY EXPERIENCE — EXAMPLE
==================================================

ПОНЕДЕЛЬНИК 18:40

User opens:

MTA Market

Home:

1 842 players online.

Top servers:

Night City RP — 428/800
Red County — 301/500
City Life — 212/400

Activity:

Night City RP posted update 2.5.

Community:

"Какой inventory лучше для RP?"

Resource:

Advanced Inventory 1.4 released.

User:

opens discussion
→ replies
→ opens server
→ follows
→ leaves.

==================================================
36. TUESDAY
==================================================

User receives:

"Night City RP: Update 2.5"

User opens notification.

Reads update.

Sees:

new discussion.

Participates.

Then:

new creator resource.

The user returns again.

==================================================
37. WEEKLY EXPERIENCE
==================================================

За неделю пользователь должен естественно
встретить:

- новые servers;
- updates;
- resources;
- articles;
- discussions;
- community members.

При этом необязательно получать все элементы одновременно.

==================================================
38. PLATFORM HEALTH
==================================================

Если:

No users
→ no activity.

No servers
→ no live.

No creators
→ no resources.

No community
→ no discussions.

Поэтому platform growth должен быть staged.

==================================================
39. EARLY STAGE PRIORITY
==================================================

На старте важнее:

Servers
+
Community
+
News
+
Resources

не:

Advanced recommendations.

==================================================
40. CONTENT QUALITY
==================================================

Activity feed не должен стать шумом.

"Someone liked something"
не должно автоматически становиться важным событием.

Приоритет:

High-value Activity.

Например:

Server Update
Resource Release
New Article
Important Discussion

выше:

Reaction
View
Minor interaction.

==================================================
41. ACTIVITY PRIVACY
==================================================

Не создавать activity из private actions.

Например:

Private Purchase
не должен автоматически стать:

"Holo bought Resource X"

Public Activity должна основываться на публичных событиях.

==================================================
42. SOCIAL GRAPH PRIVACY
==================================================

Не показывать:

- кто кого читает;
- кто что купил;
- private followers;
- private server membership;

если на это нет explicit public policy.

==================================================
43. VISUAL BEHAVIOR
==================================================

Activity items могут использовать:

- server logo;
- creator avatar;
- resource cover;
- badges.

Это создаёт визуальное ощущение живой среды.

Но каждый item должен иметь:

- clear title;
- time;
- context;
- destination.

==================================================
44. PERFORMANCE
==================================================

Activity aggregation не должна:

- выполнять сотни queries;
- загружать тысячи records;
- пересчитывать всё при каждом request.

На раннем этапе достаточно:

- bounded queries;
- indexed columns;
- small windows;
- caching where useful.

==================================================
45. ARCHITECTURAL RULE
==================================================

Activity не должна становиться новой монолитной business domain.

Она является aggregation/read layer поверх существующих domains.

Source of truth остаётся:

Server
Resource
Forum
News
Article
Review
etc.

==================================================
46. FUTURE
==================================================

После появления реальной activity можно добавить:

- personalized feed;
- recommendations;
- trending;
- daily digest;
- email digest;
- push;
- event discovery.

Но это последующие этапы.

==================================================
47. SUCCESS CRITERIA
==================================================

Мы считаем Daily Experience успешной,
когда пользователь может:

1. Открыть сайт.
2. За несколько секунд понять, что происходит.
3. Найти интересный объект.
4. Перейти в другой pillar.
5. Совершить meaningful action.
6. Получить причину вернуться.

==================================================
48. ULTIMATE LOOP
==================================================

DISCOVER
↓
INTERACT
↓
FOLLOW
↓
NOTIFICATION
↓
RETURN
↓
DISCOVER MORE

И параллельно:

SERVER
→ CONTENT
→ COMMUNITY
→ MARKET
→ TRUST
→ IDENTITY

==================================================
49. FINAL PRINCIPLE
==================================================

Главный продуктовый вопрос MTA Market:

"Что происходит в MTA прямо сейчас?"

Если человек открывает сайт и получает хороший ответ на этот вопрос,
MTA Market начинает превращаться из каталога функций в живую платформу.

==================================================
50. NEXT DEVELOPMENT DECISION
==================================================

После фиксации этого документа НЕ создавать автоматически следующий Plan.

Сначала сопоставить:

VISION
+
PRODUCT ARCHITECTURE
+
PRODUCT MODEL
+
SURFACE MAP
+
DAILY EXPERIENCE

и определить:

какая минимальная следующая development phase создаст
наибольший рост реальной ценности платформы.

Development Plan должен появиться только после этого анализа.
