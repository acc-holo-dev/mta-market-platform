# CURRENT — состояние проекта

Обновлено: 2026-09-11 (после выполнения PLAN-011).

## Активный план

Нет. PLAN-011 (Unified Platform Monorepo) выполнен и зафиксирован
(см. [COMPLETED/PLAN-011.md](completed/PLAN-011.md)). Предыдущие:
PLAN-010 (Creator Analytics, [completed/PLAN-010.md](completed/PLAN-010.md)) со статусом
**IMPLEMENTATION COMPLETE — browser E2E прогнан, production-проверка остаётся
отдельным шагом** (см. Blockers внизу).

Предыдущие планы: PLAN-005…010 — [completed/](completed/).

### Что появилось в PLAN-011 (2026-09-11)

- **PLAN-011 — Unified Platform Monorepo**: три репозитория
  (mta-market-site, mta-market-module, mta-market-document) объединены в
  `mta-market-platform`. Сохранена вся рабочая функциональность; структура —
  documents/contracts/site/module/tests/logs/scripts/config/infrastructure/.
  Централизация: tests/ (378 backend + 5 concurrency + 59 E2E), scripts/,
  config/, infrastructure/, startup.py, CI-гейты (E2E — блокирующий).
  Запись о выполнении: [completed/PLAN-011.md](completed/PLAN-011.md);
  карта переноса: [../history/MIGRATION.md](../history/MIGRATION.md).

## Состояние продукта

MTA Market — marketplace + community + server platform (см. [PROJECT.md](../PROJECT.md)).
После PLAN-006 платформа отвечает на главный вопрос daily experience:
Home — живой вход в экосистему («Что происходит в MTA прямо сейчас?»).

### Что появилось в PLAN-007

- **CONTENT pillar**: статьи как сущность (DRAFT → PENDING_REVIEW →
  PUBLISHED/ARCHIVED, модерация с причиной, audit, уведомления автору),
  хаб /content с категориями, страницы /content/articles/[slug] с явными
  связями (ресурсы — любые PUBLISHED; серверы — только staff, G-004
  прецедент), треды обсуждения, «Мои статьи», вкладка «Статьи» в админке,
  репорты ARTICLE.
- **Daily experience**: NEW_ARTICLE в активности Home (инвалидация кэша на
  одобрении/скрытии), статья в профиле автора, группа Articles в /search,
  «Статьи» в глобальной навигации.
- **Ремонт пробела PLAN-006**: построена страница /search (hero вёл на
  404-страницу).

### Что появилось в PLAN-008

- **Follow Expansion (§16: Server → Creator → Resource)**: подписка на
  создателя (продавец с APPROVED профилем) и на конкретный ресурс;
  уведомления CREATOR_RESOURCE / CREATOR_ARTICLE / RESOURCE_UPDATE с deep
  links; агрегаты «N подписчиков» на storefront и странице ресурса без
  раскрытия списков (§42); ряды в сводке «Сейчас / За ночь».
- **Market Loop починен на шаге Update**: загрузка новой версии
  опубликованного ресурса возвращает его в PENDING_REVIEW (system-initiated
  re-moderation с audit) → одобрение выпускает версию → покупатели (§26 —
  relationship уже существует) и подписчики получают уведомления с dedup.

### Что появилось в PLAN-009

- **Thread Follow (шаг Follow в Community Loop, §10)**: подписка на любое
  обсуждение (Follow на странице темы, агрегат «N следят» без списков),
  FORUM_REPLY доставляется подписчикам вместе с автором и участниками
  (dedup), ряд «Отслеживаемые обсуждения» в сводке «Сейчас / За ночь».

### Что появилось в PLAN-010

- **Creator Analytics (IDEAS §4 — foundation)**: честный счётчик просмотров
  страниц ресурсов (ResourceViewDaily — агрегат ресурс×день, без
  идентичностей зрителей), POST /resources/:slug/view; блок «Аналитика» в
  кабинете продавца: просмотры/покупки за 30 дней, конверсия по каждому
  ресурсу. Просмотры — приватные данные продавца.

