# PLAN-017 — Platform Consolidation, Runtime, Admin, Testing & Technical Hardening

**Scope:** code / architecture / runtime / infrastructure / tests / admin / UX fixes / cleanup / incomplete features  
**Priority:** highest  
**Goal:** reduce repository sprawl, centralize runtime, simplify development/testing, consolidate configuration, strengthen administration, remove technical debt, fix discovered UX defects, and complete incomplete parts of already implemented platform functionality.

---

# RULES

1. Inspect current implementation before modifying it.
2. Reuse existing domains, services, contracts and components.
3. Do not create parallel implementations.
4. Do not preserve obsolete compatibility layers unless required by an active contract.
5. Do not organize tests by PLAN number.
6. Do not add documentation claims for functionality that is not actually implemented.
7. Do not move secrets into tracked configuration files.
8. `config/` is non-secret configuration.
9. `temp/` is disposable runtime/build/test/generated data.
10. `logs/` is persistent operational logging only.
11. `startup.py` becomes the canonical local operational entry point.
12. Do not break production deployment semantics while simplifying local runtime.
13. Every removed file/path must have all references migrated before deletion.
14. Every behavior change requires the smallest appropriate test.
15. Do not increase test execution time without a demonstrated reason.
16. Do not classify a task complete until its acceptance check passes.

---

# A. REPOSITORY CONSOLIDATION

## 1. Repository inventory

Audit the full tree and classify every root-level directory/file as:

```text
KEEP
MOVE
MERGE
GENERATED
LEGACY
DELETE
```

Produce an explicit migration map before structural changes.

Target root should remain compact and intentional.

---

## 2. Normalize temporary/generated files

Create:

```text
temp/
├── runtime/
├── build/
├── test/
├── generated/
├── screenshots/
├── reports/
└── work/
```

Move disposable generated artifacts out of tracked source locations.

Candidates include:

- runtime PID files;
- local process artifacts;
- generated test reports;
- temporary screenshots;
- browser output;
- coverage;
- ad-hoc generated files;
- migration working artifacts that are explicitly disposable.

Never place persistent audit logs or production data into `temp/`.

---

## 3. Normalize runtime directory

Current `startup.py` uses:

```text
runtime/pids
```

Move runtime PID/process state to:

```text
temp/runtime/pids
```

Update all scripts and cleanup logic.

No operational runtime state should remain under a tracked `runtime/` root unless explicitly required by deployment tooling.

---

## 4. Normalize logs

Retain:

```text
logs/
├── audits/
├── builds/
├── deployments/
├── development/
└── security/
```

Define what belongs in each directory.

Development logs may be generated locally and ignored.

Persistent application audit/security logs must not be silently treated as disposable developer logs.

---

## 5. Audit `.gitignore`

Inspect:

```text
.gitignore
.dockerignore
.prettierignore
```

Remove obsolete patterns and add the new `temp/` policy.

Required:

```text
temp/*
temp/**
```

while preserving intentionally tracked documentation/configuration files.

---

# B. CONFIGURATION CONSOLIDATION

## 6. Make `config/` the canonical non-secret configuration root

Current repository already contains:

```text
config/development/
config/production/
config/staging/
config/schemas/
```

Do not create a second configuration system.

Refactor the existing structure rather than duplicating it.

---

## 7. Consolidate environment configuration

Target:

```text
config/environments/
├── development.yaml
├── test.yaml
├── staging.yaml
└── production.yaml
```

where practical.

Migrate duplicated values from scattered YAML files into the canonical environment model.

Do not move secret values.

---

## 8. Consolidate application configuration

Create only necessary configuration domains:

```text
config/application/
├── features.yaml
├── limits.yaml
├── logging.yaml
├── advertising.yaml
└── plans.yaml
```

Do not add files unless the underlying configuration is actually used.

---

## 9. Feature flags

Introduce a typed feature-flag source.

Support future/current flags such as:

```text
feature.creator
feature.services
feature.advertising
feature.premium
feature.live_demo
feature.3d
feature.advanced_analytics
```

