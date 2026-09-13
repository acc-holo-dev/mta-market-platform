# PLAN-020 — Section G/H Audit: Payments / Ledger / Subscriptions / Entitlements / DRM

Scope: `site/server/src/lib/{paymentStateMachine,paymentProvider,paymentErrors,commerce,ledger,refunds,payouts,subscriptions,adsBilling,discount,entitlements,idempotency,cryptoinvoice}.ts`, `lib/providers/payment-*`, `lib/{yookassa,tbank,yookassaWebhook}.ts`, `lib/reconciliation/`, `routes/payments.ts`, `routes/subscription-*.ts`, `routes/sellerPayouts.ts`, `lib/artifact/`, `lib/drm/`, `cli/drm.ts`, `contracts/drm/v2/`, `module/src/drm/`, `routes/{versions,leak,drm}.ts`, `routes/drm/v2.ts`.
Method: read-only audit; every claim carries `файл:строка` evidence. No repository files were modified except this report.

---

## G-001.1 — Payment state machine guard is not centralized; direct status writes bypass it (and one creates a 500-retry loop)

- severity: high
- verdict: FIX
- current: The header claims "every Payment row mutation goes through assertTransition" (site/server/src/lib/paymentStateMachine.ts:1-11) and the canonical table + self-check are solid (paymentStateMachine.ts:45-72). But `handleProviderWebhook` mutates Payment.status directly, bypassing the machine: (a) CANCELED→PENDING repair via plain CAS (routes/payments.ts:491-493); unconditional `update({status:"SUCCEEDED"})` re-writes (routes/payments.ts:627-630, 667-670); redundant second CANCELED write (routes/payments.ts:464-466). Concrete failure: T-Bank emits AUTHORIZED and CONFIRMED notifications, both mapped to eventType `payment.succeeded` with **distinct** providerEventIds (`${paymentId}:${status}`, lib/providers/payment-tbank.ts:213-227), so dedup [provider,providerEventId,eventType] (routes/payments.ts:378-387) does not merge them. The second event arrives when the payment is already SETTLED; `transitionPaymentTo(ppId,"SUCCEEDED")` (routes/payments.ts:592-594) calls `assertTransition("SETTLED","SUCCEEDED")` which throws (paymentStateMachine.ts:78-82) → handler answers 500 (routes/payments.ts:697-705) → provider retries forever, event stuck PROCESSING.
- change: 1) Encode the two repair transitions in the machine itself (e.g. a `repairTransition()` that allows CANCELED→PENDING only inside the webhook-repair path, logged); 2) replace the direct writes at payments.ts:491-493/627-630/667-670 with CAS `transitionPaymentTo`; 3) make the succeeded-branch idempotent for money-states: if the payment is already SETTLED/REFUNDED for this order and the order is completed, ack 200 instead of throwing (move the `from===to`-style idempotency up to the webhook flow).
- reason: Illegal transitions must be rejected in one place; today the payments route is the largest violator of its own invariant, and a legitimate provider sequence (two-stage capture) wedges the webhook.
- risk: Re-routing writes through the CAS helper can surface races that were previously silently overwritten; the "provider truth wins" repair (CANCELED→SUCCEEDED) must stay reachable or paid-but-canceled orders lose entitlements again.
- verification: New test in tests/integration/api/commerce/payments-webhook-tbank.test.ts: deliver AUTHORIZED then CONFIRMED notifications sequentially and concurrently; expect 200/200, final payment status SETTLED, one license, one ledger settlement; then `pnpm test tests/concurrency/payment`.

## G-001.2 — `payment.failed` events are acknowledged but never applied; stale PENDING payments have no poller

- severity: medium
- verdict: FIX
- current: The webhook handler marks every event that is not `payment.succeeded|payment.canceled` as PROCESSED with no business effect (routes/payments.ts:443-450). T-Bank REJECTED/DEADLINE_EXPIRED maps to `payment.failed` (payment-tbank.ts:213-220) and to PaymentState FAILED in the mapper (payment-tbank.ts:44-45) — yet the local Payment row stays PENDING forever. The only reconciliation that would notice is YooKassa-only (lib/reconciliation/service.ts:258-266: `provider.toUpperCase() !== 'YUKASSA'` → source unavailable) and it only alerts, never fixes.
- change: In `handleProviderWebhook`, apply `payment.failed` via `transitionPaymentTo(ppId,"FAILED")` when the local row is PENDING (CAS already proven safe), or add a periodic poller (`payment.poll` capability exists: paymentProvider.ts:79-85) that re-fetches PENDING payments older than N hours.
- reason: Buyer-facing history (routes/payments.ts:879-889) and purchase pages read local status; a failed charge shown as PENDING blocks the buyer from re-attempting through the normal flow (commerce re-presentation logic relies on live-state checks, lib/commerce.ts:135-157).
- risk: A late `payment.succeeded` for an already-FAILED payment would now hit the illegal-transition path — pair this change with the G-001.1 repair transition.
- verification: Unit test: send a T-Bank REJECTED notification for a PENDING payment, assert Payment.status === "FAILED" and the event is PROCESSED.