### Приёмка PLAN-010 (2026-09-11)

- Backend-тесты: **378/378** (372 + 6 analytics).
- Playwright browser E2E: **59/59** (56 + 3 analytics).
- Миграция: 4 ops (20260911T0343_plan010_creator_analytics) в git.

### Приёмка PLAN-009 (2026-09-11)

- Backend-тесты: **372/372** (365 + 7 thread-follow).
- Playwright browser E2E: **56/56** (52 + 4 thread-follow).
- Миграция: 6 ops (20260911T0309_plan009_thread_follow) в git.

### Приёмка PLAN-008 (2026-09-11)

- Backend-тесты: **365/365** (358 + 7 follows).
- Playwright browser E2E: **52/52** (47 + 5 follow).
- Миграция: 14 ops (20260911T0202_plan008_follow_expansion) в git.
- Activity layer без изменений; Home-путь не затронут.

### Приёмка PLAN-007 (2026-09-11)

- Backend-тесты: **358/358** (349 + 9 content).
- Playwright browser E2E: **47/47** (42 + 5 plan007).
- Production build web: exit 0; миграция 22 additive ops
  (20260911T0112_plan007_content_foundation) в git.
- Performance: activity cold 86.8мс / warm 23.2мс (статьи в том же
  bounded-наборе).

### Что появилось в PLAN-006

- **LIVE-слой**: глобальные агрегаты «N игроков / M серверов онлайн» из
  реальных heartbeat-сэмплов (только VERIFIED/ACTIVE + ONLINE + showStats=true),
  кэш Redis TTL 45с; `GET /activity/live`.
- **Activity read-layer**: `GET /activity` — смешанная лента высокоценных
  событий (9 типов DAILY-EXPERIENCE §18) из существующих доменов, окно 7 дней,
  bounded queries, dedup, chronological + детерминированные приоритеты без ML.
  Никакой новой доменной сущности (§45).
- **Home rebuild**: «Сейчас в MTA» (live line + поиск) → «Активность» (лента с
  deep links) → «Популярное» (топ серверов по реальному онлайну + горячие
  обсуждения) → маркетплейс-секции PLAN-003 сохранены. Всё доступно Guest.
- **Инвалидация кэша** на высокоценных мутациях (publish news/update, release
  ресурса, тема/ответ, отзыв) — свежие события на Home мгновенно.
- **Dashboard «Сейчас / За ночь»**: сводка с момента последнего визита
  (`User.dashboardSeenAt`): обновления подписок, новые ответы в моих темах,
  обновления купленных ресурсов, unread-уведомления; deep links; baseline
  продвигается при каждом визите.

### Приёмка PLAN-006 (2026-09-11)

- Backend-тесты: **349/349** (337 до плана + 12 activity/dashboard).
- Playwright browser E2E: **42/42** (plan001 12 + plan003 13 + plan005 12 +
  plan006 5) на живых dev-серверах.
- Production build web: exit 0; First Load JS shared 102 kB (без роста).
- Миграция формальным путём: 10 additive ops (user.dashboardSeenAt + 9
  индексов), пакет `20260911T0004_plan006_daily_experience` в git.
- Performance: cold compute 93мс / warm 23мс; горячий путь — из кэша.

## Состояние продукта

MTA Market — marketplace + community + server platform (см. [PROJECT.md](../PROJECT.md)).
После PLAN-005 платформа больше не только про commerce: у неё есть живая
социальная поверхность вокруг сущности SERVER.

### Что появилось в PLAN-005

