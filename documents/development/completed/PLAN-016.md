# PLAN-016 — Identity Expansion, Multi-Provider Payments & Platform Debt Closure (выполнен)

Дата: 2026-09-12. Статус: IMPLEMENTATION COMPLETE.
Спека: `documents/development/active/PLAN-016.md` (перенесена в
`completed/PLAN-016-spec.md`). Работа выполнена двумя проходами: основной
агент (прерван на середине Phase C/D — работа восстановлена по факту) +
завершающий проход с восстановлением гейтов.

## 1. Что сделано (по фазам)

### Workstream A — Identity Expansion
- **Discovery `GET /auth/providers`** (A-001): публичный список включённых
  провайдеров `{provider, displayName, mode: "redirect"|"direct", botName?}`
  из реестра (`getEnabled()`); без env провайдер отсутствует (честное
  отсутствие), конфигурация не раскрывается. Зарегистрирован ДО generic
  `/:provider`-роутов.
- **VK ID** (A-004): `lib/providers/vk.ts` — OAuth2 code-flow id.vk.com,
  verified-email по фактическому флагу `email_verified` (без флага —
  синтетический `.local` email, анти-takeover правило неизменно); state/
  identity-upsert/link-режим переиспользованы as-is.
- **Telegram direct-login** (A-005): `lib/providers/telegram.ts` +
  `POST /auth/telegram/callback` — HMAC-SHA256 data-check-string
  (ключ SHA256(bot_token)), freshness `auth_date` ≤ 24h, replay-дедуп
  `(id, auth_date)` (in-memory кэш, TTL 24h, cap 10 000), rate-limit,
  nullable-токены. Generic redirect-роуты Telegram не задействованы.
- **Login page** (A-007): `OAuthButtons` рендерит кнопки из discovery
  (redirect-провайдеры + лениво монтируемый Telegram-виджет); при пустом
  списке панель отсутствует — ни одной мёртвой кнопки.
- **Identity UI** (A-006): страница `/account/identities` (привязка через
  `POST /auth/:provider/link/start`, отвязка `DELETE /auth/identities/:id`
  с правилом последнего способа входа, результат `?linked=1`); вкладка
  «Подключения» `/account` получила кнопки-ссылки на страницу (мёртвый
  redirect закрыт).
- **Смена пароля** (A-008): `PATCH /auth/password` — bcrypt-проверка
  текущего, ≥8, инвалидация всех ДРУГИХ сессий (текущая выживает),
  равномерная ошибка `INVALID_CREDENTIALS` (анти-энумерация); UI на
  `/account` (Профиль).
- **Шифрование OAuth-токенов в покое** (A-009/D-011): `lib/tokenCrypto.ts`
  AES-256-GCM (ключ `OAUTH_TOKEN_ENCRYPTION_KEY`, 32 байта base64,
  envelope `v1:iv:tag:ct`); шифрование при записи; расшифровка —
  единственный путь чтения, зарезервированный под будущий refresh-флоу
  провайдера (сам refresh не реализован — честно задокументировано);
  идемпотентный startup-sweep перешифровывает legacy-plaintext строки
  (только при наличии ключа, не фатален).
- **Env/валидация** (A-009a): матрица `YANDEX_*/GOOGLE_*/VK_*/TELEGRAM_*/
  OAUTH_TOKEN_ENCRYPTION_KEY` в обоих `.env.example`; `startupValidation.ts`
  — ни один OAuth-провайдер не обязателен в production (провайдер без env
  просто отключён), частичная конфигурация — warning; ключ шифрования
  обязателен в production при любом настроенном OAuth-провайдере (32 байта
  base64); TBANK/CRYPTO follow YooKassa-контракт enabled→configured.

