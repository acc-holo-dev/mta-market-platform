# PLAN-020 — Architecture Deep Audit & Stabilization (Final Report)

Status: **COMPLETE** — all 9 audit passes done (A–T), 26 corrections landed
and verified, deferred items documented with reasons, U-001 clean-environment
check passed.

Scope: PLAN-020 (documents/development/active/PLAN-020.md), sections A–T + U.

Method: 9 parallel read-only audit passes (architecture/startup, prisma/data,
api-contracts, events/redis, money/drm, auth/security, storage/frontend,
ci/recovery, simplification), detailed findings in
`documents/development/active/PLAN-020/audit/*.md`, then triage and
implementation of justified fixes with type-check + test verification.

Baseline (recorded before any change):

| Check | Result |
| --- | --- |
| `pnpm type-check` (workspace) | PASS (exit 0) |
| `pnpm exec vitest run tests/unit` | 139/139 PASS (10 files) |
| `python3 startup.py doctor` | all PASS |

## Confirmed findings (already verified, fix pending/landed)

### B-001 — Mixed-major Prisma stack: unused `@prisma/client@7`

- severity: high
- verdict: REMOVE (dependency)
- current: `site/server/package.json` declares `"@prisma/client": "7.10.0"`
  while the real runtime stack is `@prisma/orm-postgres` 8.0.0-rc.9 +
  `prisma` CLI 8.0.0-rc.13 (src/prisma/db.ts: `postgres<Contract>({contractJson, url})`).
  `grep "from \"@prisma/client\""` over site/server/src and tests → 0 hits;
  `pnpm --filter @mta-market/server why @prisma/client` → no dependents.
- change: drop `@prisma/client` from dependencies; re-run type-check + build.
- reason: undocumented mixed-major presence (exactly the B-001 risk); dead weight.
- risk: low — nothing imports it.
- verification: `pnpm why @prisma/client` empty, type-check PASS, unit tests PASS.

### N-002/N-004 — startup.py: derived `PORT` leak breaks full `dev` (fixed)

- severity: high
- verdict: FIX (landed, uncommitted)
- current: `derive_environment()` exported `PORT=<api_port>` (3001) into the
  parent `os.environ`; `derive_web_env()` then read `os.environ.get("PORT")`
  and started `next dev` on 3001 (occupied by the API) → EADDRINUSE crash of
  web on every full `startup.py dev` (observed twice this session, 22:44 and
  22:57). Reproduction: `python3 startup.py dev` → `web: EADDRINUSE :::3001`.
- change: capture operator `PORT` once at module load (`OPERATOR_PORT`) and
  use it in `derive_web_env` instead of the mutated environ (startup.py diff,
  2 lines).
