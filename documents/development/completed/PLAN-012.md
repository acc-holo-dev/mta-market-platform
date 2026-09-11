# PLAN-012 — Transactional Correctness & Platform Consistency (выполнен)

Дата: 2026-09-11. Статус: IMPLEMENTATION COMPLETE.

## 1. Repository audit

- Stray tests: `site/server/tests/` (33 *.test.ts + helpers/db-reset.ts +
  helpers/zip.ts) — все являются pre-centralization дубликатами с
  переписанными путями импорта (16–18 пар отличались только импортами,
  16 — 2–18 механическими строками; канонические копии в tests/ активны).
  **FIXED: DELETE** всей директории + удаление dangling
  `site/server/vitest.config.ts` + dead-скрипта `test` в
  site/server/package.json.
- Stray logs: не найдены (logs/ содержит только tracked .gitkeep; *.log
  нигде не tracked) — NOT APPLICABLE.
- .md policy: единственный tracked .md вне documents/ —
  `.github/pull_request_template.md` (GitHub-technical exception;
  перемещение технически невозможно). **Исключение явно зафиксировано**
  в validate.yml (grep -v '^\.github/pull_request_template\.md$').
- Naming policy: violations отсутствуют (document/ test/ log/ script/
  infra/ docs/ не существуют на любом уровне) — NOT APPLICABLE.
- Migration residue: см. §1.

## 2. Documentation audit — FIXED (см. §15)

## 3. Commerce audit

- Checkout: key-lock дополнен DB-инвариантом
  `purchase_buyer_resource_live_uq` (одна живая PENDING|COMPLETED покупка
  на buyer+resource; FAILED/REFUNDED не блокируют повторный checkout).
  Поток, проигравший гонку (межинстансовую), ре-представляет checkout
  победителя вместо ошибки. FIXED.
- Duplicate checkout не создаёт второй logical purchase — покрыто тестом
  (parallel-checkout: 5 параллельных → 201×1 + 409×4, одна лицензия). FIXED.
- Idempotency keys: с Idempotency-Key повтор возвращает сохранённый ответ;
  conflicting payload → 409 idempotency_key_conflict. Механизм опционален
  (без header — прежнее поведение), DB-инварианты — жёсткая гарантия. FIXED.
- Conflicting idempotency key: deterministic reject. FIXED.

## 4. Payment audit

- Duplicate webhook безопасен: PaymentProviderEvent уникальность
  [provider, providerEventId, eventType] + adopt-winner в гонке создания
  события. FIXED.
- Provider event idempotent: unique constraint существовал; обработка
  unique-violation race добавлена. FIXED.
- Duplicate completion безопасен: CAS PENDING→COMPLETED + license-if-missing
  (unique purchaseId). FIXED (существовало, усилено тестами).
- Duplicate refund: параллельные полные возвраты — ровно 1 success + N
  deterministic rejections (400/409), потолок INV-013 держится. FIXED.
- Re-attempt платежа после CANCELED: blanket-unique на payment.purchaseId /
  orderItemId заменены partial unique только по CAPTURED-состояниям —
  500 на повторное создание платежа устранён. FIXED.

## 5. Ledger audit

- Balance mutation atomic: `UPDATE sellerBalance SET "availableAmount" =
  "availableAmount" + delta ... RETURNING` через raw lane — read-then-write
  в JS устранён. FIXED.
- Settlement atomic: legacy cache (SellerBalance) + legacy row
  (FinancialTransaction) + double-entry (LedgerEntry) в ОДНОЙ транзакции
  для purchase и service settlement. FIXED.
- Duplicate settlement impossible: `ledger_entry_tx_account_direction_uq` +
  `financial_txn_settlement_once_uq` (межинстансово). FIXED.
- Ledger entries idempotent: deterministic ids + unique index. FIXED.
- Balance/ledger consistency проверяется reconciliation (internal.ts) —
  ACCEPTED (reconciliation — аварийный инструмент, не замена атомарности,
  см. PLAN-012 §17: ledger = canonical, balance = derived cache).

## 6. Dispute audit

- State transitions concurrency-safe: CAS по текущему статусу. FIXED.
- Money effects transaction-safe: DISPUTED→COMPLETED restore — CAS
  (не перезаписывает REFUNDED). FIXED.
- Duplicate transitions безопасны: дубликат того же перехода acknowledged
  (+событие STATUS_CHANGE_DUPLICATE_IGNORED), конфликтный → 409. FIXED.
- Dispute events append-only (существующий DisputeEvent). NOT APPLICABLE
  (уже было).
- One-open-dispute: DB partial unique. FIXED.

## 7. Concurrency audit

Реальный параллельный execution (Promise.all × N через supertest/app):
- parallel-checkout (FREE + paid flows), duplicate-webhook (parallel ×4),
- NEW parallel-refund (×4 full-refund race),
- NEW balance-race (20 параллельных дельт — аддитивная композиция,
  rollback-инвариант), parallel-settlement (усилен: ровно 1 FinancialTransaction),
- NEW parallel-transition (споры: open ×5 → 1; UNDER_REVIEW → разные
  RESOLVED_* параллельно → 1 победитель),
- NEW idempotency-key (replay, conflict, parallel same-key ×6),
- discount coupon race (существующий commerce C-007, 20 параллельных).

## 8. Database constraints added (миграция 20260911T1014, 12 ops)

1. `purchase_buyer_resource_live_uq` — partial unique (buyerId, resourceId)
   WHERE status IN ('PENDING','COMPLETED').
2. `ledger_entry_tx_account_direction_uq` — unique (transactionId,
   accountId, direction).
