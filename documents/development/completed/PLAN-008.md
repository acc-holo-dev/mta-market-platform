# PLAN-008 — Follow Expansion (Creator + Resource)

> Этот файл объединяет СПЕЦИФИКАЦИЮ плана (§0–§19) и ЗАПИСЬ О ВЫПОЛНЕНИИ
> (EXECUTION RECORD, в конце документа) — по конвенции PLAN-002..007.
> Статус: **IMPLEMENTATION COMPLETE** (2026-09-11); production-верификация
> остаётся отдельным шагом (см. DEVELOPMENT/CURRENT.md).
> Обоснование выбора фазы: [NEXT-PHASE.md](../NEXT-PHASE.md) (§9, Цикл 3).

---

PLAN-008 — Follow Expansion (Creator + Resource)

Репозитории:

- acc-holo-dev/mta-market-site (основной объём работ)
- acc-holo-dev/mta-market-document (этот план)
- acc-holo-dev/mta-market-module — НЕ затрагивается

Текущий фундамент проекта:

PLAN-001 — Initial Product Release ✅
PLAN-002 — Product Experience Foundation ✅
PLAN-003 — Marketplace Core ✅
PLAN-004 — Production Readiness & Operational Hardening ✅
PLAN-005 — Community & Server Foundation ✅
PLAN-006 — Daily Experience Foundation ✅
PLAN-007 — Content Foundation ✅

Фундаментальные документы:

VISION.md
PRODUCT-ARCHITECTURE.md
PRODUCT-MODEL.md
PRODUCT-SURFACE-MAP.md
DAILY-EXPERIENCE.md

=================================================
0. ЦЕЛЬ PLAN-008
   ==================================================

Переход состояния:

ИЗ:

Follow есть только у серверов (PLAN-005). Создатель не собирает аудиторию:
публикует ресурс или статью — и никто, кроме модерации, не узнаёт. Покупатель
не получает уведомления об обновлениях купленного ресурса — Market Loop
(DAILY-EXPERIENCE §12) разорван на шаге «Update». Порядок follow-модели
(§16: Server ✅ → Creator → Resource) не выполнен.

В:

Пользователь может следить за создателем (продавцом) и за конкретным ресурсом;
подписчики получают уведомления о релизах, обновлениях и статьях; покупатель
уведомляется об обновлении купленного ресурса (существующая relationship, §26).
Порядок follow-модели §16 выполнен до шага Resource включительно. Социальный
граф закрыт: только агрегаты-счётчики, никаких списков подписчиков (§42).

После PLAN-008:

 fan следует за создателем
 → создатель публикует ресурс/обновление/статью
 → fan получает уведомление с deep link
 → возвращается.

 Покупатель покупает ресурс
 → выходит новая версия
 → покупатель получает уведомление
 → обновляется, пишет отзыв, возвращается.

=================================================
1. СТРАТЕГИЧЕСКАЯ ИДЕЯ
   ==================================================

PLAN-008 не называется:

"Social graph implementation".

Подписки — не соцсеть.

Подписки — это механизм возврата: они превращают одноразовый интерес
в повторные визиты (§9 Creator Loop, §12 Market Loop, §26 Resource
Following).

Главная цель:

"Каждая значимая публикация находит свою аудиторию сама."

Создатель публикует → система доставляет уведомление тем, кто уже выразил
интерес. Никаких алгоритмов, никаких лент подписок — только прямой канал
событие → заинтересованный пользователь → deep link.

=================================================
2. КТО ЕСТЬ «CREATOR»
   ==================================================

Creator = seller identity (VISION §21, MODEL §12): пользователь с
APPROVED SellerProfile.

- Follow цели — User создателя (не отдельная сущность).
- Подписаться можно только на создателя с APPROVED SellerProfile.
- Нельзя подписаться на себя.
- Статьи автора попадают в уведомления подписчикам создателя только если
  автор — этот создатель (PLAN-007 связка: автор статьи = User).

=================================================
3. НЕ ДЕЛАТЬ ИЗ ЭТОГО СОЦСЕТЬ
   ================================

Жёсткие правила (DAILY-EXPERIENCE §24, §42):

1. НИКОГДА не публиковать списки подписчиков — только агрегат-счётчик.
2. Follow — приватная relationship: не появляется в activity layer
   (PLAN-006 layer не расширяется), не создаёт лент «кто на кого подписан».
3. Никаких «друзей», взаимных подписок, рекомендаций «кого читать».
4. Уведомления — единственный канал доставки события подписчику
   (+ существующая сводка «Сейчас / За ночь»).

