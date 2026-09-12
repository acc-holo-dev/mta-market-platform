
# PLAN-012 — Transactional Correctness & Platform Consistency

## 0. НАЗНАЧЕНИЕ

Ты работаешь с главным репозиторием:

```text
acc-holo-dev/mta-market-platform
```

Это единый monorepo всей платформы MTA Market.

PLAN-011 уже завершил объединение:

```text
mta-market-site
mta-market-module
mta-market-document
```

в единый repository.

Теперь задача PLAN-012 — **не добавлять новую крупную пользовательскую функциональность**, а перевести существующую платформу в более строгое и надёжное состояние.

Главная цель:

```text
"Работает"
        ↓
"Корректно работает при конкуренции,
повторных запросах, сбоях и нескольких инстансах"
```

Одновременно необходимо устранить обнаруженные остатки миграции PLAN-011 и синхронизировать repository/documentation truth.

---

# 1. ОБЯЗАТЕЛЬНОЕ ПЕРЕД НАЧАЛОМ

Не начинать реализацию сразу.

Сначала самостоятельно изучить:

```text
documents/product/
documents/architecture/
documents/development/
documents/adr/
documents/api/
documents/drm/
documents/operations/
documents/history/

contracts/

site/server/src/
site/server/migrations/
site/web/

module/src/
module/CMakeLists.txt
module/CMakePresets.json

tests/

infrastructure/
scripts/
.github/
```

Особенно изучить:

```text
documents/development/CURRENT.md
documents/development/NEXT-PHASE.md
documents/product/PRODUCT-ARCHITECTURE.md
documents/product/PRODUCT-MODEL.md
documents/product/PROJECT.md
documents/architecture/DATA.md
documents/architecture/SECURITY.md
documents/architecture/TESTING.md
documents/drm/PROTOCOL-V2.md
documents/history/MIGRATION.md
```

Не создавать собственное альтернативное понимание продукта.

Документация является source of truth.

Но при конфликте:

```text
actual code
+
actual tests
+
actual database
```

необходимо выявить конфликт и задокументировать его.

Не молча менять документацию под код.

---

# 2. СОСТОЯНИЕ, КОТОРОЕ НУЖНО ПОЛУЧИТЬ

После PLAN-012:

```text
Checkout
Payment
Webhook
Refund
Dispute
Settlement
Ledger
Seller Balance
```

должны иметь формальные гарантии:

```text
idempotency
atomicity
exactly-once effects
database invariants
concurrency safety
recoverability
```

Также repository должен соответствовать собственным правилам:

```text
documents/
contracts/
site/
module/
tests/
logs/
scripts/
config/
infrastructure/
```

---

# 3. ОБЛАСТЬ ПЕРВАЯ — REPOSITORY CONSISTENCY

Провести repository-wide audit.

Проверить:

## Markdown

Все:

```text
*.md
```

только в:

```text
documents/
```

Запрещено:

```text
site/*.md
site/**/README.md
module/*.md
tests/*.md
root/*.md
```

кроме случаев, когда файл технически создаётся GitHub и его перемещение невозможно.

Если такие исключения существуют — явно зафиксировать.

---

## Tests

Во всём проекте единственный test root:

```text
tests/
```

Найти и устранить остатки:

```text
site/server/tests/
site/web/tests/
module/tests/
test/
```

Особенно проверить старые migration leftovers.

Не просто удалять.

Для каждого найденного теста определить:

```text
MOVE
MERGE
DELETE
REWRITE
```

---

## Logs

Единственный root:

```text
logs/
```

Удалить/перенести случайные:

```text
log/
site/logs/
module/logs/
```

Runtime log files не должны tracked.

---

## Naming

Проверить:

```text
documents
contracts
tests
logs
scripts
config
infrastructure
```

Не допускать:

```text
document
test
log
script
infra
docs
```

как альтернативных root conventions.

---

# 4. ОБЛАСТЬ ВТОРАЯ — CHECKOUT IDEMPOTENCY

Исследовать:

```text
site/server/src/lib/commerce.ts
site/server/src/routes/purchases.ts
```

и связанные модели.

Текущий механизм использует application-level lock:

```text
checkout:user:resource
```

Он полезен, но не достаточен для multi-instance deployment.

Необходимо реализовать database-level invariant.

Цель:

```text
10 одновременных checkout requests
        ↓
exactly one logical purchase flow
```

Нужно решить:

* unique constraint;
* partial unique index;
* idempotency record;
* transaction boundary.

Не выбирать решение по удобству.

Решение должно соответствовать существующей ORM/database architecture.