Disabled future features must not expose broken UI.

---

## 10. Configuration loader

Create one configuration loading abstraction.

It must:

- load selected environment;
- validate against schemas;
- reject malformed configuration;
- distinguish secret/non-secret values;
- expose typed values;
- provide startup diagnostics.

Remove duplicated ad-hoc environment parsing where it overlaps.

---

## 11. Preserve `.env` for secrets

Keep secret material in:

```text
.env
site/server/.env
```

or the appropriate secret-management mechanism.

`.env.example` remains documentation only.

Do not migrate:

- JWT secrets;
- OAuth secrets;
- payment secrets;
- encryption keys;
- DB passwords

into tracked YAML.

---

## 12. Eliminate duplicate configuration sources

Search for:

- duplicated ports;
- duplicated URLs;
- duplicated DB names;
- duplicated Redis URLs;
- repeated environment defaults;
- repeated payment flags;
- repeated runtime paths.

Use one source of truth per value.

---

# C. UNIFIED STARTUP / RUNTIME

## 13. Rebuild `startup.py` as the canonical CLI

Current file:

```text
startup.py
```

Current functionality already includes:

```text
dev
site
module
tests
build
status
stop
clean
doctor
```

Replace the current partially unified implementation with a structured command router.

---

## 14. Required startup commands

Implement:

```text
python startup.py
python startup.py dev
python startup.py release
python startup.py test
python startup.py test unit
python startup.py test integration
python startup.py test e2e
python startup.py test smoke
python startup.py build
python startup.py module
python startup.py db
python startup.py status
python startup.py logs
python startup.py stop
python startup.py clean
python startup.py doctor
```

Keep aliases only when they improve compatibility.

---

## 15. `startup.py dev`

Target behavior:

```text
startup.py dev
↓
validate tools
↓
load development config
↓
ensure Docker
↓
start application stack
↓
wait for health
↓
apply schema if necessary
↓
start web/api/worker
↓
print service URLs
```

No manual second terminal should be required.

---

## 16. `startup.py release`

Implement production-like local execution:

```text
startup.py release
↓
build
↓
compose up
↓
wait health
↓
verify API
↓
verify frontend
↓
verify DB
↓
verify Redis
↓
run smoke
↓
report status
```

Use production-style container images/builds where appropriate.

Do not run real production secrets automatically.

---

## 17. `startup.py stop`

Must stop:

- application containers;
- local application processes;
- development infrastructure;
- test resources belonging to this session.

Do not delete volumes by default.

---

## 18. `startup.py clean`

Clean only disposable artifacts:

```text
temp/
.next/
dist/
coverage/
playwright-report/
test-results/
other generated build output
```

Never remove:

```text
production DB
production volumes
uploads
secret files
```

without explicit destructive confirmation/flag.

---

## 19. `startup.py status`

Return one compact service table:

```text
WEB
API
WORKER
POSTGRES
REDIS
MODULE
TEST ENV
```

For every service:

```text
RUNNING
STOPPED
DEGRADED
MISSING
```

Include port/container/process where useful.

---

## 20. `startup.py doctor`

Validate:

- Python;
- Node;
- pnpm;
- Docker;
- Docker Compose;
- CMake;
- Ninja;
- compiler;
- dependencies;
- environment;
- ports;
- writable temp;
- writable logs;
- config validity.

Return actionable errors only.

---

# D. DOCKER / INFRASTRUCTURE CONSOLIDATION

## 21. Consolidate Compose topology

Current repository has separate:

```text
development.yml
tests.yml
production.yml
```

under:

```text
infrastructure/docker/compose/
```

Retain separate logical environments but eliminate duplicated service definitions where possible.

Use shared YAML anchors/fragments or generated configuration where appropriate.

---

## 22. Development stack

Move development toward:

```text
web
backend
worker
postgres
redis
```

inside Docker where technically practical.

Do not require host-run backend + host-run web + Docker infrastructure as the normal path.