## G-002.1 — Crypto amount-acceptance policy (underpay/overpay) lives inside the provider adapter

- severity: low
- verdict: SIMPLIFY
- current: The underpay/overpay acceptance rule — the amount gate `underpayVerdict` with tolerance, overpay acceptance, "never invent entitlement" — is implemented inside the YooKassa…/CRYPTO adapter's state mapper (lib/providers/payment-crypto.ts:5-16, 63-74, 90-120). All other adapters map native status→state only (payment-yookassa.ts:46-54, payment-tbank.ts:39-54).
- change: Keep the mapper state-only (funded/failed) and let it surface `paidAmount`/`requiredAmount` on `ProviderPayment`; move the tolerance decision into the shared business layer (route/service) next to the existing amount check (routes/payments.ts:539-560).
- reason: G-002 states business rules stay outside adapters; amount acceptance is a business rule and is currently invisible to the neutral layer (the route cannot distinguish "provider said paid" from "we decided underpay-within-tolerance is acceptable").
- risk: Low — behavior-preserving refactor; tests/integration/api/commerce/payments-crypto.test.ts pins the sign/status mapping and must be updated with the move.
- verification: `pnpm test tests/integration/api/commerce/payments-crypto.test.ts` after refactor; grep that `CRYPTO_UNDERPAY_TOLERANCE_PCT` is no longer read inside lib/providers/.

## G-003.1 — PENDING refunds have no completion path: no refund webhook, no poller → money left the platform but ledger never posted

- severity: high
- verdict: FIX
- current: `createRefund` writes a PENDING Refund and calls the provider; effects run only when the provider response is synchronously SUCCEEDED (lib/refunds.ts:152-166). For an async result (YooKassa refund created in `pending`, payment-yookassa.ts:124-126) nothing ever finishes it: the webhook handler acknowledges every non-succeeded/canceled event with no effect (routes/payments.ts:443-450 — `refund.succeeded` events are persisted as PROCESSED and dropped); no code path re-fetches PENDING refunds (grep: `refund.succeeded` has zero handlers); the reconciliation REFUND report has no provider source ("provider_api_not_implemented_yet", lib/reconciliation/service.ts:268-277). Consequences: (a) platform_cash never sees the CREDIT, seller never debited → ledger says money still here (G-004 imbalance); (b) the INV-013 ceiling counts PENDING forever (refunds.ts:114-118) so the refundable amount stays blocked; (c) K-004 license revocation never fires for full refunds that were async.
- change: Add a refund-result ingestion path: handle `refund.succeeded|refund.canceled` provider events by mapping to the local Refund row and calling the existing `applyRefundEffects` (lib/refunds.ts:191) / a FAILED transition; plus a bounded sweeper for Refund rows PENDING > 24h that polls `provider.getRefund` (YooKassa transport call must be added to the provider capability set).
- reason: The refund lifecycle (`PENDING -> SUCCEEDED|FAILED|CANCELED`, refunds.ts:3-4) has only one realized inbound edge; the other edges are unreachable, which makes the documented INV-013/K-004 semantics false for async providers.
- risk: Double-apply if both the webhook and the sweeper fire — mitigate by keeping the existing effect marker (`refund:<id>` ledger tx id, refunds.ts:248-253, 355) as the single idempotency gate; FAILED transitions must also release the INV-013 ceiling (currently PENDING and FAILED both… only SUCCEEDED|PENDING count — refunds.ts:115-117 — FAILED already releases it).
- verification: Integration test: stub provider refund created PENDING → deliver `refund.succeeded` event → assert Refund SUCCEEDED, Payment REFUNDED, license REVOKED, `refund:<id>` ledger balanced; then rerun (idempotent no-op).

## G-003.2 — YooKassa notification password silently defaults to empty (fail-open basic auth)

- severity: low
- verdict: FIX
- current: `process.env.YOOKASSA_NOTIFICATION_PASSWORD || ""` (lib/providers/payment-yookassa.ts:137), then `verifyYooKassaAuth(header, shopId, "")` (lib/yookassaWebhook.ts:53-70) — with an empty expected password the check degenerates to "caller knows shopId" (shopId travels inside payment URLs). The transports fail fast on missing credentials (lib/yookassa.ts:11-15), but the webhook credential does not. Mitigated by the IP allowlist checked first (payment-yookassa.ts:134-136).
- change: When `YOOKASSA_ENABLED=true` and the notification password is empty, refuse webhook processing (503) or at minimum fail-fast at startup with the same FATAL pattern as lib/yookassa.ts:11-15.
- reason: A known shopId plus a spoofable-free path (IP allowlist aside, `trust proxy` misconfigurations are a classic) should not be the only secret.
- risk: None if ops sets the password; a fail-fast on empty will surface any deployment that relies on the empty default.
- verification: Startup test with YOOKASSA_ENABLED=true and no password → process refuses to boot (mirror the existing FATAL test pattern).