---

# 5. IDEMPOTENCY KEY

Добавить полноценный механизм idempotency для финансово значимых mutation endpoints там, где он действительно нужен.

Минимально рассмотреть:

```text
POST /purchases
payment creation
payment simulation
refund
settlement
```

Использовать:

```http
Idempotency-Key: UUID
```

Хранить request identity в БД.

Требования:

```text
same key + same operation
→ same logical result

same key + conflicting payload
→ deterministic rejection
```

Повторный HTTP request не должен создавать вторую финансовую сущность.

---

# 6. ОБЛАСТЬ ТРЕТЬЯ — PAYMENT IDEMPOTENCY

Проверить provider payment model.

Не доверять application-level:

```text
if payment exists
```

без DB invariant.

Необходимо обеспечить:

```text
same internal payment
+
same provider payment
+
same webhook
```

не создают повторный purchase/license/ledger effect.

---

# 7. ОБЛАСТЬ ЧЕТВЁРТАЯ — WEBHOOK EXACTLY-ONCE EFFECT

Изучить:

```text
site/server/src/routes/payments.ts
site/server/src/lib/*
```

Проверить:

```text
providerEvent persistence
payment state
purchase completion
license creation
ledger effects
notifications
```

Цель:

```text
same webhook × N
        ↓
one business effect
```

Важный принцип:

```text
Webhook delivery may be at-least-once.
Business effect must be effectively exactly-once.
```

Должен существовать DB-level invariant для provider event identity.

---

# 8. ОБЛАСТЬ ПЯТАЯ — LEDGER ATOMICITY

Особенно тщательно изучить:

```text
site/server/src/lib/ledger.ts
```

Текущий risk:

```text
READ balance
↓
calculate
↓
WRITE balance
```

Это нельзя оставлять в денежном контуре.

Необходимо перейти на atomic mutation:

```text
UPDATE balance
SET amount = amount + delta
```

либо эквивалент с row locking.

---

# 9. LEDGER TRANSACTION BOUNDARY

Проверить settlement.

Операции:

```text
Seller revenue
Seller balance
Financial transaction
Ledger entries
Idempotency marker
```

по возможности должны происходить **в одной database transaction**.

Не допускать состояния:

```text
balance updated
ledger absent
```

или:

```text
ledger exists
balance not updated
```

без корректного recoverable state.

---

# 10. LEDGER DATABASE INVARIANTS

Определить database-level guarantees.

Минимально:

```text
same settlement cannot be posted twice
same ledger transaction cannot be posted twice
balance mutation cannot silently overwrite another mutation
```

Если для этого необходима migration:

создать formal migration.

Не использовать ad-hoc SQL во время application startup.

---

# 11. MULTI-INSTANCE CORRECTNESS

Это принципиально важно.

Текущий key-lock может защищать single-instance topology.

Он не должен считаться доказательством multi-instance correctness.

Проверить сценарии:

```text
instance A
instance B

same checkout
same payment
same webhook
same settlement
same refund
```

Цель:

```text
distributed duplicate request
        ↓
database invariant
        ↓
one business effect
```

---

# 12. REFUND CORRECTNESS

Изучить:

```text
refund service
payments
disputes
ledger
```

Проверить:

```text
same refund requested twice
refund + settlement race
refund + webhook race
dispute resolution + refund race
```

Гарантировать:

```text
one financial refund effect
```

---

# 13. DISPUTE CONSISTENCY

Изучить:

```text
site/server/src/routes/disputes.ts
```

и весь lifecycle:

```text
OPEN
WAITING_BUYER
WAITING_SELLER
UNDER_REVIEW
RESOLVED_BUYER
RESOLVED_SELLER
PARTIAL_REFUND
CLOSED
```

Проверить:

* state transitions;
* target purchase freezing;
* refund side effects;
* settlement side effects;
* append-only events;
* duplicate transition;
* concurrent transition.

Все money-affecting transitions должны быть transaction-safe.

---

# 14. DB STATE MACHINE INVARIANTS

Не ограничиваться:

```ts
if (state === ...)
```

в application code.

Для каждого критического transition определить:

```text
allowed transition
actor
financial effect
audit effect
notification effect
```

Не позволять параллельным запросам перескакивать состояние.

Пример:

```text
UNDER_REVIEW
        ↓
PARTIAL_REFUND
```

должен быть атомарным относительно второго admin request.

---

# 15. CONCURRENCY TEST SUITE

Root:

```text
tests/concurrency/
```

должен стать настоящим correctness suite.

Минимально создать/доработать:

```text
tests/concurrency/commerce/parallel-checkout.test.ts
tests/concurrency/payment/duplicate-webhook.test.ts
tests/concurrency/payment/parallel-refund.test.ts
tests/concurrency/ledger/parallel-settlement.test.ts
tests/concurrency/ledger/balance-race.test.ts
tests/concurrency/disputes/parallel-transition.test.ts
```

Тесты должны делать реальный параллельный execution, а не просто два последовательных вызова.

---

# 16. FAILURE / RECOVERY TESTS

Добавить tests для failure windows.

Например:

```text
DB transaction interrupted
provider response duplicated
request repeated after timeout
process restart after financial mutation
```

Проверять конечное состояние:

```text
database invariant
financial invariant
ledger invariant
license invariant
```

---

# 17. BALANCE RECONCILIATION

Изучить существующий reconciliation.

Определить:

```text
source of truth
cached balance
ledger total
```

Формально зафиксировать:

```text
ledger = canonical financial history
balance = derived/maintained aggregate
```

или другую выбранную модель.

Не допускать, чтобы reconciliation использовался как замена atomic correctness.

Reconciliation должен исправлять чрезвычайные случаи, а не обычные race conditions.

---

# 18. DUPLICATE ORDERS

Проверить DB schema.

Найти:

```text
Order
Purchase
OrderItem
Payment
```

и их уникальные поля.

Создать constraints, где это возможно.

Не полагаться только на:

```ts
findFirst()
```

перед `create()`.

---

# 19. DISCOUNT CONCURRENCY

Изучить discount/promocode system.

Проверить:

```text
usage limit
per-user limit
parallel redemption
```

Сценарий:

```text
10 requests
usage limit = 1
```

результат должен быть:

```text
1 success
9 rejection
```

а не:

```text
10 success
```

---

# 20. LICENSE CONCURRENCY

Проверить создание license после payment completion.

Сценарий:

```text
duplicate webhook
parallel completion
retry
```

должен приводить:

```text
one logical license
```

Не создавать duplicate entitlements.

---

# 21. TECHNICAL DEBT FROM PLAN-011

Обязательно проверить и закрыть или formally defer:

### A

```text
node dist/
```

Production runtime должен быть проверен реально.

Не достаточно:

```text
tsx src/index.ts
```

Проверить:

```text
build
image
container
runtime
health
shutdown
```

---

### B

Clang issue.

Найти точную причину:

```text
Json incomplete-type
```

и решить:

```text
FIX
или
FORMAL TOOLCHAIN POLICY
```

Если GCC является официальным release toolchain, это должно быть формально документировано.

---

### C

Windows module build.

Разобрать:

```text
netdb.h
timegm
```

и определить platform abstraction.

Не делать fake compatibility.

Если Windows поддерживается — исправить.

Если не поддерживается — формально определить support matrix.

---

### D

OpenAPI.

Определить, какие endpoints ещё не имеют formal request/response schema.

Не пытаться одним огромным PR описать абсолютно всё.

Начать с public/auth/commerce API.

---

### E

`/creators/[username]` vs `/sellers/[username]`

Выбрать canonical public concept.

Обновить:

```text
code
documents
routes
links
tests
contracts
```

Старый alias можно сохранить, если это действительно необходимо.

---

### F

`OFFLINE` semantics.

Согласовать:

```text
lifecycle state
operational state
```

с:

```text
PRODUCT-MODEL
PRODUCT-ARCHITECTURE
server implementation
tests
```

---

# 22. DOCUMENTATION TRUTH SYNC

После code audit обновить документы, если фактическое поведение изменилось.

Особенно:

```text
documents/development/CURRENT.md
documents/development/reference/NEXT-PHASE.md
documents/product/PRODUCT-MODEL.md
documents/architecture/DATA.md
documents/architecture/SECURITY.md
documents/architecture/TESTING.md
documents/api/COMMERCE.md
documents/api/DRM.md
documents/history/MIGRATION.md
```

Не переписывать продуктовую vision ради соответствия коду.

---

# 23. CONTRACT CONSISTENCY

Проверить:

```text
contracts/
```

против:

```text
site/
module/
tests/
```

Особенно:

```text
DRM
module integration
heartbeat
review token
payments
commerce
```

Если contract неверен:

```text
identify
fix implementation OR contract
```

с обязательной rationale.

---

# 24. CI

CI должен проверять не только:

```text
build
unit tests
E2E
security
```

но и repository invariants.

Добавить/усилить validation:

```text
.md location
tests location
logs policy
duplicate root directories
contracts parse
```

Concurrency suite обязателен.