---

## 23. Test stack

Test environment must be isolated and disposable.

Use:

```text
temporary project/container names
temporary volume names
temporary network
```

and destroy them after test completion.

Do not require permanent port `5433` unless there is a specific reason.

---

## 24. Prevent dev/test cross-contamination

Verify:

```text
dev DB ≠ test DB
dev Redis ≠ test Redis
test artifacts ≠ dev artifacts
```

Test cleanup must happen automatically.

---

## 25. Health model

Standardize health checks:

```text
/health
/live
/ready
/metrics
```

Map them consistently in Docker and startup tooling.

Do not use a static health check to claim readiness when DB/Redis dependencies are unavailable.

---

# E. TEST ARCHITECTURE REBUILD

## 26. Remove plan-based test organization

Remove:

```text
tests/e2e/plan016
```

and any equivalent plan-numbered test folders.

Tests must describe product behavior, not historical implementation plans.

---

## 27. Target test structure

Use:

```text
tests/
├── unit/
├── integration/
├── e2e/
│   ├── auth/
│   ├── marketplace/
│   ├── servers/
│   ├── community/
│   ├── content/
│   ├── account/
│   ├── admin/
│   └── platform/
├── concurrency/
├── module/
└── tools/
```

Merge redundant folders.

---

## 28. Test tiering

Define:

```text
L0 fast
L1 normal
L2 affected
L3 full
L4 release
```

### L0

- type-sensitive unit;
- pure logic;
- small component tests.

### L1

- unit + focused integration.

### L2

- affected-area integration;
- targeted browser tests.

### L3

- full test suite + complete E2E.

### L4

- full suite;
- build;
- Docker smoke;
- production-like verification.

---

## 29. Optimize Vitest execution

Inspect all ~440 existing tests.

Classify each as:

```text
KEEP
MERGE
DELETE
MOVE
REWRITE
```

Remove duplicate assertions covering the same contract.

Prefer high-value behavior tests over repetitive field-level tests.

---

## 30. Optimize browser E2E

Inspect all 68 E2E tests.

Remove redundant browser coverage when the same contract is already covered by integration tests.

Keep browser tests for:

- authentication;
- shell;
- main navigation;
- critical commerce flow;
- server critical flows;
- community critical flows;
- admin critical flows;
- theme;
- search;
- critical account interactions.

---

## 31. Shared E2E fixture

Create one canonical browser fixture layer for:

- login;
- register;
- admin login;
- seller setup;
- seeded resources;
- seeded server;
- cleanup.

Do not duplicate user creation logic across files.

---

## 32. E2E cleanup guarantees

All E2E-generated entities must have deterministic cleanup.

No:

```text
e2e_*
p1*
random test users
```

should accumulate after normal execution.

Cleanup must handle FK-restricted relations safely.

---

## 33. Test command optimization

Replace scattered root commands with:

```text
startup.py test
```

and internal runner support:

```text
startup.py test unit
startup.py test integration
startup.py test e2e
startup.py test affected
startup.py test release
```

Root `package.json` scripts may remain as aliases but should not be the primary documented workflow.

---

## 34. CI optimization

Review:

```text
.github/workflows/
```

for duplicate runs.

Merge or simplify workflows where jobs repeat identical checks.

Do not run the complete browser suite for every change that cannot affect it unless required by repository policy.

Use path/affected filtering where safe.

---

## 35. Test documentation rewrite

Rewrite testing documentation around:

```text
what to run
when to run it
what it validates
expected duration/weight
```

Remove references to historical PLAN-specific test ownership.

---

# F. ADMIN PLATFORM

## 36. Split the current admin page

Current:

```text
site/web/src/app/admin/page.tsx
```

is a very large mixed responsibility surface.

Split presentation and feature ownership without changing URL semantics unnecessarily.

Create feature modules for:

```text
overview
users
roles
resources
moderation
servers
reports
community
content
disputes
finance
advertising
audit
logs
system
```

---

## 37. Admin overview