### Workstream P — Multi-Provider Payments
- **Provider-neutral dispatch** (P-001): `POST /payments/create` принимает
  опциональный `provider` (unknown → 400, known-but-disabled → 409);
  дефолт — `PAYMENTS_DEFAULT_PROVIDER` → единственный enabled → YooKassa
  legacy fallback. Хардкоды `"YUKASSA"` сняты из routes/payments.ts,
  jobs/reconciliation.ts (цикл по всем enabled + agnostic backfill) и
  db-reset.ts (events по всем провайдерам). `PaymentProvider` enum
  расширен `TBANK`/`CRYPTO` формальной миграцией
  `migrations/app/20260912T0456_plan016_payment_providers/`.
- **Per-provider webhooks** (P-002): `POST /payments/webhook/:provider`
  + legacy-алиас `POST /payments/webhook` (default-провайдер); raw-body
  capture (express.json verify-callback, payloadHash от raw bytes — заодно
  фикс для YooKassa-лога); reason расширен `"signature"`; общий конвейер
  неизменен (persist event → verify → re-fetch → сверка amount/RUB/
  привязки → quarantine → CAS → completion → ledger).
- **T-Bank EACQ** (P-003): `lib/tbank.ts` + `lib/providers/payment-tbank.ts`
  — redirect-подтверждение, SHA-256 notification token по отсортированным
  параметрам, GetState/Cancel/Refund; capabilities payment.create/
  verification/cancel/refund/poll. Статус-мапперы (`fromYooKassaStatus`,
  `fromTBankStatus`) живут в файлах провайдеров — нейтральный
  `paymentStateMachine.ts` содержит только нейтральные состояния.
- **Crypto-адаптер** (P-004): `lib/cryptoinvoice.ts` +
  `lib/providers/payment-crypto.ts` — RUB-locked инвойсы (FINAL total в
  RUB, конверсия на стороне провайдера, никаких мультивалютных полей),
  confirmation `crypto_invoice` (payUrl/address/memo/expiresAt),
  capability `payment.poll`, без cancel/refund (гейт скрывает кнопку);
  политика расхождений: недоплата → FAILED/истёк (никогда частично
  завершённая покупка), переплата ≥ порога → accept, TTL → CANCELED.
  Верификация — формула Cryptomus (`md5(base64(payload без sign) + api
  key)`, timing-safe, raw-body re-parse).
- **Checkout UI** (P-005): выбор способа оплаты (радио из
  `GET /payments/providers`, enabled only); invoice-блок: сумма (RUB),
  payUrl, memo/address с copy-кнопкой, живой TTL-каундаун (role=timer),
  честная индикация опроса; подтверждение — polling статуса покупки
  (`refetchInterval` 5с только при активном PENDING-инвойсе, §10), при
  COMPLETED поверхность сама переключается в «Покупка завершена» —
  без ручных кнопок и без фейковой индикации.
- **Reconciliation/refunds** (P-006): цикл reconciliation по всем включённым
  провайдерам; backfill `runReconciliationForDateRange` без явного
  провайдера покрывает все enabled; refund-сервис провайдер-агностичен
  (покрыт тестами для YooKassa; crypto не advertise refund).
- **Dev-заглушка TEST** (P-007): `lib/providers/payment-test.ts` —
  `PAYMENTS_TEST_ENABLED=true` + `NODE_ENV !== "production"`;
  crypto_invoice-инвойс с memo/TTL, завершение существующим
  `POST /payments/:id/simulate`; simulate блокирован (403) при любом
  включённом НЕ-TEST провайдере, в production роут не компилируется.

### Workstream D — Debt Closure
- **D-001**: `tests/e2e/plan016/shell.spec.ts` — 9 тестов: sidebar
  collapse+persist, тема+persist, search-дропдаун (empty state), AccountMenu
  (баланс/выход без dashboard), «/»-хоткей, `/account/identities`, checkout
  (способ оплаты + invoice-блок через TEST-провайдер + auto-completion по
  polling после simulate), discovery-кнопки входа, 24H/7D/30D переключатель.
- **D-002**: admin raw-ID формы — немедленная валидация UUID
  (`MODERATION_ID_REGEX`), aria-invalid на всех четырёх полях, описательные
  placeholder/hint («ID версии … из деталей ресурса»); список-выбор вместо
  paste-ID остаётся открытым (см. §3).