- **Server domain (A/B/C/D/E)**: модель Server (slug, owner, брендинг,
  connection-данные, lifecycle CREATED → PENDING_VERIFICATION → VERIFIED →
  ACTIVE (+ SUSPENDED/ARCHIVED)), staff-роли, регистрацию через мастер
  /servers/create, ownership verification через possession-токен интеграции
  (первый валидный heartbeat от модуля/скрипта → VERIFIED, audit + note),
  публичную страницу /servers/[slug] (hero с онлайн-статусом, review,
  follower count; табы Обзор/Live/Новости/Обновления/Отзывы/Сообщество),
  monitoring (ONLINE/OFFLINE/UNKNOWN; graceful OFFLINE только от сервера,
  тишина → UNKNOWN через sweep-job, никогда не «врёт» OFFLINE), statistics
  (peak/average/uptime по реальным сэмплам, 24h/7d/30d).
- **Global community (F)**: форум (7 категорий, темы, посты, реакции,
  редактирование, мягкое удаление, состояния OPEN/LOCKED/ARCHIVED,
  просмотры = реальные, pinned), хаб /community (latest/active/pinned/
  activity), server-linked обсуждения (G-004: привязка темы к серверу —
  только персоналом этого сервера).
- **Server news & updates (H/I)**: черновик → публикация (уведомления
  подписчикам), опциональное обсуждение новости (тред), обновления с
  версией/changelog, глобальная лента /news (один News object на все
  поверхности).
- **Reviews с токенами (J/K)**: отзывы сервера доступны ТОЛЬКО после
  claim одноразового токена интеграции (server-bound, expiry 24h по
  умолчанию, replay-protection, self-review ban, 1 отзыв/сервер,
  ✓ Verified Interaction badge = подтверждённое взаимодействие, скрытие
  отзывов модерацией с audit).
- **Follow & notifications (L/M)**: подписка на сервер, счётчик подписчиков,
  уведомления SERVER_NEWS / SERVER_UPDATE / FORUM_REPLY / REVIEW_EVENT /
  MODERATION, центр /notifications с непрочитанными и «прочитать всё»,
  колокольчик с бейджем в навбаре.
- **Dashboard & profile (N/O/P)**: «My MTA» блок в существующем dashboard
  (мои серверы, подписки, обсуждения, уведомления), публичный профиль
  /profile/[username] с бейджами (Server Owner / Verified Server /
  Verified Seller) и публичными серверами/ресурсами.
- **Moderation & reports (Q/R)**: админ-вкладки Серверы (inspect, verify/
  reject, suspend/restore/archive — каждое действие audit + уведомление
  владельцу), Жалобы (queue → resolve/dismiss + уведомление репортёру),
  модерация контента сообщества (news/reviews/threads).
- **Privacy by default (S/T)**: host/port никогда не покидают бэкенд;
  showResources/showStaff/showTechStack/showCommunity выключены по
  умолчанию; showStats=true по умолчанию, но выключение скрывает live-
  числа на API-уровне; связь Server↔Resource публична только по явному
  opt-in владельца (проверено E2E: «public API does not expose the
  resource list»).
- **Integration protocol (AC/§33)**: POST /integration/heartbeat (token
  possession → proof-of-control; только агрегаты: count/status), POST
  /integration/review-tokens (one-time токен для игрока). Модуль
  (mta-market-module): новый `source/drm/market_client.{hpp,cpp}` + Lua
  функции `mta_market_configure/start/stop/report_players/status/
  review_token` (privacy: только счётчики, никаких player identity).
- **Поиск (W)**: /search с явными типами результатов (Resources/Servers/
  Discussions + счётчики).
- **Seed (§34)**: scripts/seed-plan005.ts — 10 реалистичных серверов
  (online/offline/unknown/pending/suspended, приватность-вариации),
  14 пользователей, 7 категорий, темы с ответами и реакциями, новости
  (published+draft), обновления, 15 verified-отзывов, подписки,
  уведомления. Dev-инструмент scripts/dev-heartbeat.ts держит онлайн
  свежим (симулятор интеграции через публичный API).

## Приёмка PLAN-005 (2026-09-10)

- Backend-тесты: **337/337** (было 256; +81 PLAN-005: servers 28,
  community 21, reviews 15, news 16; REGRESSION: auth/commerce/DRM/
  payments не сломаны — payments-webhook требует TRUST_PROXY=true при
  локальном прогоне, в CI это дефолт).