## G-003.3 — Crypto overpay surplus is invisible to the books

- severity: low
- verdict: DEFER
- current: Overpay is accepted by design and the entitlement is granted for the internal order (lib/providers/payment-crypto.ts:6-8, 71-73); the ledger settlement posts exactly `finalPrice` (commerce.ts:605, ledger.ts:397-405). `paid_amount` is not persisted anywhere — the surplus is "operator matter (out of API scope)". Crypto has no reconciliation source (service.ts:258-266), so the gap between cash received and platform_cash debited is never surfaced.
- change (when picked up): persist `paid_amount` on the Payment row (metadata already exists, subscriptions.ts:277 shows the column is used) and emit a quarantine/alert event when `paidAmount > required`.
- reason: Documented deviation; the ledger double-entry stays internally balanced, so this is a reporting gap, not an integrity break.
- risk: None now; undetected surplus accumulates as unexplained provider balance.
- verification: Manual: create a crypto invoice, simulate paid_over in the integration test harness, assert Payment.metadata.paid_amount recorded.

## G-004.1 — No global "total debit = total credit" and "balance = ledger" invariant; provider coverage is YooKassa-only

- severity: high
- verdict: FIX
- current: Balance-ness is enforced per transaction at post time (lib/ledger.ts:151-163) and re-checked only for payouts (lib/payouts.ts:349-351) and in tests (ledger.ts:195-204). The periodic cycle (site/server/src/jobs/reconciliation.ts) runs: payment/refund/payout provider comparison (YooKassa transport only — service.ts:258, 268-277) and the seller purchase↔balance check (lib/reconciliation/internal.ts:42-165), which compares SellerBalance against **FinancialTransaction** rows — the legacy cache — not against the double-entry **LedgerEntry** table that F-001 declares the source of truth (ledger.ts:2-7). Nothing verifies per-account sums (e.g. `seller_available:<id>` credits − debits == SellerBalance.availableAmount) or `platform_cash` against captured payments.
- change: Add one SQL-level check per reconciliation cycle: per account code, `sum(CREDIT)-sum(DEBIT)` equals the derived expectation (SellerBalance for seller accounts; sum of captured payments − refunds − payouts for platform_cash), plus a whole-ledger `sum(DEBIT)=sum(CREDIT)` assertion; surface as ReconciliationMismatch like the existing steps.
- reason: G-004 asks exactly for these two equations; today only per-transaction balance is enforced, so a partial posting (see G-005.1) or a missing settlement is visible only via indirect WARNINGs (internal.ts:154-164).
- risk: A strict invariant may fire on pre-existing drift — ship it as report-only first (matches the B-003 "never auto-corrects money" rule, service.ts:7-16).
- verification: Unit test seeding an intentionally unbalanced extra LedgerEntry → reconciliation report flags CRITICAL; then run `runReconciliationCycle` against a seeded DB.

## G-005.1 — Platform-line settlement posts the ledger outside a transaction; a crash leaves a permanently unbalanced ledger transaction

- severity: high
- verdict: FIX
- current: `settlePlatformOrderRevenue` (site/server/src/lib/subscriptions.ts:379-415 — used by subscriptions **and** ad campaigns via lib/adsBilling.ts:300-304) calls `postLedgerEntries(...)` with the default `db` executor (subscriptions.ts:385). Inside `postLedgerEntries` each entry is a separate implicit transaction (lib/ledger.ts:165-181), and the idempotency fast-path returns early when **any** entry with that transactionId exists (ledger.ts:146-149). A crash after the DEBIT commit and before the CREDIT commit leaves `settle:subscription:<orderId>` / `settle:ad-campaign:<orderId>` permanently unbalanced, and every repair pass hits the early return and skips the missing leg. All other callers pass a `tx` (refunds.ts:355, payouts.ts:341, ledger.ts:430) and are safe.
- change: Wrap the two entries in `db.transaction` inside `settlePlatformOrderRevenue`, and additionally harden `postLedgerEntries`: when called without an executor, self-transaction; replace the "any entry exists → return" check with a completeness check (all expected (account,direction) pairs present) so a legacy partial cannot masquerade as done.
- reason: The exactly-once machinery (unique `ledger_entry_tx_account_direction_uq`, contract.prisma:1044) prevents duplicates but not halves; this is precisely the G-005 "payment changes without ledger" class.
- risk: Low — making the call transactional only narrows the crash window; the completeness check must tolerate legitimately different entry sets with the same id (none exist today — ids are deterministic per line).
- verification: Test: monkey-patch/fault-inject between entry 1 and 2 (or call postLedgerEntries twice with disjoint entries) → second call must complete the posting, and `isLedgerTransactionBalanced` must be true.

