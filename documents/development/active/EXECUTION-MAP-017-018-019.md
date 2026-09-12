# EXECUTION MAP — PLAN-017 → PLAN-019 → PLAN-018

Working contract for executing the three active plans. Audits of the full
repository (backend, frontend, infra, tests, module/contracts, docs) were
performed before this map; every decision below cites the audit verdict.

Execution order: **PLAN-017 → PLAN-019 → PLAN-018**, full validation matrix
at the very end. The tree must type-check/build at every wave boundary; the
complete test suite runs only in the final phase.

## PROGRESS LOG

- W1 DONE: temp/ tree + ignore policy; dead files removed (stale Dockerfiles,
  hono overrides, wrapper scripts, one-off codemods); config/ consolidated
  (environments + application + schemas, TS loader, GET /config/features);
  startup.py rebuilt (§13–§20 command router, cross-platform, config-driven,
  temp/runtime/pids; status/doctor/unit verified live); compose topology
  consolidated (project names, parameterized test port, staging /ready,
  production build sections + STACK_PREFIX + nginx ports); CI dedup
  (site.yml workflow_call-only, single type-check home).
- W2 DONE (§26–§33): 40 renames into domain dirs; ~83 describe retitles;
  shared E2E fixtures + canonical FK-safe cleanup + globalTeardown;
  vitest harnesses deduped (payments/oauth/purchase-journey); 440/440 green.
- W3 DONE/IN-FLIGHT (§36–§51): schema migration admin_platform_foundation
  applied (SystemLog, AdCampaign, AdMetric, Entitlement, roles USER/SELLER/
  MODERATOR/SUPPORT/FINANCE/ADMIN/SUPERADMIN); admin platform backend
  (overview/users/roles/permissions/activity/audit/system-logs/search);
  advertising backend (campaigns lifecycle, placements serving, metrics);
  premium backend (entitlements idempotent grant/revoke + plans catalog);
  admin frontend decomposed 1496→92-line shell + 22 feature modules +
  EntityPicker (raw-UUID inputs replaced); advertising/premium admin tabs.
  Feature flags: advertising/premium ship disabled; FEATURE_* env overrides.
- W4 PARTIAL (§52–§60, §63, §65, §70, §74/§75): Topbar duplicate toggle +
  quick-logout removed; AccountMenu trimmed to account actions; search
  focus-within states; Inter via next/font; route loading skeletons;
  identities error redirects + banner; raw colors → tokens (overlay,
  on-media, on-accent, star); price/discount alignment; LiveLine deleted;
  plan006:* Redis keys → activity:*:v2 (+tests/docs); sensitive-data sweep
  clean. §58/§59 density+home refinement deferred to browser QA phase.
- W5 IN-FLIGHT: canonical error model foundation (lib/errors.ts, adoption
  in module wave); query-key factory consolidation DONE (single keys per
  endpoint, invalidations via factory); canonical fetch client DONE (axios
  removed, api-ext split into 7 domain modules behind a compat shim,
  dead-export sweep); dependency decisions documented (DEPENDENCY-POLICY:
  commander/date-fns/axios REMOVED, @types/express pinned to runtime,
  Prisma client/adapter pairing documented as intentional).
- Wave-6 backend (PLAN-018) — landed: admin platform + advertising +
  premium + admin UI (§36–§51 all green); worker/outbox runtime
  (events.ts claim/CAS/backoff/dead-letter, worker process with moved
  schedulers, compose+startup wiring, PAYMENT_SUCCEEDED + publication
  emits); commerce/finance (payout lifecycle with real ledger settlement,
  discounts CRUD, buyer transactions, payment state machine hardening).
  Sessions API + UI; SystemLog wired into the global error handler;
  outbox queue metrics; DRM shared vectors (S-003); alert thresholds
  (P-003); incident procedures (R-003). In verification: trust/versioning/
  search, community/personal, subscriptions/deals/ad-billing,
  demo/3D/leak/feedback agents.

## Verified starting facts (from audit, 2026-09)

- Stack: Express 4.21 + @types/express 5 (mismatch), Prisma contract-ORM
  (`db.orm.public.Model.where(...)`, client 7.10.0 + orm-postgres 8.0.0-rc.9),
  ioredis, Next 15.5 + React 19 + RQ5 + Zustand + axios, Tailwind 3.
- Backend: 31 route files (~210 endpoints), 72 lib files, no `modules/`,
  no `worker/`, no outbox; schedulers in-process.
- Frontend: all 34 pages `"use client"`; `api-ext.ts` 1701-line god-module;
  admin page 1496 lines; no per-route loading/error files; 6 hand-rolled
  dialogs; 5 badge families; no Modal primitive.
