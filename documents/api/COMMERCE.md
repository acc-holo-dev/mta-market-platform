# COMMERCE — покупки, платежи, споры, услуги, скидки, ledger

Область: `site/server/src/routes/{purchases,payments,disputes,services}.ts`,
`site/server/src/lib/{commerce,paymentStateMachine,ledger,discount,refunds,paymentProvider,tbank,cryptoinvoice}.ts`.
Общие условия: [README](README.md). Все суммы — копейки RUB (мультивалютности
нет; крипто-провайдер — RUB-locked инвойсы, конверсия на стороне провайдера).
Платежи — нейтральный реестр `IPaymentProvider` (`lib/paymentProvider.ts`):
адаптеры `lib/providers/payment-{yookassa,tbank,crypto,test}.ts`
саморегистрируются side-effect-импортами в `routes/payments.ts`; маршруты
никогда не обращаются к SDK провайдера напрямую (E-002). Провайдер без env —
честно выключен и отсутствует в discovery (A-010).

## Checkout (`routes/purchases.ts`, `lib/commerce.ts`)

### POST /purchases (`authenticate`, per-user 30/мин)

Тело `{resourceSlug, discountCode?}`. Создаётся checkout-агрегат:
`Order` (намерение) + `OrderItem` (иммутабельная строка с `basePrice`,
`discountAmount`, `finalPrice`, fee-split) + `Purchase` (ресурсная линия).
Инварианты:

- ресурс должен быть PUBLISHED и иметь хотя бы одну версию;
- COMPLETED-покупка уже существует → `409 {code:"already_owned"}`;
- PENDING-покупка с order item → идемпотентный повтор того же checkout
  (`pending_purchase_exists` при отсутствии item);