## G-005.2 — Resource purchase path: completion + settlement is atomic/idempotent and crash-repairable (positive)

- severity: low
- verdict: KEEP
- current: Completion is one transaction with CAS on Purchase PENDING→COMPLETED, duplicate-ownership defense, discount consumption and the outbox event (lib/commerce.ts:512-601); settlement runs after commit with a deterministic id `settle:purchase:<id>` and a database dedup marker (ledger.ts:390-346, contract.prisma:535 `financial_txn_settlement_once_uq`); the crash window is repaired on any retry (commerce.ts:612-624). The captured-payment exactly-once is a partial unique index (contract.prisma:470-474).
- change: none. One residual gap: if no retry ever arrives after a crash between completion and settlement, the gap waits for a manual reconciliation WARNING (internal.ts:154-164) — acceptable given G-004.1 will alarm.
- reason: This is the reference implementation of the payment↔ledger atomicity contract; new money paths (G-005.1) should be brought to this shape, not the reverse.
- risk: n/a
- verification: existing tests/concurrency/ledger + duplicate-webhook tests; keep them green.

## G-006.1 — Webhook never dispatches SUBSCRIPTION / AD_CAMPAIGN orders: provider-confirmed money sits without activation

- severity: high
- verdict: FIX
- current: `createProviderPayment` stores `metadata.kind = "SUBSCRIPTION"|"AD_CAMPAIGN"` and orderRef = the checkout **Order** id (lib/subscriptions.ts:262-268 with metadata subscriptions.ts:451; lib/adsBilling.ts:105-112). But the YooKassa transport drops `request.metadata` entirely and hardcodes `metadata.order_id = orderId` (lib/yookassa.ts:81-95; adapter passes only amount/description/orderId/returnUrl, lib/providers/payment-yookassa.ts:74-91). In `handleProviderWebhook` the orderRef is resolved only against Purchase → ServicePurchase (routes/payments.ts:501-516); an Order id matches neither → event FAILED "Order not found", HTTP 404 (routes/payments.ts:518-525). The module headers document this as a pending integration point (subscriptions.ts:22-30, adsBilling.ts:15-20), and the only capture path is the manual `POST /subscriptions/:id/activate-payment` (routes/subscriptions.ts:131-160).
- change: In `handleProviderWebhook`, before the Purchase/ServicePurchase lookup, resolve `Payment.metadata.kind` (or the parsed webhook metadata): `SUBSCRIPTION` → `activateSubscriptionPayment({orderId: orderRef, ...})`, `AD_CAMPAIGN` → `completeCampaignPayment`. Both are already provider-verified and idempotent (subscriptions.ts:325-361, adsBilling.ts:237-326).
- reason: A captured payment that silently produces no product is the worst failure mode for financial integrity; today it depends on the buyer (or an admin) calling an extra endpoint.
- risk: The activation paths answer 409 `payment_required` when they cannot verify — wire the webhook actor as system + pass the providerPaymentId so the verification inside `capturePlatformPayment` re-fetches provider truth.
- verification: Integration test mirroring payments-webhook-yookassa.test.ts but with a subscription checkout: deliver payment.succeeded → assert Order COMPLETED, Subscription ACTIVE, Entitlement granted, ledger `settle:subscription:<id>` balanced; duplicate delivery → no second period.

## G-006.2 — Refunding a platform line (subscription / ad booking) revokes nothing

- severity: high
- verdict: FIX
- current: `applyRefundEffects` resolves seller/entitlement only from `payment.purchaseId` (lib/refunds.ts:218-230); platform lines carry `purchaseId: null, orderItemId` (subscriptions.ts:269-278). On a full confirmed refund of a subscription payment the ledger posts a balanced reversal (refunds.ts:309-355) but the Subscription stays ACTIVE and the PLAN_PURCHASE entitlement stays granted until natural expiry — `revokePlanEntitlements` is never called from the refund path. Contrast: resource purchases get Purchase→REFUNDED + License→REVOKED (refunds.ts:277-291).
- change: Extend `applyRefundEffects` for `payment.purchaseId === null && payment.orderItemId` lines: resolve the OrderItem → Order → `planKindFromLineTitle` (subscriptions.ts:426-431) or `AdCampaign.orderId` (adsBilling.ts:246); on full refund revoke the plan entitlements and expire/cancel the subscription (or set the campaign inactive), inside the same transaction.
- reason: Symmetry of the refund policy (K-004) across all money-bearing lines; otherwise a refunded buyer keeps premium until period end with no mechanism to claw it back.
- risk: Admin partial refunds must keep the entitlement (same K-004 rule); only `willBeFull` triggers the revoke, as with licenses.
- verification: Test: subscription activated → admin full refund via POST /payments/refunds → assert subscription EXPIRED (or CANCELLED with immediate effect) + entitlement revoked + ledger reversal rows.

