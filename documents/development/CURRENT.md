# CURRENT — состояние проекта

Обновлено: 2026-09-12 (PLAN-016 выполнен).

## Активный план

Нет активного плана. **PLAN-016 — Identity Expansion, Multi-Provider
Payments & Platform Debt Closure** выполнен (см.
[COMPLETED/PLAN-016.md](COMPLETED/PLAN-016.md); спека:
PLAN-016-spec.md): вход через VK/Google/Yandex/Telegram + discovery,
страница `/account/identities`, шифрование OAuth-токенов (AES-256-GCM),
смена пароля; provider-neutral платежи — dispatch без хардкодов,
`POST /payments/webhook/:provider` (raw-body + signature), T-Bank и
crypto-адаптеры (RUB-locked), checkout UI (выбор способа + invoice-блок
с TTL и polling), dev-заглушка TEST; закрыт долг D-002..D-014 (фокус-трапы,
search react-query, admin-валидация, error-страницы, footer claims, 7d/30d
статистика, api-ext доменные модули, housekeeping документации, E2E-гигиена).
Приёмка: type-check ✓, lint 0 errors ✓, web build ✓, unit **440/440**,
E2E **68/68**, браузерная верификация (login/checkout/identities, light+dark).
Открыто (честно): OAuth token refresh, QR crypto-инвойса (зависимость —
решение владельца), admin-выбор из списков (validation-минимум сделан),
боевые env провайдеров — CURRENT Blockers.

Основа плана: аудит документации и кода (2026-09-12) — три опоры:
1. **Вход**: Google включён (backend готов), VK ID (новый), Telegram
   Login Widget (direct-mode), discovery `GET /auth/providers`,
   страница `/account/identities` (сейчас серверный link-callback ведёт
   в 404), шифрование OAuth-токенов в покое (PLAN-004 §6), смена пароля.
2. **Платежи**: provider-neutral dispatch (снятие хардкодов `"YUKASSA"`
   в routes/payments.ts, jobs/reconciliation.ts, db-reset), per-provider
   webhooks (`/payments/webhook/:provider`, raw-body, HMAC), фиат-адаптер
   №2 (референс T-Bank EACQ), crypto-адаптер (RUB-locked инвойсы,
   underpay/overpay политика) — по нейтральному `IPaymentProvider`
   (комментарий E-010; ideas/MARKETPLACE §6 «несколько платёжных
   провайдеров»).
3. **Долг**: plan-015 E2E coverage (§51 коммит test(ui) не создан),
   мёртвый redirect /account/identities, admin raw-ID формы, EN targetType
   в спорах, фокус-трапы модалок (DESIGN-SYSTEM §10 обещает, кода нет),
   search не на react-query, auth-FOUC bootstrap, 7d/30d статистика
   сервера (API есть, UI нет), error/not-found/loading.tsx, api-ext split
   + dead exports, footer claims, housekeeping документации
   (stale-спеки в active/, отсутствующая запись PLAN-013, README без
   PLAN-011..014, TESTING.md дрейф).

Мультивалютность, top-up, payouts, email/push, password reset, deals,
subscriptions, bundles — явно вне scope (§15 плана).

### Что появилось в PLAN-015 (2026-09-12)

- **AppShell** (§5–§7): Sidebar (expanded w-60 / collapsed w-14 icons-only,
  tooltip, персистентность, creator-секция только продавцам, admin отдельно)
  + Topbar (logo, GlobalSearch, ContextCreate, LiveChip, ThemeToggle, bell,
  «Выход», AccountMenu с балансом). Navbar.tsx заменён.
- **Две темы** (§10): light `:root` + dark `.dark` на идентичных именах
  токенов; ThemeProvider + no-FOUC inline-скрипт; один переключатель;
  новые токены `--on-accent`/`--star` (убраны raw text-white/amber).
- **GlobalSearch** (§8): дропдаун в topbar над реальным GET /search —
  группы Ресурсы/Серверы/Обсуждения/Статьи, клавиатура, хоткей «/».
- **Home** (§12–§15): hero + LiveStrip, PromotionHero (placement-контракт
  §38 на реальных featured-сущностях), Популярное/Новинки/Бесплатные,
  Новости+Обсуждения, Активность, правый рельс (Авторы из реальных
  публикаций, Лента событий, secondary placement). /activity теперь один
  fetch на страницу (общий queryKey).
- **Маркет** (§16/§25): вкладки Ресурсы | Услуги (реальный GET /services —
  первый UI сервиса-каталога), ResourceCard §17, ServiceCard, TrustBadges.
- **Personal** (§31–§32): dashboard → My MTA («Сейчас» первым блоком),
  /me/following (creators/resources/threads), уведомления «Сегодня/Ранее»,
  a11y-фикс вложенного интерактива.
- **Creator Studio** (§35): /seller?tab= (Обзор/Ресурсы/Услуги/Заказы/
  Аналитика), действие «Опубликовать».
- Приёмка: type-check чист, web build ✓, unit **392/392**, E2E **59/59**,
  браузерная верификация 1440/1920 light+dark.

### Что появилось в PLAN-014 (2026-09-12)

- **E2E regression PLAN-013 закрыта** (root cause: второй слой мойдибейка
  от багованной починки d3b0320 в серверных шаблонах уведомлений + баг
  `Новинка от [object Object]` + устаревший локатор поиска после редизайна
  + сирота logs/tests/.gitkeep). Кодемод scripts/development/repair-cyrillic.cjs
  (идемпотентный, --check для CI). Локальный полный E2E **59/59**.
- **Prisma унифицирована** (§16 вариант C): CLI 8.0.0-rc.13, orm-postgres
  rc.9, cli-engine 0.3.0, client 7.10.0 exact; contract-хеш идентичен,
  392/392 тестов.