Build dashboard with:

```text
Users
Resources
Pending moderation
Servers
Reports
Open disputes
Sales
Revenue
Advertising
System health
```

Use real API data only.

---

## 38. User management

Admin must be able to:

- search users;
- inspect profile;
- inspect status;
- inspect roles;
- suspend/restore;
- inspect activity;
- inspect purchases;
- inspect resources;
- inspect linked identities;
- inspect moderation history.

Do not expose secrets.

---

## 39. Role management

Implement admin role assignment UI.

Roles must be explicit.

Minimum conceptual roles:

```text
USER
SELLER
MODERATOR
SUPPORT
FINANCE
ADMIN
SUPERADMIN
```

Do not grant full ADMIN when only a narrower role is required.

---

## 40. Permission management

Create permission definitions such as:

```text
users.view
users.manage
users.suspend

resources.view
resources.moderate
resources.publish

servers.view
servers.manage

reports.view
reports.resolve

finance.view
finance.refund
finance.payout

advertising.view
advertising.manage

audit.view
logs.view

system.manage
roles.manage
```

Backend permission checks are authoritative.

Frontend only reflects capabilities.

---

## 41. Safe role changes

Role-management UI must:

- prevent self-lockout;
- prevent accidental removal of the last SUPERADMIN;
- require explicit confirmation for privilege escalation;
- log every role/permission change;
- show before/after permissions.

---

## 42. User activity center

Create user activity view:

```text
login
logout
profile update
purchase
refund
resource upload
resource publish
resource update
review
report
server action
role change
```

Group by timeline.

Never display private secrets.

---

## 43. Audit center

Reuse existing audit infrastructure.

Expose:

```text actor
action
target
before
after
IP
request ID
timestamp
```

Filters:

```text user
admin
action
target
date
IP
request ID
```

Audit records must be append-only.

---

## 44. System logs center

Separate from audit.

Audit:

> who changed what.

System logs:

> what the application technically did.

Add filters:

```text level
service
request id
date
error
route
```

Do not expose sensitive secret/environment values.

---

## 45. Moderation center

Unify:

- resources;
- versions;
- servers;
- reviews;
- reports;
- community;
- articles.

Use consistent action/confirmation/reason UI.

---

# G. ADVERTISING MANAGEMENT

## 46. Advertising control center

Create:

```text
/admin/advertising
```

or equivalent admin context.

Sections:

```text
Campaigns
Placements
Creatives
Schedule
Analytics
```

---

## 47. Campaign management

Support:

```text
draft
scheduled
active
paused
expired
cancelled
```

Properties:

```text advertiser
creative
placement
priority
start
end
status
```

---

## 48. Placement management

Support at minimum:

```text
home_hero
home_rail_secondary
market_featured
server_featured
community_featured
```

Admin can:

- pin;
- unpin;
- prioritize;
- pause;
- schedule;
- preview.

No hardcoded frontend-only advertisements.

---

## 49. Advertising analytics

Track:

```text impressions
clicks
CTR
campaign status
placement performance
```

Keep analytics aggregated and bounded.

---

# H. PREMIUM / ENTITLEMENTS

## 50. Premium foundation

Do not force full recurring billing unless backend support is ready.

First create an entitlement model capable of supporting:

```text creator_premium
server_premium
marketplace_premium
advertising_premium
analytics_premium
```

Expose only actual entitlements.

---

## 51. Premium administration

Admin must eventually be able to:

- inspect plans;
- enable/disable plans;
- inspect entitlements;
- grant/revoke manual entitlement;
- inspect expiration;
- log manual changes.

No invisible privilege changes.

---

# I. FRONTEND POLISH

## 52. Remove duplicate shell controls

Remove the second Leftbar expand/collapse control currently duplicated into topbar.

Sidebar owns its own collapse control.

Topbar must not duplicate it.

---

## 53. Remove duplicated navigation

Audit Sidebar vs Topbar.

Remove duplicate entries for:

- account;
- navigation;
- theme;
- actions;
- notifications;
- profile.

Every major action has one clear home.

---

## 54. Search focus styling

Fix search focus border/outline.

Requirement:

- normal;
- hover;
- focus;
- active;
- error

must have distinct but restrained states.

No ugly double ring.

Use existing semantic design tokens.

---

## 55. Typography

Replace current default body stack in:

```text
site/web/src/app/globals.css
```

with the project-selected final production font.

Load it efficiently.

Do not introduce unnecessary font files or excessive weights.

Remove mixed font-family definitions.

---

## 56. Scroll behavior

Audit:

- Sidebar;
- dropdown menus;
- account menu;
- command/search menu;
- tabs;
- modal menus.

Remove internal scrollbars where the content can fit naturally.

Where scrolling is unavoidable:

- keep it subtle;
- make the scrollbar visually unobtrusive;
- do not nest unnecessary scroll containers.

Do not use fixed heights merely to force layout.

---

## 57. Resource card price alignment

Fix all marketplace cards so:

- prices align;
- discount prices align;
- free state aligns;
- CTA placement is stable;
- metadata cannot push price unpredictably.

Card heights must remain visually coherent.

---

## 58. Card density

Audit:

```text ResourceCard
ServiceCard
ServerCard
CreatorCard
NewsCard
DiscussionCard
```

Reduce excessive padding and vertical whitespace.

Use consistent density tokens.

Desktop should show more useful information per viewport.

---

## 59. Home layout refinement

Review:

```text PromotionHero
LiveStrip
PopularSection
ActivityFeed
RightRail
Resource sections
News
Community
```

Remove empty visual areas.

Do not enlarge components solely to fill screen space.

Preserve desktop-first density.

---

## 60. Light/dark parity

Audit every redesigned component in:

```text light
dark
```

No:

- unreadable dark text;
- low-contrast borders;
- invisible placeholders;
- incorrect shadows;
- raw white text;
- hardcoded amber/blue colors bypassing semantic tokens.

---

# J. BACKEND / DOMAIN CLEANUP

## 61. Audit API extensions

Review:

```text site/web/src/lib/api-ext
```

and corresponding backend route/domain modules.

Remove dead exports.

Merge files whose separation has no functional value.

Do not collapse domains that require independent lifecycle/security.

---

## 62. Search architecture

Current documentation notes search migration to React Query as completed.

Verify implementation actually uses a stable query abstraction.

Remove duplicate fetch mechanisms.

Use bounded result counts.

---

## 63. Account identities callback

Current status explicitly reports the server-side identities link callback as still leading to 404.

Trace:

```text /account/identities
→ provider link start
→ provider callback
→ redirect
```

Fix the broken callback target.

Add browser coverage for a real link flow or a deterministic provider stub.

---

## 64. OAuth refresh

Current blocker:

```text OAuth token refresh
```

Audit provider architecture.

Implement only if provider contracts support it cleanly.

If still deferred, make the limitation explicit and prevent stale-token failures from presenting as unexplained errors.

---

## 65. Error/loading/not-found coverage

Audit every major Next.js route.

Ensure meaningful:

```text loading.tsx
error.tsx
not-found.tsx
```

where needed.

No blank page on route failures.

---

## 66. Admin raw ID interfaces

Replace operator-unfriendly raw ID workflows where possible.

Prefer:

```text search
select
autocomplete
entity preview
```

while retaining IDs for advanced/debug workflows.

Do not remove API ID validation.

---

## 67. Server statistics

Verify 24H/7D/30D UI remains functional after previous implementation.

Remove duplicated statistics query logic.

Use one reusable chart/statistics component.

---

# K. SECURITY / DATA INTEGRITY

## 68. Permission checks

Audit every new admin route.

Verify role check is not the only security layer where narrower permissions are required.

Authorization belongs to backend.

---

## 69. Audit coverage

Every privileged action must produce audit information.

At minimum:

```text role change
permission change
resource moderation
server moderation
report resolution
financial action
advertising change
premium entitlement change
system configuration change
```