## G-006.3 — Subscription status↔entitlement mutations are not atomic; PAST_DUE is a dead enum value

- severity: medium
- verdict: FIX
- current: Every lifecycle transition CASes the Subscription row and then, as separate calls, extends or revokes entitlements: grace entry (subscriptions.ts:809-821), expiry (823-829), grace end (838-845), cancelled period end (853-860), admin activate (993-1005), admin expire (1026-1032), admin cancel (1039-1045). A crash between the two steps leaves EXPIRED/CANCELLED subscriptions with live entitlements (admin cancel case: entitlement expiresAt is still in the future and `hasEntitlement` only checks `expiresAt > now && revokedAt == null`, lib/entitlements.ts:174-184) or GRACE subscriptions whose entitlement already expired. Additionally `PAST_DUE` is declared (subscriptions.ts:470, routes/subscriptions.ts:234) but never assigned anywhere in the codebase.
- change: Wrap each CAS + `extendPlanEntitlementExpiry`/`revokePlanEntitlements` pair in `db.transaction` (the sweep loop can share one tx per subscription); either implement PAST_DUE in the failed-renewal path or remove it from the admin filter enum to keep the state vocabulary honest.
- reason: Subscription status and entitlement are one aggregate (module header: "lifecycle over real entitlements", subscriptions.ts:1-20); half-applied states break the H-001 chain.
- risk: Low; the CAS predicates stay identical, only the wrapping changes.
- verification: Fault-injection test: throw after the subscription CAS → assert no partial state; grep confirms zero `PAST_DUE` writers or its removal from the enum/filter.

## G-006.4 — Renewal/grace/cancel semantics are CAS-guarded and honest (positive)

- severity: low
- verdict: KEEP
- current: Renewal is explicit re-purchase that extends the live window (subscriptions.ts:493-537 with per-user key lock), cancel takes effect at period end with resume (subscriptions.ts:873-926), grace only for autoRenew (subscriptions.ts:801-821), activation is provider-verified with amount check (subscriptions.ts:330-344), simulate is blocked when a battle provider exists (subscriptions.ts:694-698; parity with routes/payments.ts:953-956).
- change: none.
- reason: The financial semantics of each state are documented at the transition site and guarded; the gaps are the non-atomicity (G-006.3) and the missing webhook dispatch (G-006.1), tracked separately.
- risk: n/a
- verification: existing tests under tests/integration/api/premium.

## H-001.1 — Download authorizes on Purchase only; a revoked License (self-service revoke) cannot stop raw artifact downloads

- severity: high
- verdict: FIX
- current: `GET /resources/:slug/versions/:version/download` requires `Purchase.status === "COMPLETED"` (routes/versions.ts:404-419) and never consults the License row. `DELETE /drm/revoke/:licenseId` revokes the License + its Installations but leaves the Purchase COMPLETED (routes/drm.ts:117-129) → the same buyer keeps a working download path for the exact artifact the license protected. The refund path is safe only because it also moves the Purchase to REFUNDED (lib/refunds.ts:277-291).
- change: In the download endpoint, resolve the License for the purchase and require `license.status === "ACTIVE"` (409/403 with a precise code otherwise); mirror the check in any future signed-URL issuer.
- reason: H-001/H-002 require that the chain purchase→entitlement→license→download cannot diverge; today revoking the license alone diverges it by design of the revoke endpoint.
- risk: Buyers who revoked their own license lose download access — that is the endpoint's stated semantics (routes/drm.ts:91-137 "Revoke license"); communicate in the API error.
- verification: Test: complete purchase → DELETE /drm/revoke/:licenseId → GET download → 403; then un-revoke path (none exists — document).

## H-001.2 — Entitlement grant is check-then-create with no uniqueness backstop

- severity: low
- verdict: SIMPLIFY
- current: `grantEntitlement` reads for an active row then creates (lib/entitlements.ts:88-102); concurrent grants (subscription activation vs admin grant vs two instances) both miss and both insert. The subscription path serializes by key lock (subscriptions.ts:498, 645), admin grants do not. Duplicate entitlements are then all iterated by `revokePlanEntitlements`/`extendPlanEntitlementExpiry` (subscriptions.ts:566-597), so the blast radius is limited to extra rows.
- change: Add a partial unique index `(subjectType, subjectId, kind) WHERE "revokedAt" IS NULL` (mirroring the established pattern contract.prisma:368,473) and catch the violation → re-read winner.
- reason: The codebase already standardizes on "database invariant, not JS check" (commerce.ts:82-90, ledger.ts:133-137); entitlements are the last financially-relevant check-then-create.
- risk: Migration-only; existing duplicate rows must be collapsed first.
- verification: Migration + concurrency test granting the same entitlement in parallel; expect one row.