- Tests: vitest 421 cases (unit 93 / integration ~314 / concurrency 14),
  Playwright 68 cases in 9 plan-named specs; serial shared-DB integration;
  e2e specs 5/9 leak `e2e_*` rows; no global teardown.
- Infra: `config/` loaded by nothing; ports duplicated across 10+ places;
  stale root Dockerfiles (`apps/` layout); `startup.py` POSIX-only bits
  (`os.killpg`, `bash`, `linux-gcc` preset); staging healthcheck `/health`
  vs prod `/ready`; 8 workflows with postgres/redis services triplicated.
- Module: POSIX-only HTTP client (Windows build = documented blocker);
  DRM protocol version hand-duplicated in 3 places; module never verifies
  artifactHash; `contracts/` has no code consumers; `openapi.yaml` empty.
- Docs: identities-callback 404 already fixed (residual JSON error branches
  remain); search-on-RQ done; 7d/30d done; footer honest; focus traps partial;
  Topbar triple sidebar control confirmed; admin raw-ID inputs confirmed;
  GlobalSearch focus state-driven (no :focus-within) confirmed;
  `text-amber-400` star violation + `text-white`/`bg-black` raw uses found.

## Wave 1 — PLAN-017 A/B/C/D: repository, config, startup, compose

1. ✅ `temp/` tree (runtime/build/test/generated/screenshots/reports/work)
   with `.gitkeep` placeholders; `/temp/**` ignore policy keeping keeps.
2. Dead-file cleanup: delete stale `site/server/Dockerfile`,
   `site/web/Dockerfile` (dead `apps/` layout); remove hono pnpm overrides
   (zero real imports — "honoring" false positives); fix `.env.example`
   stale refs (`docker-compose.prod.yml` → production.yml path, stale
   rate-limit comment); delete unreferenced `scripts/development/fix-esm-extensions.cjs`,
   `scripts/cleanup-e2e-demo.sql`, `site/server/scripts/regen-missing-media.ts`;
   fold `scripts/development/{doctor,start,stop}.py` wrappers into startup.py
   (keep thin aliases only if referenced); update DEPLOYMENT.md Dockerfile refs.
3. Config consolidation: `config/environments/{development,test,staging,production}.yaml`
   + `config/application/{limits,logging,features}.yaml` (advertising/plans
   added with PLAN-018 domains, per §8); refresh `config/schemas/`;
   delete `config/{development,production,staging}/`; startup.py consumes
   config via minimal stdlib YAML-subset reader and exports env for spawned
   services (config = source of truth for local ops; server keeps env
   contract → production semantics unchanged).
4. `startup.py` rebuild (§13–§20): structured command router, commands
   `dev/release/test [unit|integration|e2e|smoke|affected|release]/build/
   module/db/status/logs/stop/clean/doctor`; cross-platform (Windows +
   POSIX) process spawn/stop (no `os.killpg`/`bash` dependency); PIDs in
   `temp/runtime/pids`; health via `/health /live /ready` + TCP/docker;
   status table WEB/API/WORKER/POSTGRES/REDIS/MODULE/TEST ENV; clean never
   touches production data without `--destructive`; doctor reports the
   Windows module-build limitation honestly.
5. Compose (§21–§25): shared YAML anchors for postgres/redis; unique
   container names per stack; tests.yml port via env (default 5433) +
   project isolation; staging healthcheck unified; worker service added
   when the worker exists (Wave 5).
6. CI dedup (§34): single type-check home; keep workflow_call reuse;
   document release gate.

## Wave 2 — PLAN-017 E: test architecture (§26–§33)

- e2e → domain dirs with behavior names (`auth/`, `marketplace/`,
  `servers/`, `community/`, `content/`, `account/`, `admin/`, `platform/`);
  plan-numbered spec names removed.
- integration/api → domain subdirs; plan/blocked-named files renamed
  (plan001-e2e→purchase-journey, plan005-*→forum/server-news/server-reviews/
  servers, plan006-activity→activity, plan007-content→articles,
  plan008-follows→follows, plan009-thread-follow→thread-follow,
  plan010-analytics→analytics, auth-plan016→auth-providers,
  n-block8→commerce-flows, o-block8→platform-contracts,
  block3-observability→observability, block7→compatibility, drm-g6→drm-hardening).
- Vitest tiers L0 (unit, no DB) / L1 (unit+integration) / L2 (affected via
  `vitest --related`) / L3 (full + e2e) / L4 (release) wired through
  `startup.py test <tier>`.