- **D-003**: словарь `disputeTargetLabel` в `lib/disputeLabels.ts`
  (переиспользован и пользовательским списком споров, и админ-вкладкой;
  вынесен из page-файла — Next.js запрещает произвольные page-export).
- **D-004**: общий `components/ui/focusTrap.ts` (Tab-цикл + Esc +
  restoreTrigger) применён к ConfirmDialog, ReportDialog, Gallery-лайтбоксу,
  mobile-drawer сайдбара, mobile-листу фильтров каталога; dropdown-минимум
  (Esc с возвратом фокуса на триггер + закрытие по Tab-out) — AccountMenu,
  ContextCreate. `DisputeDialog` — inline-панель, не оверлей (ловушка
  не требуется, фокус следует документному порядку).
- **D-005**: `/search` переведён на react-query (`useQuery` + URL как
  единственный источник истины, debounce 350мс через replace, keepPreviousData;
  тексты/локаторы E2E сохранены, включая pill «Статьи <n>»).
- **D-006**: warm-up `bootstrapSession()` в AppShell (on mount) — первый
  paint больше не гостевой; поточечные вызовы остались идемпотентными.
- **D-007**: 24H/7D/30D переключатель + Peak/Average/Uptime на Live-вкладке
  сервера (E2E покрыт).
- **D-008**: dead exports удалены (patchReview, fetchMyServers,
  archiveServer, updateServerNews, deleteServerReview, fetchForumCategories —
  все проверены на неиспользование); доменные модули `lib/api/identity.ts`
  и `lib/api/payments.ts` выделены с реэкспортом из `api-ext.ts` (импорты по
  всему app не ломаются).
- **D-009**: `app/error.tsx` (ru, role=alert, retry), `app/not-found.tsx`,
  `app/loading.tsx` (skeleton) — добавлены.
- **D-010**: footer claims приведены к факту («Оплата через платёжных
  провайдеров · DRM-лицензии · Возвраты через споры и модерацию»), дубль
  /news убран.
- **D-012**: спеки PLAN-012/013/014/015 (+MAP) перенесены в `completed/`;
  пост-хок запись `completed/PLAN-013.md` создана (помечена «восстановлена
  пост-хок»); README: строки PLAN-011..014 + битая ссылка
  `../IDEAS/IDEAS.md` → `../ideas/README.md`; TESTING.md: «Каталог workflows
  пуст» (ложь с PLAN-011) исправлен, счётчики актуализированы; CURRENT.md:
  дубль-заголовок PLAN-014 убран, Blockers актуализированы (добавлены
  OAuth-refresh и QR-ограничения), ссылка на PROJECT.md починена;
  NEXT-PHASE.md: Цикл 6; PROJECT.md: дата + «Что ещё НЕ реализовано»
  (token refresh, боевые env провайдеров) + починены ссылки DEVELOPMENT/IDEAS.
- **D-013**: plan001 spec — afterAll-чистка созданных `e2e_*` сущностей
  (RESTRICT-дети раньше: financialTransaction → purchase → order →
  servicePurchase → artifactSignature → publisherKey → user); plan016 spec
  — своя afterAll; vitest plan001 — `resetUsersByUsernamePrefix("p1")`
  (db-reset обобщён на произвольные множества userId).
- **D-014**: lint green (0 errors); unused imports/vars в затронутых файлах
  убраны (OAuthButtons, identities page, cryptoinvoice, payment-test).

### Контракты и env
- `contracts/api/authentication.yaml`: providers/discovery, direct-mode,
  link/start, telegram callback, PATCH /auth/password, шифрование токенов.
- `contracts/api/commerce.yaml`: GET /payments/providers, provider в create,
  webhook/:provider + alias, capability-гейты, simulate-правила.
- `.env.example` (оба): полная матрица OAuth (YANDEX/GOOGLE/VK/TELEGRAM/
  OAUTH_TOKEN_ENCRYPTION_KEY) и платежей (PAYMENTS_DEFAULT_PROVIDER/TBANK/
  CRYPTO/PAYMENTS_TEST_*).