## H-002.1 — DEK re-release ignores license/purchase revocation while a lease is alive

- severity: high
- verdict: FIX
- current: `issueVersionDek` checks nonce format, installation exists/not-revoked/ACTIVE, possession proof, and an unexpired lease covering the version (lib/drm/service.ts:529-560) — it never checks `license.status` or the Purchase. `activateLicense` does check the license (service.ts:250-252), so a refunded license cannot *renew*; but its already-issued lease lives 7 days (LEASE_DURATION_SECONDS, lib/drm/protocol.ts:19) and during that whole window the installation can re-fetch the per-version DEK (the actual decryption secret) — a *new* secret grant, not just "existing lease keeps its natural expiry" (the documented ADR-001 policy, service.ts:392-397). Refund revokes the License (refunds.ts:281-290) but not Installations.
- change: In `issueVersionDek`, load the Lease→License and require `license.status === 'ACTIVE'` (same string the activate path uses), returning DRM_INVALID_LICENSE otherwise; optionally revoke installations in `applyRefundEffects` like routes/drm.ts:122-129 does.
- reason: ADR-001 (existing leases keep natural expiry) is a *run* policy; handing out the DEK again after revocation materially extends the leak window beyond the policy's intent.
- risk: Legitimate reinstall during an active lease after refund is blocked — intended.
- verification: Test in tests/integration/api/licenses/drm-hardening.test.ts: active lease → refund full → POST /v2/versions/:id/dek with a valid possession proof → 403/404 DRM_INVALID_LICENSE.

## H-003.1 — Client-declared fileChecksum is stored unverified; stored bytes are never re-verified against the signature; publication gate checks existence only

- severity: high
- verdict: FIX
- current: Version create persists `fileChecksum` straight from the request body (routes/versions.ts:81, 132-140) — never compared to the actual SHA-256 of the uploaded buffer (which is computed independently into `ArtifactSignature.artifactHash`, lib/artifact/signing.ts:97-114). The download response then returns that unverified `checksum` to clients (routes/versions.ts:466). `verifyStoredArtifact` (signing.ts:157-191) — the only function that re-hashes bytes against the stored signature — has **zero callers** (grep: only exported via lib/artifact/index.ts:35). The publication gate requires only that a signature row exists with an ACTIVE key (`hasValidSignature`, routes/admin.ts:137, signing.ts:210-220), not that the bytes still match. Net: a silent storage mutation (S3 object replaced, local file swapped) is undetectable, and the user-visible checksum can lie.
- change: 1) At version create/rollback, compute `hashFile(artifactBuffer)` and reject when `fileChecksum !== hash` (or overwrite with the server-computed value and drop the client field); 2) call `verifyStoredArtifact` in the publication gate (replacing/augmenting hasValidSignature) and add a periodic verifier or verify-on-download (cheap: one SHA-256 per request, artifact sizes bounded).
- reason: H-003: "published artifact bytes cannot be silently changed; hash/signature/manifest must remain consistent" — today only the *record* of the hash is consistent, the bytes are never re-checked.
- risk: Stricter create path may reject legacy uploads whose clients sent wrong checksums — acceptable (fail at upload, not at download); re-verify-on-download adds latency for large artifacts (bounded by S3 streaming).
- verification: Test: create version with fileChecksum="deadbeef" → 422; mutate the stored object → verifyStoredArtifact fails and the publication gate blocks.

## H-003.2 — Rollback/manifest/signing pipeline and leak-radar honesty are sound (positive)

- severity: low
- verdict: KEEP
- current: Rollback reuses the exact artifact reference (never re-uploads), requires a previously moderation-released target, and re-signs the same bytes (routes/versions.ts:299-338); the publication gate blocks unsigned versions (admin.ts:130-143). Fingerprinting caps confidence at 0.9 and never claims proof (lib/artifact/fingerprint.ts:2-6, 128-140), evidence is bounded (fingerprint.ts:99-118), auto-open dedupes per fingerprint (routes/leak.ts:204-225), and the whole surface is behind `system.manage` (leak.ts:29).
- change: none (one nit: `fingerprintArtifact` is read-then-upsert with an unhandled unique race on concurrent create, fingerprint.ts:62-87 — catch `artifactFingerprint_artifactHash_key` and re-read, mirroring ledger.ts:77-85).
- reason: These implement H-003's intent and O-00x honesty rules as specified.
- risk: n/a
- verification: existing leak/scan routes under admin permission tests.

## H-004.1 — DRM error-code surface diverges three ways (TS constants vs contract schema vs route responses)