- Shared E2E fixture layer: canonical register/login/admin/seller/seed +
  FK-safe cleanup helper; every spec cleans up after itself; global
  teardown sweep for `e2e_*`/RUN-suffixed rows (§31, §32).
- Harness dedup: single payment-provider harness, single OAuth stub
  harness, shared purchase-journey steps (§29, §30) — suites merged only
  where the same contract is provably re-asserted.

## Wave 3 — PLAN-017 F/G/H: admin platform, advertising, premium foundation

- Backend: `/admin/overview` aggregate (§37); user management
  (search/inspect/suspend/restore/activity/purchases/resources/identities/
  moderation history, §38); explicit role model USER/SELLER/MODERATOR/
  SUPPORT/FINANCE/ADMIN/SUPERADMIN + permission set (§39/§40) with safe
  role-change guards (self-lockout, last-superadmin, confirmation, audit,
  before/after, §41); user activity center read-model (§42); audit center
  filters (§43); SystemLog table + system logs center (§44, bounded
  retention); moderation center unification (§45).
- Advertising control center (§46–§49): AdCampaign/AdPlacement/AdMetric
  models, campaign lifecycle draft→scheduled→active→paused→expired→
  cancelled, placements (home_hero, home_rail_secondary, market_featured,
  server_featured, community_featured), impressions/clicks/CTR; honest
  "Sponsored" label per DESIGN-SYSTEM (VISION §49: no ad exchange).
- Premium entitlement foundation (§50–§51): Entitlement model
  (creator_premium/server_premium/marketplace_premium/advertising_premium/
  analytics_premium), admin grant/revoke with audit; plans admin arrives
  with PLAN-018 J.
- Frontend: decompose `/admin` (1496 L) into `features/admin/*` section
  modules without URL-semantics change (§36); searchable entity pickers
  replace raw-UUID inputs (§66).

## Wave 4 — PLAN-017 I/J/K/L/M: polish, cleanup, security, perf

- §52–§54: remove Topbar duplicate collapse control (Sidebar owns collapse),
  dedupe nav (Sidebar=navigation, AccountMenu=account actions, Topbar=global
  actions, Footer=marketing/legal; single logout in AccountMenu), GlobalSearch
  focus via `:focus-within` + tokens (normal/hover/focus/active/error).
- §55: production font via `next/font` (Inter variable, weights 400–700,
  display swap), single source in globals.css.
- §56: bounded, subtle scroll containers (AccountMenu/ContextCreate/GlobalSearch
  get max-h + overflow + styled scrollbar; MessageThread scroll styled).
- §57–§58: Price token sizes equalized (free/paid), discount/strikethrough
  variant, CTA slot stable, title line-clamp; density tokens for the 6 cards.
- §59–§60: home empty areas removed; raw colors fixed (text-white→on-accent,
  bg-black→overlay token, amber→star token).
- §61–§67: api-ext split folded into canonical client (Wave 5 E-003);
  identities callback residual error branches redirect; `/auth/:path*`
  same-origin rewrite fix; per-route loading/error for heavy routes; admin
  pickers (§66); server stats single component (§67).
- §68–§70: permission checks on every new admin route; audit on every
  privileged action; sensitive-data grep sweep.
- §71–§73: N+1 audit (no per-row loops found on Home/admin — verify server
  pages), admin pagination/filtering verified.
- §74–§76: dead code (LiveLine.tsx + unused exports), plan-era naming
  (`plan006:activity:*` Redis keys → `activity:*:v2`), badge/chip family
  consolidated → `ui/Badge`; `ui/Modal` primitive with focus trap; stars →
  `ui/Rating`.

## Wave 5 — PLAN-019: architecture 2.0

- A: remove hono overrides (W1); `@types/express` → 4.x pin matching
  runtime 4.21 (A-003); Prisma pairing verified/normalized (A-002);
  `commander` removed (hand-rolled CLI args); date-fns/unzipper audited;
  axios removed in favor of canonical fetch client (A-005, see E-003).
- B/C: `src/modules/<domain>/` boundaries (auth, users, marketplace,
  services, servers, community, content, payments, ledger, licenses, drm,
  moderation, notifications, search, admin) with routes/service/repository/
  schemas/index; repository conventions (findById/findMany/count/create/
  update/delete/aggregate); transaction policy via single `db.transaction`;
  dependency-direction eslint rule; N+1 elimination on list endpoints.
- D: index audit for users/resources/versions/orders/payments/ledger/
  licenses/sessions/audit/notifications/activity/heartbeats; constraint
  audit; money already Int kopecks (§D-04 satisfied, documented); UTC
  timestamps confirmed.