---

## 70. Sensitive data audit

Search repository for accidental exposure of:

```text secrets
tokens
passwords
OAuth credentials
payment credentials
private host/port data
DRM keys
```

Ensure no new admin screen exposes them.

---

# L. PERFORMANCE

## 71. N+1 audit

Inspect:

- Home;
- admin;
- marketplace;
- server pages;
- creator pages.

Identify repeated per-row requests.

Replace with:

- bounded batch queries;
- joined/aggregated queries;
- cached read models.

---

## 72. Home query consolidation

Keep Home data fetches bounded.

Do not fetch unnecessary datasets merely to render small cards.

Ensure activity remains a single shared query.

---

## 73. Admin query consolidation

Admin tables must use:

- pagination;
- bounded limits;
- server-side filtering;
- server-side search where applicable.

Never load entire users/resources datasets to the browser.

---

# M. DEAD CODE / CLEANUP

## 74. Dead component audit

Search for unused:

```text components
hooks
stores
utils
exports
routes
types
CSS classes
```

Delete dead code after reference verification.

---

## 75. Legacy naming cleanup

Remove old PLAN-era naming from source code where it no longer describes behavior.

Allowed:

- historical commit/document references.

Not allowed:

- runtime components named after historical plan numbers.

---

## 76. Duplicate UI primitives

Search for duplicate:

- Button;
- Input;
- Modal;
- Badge;
- Tabs;
- Loading;
- Empty State;
- Error State;
- Card.

Consolidate only truly equivalent primitives.

---

# N. DOCUMENTATION / CONTRACT CLEANUP

## 77. Rewrite CURRENT.md

Update:

- current architecture;
- current startup workflow;
- current config model;
- test model;
- admin capabilities;
- real blockers;
- deferred functionality.

Remove stale statements about already-completed work.

---

## 78. Rewrite DEVELOPMENT.md

Document only:

```text
python startup.py
python startup.py dev
python startup.py test
python startup.py release
python startup.py doctor
python startup.py clean
```

Avoid making the user learn separate low-level commands unless debugging requires them.

---

## 79. Rewrite TESTING.md

Use test tiers:

```text L0–L4
```

Document expected use cases.

Remove Plan-specific test instructions.

---

## 80. Rewrite architecture references

Update:

```text infrastructure
config
runtime
temp
logs
tests
startup
admin
```

Ensure cross-links are correct.

---

# O. ACCEPTANCE / REGRESSION

## 81. Static validation

Must pass:

```text type-check
lint
format-check
build
```

---

## 82. Unit/integration validation

Final full run must pass.

Record exact count.

Do not claim a number unless execution confirms it.

---

## 83. Browser validation

At minimum:

```text 1440×900
1920×1080
```

Test:

- Home;
- sidebar;
- topbar;
- search;
- theme;
- account;
- balance;
- marketplace;
- resource;
- server;
- community;
- notifications;
- admin;
- advertising.

---

## 84. Runtime validation

Run:

```text
python startup.py doctor
python startup.py dev
python startup.py status
python startup.py stop
python startup.py release
```

Verify no manual infrastructure launch is required.

---

## 85. Docker validation

Verify:

- DB health;
- Redis health;
- API readiness;
- web availability;
- worker availability;
- clean shutdown;
- restart behavior.

---

## 86. Test isolation validation

Run test suite twice consecutively.

Verify:

- no accumulating users;
- no accumulating resources;
- no stale test DB state;
- no stale E2E artifacts;
- no port conflicts.

---

# P. FINAL DELIVERABLE

## 87. Repository shape

Target conceptual root:

```text
/
├── config/
├── contracts/
├── documents/
├── infrastructure/
├── logs/
├── site/
├── module/
├── temp/
├── tests/
├── startup.py
├── package.json
├── pnpm-workspace.yaml
└── ...
```

No unnecessary runtime/build/test folders at root.

---

## 88. Operational experience

Target:

```text
python startup.py
```