- reason: full-dev must not depend on invocation order (`dev web` worked,
  full `dev` didn't).
- risk: minimal; operator override semantics preserved.
- verification: `python3 startup.py dev` → WEB RUNNING :3000, HTTP 200
  (verified this session after fix).

<!-- AUDIT SECTIONS PLACEHOLDER — filled from documents/development/active/PLAN-020/audit/*.md -->

## WHAT WAS FOUND (aggregate)

~192 findings across 9 audit passes (0 critical, 33 high, 60 medium, 99 low).
Highest-density zones: money/DRM (11 high), API contracts (5 high), data
layer (4 high), architecture (4 high), auth/security (3 high), CI/recovery
(3 high), frontend (1 high).

Recurring themes:
1. **Concurrency honesty** — plain `update()` used where CAS was documented;
   fire-and-forget side effects after commits; non-atomic Redis operations.
2. **Dead surfaces** — unused dependency, dead alias, dead config loader
   exports, dead metric series, shadowed admin routes, orphaned scripts.
3. **Unbounded growth** — outbox / reconciliation / provider events / sandbox
   runs had no retention.
4. **Stale authorization assumptions** — JWT claims trusted forever on
   refresh; OAuth skipped account status; license revocation not consulted
   by download/DEK paths.

## WHAT WAS KEPT (evidence-backed KEEP verdicts)

- **Outbox claim CAS + finite retries** (lib/events.ts:174-181, dead-letter
  :229-235) — race-safe, no infinite retry loop (audit 04, tests outbox.test.ts).
- **Redis = ephemeral only**: rate-limit counters + 45s activity cache with a
  complete invalidation matrix; no persistent data in Redis (audit 04 F-001).
- **keyLock cannot expire mid-section** (in-process promise chain, keyLock.ts);
  financial critical sections covered (payouts, ledger, commerce, adsBilling).
- **Financial cores are transaction-disciplined** (audit 02 appendix):
  checkout, completion, refund effects, payout, ledger — atomic + idempotent.
- **Money correctness (C-005)**: all amounts are Int minor units; float only
  at display/provider boundaries.
- **api-ext.ts / domain.ts shims are alive** (~70 importers) — KEEP despite
  "compat layer" smell (audit 09).
- **Zero circular imports across 147 modules; no lib→routes edges**;
  startup.py remained an orchestrator, not a second backend (audit 01).
- **Lease signing byte-identical TS↔C++** pinned by contracts/drm/v2/vectors.json
  (audit 05 H-004.3).
- **No secrets in code/logs/CI**; logger redaction works; CORS has no
  wildcards; identity-link protected by unique constraint + verified-email-only
  matching; OAuth tokens AES-256-GCM at rest (audits 06, 09).
- **Workflows all earn their place** (9/9 KEEP; duplication fixable via
  cache/filters, not deletion) (audit 08).

## WHAT REMAINS / WHY (deferred with reasons)

Status legend: items below were deferred at the original PLAN-020 run
(2025-09-13) and were re-triaged afterwards — the marked ones landed in the
follow-up stabilization change-set (2025-09-13, see change log #27+).

| Item | Verdict | Why it remains |
| --- | --- | --- |
| ~~F-004 no cross-instance scheduler lock~~ | FIX | **landed** — `lib/schedulerLock.ts` `runUnderSchedulerLock` (tx-scoped `pg_try_advisory_xact_lock` per job key, loser skips the tick), wired into all 5 worker schedulers + concurrency tests; scheduler handle exposes `idle()` for deterministic tests. |
| ~~E-002 notification dedup is check-then-insert~~ | FIX | **landed** — `Notification.dedupKey` (nullable unique) + unique-violation skip in `createNotifications`; all three delivery paths (admin route / outbox worker / CRON sweep) now share one key per (recipient, version). |
| ~~E-002b triple VERSION_RELEASED delivery~~ | MERGE | **landed** — admin inline path re-keyed to `resourceVersion` entity + the shared dedupKey; the DB index arbitrates across concurrent paths. |
| ~~G-006.1 webhook does not dispatch SUBSCRIPTION/AD_CAMPAIGN orders~~ | FIX | **landed** — the webhook resolves platform checkout Orders and routes by line tag to `activateSubscriptionPayment` / `completeCampaignPayment` (provider-verified, idempotent); verified by payments-webhook-platform.test.ts (activation, duplicate replay, amount quarantine). |
| ~~B-004.3 async-refund dead end~~ + ~~G-003.1 PENDING refunds no completion path~~ | FIX | **landed** — `refund.succeeded` / `refund.*` events complete PENDING refunds (CAS-guarded) and apply effects exactly once; payments-refund-webhook.test.ts covers the full journey (PENDING → effects → replay no-op). Provider pollers for webhook-less providers remain DEFERRED until such providers exist. |
| ~~G-005.1 per-entry ledger idempotency~~ | FIX | **landed** — root-db postings wrapped in ONE transaction under a blocking advisory lock keyed by the ledger transaction id (partial `settle:*` groups are now impossible from the posting path); caller-supplied transactions keep their own atomicity. |
| ~~O-002/O-003 CI cache + path filters~~ | FIX | **landed** — pnpm store cache in 4 install workflows; PR-level path filters for the module build and browser E2E (full blocking gate unchanged on push/workflow_call); mojibake gate wired (was in #24). |
| D-001 OpenAPI is an empty stub (`paths: {}`) | REPLACE (deferred) | ~93 endpoints outside the contract; generating the spec from code is a project of its own; the 6 manual inventories are stale and should be deleted with it. |
| D-003 canonical error envelope (733 legacy `{error}` responses) | FIX (deferred) | Mechanical but repo-wide migration; must land with the API-contract round to avoid two migrations. |
| D-002 client generation from OpenAPI | REPLACE (deferred) | Blocked by D-001. |
| T-001.03 sandbox runner is a pass-through mock feeding the publish gate | REMOVE (deferred) | Product-behavior change (phantom SandboxRun disappears; gate becomes honest PENDING); must ship with E2E for the publication path. |
| S-001a/S-003a worker-crash & Redis-fail-open tests | FIX (partially landed) | Scheduler-lock + notification-dedup + refund/platform webhook tests added (incl. `idle()` exposure); the dead-port Redis fail-open fixture and kill-mid-processing drill remain a test-only change-set. |
| S-002 / R-001 dynamic drills (DB restart, p50/p95/LCP, load) | DEFER | Require a live bench; methodology documented in audit 08. |
| P-004 OpenTelemetry | DEFER | No collector/backend exists — adopting OTel now would be observability infrastructure with nowhere to go (explicitly rejected by the plan). |
| L-002/L-005/M-003/L-001/L-004 frontend migrations | DEFER | RSC migration of 37 client pages, query-key factory normalization (166 keys), next/image adoption, component-home consolidation and api-ext migration are mechanical but repo-wide; scheduled as their own change-sets (audit 07 holds the plans). |
| Reconciliation scan bounding (377-row mismatch scan per cycle, N+1) | SIMPLIFY (deferred) | payment_reconciliation scans all payments; period-bounded scanning is a semantics change that needs its own review round (it now also surfaced as a test-DB slowdown). |

## Change log

| # | Area | Finding | Verdict | Status |
| --- | --- | --- | --- | --- |
| 1 | N-002/N-004 | PORT leak in startup.py (web EADDRINUSE on full `dev`) | FIX | **landed** |
| 2 | B-001/T-001.01 | unused `@prisma/client@7` (0 imports, no dependents) | REMOVE | **landed** |
| 3 | E-001 | outbox emits outside tx + un-awaited (admin.ts:199/243) — event loss on crash | FIX | **landed** (db.transaction + awaited tx emits) |
| 4 | F-001b | rate limiter INCR+PEXPIRE non-atomic → permanent 429 on TTL loss | FIX | **landed** (Lua INCR+conditional PEXPIRE, self-healing TTL) |
| 5 | E-005 | zero retention: OutboxEvent / ReconciliationReport+Mismatch / PaymentProviderEvent / SandboxRun | FIX | **landed** (worker `retention` job, daily; env-tunable windows) |
| 6 | N-004 | `app.listen` without 'error' handler → raw stack on EADDRINUSE (index.ts:24) | FIX | **landed** (clear fatal log + exit 1) |
| 7 | N-004 | `cmd_dev` exits 0 with dead backend/web ("not healthy yet" info only) | FIX | **landed** (non-zero exit, FAIL line; 13/13 policy tests pass) |
| 8 | O-004b | release.yml ctest gate ran ZERO module tests and was always green (`--test-dir` overrode preset binaryDir) | FIX | **landed** (ctest from module/ + `--no-tests=error`; verified: 3/3 module tests run via `startup.py module`) |
| 9 | N-002/U-001 | `startup.py module` crashed with TypeError (`sh()` hardcoded `cwd` vs caller `cwd=mod`) — broken since the startup.py rewrite | FIX | **landed** (`kw.setdefault("cwd", ROOT)`; command verified end-to-end) |
| 10 | S-004a | all outbound provider/OAuth HTTP unbounded (4× yookassa.ts, 8× providers/{discord,google,vk,yandex}) — hung endpoint holds request + idempotency row | FIX | **landed** (`lib/providerHttp.ts` `providerFetch`, `PROVIDER_HTTP_TIMEOUT_MS`, 12 call sites) |
| 11 | B-004.4 | plain `update()` used as conditional transition in 5 routes (select-identity→update-by-PK = TOCTOU, violates documented CAS rule) | FIX | **landed** (`updateAndCount` + count checks: payments.ts purchase close, services submit+rollback, serverReviews token consume, disputes freeze) |
| 12 | T-001 + B-001 docs | dead `lib/prisma.ts` alias (0 importers); DEPENDENCY-POLICY.md / TOOLCHAIN.md still described removed `@prisma/client@7` pairing | REMOVE + FIX | **landed** (file deleted; docs now describe the actual orm-postgres-only runtime) |
| 13 | I-002-c | `POST /auth/refresh` trusted stale JWT forever — banned user / downgraded admin kept access (auth.ts:307+) | FIX | **landed** (DB re-check on every rotation; claims re-minted from DB; disabled → session revoked, 403) |
| 14 | I-002-d | OAuth login skipped `targetUser.status` — banned accounts got fresh sessions via identity link or verified-email match (auth.ts:1034+) | FIX | **landed** (ACTIVE-only guard before session issue, parity with password path) |
| 15 | J-003-c + A-004.01 | legacy `PATCH /admin/users/:id/status` (MODERATOR could ban SUPERADMIN; no audit, no session revoke) + dead `GET /admin/users`, `PATCH /admin/users/:id/role` (shadowed by adminPlatform mount order) | REMOVE | **landed** (3 handlers deleted; parity in adminPlatform: users.view / roles.manage / users.suspend+restore) |
| 16 | C-004.1 | `POST /payments/cancel` left the Purchase PENDING forever — partial unique (buyer,resource) then blocked any re-checkout | FIX | **landed** (canceled payment CAS-closes its PENDING purchase) |
| 17 | C-003.2 | `DELETE /resources/:slug` had no purchase-history guard → raw 500 on Restrict FK (sold) or silent cascade of reviews/threads (unsold) | FIX | **landed** (409 when purchases exist; duplicate owner check removed) |
| 18 | B-004.2 | subscription activation crash window: COMPLETED order + missing subscription = permanent 409 (`subscription_missing`), buyer stuck | FIX | **landed** (self-healing replay: deterministic-key settle → keyed upsert → grant; verified premium/commerce suites 144/144) |
| 19 | H-001.1 | `issueVersionDek` never checked license state — a refunded license's old lease could re-fetch the DEK | FIX | **landed** (installation's license must be ACTIVE; INVALID_LICENSE otherwise; licenses suite green) |
| 20 | H-002.1 | raw version download authorized on Purchase only — self-service license revoke left downloads working | FIX | **landed** (non-ACTIVE license → 403; legacy rows without license unaffected; 108/108 marketplace+licenses) |
| 21 | P-003.1 | outbox metric series declared but never fed (`/metrics` rendered eternal zeros) | FIX | **landed** (amended after runtime check: gauges are derived from the DB at scrape time in the API process — the worker is a separate process whose registry is not scrapeable; `outbox_depth`/`outbox_dead_letter`/`outbox_processed` render real state) |
| 22 | Q-005-a | webhook routes parsed bodies under the global 10mb limit — unauthenticated parse-DoS surface before signature check | FIX | **landed** (route-scoped 256kb parser mounted before global; rawBody stash preserved for HMAC) |
| 23 | D-003.2 | Telegram login leaked raw provider `error.message` to the client | FIX | **landed** (canonical non-leaking 401; detail stays in logs; 31/31 auth tests) |
| 24 | T-001 + O-001 | orphaned `scripts/maintenance/cleanup.sh` (superseded by `startup.py clean`) and `scripts/development/seed.py` (superseded by scripts/seed-services.ts); `repair-cyrillic.cjs --check` documented as CI-usable but never wired | REMOVE + FIX | **landed** (2 scripts removed with reference verification; mojibake gate wired into validate.yml; py_compile glob fixed) |
| 25 | A-003 | `/config/features` re-read + re-validated 3 YAML + JSON schema on EVERY request, bypassing the lib/featureFlags 60s cache | FIX | **landed** (`allFeatureFlags()` through the shared cache; response shape unchanged) |
| 26 | A-004.01/H-002.1 | legacy `GET /drm/my-licenses` (N+1, 0 consumers) and `DELETE /drm/revoke/:licenseId` (0 consumers, revocation bypassing lib/drm/service.ts) | REMOVE | **landed** (v1 410 tombstones kept; canonical revocation via /drm/v2 + service; 77/77 licenses/authz/contracts) |

### Follow-up stabilization change-set (deferred items → landed, 2025-09-13)

| # | Area | Finding | Verdict | Status |
| --- | --- | --- | --- | --- |
| 27 | F-004 | worker schedulers not serialized across instances | FIX | **landed** (`lib/schedulerLock.ts`, advisory xact lock per job key; all 5 jobs wired; scheduler-lock.test.ts 3/3; `idle()` exposed on the scheduler handle) |
| 28 | E-002 + E-002b | notification dedup check-then-insert; triple VERSION_RELEASED delivery | FIX + MERGE | **landed** (`Notification.dedupKey` nullable-unique via contract migration `notification_dedupKey_key`; shared key across all delivery paths; admin inline path re-keyed to resourceVersion; notification-dedup.test.ts 2/2) |
| 29 | G-006.1 | captured platform orders (subscriptions/ads) never dispatched by the webhook | FIX | **landed** (Order resolution + line-tag routing to `activateSubscriptionPayment`/`completeCampaignPayment`; platform-webhook.test.ts 3/3: activation, duplicate replay, amount quarantine) |
| 30 | B-004.3 + G-003.1 | `refund.*` provider events ignored; PENDING refunds never completed | FIX | **landed** (webhook completes PENDING refunds CAS-guarded; full effect journey verified — payment REFUNDED, purchase closed, license revoked, balanced ledger; refund-webhook.test.ts 3/3) |
| 31 | G-005.1 | root-db ledger postings = per-entry implicit transactions → unbalanceable partial `settle:*` groups | FIX | **landed** (single-transaction posting under blocking advisory lock keyed by transactionId; caller-owned transactions unchanged) |
| 32 | O-002/O-003 | pnpm cache + PR path filters | FIX | **landed** (4 workflows cached; module/E2E path-filtered on PRs only; full gate unchanged on push/workflow_call) |
| 33 | S-001a (partial) | reconciliation scheduler exposes `idle()` for deterministic recovery tests | FIX | **landed** (interval scheduler test now awaits cycle completion) |

## Audit inventory (detailed reports)

| Report | Sections | Findings (c/h/m/l) |
| --- | --- | --- |
| audit/01-arch-startup.md | A, N | 0/4/11/9 |
| audit/02-prisma-data.md | B, C | 0/4/9/13 |
| audit/03-api-contracts.md | D, P | 0/5/7/5 |
| audit/04-events-redis.md | E, F | 0/2/6/10 |
| audit/05-money-drm.md | G, H | 0/11/3/9 |
| audit/06-auth-security.md | I, J, Q | 0/3/5/22 |
| audit/08-ci-recovery.md | O, R, S | 0/3/7/13 |
| audit/09-simplification.md | T, A-003/A-004 | 0/3/8/25 |
| audit/07-storage-frontend.md | K, L, M | 0/1/4/7 |

## Verification log

| When | What | Result |
| --- | --- | --- |
| baseline | `pnpm type-check` | PASS |
| baseline | `vitest run tests/unit` | 139/139 PASS |
| after dep removal | `pnpm type-check` + unit | PASS, 139/139 |
| after dep removal | `prisma contract emit` | PASS (hash matches committed snapshot) |
| after E-001/F-001b/E-005 | `tsc --noEmit` (server) | PASS |
| after E-001/F-001b/E-005 | moderation + outbox integration | 22/22 PASS |
| after N-004 fixes | startup.py syntax + policy tests | ok, 13/13 PASS |
| after N-004/O-004b/S-004a | full integration + concurrency | 541/541 PASS (59 files) |
| after N-002 fix | `python3 startup.py module` | 3/3 module ctest PASS (was: TypeError crash) |
| E-005 | new retention.test.ts against test DB | 2/2 PASS |
| after I/J/C fixes (13–17) | unit + integration + concurrency | 139/139 unit, **543/543** integration+concurrency (60 files) |
| after B-004.2 self-heal | premium + commerce suites | 144/144 PASS |
| after H-001.1/H-002.1 | licenses + marketplace suites | 108/108 PASS |
| after P-003/Q-005/D-003.2 (21–23) | platform + auth suites, tsc | 188/188, 31/31, PASS |
| after DRM trim + config cache | licenses/authz/contracts suites, tsc | 77/77, PASS |
| **U-001 clean environment** | `doctor` → `dev` → `status` → health → `stop` → `status` | doctor all-PASS; dev exit 0 with WEB/API/WORKER healthy (:3000/:3001 200); stop clean — **all infra including postgres/redis now governed by startup.py** (post-migration) |
| U-001 evidence | `/metrics` outbox gauges | `outbox_depth 0 / outbox_dead_letter 0 / outbox_processed 0` = true DB state |
| **FINAL** | type-check + full test suite (test infra up) | tsc PASS · **682/682 tests, 70 files** (unit 139 + integration 529 + concurrency 14 + retention 2... aggregated run) · module ctest 3/3 · startup-policy 13/13 |
| follow-up batch (27–33) | tsc + full suite, twice | **693/693 tests, 74 files** × 2 consecutive runs (new: scheduler-lock 3, notification-dedup 2, platform-webhook 3, refund-webhook 3; reconciliation stabilized via `idle()`) |