- Prisma 8 migration formal path: `migration plan` (93 additive ops,
  16 новых таблиц + индексы/FK) → `db migrate` на dev-БД → "Applied 1
  migration(s) (93 operation(s))"; пакет
  `migrations/app/20260910T1051_plan005_community_server` в git.
- `tsc --noEmit` чист у server и web; production build проверяется CI.
- Playwright browser E2E: план005-спека прогоняется на живых dev-серверах
  (см. COMPLETED/PLAN-005.md для финального счёта).
- Live-проверка цепочки интеграции (ручная, на dev-серверах): heartbeat с
  токеном → monitoring ONLINE + verification VERIFIED → публичная страница
  показывает 431/800; выпуск review-token через /integration/review-tokens
  → claim через API → eligibility granted.
- Модуль (C++): market_client + Lua-функции добавлены; сборка модуля
  требует Linux-тулчейн (Windows-сборка модуля была и остаётся отдельной
  задачей — см. Blockers PLAN-004).

## Ре-верификация (2026-09-10, аудит документации и кода)

Независимый прогон всей цепочки после аудита трёх репозиториев:

- Backend-тесты: **337/337** на чистой БД (контракт-схема применена
  формальным путём `prisma db update`, 311 additive ops с нуля).
- Playwright browser E2E: **37/37** (plan001 12 + plan003 13 + plan005 12)
  на живых dev-серверах; для запуска Chromium потребовались системные
  библиотеки (libnss3/libnspr4/libasound2) — установка через
  LD_LIBRARY_PATH, без root.
- Модуль: `make -f source/drm/Makefile test` — ALL TESTS PASSED (Linux x64).
- Migration refs фикс: `refs/db.json` в mta-market-site указывал на
  промежуточный хеш (771428b3 после 0605_migration) вместо финального
  состояния после 1051_plan005 (52df04b6) — исправлен (site 6064911).
- Live-интеграционная цепочка воспроизведена: seed-plan005 → dev-heartbeat
  (7 серверов каждые 45с) → публичный API показывает ONLINE 436/800,
  VERIFIED; host/port в публичном payload отсутствуют.
- Документация приведена к целевой структуре (PROJECT/IDEAS/ACTIVE/
  COMPLETED; dedup SURFACE-MAP; PLAN-005 spec+record объединены) —
  коммиты 40561d9, bb9a729.

## Blockers

Нет блокеров кода. Ограничения/что осталось (в рамках PLAN-005 не было
обязательным):

1. **Windows-сборка модуля** (унаследовано из PLAN-004): POSIX-сокеты в
   http_client.cpp + отсутствие OpenSSL-линковки в CMake. market_client
   следует за существующей архитектурой и наследует это ограничение.
2. **Production verification** (как и после PLAN-004): live domain, real
   payments, restore drill.
3. **Почтовые уведомления**: in-app уведомления готовы; email-канал —
   будущий план (нужен digest/анти-спам дизайн).

Известные осознанные ограничения (кандидаты в следующие планы):

- Rate-limit счётчики подписок/новостей используют userRateLimit (in-memory
  Redis) — при росте аудитории пересмотреть.
- Feed /news не имеет сортировок/фильтров по серверу (минимум по плану).
- Поиск — ILIKE по name/description/title (pg_trgm — кандидат из PLAN-004
  blockers, теперь и для servers/threads).
- Нет email-уведомлений; нет push.

## Следующий шаг

Сформировать следующий план отдельным решением (автоматически не создаётся).
Логичные кандидаты: production verification (blockers PLAN-004..010 — решение
владельца инфраструктуры), гарантии/deals + payouts (Trust — требуется
владельческая платёжно-правовая модель), серверная аналитика (7d/30d
переключатель + incidents на готовом Live-блоке), wishlist, community follow
(после появления сущности «сообщество»), events, email/push, публичность
просмотров (VISION §20). Наличие темы в списке не является обязательством её
реализовать.