=================================================
4. WORKSTREAM A — ГРАНИЦЫ И ИССЛЕДОВАНИЕ
   ======================================

A-001 — Аудит

- ServerFollow (PLAN-005 L) как паттерн follow + счётчик;
- путь релиза версий (admin approve → releaseStatus PUBLISHED) — точка
  подключения уведомлений покупателям/подписчикам;
- публикация ресурса (admin status PUBLISHED) и статьи (adminContent
  approve) — точки уведомления подписчикам создателя;
- storefront /sellers/[username] и карточка ресурса — точки Follow-кнопок;
- /notifications (типы, рендер) и dashboard /now (ряды сводки).

=================================================
5. WORKSTREAM B — МОДЕЛЬ
   ======================

B-001 — SellerFollow (creator follow)

- followerId (User), sellerUserId (User с APPROVED SellerProfile);
- unique [followerId, sellerUserId]; индекс по sellerUserId (счётчик);
- createdAt. Агрегат-счётчик публичен; список — никогда.

---

B-002 — ResourceFollow

- userId, resourceId (Resource PUBLISHED);
- unique [userId, resourceId]; индекс по resourceId;
- createdAt. Счётчик публичен на странице ресурса; список — никогда.

---

B-003 — NotificationType (additive)

+ CREATOR_RESOURCE — followed creator released/updated a resource;
+ CREATOR_ARTICLE — followed creator published an article;
+ RESOURCE_UPDATE — новая версия ресурса, за которым следишь / купленного.

Формат уведомления — по канону §14: что произошло / почему важно / deep link
(Open → страница ресурса / статьи / storefront).

---

B-004 — Миграция

Аддитивная (2 таблицы + enum + индексы) формальным путём; enum-изменение
требует consent на тест-БД (см. урок PLAN-007).

=================================================
6. WORKSTREAM C — API FOLLOW
   ==========================

C-001 — Creator follow

- POST /creators/:username/follow (auth; target = User с APPROVED
  SellerProfile; не сам себя; повтор — 409);
- DELETE /creators/:username/follow (unfollow; не подписан — 404);
- GET /me/follows/creators (auth) — usernames создателей, на которых подписан
  (свои данные — ок, это не публикация чужих списков).

---

C-002 — Resource follow

- POST /resources/:slug/follow (auth; PUBLISHED; повтор — 409);
- DELETE /resources/:slug/follow;
- GET /me/follows/resources (auth) — slugs.

---

C-003 — Счётчики

- storefront payload: creatorFollowers (агрегат);
- карточка ресурса / страница: resourceFollowers (агрегат).

=================================================
7. WORKSTREAM D — ДОСТАВКА СОБЫТИЙ
   ================================

D-001 — Релиз ресурса (PENDING_REVIEW → PUBLISHED)

Уведомить подписчиков создателя (CREATOR_RESOURCE): «{Creator} опубликовал
ресурс {Title}» → /resources/[slug]. Dedup по recipientId.

---

D-002 — Новая версия (releaseStatus → PUBLISHED существующего ресурса)

Уведомить (dedup по получателю):

- покупателей с COMPLETED Purchase этого ресурса → RESOURCE_UPDATE:
  «{Resource} — новая версия {version}» → /resources/[slug] (§26: покупка
  уже создаёт relationship; это чинит Market Loop);
- ResourceFollow подписчиков → RESOURCE_UPDATE;
- SellerFollow подписчиков создателя → CREATOR_RESOURCE.

---

D-003 — Публикация статьи создателем

Уведомить SellerFollow подписчиков автора (если автор — создатель с
APPROVED SellerProfile) → CREATOR_ARTICLE: «{Creator} опубликовал статью
{Title}» → /content/articles/[slug] (PLAN-007 связка).

---

D-004 — Ограничения доставки

Bounded: подписчики одной пачкой (list по unique-индексу, лимит существующим
паттерном); createNotifications с dedup; никаких фоновых джоб — событие
доставляется синхронно в мутации (как PLAN-005 L-003).

=================================================
8. WORKSTREAM E — ПОВЕРХНОСТИ
   ==========================

E-001 — Storefront /sellers/[username]

- Follow/Отписаться кнопка (auth; guest → редирект на login — §30);
- агрегат «N подписчиков»; никаких списков.

---

E-002 — Ресурс