- E: `contracts/api/openapi.yaml` filled (endpoint inventory + shared
  schemas); shared zod contract schemas (pagination/sorting/filters/IDs/
  money/dates/errors) in `site/shared` consumed by server+web+tests;
  canonical API client `site/web/src/lib/api/` (fetch-based, bearer +
  single-flight refresh + typed error envelope) replacing axios+api-ext;
  canonical error `{error:{code,message,requestId}}` server-wide;
  HTTP status policy table.
- F: single validate(schema) pipeline; manual validators folded into zod.
- G: Idempotency-Key middleware + extension to all money-touching POSTs.
- H: Outbox table + `lib/events.ts` + `src/worker/` process (schedulers +
  outbox consumers + email queue) with retry/backoff/dead-letter policy;
  compose + startup.py gain worker service.
- I: Redis responsibility + cache registry doc (key/TTL/source/invalidation).
- J/K: StorageService abstraction; artifact pipeline state machine
  centralized (upload→validate→scan→sandbox→normalize→hash→manifest→sign→
  encrypt→store→moderate→publish) with explicit persisted stages.
- L/M: session engine (list/revoke/revoke-all + reuse quirk verified);
  permission-based authorization engine (from Wave 3).
- N/O: `features/` frontend structure; query-key factory + invalidation
  helpers (duplicate keys eliminated); RSC prefetch for public surfaces.
- P/Q/R: structured logging fields standard; OTel evaluation documented;
  metrics extended (queue depth, webhook lag, payment success); provider
  isolation wrappers (timeout/retry/circuit); graceful shutdown verified
  for worker.
- S/T: contracts tree unified; DRM vectors file shared by server + module
  tests; security/upload audits completed.
- U/V: dead code; type strictness fixes in security-sensitive code;
  Node/pnpm/TS policy single-source; turbo cache correctness.
- W/X: startup.py consumes final architecture (worker); status from real
  health; docs.

## Wave 6 — PLAN-018: productization (foundation + core flows)

- A commerce: state-machine hardening + tests; webhook reliability test
  matrix (duplicate/unknown/amount-mismatch/late/cancelled/invalid-signature);
  admin reconciliation status UI; user transaction history; seller finance
  center (Available/Pending/Sales/Fees/Refunds/Payouts from ledger); payout
  request lifecycle (PayoutRequest + admin review + audit); checkout
  hardening verified.
- B discounts: seller campaign CRUD (percentage/fixed/window/limits/
  per-user/min-order/product targeting/coupon code); validation tests;
  admin inspection; buyer UX via Price discount variant.
- C trust: verification state exposure; compatibility matrix completion
  (models exist); resource health + seller score (explainable, bounded
  inputs); TrustBadges consistency.
- D versioning: release manifest ✓; pipeline states; rollback action;
  channel foundation (stable/beta/legacy); Update Center in account.
- E creator: studio/profile/following/publishing complete; analytics
  extended (views/downloads/sales/conversion/revenue/refunds/rating).
- F server: dashboard/following/verification/statistics/privacy ✓ verified.
- G community: resource-linked discussions; mention notifications;
  moderation ✓.
- H search: global search + services/creators/news; filters; bounded
  ranking formula.
- I personal: My MTA ✓; favorites (Favorite model + UI); price alerts
  (PriceAlert + drop/discount-start/version notifications); license center
  (+ update center).
- J premium: first packages (creator/server), subscription lifecycle
  (ACTIVE/PAST_DUE/GRACE/CANCELLED/EXPIRED, manual renewal — no recurring
  billing), admin plans/entitlements.
- K advertising: campaign lifecycle + paid placements + billing via
  existing commerce + analytics + admin controls.
- L–O foundations: DealRoom (states/evidence/access control), DemoManager
  (sandbox-reuse, TTL, feature flag default-off), 3D asset metadata
  extraction (obj/gltf subset) + feature flag, Leak Radar fingerprints +
  confidence + admin case surface.
- P–S: metrics/structured logs/alert thresholds; security hardening
  verified; backup/restore verified; production checklist; beta onboarding
  paths + beta metrics + controlled feedback.
- T–U: E2E journeys for seller/buyer/free/service/admin; final acceptance.

## Final phase — validation matrix (PLAN-017 §81–§90)

type-check · lint · format-check · build · unit/integration full run with
recorded counts · E2E full · repeat-run isolation · docker smoke ·
`startup.py doctor/dev/status/stop/release` runtime validation · browser QA
1440×900 + 1920×1080 light+dark across the §83 surface list · stale-reference
and duplicate-config sweeps · docs synchronized (CURRENT/DEVELOPMENT/
TESTING/architecture).