## 2. Приёмка (гейты)
- **type-check**: чист (turbo 3/3 + tsconfig.test).
- **Unit/integration: 440/440** (45 файлов; +48 к базовым 392: identity-,
  payments-tbank/crypto, auth-plan016 [discovery/password/409],
  token-crypto round-trip, startup-policy [OAuth-optional, ключ шифрования,
  TBANK-enabled]).
- **Web build** ✓; **lint** — 0 errors (новые warnings в затронутых файлах
  отсутствуют).
- **E2E: 68/68** (59 прежних + 9 plan016; web :3000 dev + API :3001 +
  Postgres/Redis Docker + seed plan-003/005 + heartbeat).
- **Браузерная верификация**: скриншоты 1440×900 (login с discovery-панелью,
  checkout с выбором способа «Тестовый (dev)», /account/identities,
  home light+dark). §16 UX-тест: вход показывает только включённые способы;
  способ оплаты и invoice-состояние понятны (payUrl/memo/countdown);
  прежние пути не сломаны; тёмная/светлая тема на новых поверхностях на
  токенах.

## 3. Честность — что НЕ реализовано / отклонения от спеки
- **OAuth token refresh**: путь refresh'а провайдерских токенов не
  реализован; `decryptProviderToken` — зарезервированная точка чтения
  (документировано в AUTH.md). Legacy-строки перешифровываются
  идемпотентным startup-sweep.
- **QR-код crypto-инвойса** (P-005): не отрисован — новая
  рантайм-зависимость требует владельческого решения по
  DEPENDENCY-POLICY; инвойс доступен по payUrl, адрес/memo копируются.
  Задокументировано в CURRENT Blockers.
- **Deterministic Idempotence-Key** (P-003): протокола
  `providerPaymentId+attempt` не существует — T-Bank API не имеет
  Idempotence-Key header (детерминированная сторона — webhook event id
  `PaymentId:Status` + общий persist-event/CAS-конвейер). Отклонение от
  буквы спеки, задокументировано в COMMERCE.md.
- **D-002 (admin)**: выбран минимум «paste-ID + немедленная валидация»;
  выбор из списков / показ сущности перед действием — открыто.
- **Telegram replay-кэш**: in-memory (один инстанс API); при
  горизонтальном масштабировании — перенести в Redis (SECURITY.md).
- **E2E**: Telegram/VK/Yandex/Google OAuth-флоу в браузере не гоняются
  (реальные env); покрыты integration-тестами с мок-транспортом, в E2E
  провайдеры честно отсутствуют/заглушка TEST.
- Полный список вне scope — §15 спеки (мультивалютность, top-up, payouts,
  email/push, password reset, subscriptions, bundles и пр.).

## 4. Коммиты (§12)
Логические коммиты по workstream'ам (см. git log после этой записи):
identity → payments → UI/debt → tests → docs.

## 5. Приёмка (Definition of Done §14)
Discovery + динамические кнопки ✓ · Google/Yandex surfaced (env-documented)
✓ · VK ID + tests ✓ · Telegram direct + signature tests ✓ ·
/account/identities + link/unlink UI ✓ · OAuth-токены зашифрованы at rest ✓ ·
Смена пароля с инвалидацией сессий ✓ · Provider-neutral dispatch ✓ ·
webhook/:provider + raw-body + signature ✓ · Фиат-адаптер №2 + tests ✓ ·
Crypto-адаптер (RUB-locked, underpay policy) + tests ✓ · Checkout: выбор +
invoice-состояние ✓ · Reconciliation/refunds agnostic ✓ · Admin raw-ID
validation ✓ · Disputes RU ✓ · Focus traps ✓ · Search react-query ✓ ·
Auth-FOUC ✓ · Server stats 7d/30d ✓ · error/not-found/loading ✓ ·
api-ext modules + dead exports ✓ · Footer честен ✓ · Housekeeping ✓ ·
plan-016 E2E coverage ✓ · type-check/build/lint/unit ✓ · Полный E2E 68/68 ✓ ·
Документация обновлена ✓ · Логические коммиты ✓.