E2E обязателен.

---

# 25. GIT / DEPENDABOT

Не превращать PLAN-012 в бесконечное обновление зависимостей.

PR Dependabot:

```text
не являются целью плана
```

Обновлять только если:

* security fix;
* необходимая совместимость;
* build blocker;
* dependency прямо мешает цели плана.

Не делать массовую dependency migration только ради уменьшения количества PR.

---

# 26. NO MASS REWRITE

Запрещено:

```text
rewrite entire backend
rewrite entire frontend
rewrite entire module
```

ради архитектурной красоты.

Изменения должны быть:

```text
targeted
incremental
tested
reversible
```

---

# 27. ACCEPTANCE CRITERIA

PLAN-012 считается выполненным только если:

## Repository

* [ ] отсутствуют stray tests;
* [ ] отсутствуют stray logs;
* [ ] `.md` policy соблюдается;
* [ ] naming policy соблюдается;
* [ ] migration residue устранён.

## Commerce

* [ ] checkout защищён DB-level invariant;
* [ ] duplicate checkout не создаёт второй logical purchase;
* [ ] idempotency keys работают;
* [ ] conflicting idempotency key deterministic reject.

## Payments

* [ ] duplicate webhook безопасен;
* [ ] provider event idempotent;
* [ ] duplicate completion безопасен;
* [ ] duplicate refund безопасен.

## Ledger

* [ ] balance mutation atomic;
* [ ] settlement atomic;
* [ ] duplicate settlement impossible;
* [ ] ledger entries idempotent;
* [ ] balance/ledger consistency проверяется.

## Disputes

* [ ] state transitions concurrency-safe;
* [ ] money effects transaction-safe;
* [ ] duplicate transitions безопасны;
* [ ] dispute events append-only.

## Discounts

* [ ] usage limits concurrency-safe.

## Licenses

* [ ] duplicate purchase completion не создаёт duplicate license.

## Tests

* [ ] concurrency tests реально параллельные;
* [ ] failure/recovery tests существуют;
* [ ] все unit/integration/concurrency проходят;
* [ ] E2E проходят.

## Production

* [ ] production container реально стартует;
* [ ] backend `dist` runtime проверен;
* [ ] health/readiness работают;
* [ ] graceful shutdown работает.

## Module

* [ ] Linux release toolchain проходит;
* [ ] Windows support policy определена;
* [ ] Clang policy определена.

## Contracts

* [ ] contracts parse;
* [ ] major implementations соответствуют contracts.

## Documentation

* [ ] CURRENT актуален;
* [ ] NEXT-PHASE актуален;
* [ ] architecture docs не противоречат implementation;
* [ ] migration history обновлена.

---

# 28. РЕЗУЛЬТАТ ПЛАНА

После PLAN-012 система должна находиться в состоянии:

```text
MTA Market Platform
        │
        ├── Product
        ├── Site
        ├── Module
        ├── Contracts
        ├── Tests
        ├── Infrastructure
        └── Documentation
```

и критические финансовые операции:

```text
Checkout
Payment
Webhook
Purchase
License
Refund
Dispute
Settlement
Ledger
Balance
```

должны иметь не только happy-path implementation, но и доказанную корректность при:

```text
retry
duplicate request
parallel request
process failure
multi-instance execution
```

---

# 29. ФИНАЛЬНЫЙ ОТЧЁТ АГЕНТА

По завершении обязательно предоставить:

```text
1. Repository audit
2. Documentation audit
3. Commerce audit
4. Payment audit
5. Ledger audit
6. Dispute audit
7. Concurrency audit
8. Database constraints added
9. Migrations added
10. Files moved/removed
11. Tests added
12. Tests executed
13. E2E result
14. Module result
15. Production runtime result
16. CI result
17. Remaining technical debt
18. Known limitations
19. Final architecture state
20. Exact commit list
```

Для каждой найденной проблемы использовать статус:

```text
FIXED
DEFERRED
ACCEPTED RISK
NOT APPLICABLE
```

Нельзя писать:

```text
"готово"
```

если соответствующая проверка фактически не выполнена.

---

# 30. ОСНОВНОЙ РЕЗУЛЬТАТ

Этот Plan не должен превращаться в бесконечный рефакторинг.

Его конечная точка:

```text
MTA Market Platform
```

имеет:

```text
единый repository
+
единые contracts
+
централизованные tests
+
transactionally correct commerce
+
idempotent payments
+
atomic ledger
+
concurrency safety
+
production runtime verification
+
актуальную документацию
```

Только после этого выбирать следующую большую продуктовую фазу.