- скидка валидируется на бэкенде от иммутабельной базовой цены
  (см. [Скидки](#скидки-libdiscountts)); невалидная —
  `400 {code:"discount_invalid", message}`.

Комиссия платформы — 10% от FINAL цены (`PLATFORM_FEE_RATE = 0.1`,
`lib/commerce.ts`).

Ответ `201` при `finalPrice == 0` (бесплатные и 100%-дисконт — завершаются
сразу тем же атомарным путём, что и платные):

```json
{"orderId","orderItemId","purchaseId","licenseId","status":"completed",
 "message":"Free resource acquired",
 "discount": {"applied":true,"amount":…,"originalPrice":…,"finalPrice":0}}
```

Иначе `201 {orderId, orderItemId, purchaseId, amount, originalAmount,
currency:"RUB", status:"pending", discount?: {applied, amount, percentage},
message:"Checkout created - create the payment via /payments/create"}`.

### GET /purchases/my, GET /purchases/:id

`/my` — список покупок покупателя c enrichment: `{resource:{slug,title,type},
version:{version}, license:{id,status}|null}`. `/:id` — детали (владелец,
UUID-валидация): полная строка покупки + resource + version + license
(`{id,status,serverSerial,activatedAt}`).

### Замечание о прямом завершении

`POST /purchases/:id/complete` **удалён** из соображений безопасности:
завершение покупки — только через верифицированный webhook включённого
платёжного провайдера (`/payments/webhook/:provider`) или аттестованные
dev-пути (simulate). Комментарий зафиксирован в `routes/purchases.ts`.

## Платежи (`routes/payments.ts`)

### Машина состояний (`lib/paymentStateMachine.ts`)

```
PENDING → SUCCEEDED | FAILED | CANCELED
SUCCEEDED → SETTLEMENT_PENDING | SETTLED | PARTIALLY_REFUNDED | REFUNDED
SETTLEMENT_PENDING → SETTLED | FAILED
SETTLED → PARTIALLY_REFUNDED | REFUNDED
PARTIALLY_REFUNDED → REFUNDED
FAILED/CANCELED/REFUNDED — терминальные
```

Каждая мутация `Payment` идёт через `assertTransition`; нелегальный переход —
ошибка программирования (500). Нативные статусы маппятся **в файле
провайдера** (PLAN-016 P-003; нейтральный `paymentStateMachine.ts` хранит
только нейтральный словарь): `fromYooKassaStatus`
(`succeeded/canceled/pending/waiting_for_capture` — `lib/providers/payment-yookassa.ts`),
`fromTBankStatus`, `fromCryptoStatus` (консервативно: неизвестный статус —
PENDING, терминальным никогда не угадывается).

### GET /payments/providers — discovery (PLAN-016)

Публичный список **включённых** платёжных провайдеров:

```json
{"providers":[{"provider":"YUKASSA","displayName":"ЮKassa","confirmation":"redirect"},
              {"provider":"CRYPTO","displayName":"Криптовалюта","confirmation":"crypto_invoice"}]}
```

`confirmation` выводится из capability `payment.poll`: провайдеры с
`payment.poll` — инвойсные (`crypto_invoice`), остальные — redirect PSP.
Выключенный провайдер в списке отсутствует; никакой конфигурации endpoint не
отдаёт.

### POST /payments/create (`authenticate`)

Тело `{purchaseId}` (ресурсная линия) **или** `{servicePurchaseId}` (услуги),
опционально `provider` (PLAN-016 P-001 — выбор способа оплаты в checkout).
Проверки: существование, владелец, статус PENDING (иначе 400).

- **Выбор провайдера**: явное имя побеждает (регистр не важен); иначе
  `PAYMENTS_DEFAULT_PROVIDER` → единственный включённый → legacy-фолбэк на
  YooKassa (канонический провайдер). Ничего не сконфигурировано → endpoint
  честно выключен (см. ниже).
- `provider` неизвестен → `400 {"error":"Unknown payment provider: X"}`;
  известен, но выключен (или без `payment.create`) →
  `409 {"error":"Payment provider X is disabled"}` — без тихого fallback.
- Провайдер создаёт платёж (сумма — FINAL total после скидок, TASK A-011) и
  строка `Payment(PENDING, providerPaymentId)`; ответ
  `{paymentUrl?, paymentId, provider, confirmation}` — `paymentUrl` для
  redirect-подтверждения, `confirmation` (`ProviderConfirmation`) —
  структурированное описание (`redirect` / `crypto_invoice` с
  `payUrl/address?/memo/expiresAt`), `null` для классического redirect.
- Провайдер отключён (без явного выбора):
  для услуг — `503 {"error":"Payment provider is not configured", servicePurchaseId}`;
  для ресурсов — `{message:"Payment provider disabled - use /payments/:id/simulate for testing", purchaseId}`.

### POST /payments/webhook/:provider — per-provider dispatch (PLAN-016 P-002)

`POST /payments/webhook/:provider` — публичный, транспортно-верифицируемый
вход для каждого провайдера. `POST /payments/webhook` остаётся
обратно-совместимым алиасом на **дефолтного** провайдера (та же
резолюция, что у create; YooKassa-настройки живут дальше) —
провайдер не сконфигурирован → `503`.

Транспортная подлинность — `provider.verifyWebhook` (E-006), причины отказа
маппятся точно: `"ip"` → `403`, `"auth"` → `401`, `"signature"` → `400`.
Сырые байты запроса: `express.json({verify})` в `app.ts` кладёт тело в
`req.rawBody` и передаёт провайдеру (крипто-адаптер переразбирает raw bytes
для подписи); `payloadHash` события = SHA-256 от raw bytes (fallback —
сериализованный parsed body). Формат провайдера нормализуется
`provider.parseWebhook` → нейтральное событие
`{providerEventId, eventType, providerPaymentId, orderRef?}`; нераспознанный
payload → 400. Дальше общий конвейер **не изменён** (по порядку):

1. Провайдер не сконфигурирован → `503` (endpoint закрыт, не открыт).
2. Транспортная подлинность (выше).
3. Событие сохраняется **до** бизнес-эффектов в `PaymentProviderEvent`
   (`payloadHash` = SHA-256 raw-байтов тела; `attempts`++ при повторе;
   DB-уникальность `[provider, providerEventId, eventType]` — у T-Bank
   `providerEventId` = `PaymentId:Status`, у крипто — uuid инвойса). Уже
   `PROCESSED` → `200 {"message":"Event already processed"}` (безопасный
   повтор). События кроме `payment.succeeded|payment.canceled`
   ack-аются и закрываются как PROCESSED.
4. `payment.canceled`: локальный PENDING `Payment` → CANCELED; покупка
   (по `parsed.orderRef` — `metadata.order_id` YooKassa / `OrderId` T-Bank /
   `order_id` крипто) из PENDING → FAILED (у Purchase нет
   CANCELED — FAILED терминален «без права»).
5. `payment.succeeded`: **повторная сверка с провайдером** (не доверяем телу):
   re-fetch `getPayment(parsed.providerPaymentId)`, требование
   `state=SUCCEEDED && paid`,
   совпадения суммы/валюты (RUB) и привязки провайдер-платежа к этому заказу;
   нарушение — quarantine: `PaymentProviderEvent.status=FAILED`, `409`.
   Дополнительно чинится out-of-order (canceled-then-succeeded): `Payment`/
   `Purchase` возвращаются в PENDING — «provider truth wins».
6. Завершение: ресурсы — `completeResourceOrderItem` (атомарно: CAS-переход
   статуса, лицензия, потребление скидки, статус Order; затем ledger-сеттлмент
   и SETTLED), услуги — `markServicePurchasePaid` (`PENDING→IN_PROGRESS`).
   Письмо покупателю (best-effort), `PaymentProviderEvent.status=PROCESSED`.

Ответы: `200 {"message":"Webhook processed successfully"}` / диагностические
400/404/409/503.

### Адаптеры провайдеров (`lib/providers/payment-*.ts`)

| Провайдер | Подтверждение | Capabilities | Верификация webhook |
|---|---|---|---|
| `YUKASSA` (канонический) | `redirect` | create/verification/cancel/refund/poll | IP-allowlist + HTTP Basic (E-006) |
| `TBANK` | `redirect` (PaymentURL) | create/verification/cancel/refund/poll | SHA-256 `Token` (ниже) + владение `TerminalKey` |
| `CRYPTO` | `crypto_invoice` | create/verification/poll (**без** cancel/refund) | `sign` крипто-провайдера по raw-байтам (ниже) |
| `TEST` (dev-only) | `crypto_invoice`-заглушка | create/verification/poll | webhook-канала нет — любой delivery отклоняется (`reason:"ip"`) |

**T-Bank EACQ** (`lib/tbank.ts` + `payment-tbank.ts`, env `TBANK_ENABLED=true`,
`TBANK_TERMINAL_KEY`, `TBANK_PASSWORD`): `/v2/Init` → redirect `PaymentURL`;
статусы `AUTHORIZED/CONFIRMED → SUCCEEDED`, `REJECTED/DEADLINE_EXPIRED →
FAILED`, `CANCELED/REVERSED → CANCELED`, `REFUNDED`/`PARTIALLY_REFUNDED`
маппятся напрямую, остальное — консервативно PENDING. Notification-`Token` —
SHA-256 по полям уведомления (ключи отсортированы, пары `${key}${value}`,
`Password` в конце), timing-safe; GetState/Cancel/Refund подписываются
отдельным request-token'ом (значения отсортированных параметров + Password).
Refund синхронный (сразу `SUCCEEDED`); у T-Bank нет Idempotence-Key-заголовка
— параметр нейтрального слоя принимается, но не отправляется. Тело
уведомления — JSON (токен считается по разобранным значениям, сырые байты
не требуются).

**Crypto (Cryptomus-класс)** (`lib/cryptoinvoice.ts` +
`payment-crypto.ts`, env `CRYPTO_ENABLED/CRYPTO_MERCHANT_ID/CRYPTO_API_KEY`):
RUB-locked инвойсы — инвойс создаётся на RUB-сумму FINAL total, конверсия на
стороне провайдера; сверка `currency === "RUB"` сохранена (схема БД на
мультивалютность не менялась). Подтверждение — `crypto_invoice`
(`payUrl`, `memo` = внутренний order id, `expiresAt` = TTL
`CRYPTO_INVOICE_TTL_SEC`, дефолт 1 ч) + capability `payment.poll` (re-fetch
`GET /v1/payment/{uuid}`) — cancel/refund вне API провайдера, capability-гейт
это скрывает. TTL инвойса/`expired` → CANCELED. Политика расхождений:
недоплата (статусы `underpaid`/`wrong_amount` или paid_amount ниже порога
`required*(1−CRYPTO_UNDERPAY_TOLERANCE_PCT%)`, дефолт 0) → invoice FAILED —
«частично завершённая покупка» невозможна; переплата ≥ порога → принимается
полная услуга, разница — вопрос оператора, вне платформы; funded-статусы
(`paid/paid_over/confirming/confirmed`) проходят amount-гейт, прежде чем
маппиться в `SUCCEEDED`. Callback-подпись — формула крипто-провайдера
(`sign` = md5(base64(JSON без поля sign) + api key), сравнение timing-safe);
сырые байты переразбираются, когда доступны.

**TEST** (`payment-test.ts`, P-007): только при
`PAYMENTS_TEST_ENABLED=true` и `NODE_ENV !== "production"`; заглушка
`crypto_invoice` (`memo:"DEV-TEST"`, TTL `PAYMENTS_TEST_TTL_SEC`, дефолт
600 с), провайдер-статус всегда PENDING — покупку завершает dev-путь
`POST /payments/:id/simulate` (см. ниже). В production не регистрируется.

### POST /payments/cancel (`authenticate`)

Отмена PENDING-платежа **у его собственного провайдера** (`{paymentId}` —
провайдер берётся из строки `Payment`, не дефолт; PLAN-016 P-001); только
платящий или ADMIN. Capability-гейт: у провайдера без `payment.cancel`
(крипто, TEST) → `503 {"error":"Provider cancellation is not available"}`.
Не-PENDING → `409`. Ответ `{status:"CANCELED"}`.

### Возвраты (ADMIN)

- `POST /payments/refunds` — `{paymentId, amount?, reason?}` →
  `lib/refunds.ts` (INV-013: суммарный возврат ≤ захваченной суммы);
  ошибки — `PaymentRefundError` с кодом. Ответ `201 {refundId, …}`.
- `GET /payments/:paymentId/refunds` — список возвратов платежа.

### POST /payments/:id/simulate — только НЕ-production

Маршрут компилируется только при `NODE_ENV !== "production"`; в production
build его нет и запрос уходит в глобальный 404-обработчик (`404 {"error":
"Not found"}`) — т.е. в prod поведение 404, а не 403. Дополнительные условия
в dev (PLAN-016 P-007): активен любой **не-TEST** провайдер → 403
(`"Cannot simulate in production"`); TEST-провайдер боевым не считается —
его инвойсы завершаются именно simulate; покупка не владельца → 403; не
PENDING → 400; нет order item → 409. Завершение — тот же атомарный
`completeResourceOrderItem` (лицензия, скидка, ledger). Ответ
`{message, purchaseId, licenseId}`. Honors `Idempotency-Key` (PLAN-012 §5).

## Скидки (`lib/discount.ts`)

- Кампании `DiscountCampaign`: `type PERCENT|FIXED`, `scope ALL|RESOURCE|SERVICE`
  (+`scopeId`), окна `startsAt/endsAt`, `minOrderAmount`, `usageLimit`/`usedCount`,
  `perUserLimit` (MVP: null или 1).
- `validateDiscount` — read-only: код/окно/scope/минимум/лимиты/валюта;
  `perUserLimit > 1` не поддерживается (ошибка). Сумма: PERCENT —
  `floor(base*value/100)`, FIXED — фиксированная в копейках (валюта обязана
  совпадать); клампится в `[0, basePrice]`.
- Потребление — `consumeDiscount` **внутри транзакции завершения заказа**
  (C-007): идемпотентно по `(campaignId, orderItemId)`; лимит кампании —
  compare-and-set на `usedCount` (параллельные завершения не превышают
  лимит); per-user breach откатывает счётчик (без фантомного usage).
- Админские endpoints кампаний в routes **не реализованы** — кампании
  создаются администратором БД/скриптами; helper `canCreateDiscount`
  сохранён из Phase C.

## Услуги (`routes/services.ts`)

Листинг: `DRAFT → PENDING_REVIEW → PUBLISHED / SUSPENDED`; публиковать свою
услугу продавец не может (только ADMIN/MODERATOR — тот же принцип, что у
ресурсов). Заказы услуг не создают DRM-лицензии (INV-015).

Каталог и CRUD:

| Маршрут | Кто | Эффект |
|---|---|---|
| `GET /services` | публично | каталог PUBLISHED |
| `GET /services/my` | владелец | свои услуги |
| `POST /services` | APPROVED-продавец | `{title, description, type, price, deliveryDays, requirements?}`; slug генерируется; 400 при нехватке полей |
| `PATCH /services/:id` | владелец | поля; правка в PENDING_REVIEW откатывает в DRAFT |
| `POST /services/:id/submit` | владелец | DRAFT→PENDING_REVIEW (CAS; иначе 409) |
| `POST /services/:id/publish` | модератор | PENDING_REVIEW→PUBLISHED |
| `POST /services/:id/suspend` | модератор | PUBLISHED→SUSPENDED |
| `GET /services/:slug` | публично | PUBLISHED-детали |

Заказ услуги (состояния `ServicePurchase`: `PENDING → IN_PROGRESS →
DELIVERED → ACCEPTED → CLOSED`, альтернативы `CANCELLED`, `DISPUTED`):

- `POST /services/:slug/order` (`authenticate`) — checkout услуги
  (`createServiceCheckout`: Order + ServiceOrderItem + ServicePurchase,
  поддержка `discountCode`, `buyerNotes`). Ошибки — `CommerceError`.
- `GET /services/orders/my` — заказы покупателя (+service slug/title).
- `POST /services/orders/:id/deliver` — продавец: IN_PROGRESS→DELIVERED +
  `ServiceDelivery{notes, deliverableRef?}` (транзакционно; иначе 409).
- `POST /services/orders/:id/revision` — покупатель: DELIVERED→IN_PROGRESS +
  `ServiceRevision(OPEN)`; максимум 3 ревизии на заказ (C-011); без доставки —
  откат статуса, 409.
- `POST /services/orders/:id/accept` — покупатель: DELIVERED→ACCEPTED;
  **сеттлмент выручки** (`settleServiceRevenue`) происходит на accept.
- `POST /services/orders/:id/close` — ACCEPTED→CLOSED (любая сторона).
- `POST /services/orders/:id/cancel` — PENDING/IN_PROGRESS→CANCELLED;
  возвраты за платные отмены — не реализовано (Phase E, пометка в коде).
- `POST /services/orders/:id/dispute` — PENDING/IN_PROGRESS/DELIVERED→DISPUTED
  (заморозка; формальный dispute — через `/disputes`).
- `GET/POST /services/orders/:id/messages` — чат участников
  (`ServiceOrderMessage`, `senderRole BUYER|SELLER|ADMIN`).

## Споры (`routes/disputes.ts`)

Машина (админ ведёт машину; стороны создают/переписываются):

```
OPEN → WAITING_BUYER | WAITING_SELLER | UNDER_REVIEW | CLOSED
WAITING_BUYER ↔ WAITING_SELLER → UNDER_REVIEW | CLOSED
UNDER_REVIEW → RESOLVED_BUYER | RESOLVED_SELLER | PARTIAL_REFUND | CLOSED
PARTIAL_REFUND → CLOSED;  RESOLVED_* / CLOSED — терминальные
```

- `POST /disputes` (`authenticate`) — покупатель заказа: `{targetType:
  PURCHASE|SERVICE_PURCHASE, purchaseId|servicePurchaseId, reason}`; спорен
  только «денежный» статус (PENDING/COMPLETED/DISPUTED у Purchase;
  PENDING/IN_PROGRESS/DELIVERED/DISPUTED у услуг); один открытый спор на
  заказ (409). Открывший спор замораживает заказ (Purchase COMPLETED→DISPUTED;
  услуга →DISPUTED). Каждое событие — append-only `DisputeEvent`.
- `GET /disputes/my` — споры, где вызывающий покупатель или продавец.
- `GET /disputes/:id` — спор + messages + events (участники и модераторы).
- `POST /disputes/:id/messages` — переписка участников (+ADMIN).
- `POST /disputes/:id/transition` (ADMIN) — легальный переход (иначе 409) +
  бизнес-эффекты: услуги — RESOLVED_SELLER возвращает в IN_PROGRESS, иные
  резолюции закрывают заказ; ресурсы — RESOLVED_SELLER/CLOSED возвращают
  COMPLETED; деньги при RESOLVED_BUYER/PARTIAL_REFUND идут **только** через
  `POST /payments/refunds` (рефанд сам переведёт покупку в REFUNDED).
- `GET /disputes/admin/all?status=` — очередь для админа.

## Ledger и балансы (`lib/ledger.ts`)

- Источник истины — append-only `LedgerEntry`, сгруппированные в сбалансированные
  транзакции (`transactionId`; INV-012: `sum(debits) == sum(credits)`,
  суммы строго положительные; иначе `LedgerUnbalancedError`).
- Сеттлмент покупки (`settlePurchaseRevenue`): инвариант
  `platformFee + sellerRevenue == finalPrice` (сверяется всегда), затем
  двойная запись: `DEBIT platform_cash finalPrice`,
  `CREDIT seller_available:<seller> sellerRevenue`,
  `CREDIT platform_revenue platformFee`. Бесплатные заказы ничего не постят
  (F-005). `transactionId` детерминированный (`settle:purchase:<id>`) —
  ретрай после падения безопасен.
- Кэш баланса: `SellerBalance.availableAmount/totalEarned`
  (+ legacy-строки `FinancialTransaction`). `REFUND_FROM_SELLER` уменьшает кэш
  (согласовано с DEBIT-стороной).
- Коды счетов — `LEDGER_ACCOUNT_CODES` (`platform_cash`, `platform_revenue`,
  `refund_reserve`, `adjustments`, `seller_pending:<uid>`, `seller_available:<uid>`).

**Балансы как API**: выделенных `/ledger`-или `/balances`-endpoints нет —
пользовательский баланс (`UserBalance.available`) отдаётся в
`GET /auth/me` и в ответах register/login ([AUTH](AUTH.md)); SellerBalance —
пока без публичного чтения через API (управляется settlement/рефонами и
реконсиляцией `site/server/src/lib/reconciliation/`).

## Реконсиляция (`lib/reconciliation/`, `jobs/reconciliation.ts`)

- **Провайдер-агностична** (PLAN-016 P-006): платёжный/возвратный/payout-циклы
  выполняются по каждому **включённому** провайдеру реестра, не по
  хардкоду; результаты агрегируются per-provider. Провайдер без реализованной
  provider-side выгрузки (реально re-fetch реализован у YooKassa) честно
  отдаёт `internalCount` с `providerCount=0` и `available=false` — без
  фиктивных mismatch'ей.
- Backfill `runReconciliationForDateRange(start, end, provider?)`: без явного
  провайдера покрывает все включённые (тот же контракт, что у цикла).
- Шаги цикла (ежедневно, `RECONCILIATION_INTERVAL_MS`): payment/refund/payout
  reconciliation per provider → `checkProviderEventMismatches`
  (`PaymentProviderEvent` vs `Payment`) → внутренняя ledger-сверка
  (`reconcileAllPurchases`). Падение шага не ломает остальные;
  результаты — `ReconciliationReport` + structured logs.

## Персистентные журналы

- `Payment` — нейтральные статусы машины; `provider` — enum `PaymentProvider`
  (`YUKASSA|STRIPE|TEST|TBANK|CRYPTO`; расширение TBANK/CRYPTO — миграция
  `site/server/migrations/app/20260912T0456_plan016_payment_providers/`).
- `PaymentProviderEvent` — идемпотентный лог webhook-доставок
  (`PROCESSING/PROCESSED/FAILED`, `attempts`, `lastError`, `payloadHash`;
  DB-уникальность `[provider, providerEventId, eventType]`).
- `Refund` — независимый lifecycle возвратов (INV-013).
- Модельный контекст: [DATA](../architecture/DATA.md).