→ complete local development environment.

Target:

```text
python startup.py test
```

→ isolated tests.

Target:

```text
python startup.py release
```

→ production-like local stack.

Target:

```text
python startup.py clean
```

→ safe cleanup.

Target:

```text
python startup.py doctor
```

→ environment diagnosis.

---

## 89. Admin experience

Admin can:

```text
inspect users
inspect user actions
manage roles
manage permissions
moderate resources
moderate servers
moderate community
resolve reports
inspect disputes
inspect audit
inspect system logs
manage advertising
manage campaigns
manage placements
inspect advertising analytics
manage premium entitlements
inspect system health
```

---

## 90. Final cleanup requirement

Before declaring PLAN-017 complete:

1. Search for stale references to deleted paths.
2. Search for duplicate configuration.
3. Search for dead exports.
4. Search for unused test folders.
5. Search for PLAN-specific runtime/test naming.
6. Search for raw color violations.
7. Search for duplicate navigation controls.
8. Search for temporary artifacts outside `temp/`.
9. Search for logs outside `logs/`.
10. Search for startup instructions outside canonical `startup.py` workflow.
11. Search for claims in documentation that no longer match code.
12. Run the complete validation matrix.

---

# DEFINITION OF DONE

PLAN-017 is complete only when all of the following are true:

```text
[ ] Repository structure consolidated
[ ] temp/ introduced and used
[ ] runtime artifacts moved
[ ] logs policy normalized
[ ] config centralized
[ ] secrets remain outside tracked config
[ ] startup.py rebuilt as canonical CLI
[ ] dev unified
[ ] release unified
[ ] test unified
[ ] Docker topology simplified
[ ] dev/test isolation verified
[ ] tests reorganized by capability/domain
[ ] plan-based test folders removed
[ ] redundant tests removed
[ ] test tiers implemented
[ ] CI duplication reduced

[ ] Admin page decomposed
[ ] user management
[ ] user activity
[ ] roles
[ ] permissions
[ ] audit
[ ] system logs
[ ] moderation
[ ] advertising
[ ] campaign management
[ ] placement management
[ ] advertising analytics
[ ] premium entitlement foundation

[ ] duplicate sidebar control removed
[ ] duplicate shell controls removed
[ ] search focus fixed
[ ] final font applied
[ ] nested menu scrolling reduced/fixed
[ ] resource price alignment fixed
[ ] card density improved
[ ] Home spacing refined
[ ] light/dark parity verified

[ ] identities callback fixed
[ ] incomplete known technical debt addressed
[ ] dead code removed
[ ] duplicate primitives consolidated
[ ] N+1 hotspots reviewed
[ ] Home queries optimized
[ ] Admin pagination/filtering verified
[ ] authorization audited
[ ] sensitive data exposure audited

[ ] CURRENT.md synchronized
[ ] DEVELOPMENT.md synchronized
[ ] TESTING.md synchronized
[ ] architecture docs synchronized

[ ] type-check PASS
[ ] lint PASS
[ ] format-check PASS
[ ] build PASS
[ ] unit/integration PASS
[ ] E2E PASS
[ ] Docker smoke PASS
[ ] startup.py doctor PASS
[ ] startup.py dev PASS
[ ] startup.py test PASS
[ ] startup.py release PASS
[ ] repeat-test isolation PASS
[ ] 1440 desktop QA PASS
[ ] 1920 desktop QA PASS
[ ] light theme PASS
[ ] dark theme PASS
```

# FINAL OBJECTIVE

After PLAN-017:

**MTA Market must stop behaving like an accumulated multi-plan repository and start behaving like one coherent platform.**

The desired result is:

```text
ONE REPOSITORY
ONE CONFIGURATION MODEL
ONE STARTUP ENTRY POINT
ONE TESTING MODEL
ONE ADMIN CONTROL CENTER
ONE DESIGN SYSTEM
ONE OPERATIONAL MODEL
```

while preserving the existing production architecture, domain contracts and security boundaries.