- severity: high
- verdict: FIX
- current: `DRM_ERROR_CODES` (site/server/src/lib/drm/types.ts:124-140) contains DRM_NONCE_EXPIRED, DRM_LEASE_EXPIRED, DRM_PROTOCOL_VERSION_MISMATCH that are absent from the frozen contract enum; the contract contains DRM_PROTOCOL_DEPRECATED that no TS code returns (contracts/drm/v2/errors.schema.json:13-27). Routes additionally emit codes outside both sets: INVALID_REQUEST, INSTALLATION_EXISTS, INSTALLATION_ALREADY_VERIFIED, LICENSE_STATE_ERROR, INVALID_NONCE, LEASE_NOT_FOUND, SERVER_ERROR, SERVER_MISCONFIGURED, NOT_ENCRYPTED (routes/drm/v2.ts:122-127, 156-162, 206-213, 249-254, 267-282, 348-354, 434-443). HTTP mapping also drifts: the contract says `*_MISMATCH → 403` (errors.schema.json:35) but the server maps ARTIFACT_HASH_MISMATCH→404 (v2.ts:57-58); INSUFFICIENT_CAPABILITIES is reused for "version YANKED" (service.ts:266-268) and for "lease does not cover this version" (service.ts:558-559) — one code, three unrelated meanings, module cannot distinguish them (C++ surfaces only a generic protocol error, module/src/drm/license_client.cpp:284-287, 301-302).
- change: Regenerate errors.schema.json from DRM_ERROR_CODES (single source), add the missing route codes to the schema (or stop emitting them — map INVALID_NONCE→DRM_INVALID_SIGNATURE-family codes), fix the MISMATCH→403 mapping, and introduce a dedicated code (e.g. DRM_VERSION_YANKED via a v3 bump or map YANKED→DRM_INVALID_LICENSE per the schema's HTTP comment).
- reason: H-004 requires "identical protocol semantics and error codes"; the module's only actionable signal is the code string, and today server tests and module tests can pass while the wire contract is violated.
- risk: The C++ client treats unknown codes as generic failures already (no parse of error.code), so tightening is backward-compatible; only contract-first clients would notice.
- verification: New contract test: for each DRM_ERROR_CODES member, assert presence in errors.schema.json; run the module cross-check suite against vectors + error fixtures (tests/unit/site/drm-vectors.test.ts pattern).

## H-004.2 — protocol.yaml promises bearer auth on machine endpoints; the server (and the module) implement none

- severity: high
- verdict: FIX
- current: The frozen contract marks POST /drm/v2/installations/:id/verify, POST /drm/v2/activate, POST /drm/v2/heartbeat and GET /drm/v2/leases/... as `auth: bearer` (contracts/drm/v2/protocol.yaml:42-58). The server mounts all four **without** `authenticate` (routes/drm/v2.ts:182, 231, 300, 342 — only /v2/installations has it, v2.ts:116), and the C++ client sends `bearer == nullptr` for verify/activate/heartbeat (module/src/drm/license_client.cpp:219, 243, 351). Security today rests on: challenge possession (verify), installation-ACTIVE status + nonce (activate), and UUID knowledge for the lease GET — which returns the full signed lease unauthenticated (v2.ts:342-357). Knowing an (installationId, licenseId) pair — e.g. from logs or a shared machine — is enough to mint fresh leases for that installation.
- change: Either (a) implement what the contract says: module already has bearer plumbing (license_client.cpp:107-127) — pass a short-lived machine token issued at registration; or (b) freeze the reality: change protocol.yaml `auth:` to "possession-proof / unauthenticated" with the threat-model note, and require the possession signature on /activate like /dek already does (license_client.cpp:377-390 pattern).
- reason: Site↔contracts↔module must describe the same protocol; today the contract is the odd one out, and the weakest real link (activate without possession proof) is exactly where the contract assumed a bearer.
- risk: (b) requires a module update (add signature over nonce) — the lease request gains a field; keep v2 compat by making the signature optional-now, required-with-warning, mandatory in v3.
- verification: Contract test asserting every protocol.yaml endpoint's auth declaration against the route middleware; negative test: activate with unknown installationId → 403/401 per contract mapping.

## H-004.3 — Canonical JSON lease signing is byte-compatible across TS and C++, pinned by shared vectors (positive)

- severity: low
- verdict: KEEP
- current: Server signs leases over canonical JSON (recursive key sort, no whitespace, top-level signature stripped: lib/artifact/crypto.ts:170-197 + lib/drm/crypto.ts:100-111); the module verifies by re-serializing the parsed response with its own canonical dumper (recursive sort, no whitespace, top-level signature stripped: module/src/drm/json.cpp:338-382, 460-476) and cross-checks `serverKeyId` against the trusted key set fetched from /drm/v2/public-keys (license_client.cpp:249-303). Challenge signatures cover the **decoded raw bytes** on both sides (lib/drm/crypto.ts:69-94; module/src/drm/license_client.cpp:197-210 — the P0-1 fix note). contracts/drm/v2/vectors.json pins the Ed25519 keys, challenge and lease vectors for both sides (vectors.json:1-54) and is exercised by tests/unit/site/drm-vectors.test.ts. Clock skew (90s) is identical in protocol.ts:22, license_client.cpp:19 and protocol.yaml:21.
- change: none. One nit: the module's `verifyStoredLease` checks only expiry+skew (license_client.cpp:309-335) without the issuance-skew check the server does (lib/drm/crypto.ts:149-155) — harmless because the lease is signature-verified first; add the symmetric check when convenient.
- reason: This is the H-004 contract working as designed; protecting it from drift matters more than changing it.
- risk: n/a
- verification: keep tests/unit/site/drm-vectors.test.ts + tests/module/drm cross-runs green on every protocol touch.

## H-005.1 — Lease "grace" is natural expiry only, and heartbeat reports validity without consulting the license

- severity: medium
- verdict: DEFER
- current: ADR-001 policy: existing leases keep their natural expiry (service.ts:261-268 comment, 392-397; protocol.yaml v1 note). Heartbeat recomputes `leaseValid` purely from lease expiry (service.ts:356-364) and rejects only REVOKED installations (347-349) — a refunded (License REVOKED) buyer still gets `leaseValid: true` until the 7-day lease dies. This is coherent with ADR-001 as long as DEK re-release is also lease-time-bounded — which H-002.1 shows it effectively isn't (DEK re-fetch is gated by lease+installation, not license). Server-side skew handling exists (protocol.ts:61-67) and the module mirrors the 90s skew (license_client.cpp:19, 321-334); outages are tolerated client-side by stored-lease verification (license_client.cpp:309-335).
- change (when picked up): make heartbeat's `leaseValid` include `license.status === 'ACTIVE'` so monitoring surfaces revocation instead of green until expiry; keep the run-grace policy itself unchanged.
- reason: Cheap observability fix on top of the documented policy; the actual enforcement fix is H-002.1.
- risk: None — additive field semantics; module already treats `leaseValid:false` as a signal to re-activate (license_client.cpp:337-358).
- verification: Test: active lease + refunded license → heartbeat returns leaseValid:false (or add `licenseValid` field, contract-bumped).

## H-005.2 — CLI writes the DRM private key without restrictive mode (rotate does it right)

- severity: low
- verdict: FIX
- current: `rotate` writes with `mode: 0o600` (site/server/src/cli/drm.ts:52) but `keygen` writes JSON containing the private key with default permissions (drm.ts:72-77) into `.keys/drm-server.key` under cwd.
- change: add `{ mode: 0o600 }` to the keygen `writeFile` (and `mkdir` 0o700 for consistency with module/src/drm/key_store.cpp:78-120 which chmods 0600/0700).
- reason: The file contains the long-term platform signing key; keygen is the more common path (first setup).
- risk: none.
- verification: run `pnpm drm:keygen` in a temp dir → `stat -c %a .keys/drm-server.key` → 600.

---

## Summary

| Severity | Count |
|---|---|
| critical | 0 |
| high | 11 (G-001.1, G-003.1, G-004.1, G-005.1, G-006.1, G-006.2, H-001.1, H-002.1, H-003.1, H-004.1, H-004.2) |
| medium | 3 (G-001.2, G-006.3, H-005.1) |
| low | 9 (G-002.1, G-003.2, G-003.3, G-005.2, G-006.4, H-001.2, H-003.2, H-004.3, H-005.2) |

Total: 23 findings. Verdicts: FIX 15 · KEEP 4 · SIMPLIFY 2 · DEFER 2 · MERGE 0 · REMOVE 0

Top-5 (one line each):
1. **G-005.1** — subscription/ads settlement posts double-entry outside a transaction; crash → permanently unbalanced `settle:*` ledger transaction that the idempotency early-return (ledger.ts:146-149) refuses to repair.
2. **G-006.1** — webhook never dispatches SUBSCRIPTION/AD_CAMPAIGN orders (metadata dropped in lib/yookassa.ts:81-95; orders resolve only against Purchase/ServicePurchase, routes/payments.ts:513-525) → provider-captured money requires a manual activation endpoint.
3. **G-003.1** — PENDING refunds have no completing path (no refund webhook handler, no poller, no provider refund API in reconciliation): async refunds never reach ledger/INV-013 release/license revocation.
4. **H-002.1 + H-001.1** — revocation holes: DEK re-release ignores License REVOKED while a lease lives (service.ts:529-560), and the raw download path never checks the License at all (versions.ts:404-419) so self-revoked licenses keep working.
5. **H-004.1 + H-004.2** — DRM wire contract diverges from implementation: error-code enum/HTTP mapping drift in three directions, and protocol.yaml's bearer auth does not exist on verify/activate/heartbeat/lease-GET (server and C++ module both unauthenticated there).