- **Node 22 LTS + pnpm 9.15.0 — единая матрица** (local/CI/Docker; Docker
  приведён с node:24 к node:22).
- **Dependabot переписан**: patch/minor группами, majors игнорируются
  (ручная миграция), actions minor+patch группой.
- **GitHub Actions** на текущих stable (pnpm/action-setup v6, gitleaks v3
  и др. — Node 20 runtime удаляется с раннеров 2026-09-16).
- **Docker runner-баг исправлен**: .pnpm-стор не копировался в образ —
  ESM-импорты были битыми симлинками (ERR_MODULE_NOT_FOUND при старте
  контейнера); UPLOAD_DIR=/app/uploads пиннут. Production runtime
  верифицирован: /health, /ready, graceful shutdown, fail-fast.
- Зависимости: 15 UPDATE (patch/minor + prisma-линейка), 1 REMOVE
  (@types/bcryptjs), date-fns → dependencies; audit 0 уязвимостей;
  license audit чист (MPL/LGPL-исключения задокументированы).
- **Документы**: architecture/TOOLCHAIN.md и
  architecture/DEPENDENCY-POLICY.md (normative),
  reference/DEPENDENCY-MATRIX.md, TESTING.md синхронизирован.
- Осознанные DEFER-мажоры: Next 16 (+ESLint 9), Express 5, TS 7,
  Tailwind 4, commander/dotenv — каждый отдельной волной.
- Приёмка: vitest **392/392**, type-check чист, E2E **59/59**, module
  ctest 3/3 + DRM PASS, Docker build + production smoke зелёные.

### Что появилось в PLAN-012 (2026-09-11)

- **Transactional correctness core**: DB-инварианты через формальную
  миграцию 20260911T1014_plan012_idempotency_invariants (12 ops):
  checkout exactly-once (partial unique на живую покупку buyer+resource),
  ledger entry unique (transactionId, accountId, direction) —
  детерминированный settlement id стал hard-инвариантом,
  financial_txn_settlement_once_uq, payment captured-partial uniques
  (re-attempts разрешены, второй capture невозможен), dispute open uniques,
  IdempotencyRecord.
- **Idempotency-Key** на POST /purchases, /payments/create,
  /payments/refunds, /payments/:id/simulate: same key → replay stored
  response, conflicting payload → 409 idempotency_key_conflict.
- **Atomic ledger**: balance delta одним UPDATE ... + delta ... RETURNING;
  settlement (cache + legacy row + double-entry) в одной транзакции;
  INV-013 возвратов под per-payment advisory lock; dispute transitions —
  CAS; one-open-dispute — DB-инвариант.
- **Repository consistency**: site/server/tests/ (33 stale-копии) удалены;
  тест-рут только tests/; .md-политика соблюдена (1 GitHub-exception
  зафиксирован); naming/logs чисты; CI-инварианты усилены.
- **Tech debt PLAN-011 закрыт**: node dist/ рантайм чинен и проверен
  (health/ready 200, production fail-fast, CI smoke); Clang policy + Windows
  support matrix формализованы (MODULE.md §8/§9); /sellers канон;
  PRODUCT-MODEL §3.1 OFFLINE согласован; OpenAPI schemas для
  auth/commerce/payments/refunds/disputes — первый инкремент.
- Приёмка: **392/392** unit+integration+concurrency тестов (было 383);
  миграция 12 ops применена на dev/test; dist-smoke зелёный.

## Состояние продукта

MTA Market — marketplace + community + server platform (см.
[PROJECT.md](../product/PROJECT.md)).
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

Нет блокеров кода. Ограничения (унаследованные, после PLAN-016):

1. **Windows-сборка модуля** (унаследовано из PLAN-004): POSIX-сокеты в
   http_client.cpp + отсутствие OpenSSL-линковки в CMake. market_client
   следует за существующей архитектурой и наследует это ограничение.
2. **Production verification** (как и после PLAN-004): live domain, боевые
   ключи провайдеров (OAuth/платежи), restore drill. Новые в PLAN-016
   провайдеры включаются владельческими env и в E2E не гоняются.
3. **Почтовые уведомления**: in-app уведомления готовы; email-канал —
   будущий план (нужен digest/анти-спам дизайн). Password reset по email
   остаётся вне scope до боевого SMTP.
4. **OAuth token refresh**: токены провайдеров хранятся зашифрованными, но
   путь refresh'а провайдерских токенов ещё не реализован (decrypt-хелпер
   зарезервирован под него, AUTH.md).

Известные осознанные ограничения (кандидаты в следующие планы):

- Rate-limit счётчики подписок/новостей используют userRateLimit (in-memory
  Redis) — при росте аудитории пересмотреть.
- Поиск — ILIKE по name/description/title (pg_trgm — кандидат из PLAN-004
  blockers, теперь и для servers/threads).
- Нет email-уведомлений; нет push.
- QR-код для crypto-инвойса не отрисован (нужна новая рантайм-зависимость —
  владельческое решение по DEPENDENCY-POLICY; инвойс доступен по payUrl).

## Следующий шаг

Сформировать следующий план отдельным решением (автоматически не создаётся).
Логичные кандидаты: production verification (blockers PLAN-004..010 — решение
владельца инфраструктуры), гарантии/deals + payouts (Trust — требуется
владельческая платёжно-правовая модель), серверная аналитика (7d/30d
переключатель + incidents на готовом Live-блоке), wishlist, community follow
(после появления сущности «сообщество»), events, email/push, публичность
просмотров (VISION §20). Наличие темы в списке не является обязательством её
реализовать.
