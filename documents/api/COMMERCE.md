# COMMERCE — покупки, платежи, споры, услуги, скидки, ledger

Область: `site/server/src/routes/{purchases,payments,disputes,services}.ts`,
`site/server/src/lib/{commerce,paymentStateMachine,ledger,discount,refunds,paymentProvider}.ts`.
Общие условия: [README](README.md). Все суммы — копейки RUB.
Платёжный провайдер — YooKassa (`lib/providers/payment-yookassa.ts`),
регистрируется side-effect-импортом в нейтральный реестр `IPaymentProvider`.

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
завершение покупки — только через верифицированный webhook YooKassa или
аттестованные dev-пути (simulate). Комментарий зафиксирован в
`routes/purchases.ts`.

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
ошибка программирования (500). Маппинг нативных статусов YooKassa —
`fromYooKassaStatus` (`succeeded/canceled/pending/waiting_for_capture`).

### POST /payments/create (`authenticate`)

Тело `{purchaseId}` (ресурсная линия) **или** `{servicePurchaseId}` (услуги).
Проверки: существование, владелец, статус PENDING (иначе 400). При
настроенном провайдере создаётся платёж YooKassa (сумма — FINAL total после
скидок, TASK A-011) и строка `Payment(PENDING, providerPaymentId)`; ответ
`{paymentUrl, paymentId}`. Провайдер отключён:

- для услуг — `{message:"YooKassa disabled - service order awaits manual payment setup", servicePurchaseId}`;
- для ресурсов — `{message:"YooKassa disabled - use /payments/:id/simulate for testing", purchaseId}`.

### POST /payments/webhook (публичный, транспортно-верифицируемый)

Idempotency и верификация (по порядку):

1. Провайдер не сконфигурирован → `503` (endpoint закрыт, не открыт).
2. Транспортная подлинность: IP-allowlist + HTTP Basic
   (`provider.verifyWebhook`, E-006); ошибки — 403 (IP) / 401 (auth).
3. Событие сохраняется **до** бизнес-эффектов в `PaymentProviderEvent`
   (`payloadHash` = SHA-256 тела; `attempts`++ при повторе). Уже
   `PROCESSED` → `200 {"message":"Event already processed"}` (безопасный
   повтор). События кроме `payment.succeeded|payment.canceled`
   ack-аются и закрываются как PROCESSED.
4. `payment.canceled`: локальный PENDING `Payment` → CANCELED; покупка
   (по `object.metadata.order_id`) из PENDING → FAILED (у Purchase нет
   CANCELED — FAILED терминален «без права»).
5. `payment.succeeded`: **повторная сверка с провайдером** (не доверяем телу):
   re-fetch `getPayment(object.id)`, требование `state=SUCCEEDED && paid`,
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

### POST /payments/cancel (`authenticate`)

Отмена PENDING-платежа у провайдера (`{paymentId}`); только платящий или
ADMIN. Не-PENDING → `409`. Ответ `{status:"CANCELED"}`.

### Возвраты (ADMIN)

- `POST /payments/refunds` — `{paymentId, amount?, reason?}` →
  `lib/refunds.ts` (INV-013: суммарный возврат ≤ захваченной суммы);
  ошибки — `PaymentRefundError` с кодом. Ответ `201 {refundId, …}`.
- `GET /payments/:paymentId/refunds` — список возвратов платежа.

### POST /payments/:id/simulate — только НЕ-production

Маршрут компилируется только при `NODE_ENV !== "production"`; в production
build его нет и запрос уходит в глобальный 404-обработчик (`404 {"error":
"Not found"}`) — т.е. в prod поведение 404, а не 403. Дополнительные условия
в dev: провайдер активен → 403; покупка не владельца → 403; не PENDING → 400;
нет order item → 409. Завершение — тот же атомарный `completeResourceOrderItem`
(лицензия, скидка, ledger). Ответ `{message, purchaseId, licenseId}`.

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

## Персистентные журналы

- `Payment` — нейтральные статусы машины; `PaymentProviderEvent` — идемпотентный
  лог webhook-доставок (`PROCESSING/PROCESSED/FAILED`, `attempts`, `lastError`).
- `Refund` — независимый lifecycle возвратов (INV-013).
- Модельный контекст: [DATA](../architecture/DATA.md).