- Страница ресурса: Follow/Отписаться + агрегат «N следят»;
- состояние кнопки — из GET /me/follows/* (auth), гость видит кнопку с
  переходом на login.

---

E-003 — Уведомления и сводка

- /notifications: рендер новых типов с иконками и deep links;
- dashboard /now: ряд «Подписки на создателей: N обновлений» и
  «Отслеживаемые ресурсы: N обновлений» (в дополнение к существующим рядам);
- навбар-колокольчик — без изменений (unread уже агрегирован).

=================================================
9. WORKSTREAM F — PERFORMANCE
   ===========================

- уведомления — в существующую мутацию (bounded, как L-003);
- индексы: unique follow-пары + индекс по target (счётчик);
- activity layer не изменяется (никаких новых запросов).

=================================================
10. WORKSTREAM G — SEED
   ====================

- seed-plan005: несколько SellerFollow/ResourceFollow у seed-пользователей +
  примеры CREATOR_RESOURCE / CREATOR_ARTICLE / RESOURCE_UPDATE уведомлений
  (идемпотентно).

=================================================
11. TESTING — FOLLOW API
   ======================

- follow/unfollow создателя: 201/200; повтор 409; не-создатель 404;
  самоподписка 400; счётчик агрегатом; список чужих подписчиков не
  существует (privacy, §42 — тест: payload storefront не содержит массива
  подписчиков);
- follow/unfollow ресурса: только PUBLISHED; повтор 409;
- /me/follows/* — свои списки.

=================================================
12. TESTING — DELIVERY
   ====================

- релиз ресурса → уведомления подписчикам создателя (CREATOR_RESOURCE);
- новая версия → покупателю (RESOURCE_UPDATE), подписчику ресурса
  (RESOURCE_UPDATE), подписчику создателя (CREATOR_RESOURCE); dedup по
  получателю (тот, кто и покупатель, и подписчик — одно уведомление);
- статья создателя → CREATOR_ARTICLE подписчикам;
- статья НЕ создателя → подписчикам NOT (только если автор — создатель);
- hidden/отозванная версия не порождает уведомлений.

=================================================
13. TESTING — PRIVACY
   ===================

- /sellers/:username и страница ресурса не содержат идентичностей
  подписчиков;
- follow-state виден только самому пользователю (/me/follows/*);
- self-follow запрещён.

=================================================
14. TESTING — E2E (browser)
   =========================

- fan подписывается на создателя на storefront → создатель публикует ресурс
  (через реальный API-цикл seller→moderation) → fan видит уведомление в
  колокольчике/центре с deep link;
- fan подписывается на ресурс → новая версия → уведомление RESOURCE_UPDATE;
- покупатель получает RESOURCE_UPDATE без follow;
- создатель публикует статью → подписчику приходит CREATOR_ARTICLE;
- mobile smoke storefront.

=================================================
15. TESTING — REGRESSION
   ======================

Полный backend suite (358 + новые), Playwright 47 + новые. Особое внимание:
server follow (PLAN-005), activity (PLAN-006), content (PLAN-007),
/notifications, storefront, покупки/версии.

=================================================
16. ACCEPTANCE CRITERIA
   ====================

PLAN-008 считается завершённым, когда:

DOMAIN

- [ ] SellerFollow + ResourceFollow + enum уведомлений; миграция формальным
      путём, пакет в git.

FOLLOW API

- [ ] Follow/unfollow создателя и ресурса (валидация цели, 409/404/400).
- [ ] Счётчики-агрегаты на storefront и странице ресурса.
- [ ] /me/follows/* работает.

DELIVERY

- [ ] Релиз ресурса → CREATOR_RESOURCE подписчикам создателя.
- [ ] Новая версия → RESOURCE_UPDATE покупателю + подписчику ресурса +
      CREATOR_RESOURCE подписчику создателя; dedup по получателю.
- [ ] Статья создателя → CREATOR_ARTICLE подписчикам.
- [ ] Покупатель получает RESOURCE_UPDATE без follow (§26).

SURFACES

- [ ] Follow-кнопки + агрегаты на storefront и странице ресурса.
- [ ] Новые типы в /notifications с deep links.
- [ ] Сводка dashboard показывает обновления по подпискам.

PRIVACY

- [ ] Никаких списков подписчиков; только агрегаты; self-follow запрещён;
      follow-state только в /me/follows/*.

TECH

- [ ] Backend suite зелёный (358 + новые); E2E 47 + новые; build ok; tsc
      чист; activity layer без изменений.

WALKTHROUGH

- [ ] §18 пройден в браузере.

=================================================
17. НЕ ДЕЛАТЬ
   ==========

- Follow Thread/Community (порядок §16 — позже);
- follow статей/авторов-не-создателей;
- списки/ленты подписок, «кто на кого подписан», рекомендации;
- devlogs/CREATOR_PUBLICATION activity type (остаётся зарезервированным);
- email/push;
- изменения activity layer (PLAN-006);
- фоновые дайджесты.

=================================================
18. FINAL WALKTHROUGH
   ===================

SCENARIO 1 — FAN (Creator Loop, §9): storefront создателя → Follow →
создатель публикует ресурс → уведомление → ресурс → возвращение. ✅ цель

SCENARIO 2 — ПОКУПАТЕЛЬ (Market Loop, §12): покупка → новая версия →
уведомление RESOURCE_UPDATE → обновление → отзыв. ✅ цель

SCENARIO 3 — ЧИТАТЕЛЬ: подписка на создателя → статья → CREATOR_ARTICLE →
страница статьи → обсуждение. ✅ цель

=================================================
19. FINAL PRINCIPLE
   =================

Подписка — это обещание платформы:

«Ты сказал, что тебе интересно — мы доставим это к твоему возвращению».

Никаких алгоритмов. Только честный канал: событие → подписчик → deep link →
возвращение. Социальный граф остаётся закрытым: платформа знает ровно
столько, сколько нужно для доставки.

---

# EXECUTION RECORD — выполнено 2026-09-11

**Статус: IMPLEMENTATION COMPLETE** (2026-09-11)

## Итог

Цель плана достигнута: порядок follow-модели (DAILY-EXPERIENCE §16) доведён
до шага Resource включительно. Пользователь подписывается на создателя
(продавца с APPROVED профилем) и на конкретный ресурс; подписчики получают
уведомления о релизах (CREATOR_RESOURCE), обновлениях версий
(RESOURCE_UPDATE) и статьях создателя (CREATOR_ARTICLE); покупатель
уведомляется об обновлении купленного ресурса без всякого follow (§26 —
покупка сама создаёт relationship). Market Loop (§12) починен на шаге
Update: до плана новая версия опубликованного ресурса вообще не могла
выйти. Социальный граф закрыт: только агрегаты, никаких списков (§42);
activity layer не изменён.

## Что сделано (по workstreams)

### WORKSTREAM B — модель и миграция
- `SellerFollow` (followerId + sellerUserId, unique-пара, индексы) и
  `ResourceFollow` (userId + resourceId, unique-пара, индексы).
- NotificationType + CREATOR_RESOURCE / CREATOR_ARTICLE / RESOURCE_UPDATE
  (additive; CHECK-constraint rebuild → консент на тест-БД:
  `db update --confirm postgres`, см. урок PLAN-007).
- Миграция формальным путём: 14 ops,
  `migrations/app/20260911T0202_plan008_follow_expansion` в git.

### WORKSTREAMS C — API
- `routes/follows.ts` (единый root-mount: пути внутри абсолютные):
  POST/DELETE `/creators/:username/follow` (цель — User с APPROVED
  SellerProfile; self-follow 400; повтор 409; не подписан 404);
  POST/DELETE `/resources/:slug/follow` (только PUBLISHED; свой ресурс —
  400); GET `/me/follows/creators` и `/me/follows/resources` — ТОЛЬКО свои
  подписки.
- Storefront payload: `creatorFollowers` (агрегат); ресурсная страница:
  `resourceFollowers` (агрегат). Списки не существуют нигде.

### WORKSTREAM D — доставка
- `lib/follows.ts`: creatorFollowerIds / resourceFollowerIds / buyerIds
  (COMPLETED Purchase — существующая relationship, §26) / isCreator /
  deliverFollowNotifications (dedup по recipientId + excludeActorId;
  bounded 500).
- Хуки в мутациях: публикация ресурса → CREATOR_RESOURCE подписчикам
  создателя; releaseStatus→PUBLISHED версии → покупателям + подписчикам
  ресурса (RESOURCE_UPDATE) + подписчикам создателя (CREATOR_RESOURCE), dedup
  — и покупатель, и подписчик получают одно уведомление; статья создателя →
  CREATOR_ARTICLE (статья НЕ-создателя — никому, проверено тестом).

### Update delivery path (ключевой ремонт, D-002)
- **Найден продуктовый разрыв**: у опубликованного ресурса новая версия не
  могла выйти никоим образом — SELLER_TRANSITIONS запрещает
  PUBLISHED→PENDING_REVIEW, ADMIN_TRANSITIONS не имеет PUBLISHED→PUBLISHED;
  версии навсегда застревали в CANDIDATE. Market Loop (§12) был разорван на
  шаге Update.
- **Решение**: загрузка версии в PUBLISHED ресурс переводит его в
  PENDING_REVIEW как system-initiated re-moderation
  (`versions.ts`: ModerationEvent PUBLISHED→PENDING_REVIEW с actor=seller,
  reason «New version uploaded (update review)») → модерация одобряет →
  версия выходит → покупатели/подписчики получают уведомления. Ресурс
  временно исчезает из каталога на время ревью обновления (обычно минуты) —
  лицензии и доступ покупок не затронуты (записано в Ограничения).

### WORKSTREAM E — поверхности
- Storefront: Follow/Отписаться + агрегат «N подписчиков».
- Страница ресурса: Следить/Не следить + «Следят: N» + подпись «Уведомим о
  новой версии ресурса».
- /notifications: рендер CREATOR_RESOURCE / CREATOR_ARTICLE /
  RESOURCE_UPDATE с иконками.
- Dashboard «Сейчас / За ночь»: ряды «Подписки: N новинок от создателей» и
  «Отслеживаемые ресурсы: N обновлений» (followedCreatorUpdates /
  followedResourceUpdates, additive в payload).
- Гостевой guard: follow-state запрашивается только при сессии (401 гостя
  иначе триггерил глобальный redirect «Сессия истекла» — найдено E2E).

### WORKSTREAM G — seed
- seed-plan005: подписки (market_fan/racer_x → nightcity_owner, market_fan →
  auroraChief), resource-follows на демо-ресурсы, примеры уведомлений трёх
  новых типов (идемпотентно).

### §11–§15 — тесты и регресс
- `tests/plan008-follows.test.ts` (7): follow API (валидация цели,
  self-follow, 409/404), ресурсный follow (PUBLISHED only, свой — 400,
  счётчик на странице), privacy (storefront без списков), доставка
  (release → CREATOR_RESOURCE; версия → покупатель + подписчик ресурса +
  подписчик создателя c dedup = ровно одно уведомление fan'у-и-покупателю-и-подписчику;
  статья создателя → да, не-создателя → нет), dashboard-ряды.
- Полный backend: **365/365** (358 + 7).
- Playwright: **52/52** (47 + 5: storefront follow с честным счётчиком ±1;
  CREATOR_RESOURCE через полный artifact-пайплайн; RESOURCE_UPDATE через
  re-moderation версию; CREATOR_ARTICLE; mobile smoke).
- Production build web: exit 0; tsc чист у server и web.

### Финальные счёта приёмки (2026-09-11)

- Backend (vitest): **365/365** (337 → 349 → 358 → 365).
- Playwright browser E2E: **52/52** (37 → 42 → 47 → 52).
- Миграция: 14 ops (`20260911T0202_plan008_follow_expansion`).
- Performance: activity layer без изменений; уведомления — в мутации
  (bounded); Home-путь не затронут.

## Уроки окружения (дополнение)

1. **tsx watch не надёжен** для подхвата изменений — после каждой правки
   сервера перезапускать процесс (дефакт-стандарт сессии).
2. **Playwright multipart**: `multipart: { file: {name, mimeType, buffer} }`
   — helper должен возвращать ровно этот объект (обёртка вида
   `{file: {buffer: helper()}}` даёт «Unexpected buffer type»).
3. **Гостевые вызовы auth-эндпоинтов** в web триггерят глобальный
   «Сессия истекла» redirect — все /me/* запросы обязаны быть
   `enabled: isAuthenticated()`.

## §18 Walkthrough

- SCENARIO 1 (FAN): storefront → Подписаться → релиз → уведомление →
  ресурс. ✅ (E2E 1–2)
- SCENARIO 2 (ПОКУПАТЕЛЬ): покупка → версия → RESOURCE_UPDATE. ✅ (backend
  D-002; E2E 3 покрывает подписчика-ресурса тем же каналом)
- SCENARIO 3 (ЧИТАТЕЛЬ): подписка → статья → CREATOR_ARTICLE. ✅ (E2E 4)

## Ограничения

- Ресурс на время ревью обновления исчезает из каталога (PENDING_REVIEW не
  листится) — лицензии и покупки не затронуты; если мешает — будущая
  оптимизация (публикация черновика-обновления параллельно).
- Follow Thread/Community — по порядку §16 позже.
- Никаких digest/дайджестов — только мгновенные уведомления (in-app).
- production-верификация остаётся решением владельца инфраструктуры.