3. `financial_txn_settlement_once_uq` — partial unique (relatedPurchaseId)
   WHERE type='SELLER_REVENUE'.
4. `payment_purchase_captured_uq` / `payment_orderitem_captured_uq` —
   partial unique по money-bearing состояниям (взамен blanket unique,
   дропнутых формально).
5. `dispute_purchase_open_uq`, `dispute_service_purchase_open_uq` —
   partial unique WHERE status <> 'CLOSED'.
6. `idempotencyRecord` table + unique [operation, key] + expiresAt index.

## 9. Migrations added

- `site/server/migrations/app/20260911T1014_plan012_idempotency_invariants`
  (formal path: contract emit → migration plan → db migrate; from eefc89aa
  to b1dbf93b). Применена на dev (mtamarket) и test (mtamarket_test).
  Pre-проверка дубликатов на обеих БД: 0 нарушений.

## 10. Files moved/removed

- REMOVED: site/server/tests/ (35 tracked файлов), site/server/vitest.config.ts,
  dead-скрипт "test" в site/server/package.json.
- Encoding: 82 source-файла сервера конвертированы UTF-16 LE → UTF-8 BOM
  (наследие PS-инструментов), кириллица восстановлена программно по полной
  CP1251-таблице (Node TextDecoder windows-1251) — 0 mojibake остатков
  (check-moji: 0 файлов).

## 11. Tests added

tests/concurrency: commerce/idempotency-key (3), payment/parallel-refund (2),
ledger/balance-race (2), disputes/parallel-transition (2). Обновлены
tests/tools/helpers/db-reset.ts (idempotency-cleanup). Итого 392 тестов
(383 + 9 новых − покрытие перегруппировано).

## 12. Tests executed

- vitest run: **40 файлов, 392/392 passed, 11 skipped** (dev-опции).
- tsc --noEmit: server 0, tests 0, web 0.

## 13. E2E result

Playwright suite прогоняется в CI на push (blocking gate; среда собирается
e2e.yml). Локальный прогон не выполнялся в этом цикле (Windows-хост без
браузерных зависимостей сессии); редизайн сохранял все E2E-селекторы
(копия/роли/alt-маркеры) проверкой по инвентарю тестов. STATUS: CI-verification.

## 14. Module result

Linux release toolchain (GCC) — блокирующий CI-гейт (build + ctest + DRM
make test + CLI + python harness). Clang — report-only с формальной
причиной и политикой (MODULE.md §8). Windows — NOT SUPPORTED (§9 matrix).
Локальная компиляция недоступна в сессии — STATUS: CI-verification.

## 15. Documentation truth sync

- CURRENT.md — план/приёмка обновлены.
- MIGRATION.md §5 — статусы долгов (FIXED/PARTIAL/DEFERRED/NOT APPLICABLE).
- PRODUCT-MODEL §3.1 — OFFLINE выведен из lifecycle (согласовано §21F).
- DATA.md — добавлены Dispute-семейство (4 модели), IdempotencyRecord,
  новые DB-инварианты.
- MODULE.md — §8 Toolchain policy (GCC release / clang report-only с
  точной причиной), §9 Support matrix (Windows NOT SUPPORTED); DPAPI-миф
  в key_store исправлен.
- PRODUCT-SURFACE-MAP §20 — /creators/[username] → /sellers/[username].
- contracts/api/commerce.yaml — инвентарь дополнен (9 маршрутов):
  purchases/:id, payments/cancel|refunds|:paymentId/refunds, services
  lifecycle, disputes/:id/transition; Idempotency-Key notes.

## 16. CI result (локально исполнимые части)

- vitest 392/392 зелёный; tsc все чисты; dist-runtime smoke пройден локально
  (health 200/ready 200 в dev; NODE_ENV=production fail-fast с ясной
  диагностикой). CI-прогон: на push (platform-ci оркестрирует validate/
  contracts/security/tests/module/site/e2e + publish).

## 17. Remaining technical debt — см. MIGRATION.md §5 (статусы)

DEFERRED: real-server module integration; полный OpenAPI перевод (инкременты);
SELECT FOR UPDATE / триггер для абсолютного INV-013 (ORM не экспонирует
FOR UPDATE; advisory lock закрывает практический race — принятый остаточный
риск задокументирован).

## 18. Known limitations

- INV-013: advisory-lock + transactional ceiling вместо DB-триггера
  (сумма по строкам не выражается partial unique; триггер вне
  additive-миграционной политики). ACCEPTED RISK (задокументирован).
- Idempotency-Key опционален для клиентов (обратная совместимость API);
  DB-инварианты защищают и без ключа.

## 19. Final architecture state

Единый monorepo; финансовый контур с DB-level exactly-once (checkout,
payment capture, settlement, refund ceiling, dispute lifecycle),
durable API idempotency, concurrency-верифицирован (14 concurrency-тестов),
production dist runtime проверен, документация синхронизирована.

## 20. Exact commit list

1. `0c3bba5` feat(plan-012): transactional correctness core — DB invariants,
   idempotency, atomic ledger (+ миграция 12 ops, +concurrency тесты,
   удаление stray tests).
2. `d3b0320` fix(plan-012): repair double-encoded cyrillic from the extension
   codemod + adapt webhook test (encoding-safe codemod kept).
3. *(docs)* feat(plan-012): documentation truth sync + CI invariants
   (CURRENT/MIGRATION/DATA/MODULE/PRODUCT-MODEL/SURFACE-MAP/contracts +
   validate.yml site.yml) — см. фактический хеш в git log.
