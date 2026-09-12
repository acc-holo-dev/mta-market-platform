# PLAN-020 — Architecture Deep Audit & Stabilization

## TARGET

Audit the entire `mta-market-platform` after PLAN-017/018/019 and remove hidden complexity, unsafe assumptions, inconsistent contracts, weak boundaries, and incomplete technical behavior.

This is an **audit + correction plan**, not a feature expansion.

Do not add technologies unless the current implementation proves they are needed.

Do not rewrite working domains without evidence.

Every finding must end in one of:

```text
KEEP
SIMPLIFY
MERGE
REPLACE
REMOVE
FIX
DEFER
```

---

# A. REPOSITORY / ARCHITECTURE

## A-001 — Full architecture map

Inspect:

```text
site/server
site/web
module
contracts
config
infrastructure
tests
startup.py
```

Create a current dependency map.

Identify:

* duplicated responsibilities;
* circular dependencies;
* legacy paths;
* compatibility layers;
* hidden coupling;
* infrastructure code inside domain code.

---

## A-002 — Verify modular-monolith boundaries

Audit every backend module.

Reject:

```text
module A
→ direct internal DB access to module B
```

Prefer:

```text
module A
→ public application/service contract
```

or:

```text
domain event
```

---

## A-003 — Remove accidental abstractions

Find wrappers that only forward calls:

```text
service → service
repository → repository
client → client
helper → helper
```

Remove abstractions with no ownership, policy, validation, caching, or domain value.

---

## A-004 — Remove compatibility debt

Locate all compatibility shims introduced during previous plans.

Especially:

```text
api-ext compatibility layer
legacy exports
legacy route aliases
old configuration names
old test aliases
```

Remove anything no longer consumed.

Keep only documented compatibility that is required.

---

## A-005 — Dependency-direction enforcement

Establish explicit allowed import direction.

At minimum:

```text
HTTP
↓
Application
↓
Domain
↓
Data/Infrastructure
```

Prevent:

```text
domain → HTTP
domain → frontend
repository → controller
module → unrelated domain internals
```

---

# B. PRISMA / ORM / DATA ACCESS

## B-001 — Prisma runtime audit

Verify exact compatibility of:

```text
prisma CLI
@prisma/client
@prisma/orm-postgres
generated client
adapter
```

Verify:

* generation;
* migrations;
* runtime;
* transactions;
* test environment;
* production build.

No undocumented mixed-major behavior.

---

## B-002 — ORM abstraction audit

Audit current:

```text
db.orm.*
```

pattern.

For every abstraction determine:

```text
KEEP
SIMPLIFY
REMOVE
```

Document why.

---

## B-003 — Repository standard

Normalize repository methods:

```text
findById
findMany
count
create
update
delete
aggregate
```

Remove domain-specific variations that provide no value.

---

## B-004 — Transaction audit

Inspect all multi-write operations.

Required atomicity:

```text
order creation
payment completion
refund
payout
purchase
entitlement
license
ledger
subscription state
discount redemption
```

Find partial-commit paths.

---

## B-005 — Query plan audit

Profile expensive queries.

Inspect:

```text
JOIN
ORDER BY
GROUP BY
COUNT
pagination
search
aggregations
```

Add indexes only when supported by actual query plans.

---

# C. DATABASE

## C-001 — Schema consistency

Find:

* duplicate states;
* redundant fields;
* stale columns;
* nullable values that should not be nullable;
* impossible combinations;
* duplicate timestamps;
* obsolete tables.

---

## C-002 — State-machine correctness

Audit every important enum/state machine:

```text
Order
Payment
Refund
Payout
Subscription
Resource
Version
License
Deal
Campaign
Moderation
Dispute
```

Create a single transition table for each.

Reject illegal transitions centrally.

---

## C-003 — Foreign-key policy

Audit all relations for:

```text
CASCADE
RESTRICT
SET NULL
```

Verify deletion behavior against actual business rules.

---

## C-004 — Orphan detection

Find possible orphan records for:

```text
orders
payments
purchases
licenses
entitlements
artifacts
versions
notifications
audit events
outbox
campaigns
subscriptions
```

Implement safe cleanup/reconciliation where required.

---

## C-005 — Money correctness

Verify all financial code uses integer minor units.

Standardize:

```text
amountMinor
currency
```

No float calculations.

---

# D. API CONTRACTS

## D-001 — OpenAPI completeness

Compare implementation against OpenAPI.

Find:

```text
missing endpoints
undocumented fields
wrong status codes
legacy response shapes
wrong auth requirements
```

---

## D-002 — Generated client consistency

Verify frontend client is generated/derived from the canonical contract where practical.

Remove manually duplicated DTOs.

---

## D-003 — Canonical errors

Audit every route for canonical error responses:

```json
{
  "error": {
    "code": "...",
    "message": "...",
    "requestId": "..."
  }
}
```

Remove raw exception leakage and inconsistent error JSON.

---

## D-004 — API pagination

Define one pagination contract.

Apply to:

```text
users
resources
servers
activity
notifications
transactions
audit
search
```

Reject unbounded list endpoints.

---

## D-005 — API response budgets

Measure response size and query count for major endpoints.

Set reasonable limits.

---

# E. OUTBOX / WORKER / EVENTS

## E-001 — Outbox correctness audit

Verify:

```text
DB transaction
→ outbox insert
→ worker claim
→ processing
→ completion
```

Test crashes at every boundary.

---

## E-002 — Duplicate delivery

Force duplicate event execution.

Verify consumers remain idempotent.

---

## E-003 — Claim/CAS correctness

Audit worker claim race conditions.

Two workers must never both own the same job concurrently.

---

## E-004 — Retry policy

Verify:

```text
retry count
backoff
dead-letter
permanent failure
manual retry
```

No infinite retry loop.

---

## E-005 — Outbox cleanup

Implement retention/archival/deletion policy.

Ensure queue tables cannot grow indefinitely.

---

## E-006 — Event ownership

Every event must have:

```text
producer
schema
consumer
retry behavior
idempotency rule
```

Remove duplicate event implementations.

---

# F. REDIS / CACHE

## F-001 — Redis responsibility audit

Classify every Redis usage:

```text
cache
lock
rate limit
queue
ephemeral
```

Remove unapproved persistent-data usage.

---

## F-002 — Cache invalidation

For every cache:

```text
key
TTL
source
invalidation trigger
```

must be known.

---

## F-003 — Stale-data audit

Check:

```text
resource
server
activity
notification
profile
balance
advertising
```

for stale reads after writes.

---

## F-004 — Lock audit

Test concurrent:

```text
reconciliation
payments
payouts
scheduled jobs
expensive processing
```

Ensure lock expiration cannot corrupt state.

---

# G. PAYMENTS / LEDGER

## G-001 — Payment state machine audit

Verify every provider produces the same canonical lifecycle.

---

## G-002 — Provider boundary

Provider adapters may implement:

```text
create
verify
status
refund
cancel
```

Business rules stay outside provider adapters.

---

## G-003 — Webhook race tests

Simulate:

```text
duplicate
out-of-order
late
unknown
wrong amount
wrong currency
invalid signature
concurrent
```

---

## G-004 — Ledger reconciliation

Verify:

```text
total debit = total credit
```

and account balances match ledger entries.

---

## G-005 — Payment/ledger atomicity

Find paths where payment state changes but ledger does not, or vice versa.

Make the operation recoverable and idempotent.

---

## G-006 — Subscription financial integrity

Audit:

```text
renewal
failed charge
grace
cancel
reactivate
refund
expiration
```

against:

```text
payment
ledger
entitlement
```

---

# H. ENTITLEMENTS / LICENSE / DRM

## H-001 — Entitlement consistency

Verify:

```text
purchase
→ entitlement
→ license
→ download
```

cannot diverge.

---

## H-002 — Revocation behavior

Verify revoked:

```text
license
entitlement
purchase
```

cannot create a new valid download/lease.

---

## H-003 — Artifact immutability

Verify published artifact bytes cannot be silently changed.

Hash/signature/manifest must remain consistent.

---

## H-004 — DRM contract

Verify:

```text
site
↔ contracts
↔ module
```

all use identical protocol semantics and error codes.

---

## H-005 — Clock/outage behavior

Verify:

```text
temporary outage
lease grace
renewal failure
revocation
clock skew
```

do not produce unsafe or surprising behavior.

---

# I. AUTH / SESSIONS

## I-001 — Authentication matrix

Audit all providers:

```text
password
Google
Yandex
VK
Telegram
```

Verify discovery, login, linking, unlinking and disabled-provider behavior.

---

## I-002 — Session security

Verify:

```text
rotation
reuse detection
revocation
revoke all
expiry
device listing
```

---

## I-003 — Identity-link race conditions

Simulate concurrent linking/unlinking.

Prevent:

```text
account takeover
duplicate identity
cross-account binding
```

---

## I-004 — OAuth token storage

Verify all provider tokens are encrypted at rest where required.

No plaintext legacy rows remain.

---

# J. AUTHORIZATION / ADMIN

## J-001 — Permission matrix

Audit every privileged endpoint against:

```text
role
permission
resource ownership
```

---

## J-002 — Frontend authorization independence

Hide/show UI based on permission, but never rely on frontend authorization.

Test direct HTTP access.

---

## J-003 — Admin privilege escalation

Test:

```text
ADMIN → SUPERADMIN
self downgrade
last SUPERADMIN
cross-role assignment
```

No unsafe transition.

---

## J-004 — Audit completeness

Verify all privileged actions create audit entries.

Especially:

```text
role
permission
moderation
finance
advertising
premium
security
configuration
```

---

# K. STORAGE / ARTIFACTS

## K-001 — Storage boundary

Verify application accesses storage only through the storage abstraction.

---

## K-002 — Signed URL policy

Check:

```text
TTL
permissions
path scope
resource ownership
license entitlement
```

---

## K-003 — Private artifact isolation

Ensure paid artifacts cannot be fetched through:

```text
public URL
predictable URL
cache
alternate endpoint
```

without authorization.

---

# L. FRONTEND ARCHITECTURE

## L-001 — Feature ownership

Audit:

```text
features/
components/
lib/
store/
app/
```

Move domain-specific UI out of global component folders where appropriate.

---

## L-002 — Server/client boundary

Find unnecessary:

```text
"use client"
```

Remove client components that can remain server-rendered.

---

## L-003 — React Query/Zustand boundary

React Query owns server state.

Zustand owns UI/client state.

Remove duplicated data stores.

---

## L-004 — API request duplication

Find multiple implementations of the same request.

Every endpoint should have one canonical client path.

---

## L-005 — Query-key consistency

All React Query keys must use the canonical key factory.

---

# M. NEXT.JS / WEB PERFORMANCE

## M-001 — Bundle audit

Identify:

```text
large dependencies
duplicate dependencies
large client components
unused packages
```

---

## M-002 — Route rendering audit

For every major route determine:

```text
RSC
SSR
client
prefetch
revalidate
```

and justify the choice.

---

## M-003 — Image/media audit

Verify:

* appropriate formats;
* lazy loading;
* responsive sizing;
* no unnecessary full-resolution assets.

---

## M-004 — Home performance

Measure:

```text
TTFB
LCP
JS
request count
response size
```

before and after optimization.

---

# N. STARTUP / CONFIG

## N-001 — Single config interpretation

Compare:

```text
startup.py YAML parser
server config loader
schemas
environment variables
```

They must have identical semantics.

---

## N-002 — Startup responsibility audit

`startup.py` may:

```text
orchestrate
validate environment
launch services
manage lifecycle
```

It must not become a second application backend.

---

## N-003 — Docker/runtime parity

Verify:

```text
dev
release
test
```

use predictable and documented service topology.

---

## N-004 — Failure handling

Test:

```text
DB down
Redis down
worker down
web down
API down
port occupied
invalid config
Docker unavailable
```

Startup must fail clearly.

---

# O. CI/CD

## O-001 — Workflow inventory

Audit all:

```text
.github/workflows/*.yml
```

Determine:

```text
KEEP
MERGE
DELETE
TRIGGER_ONLY
```

---

## O-002 — Duplicate CI work

Remove repeated:

```text
install
generate
type-check
lint
build
tests
```

where safe.

---

## O-003 — Change-aware execution

Use affected/path-aware execution where it does not reduce required safety.

---

## O-004 — Release gates

Release must require:

```text
build
contract validation
security
critical tests
image validation
smoke
```

---

# P. OBSERVABILITY

## P-001 — Request ID propagation

Verify request ID flows through:

```text
HTTP
logs
DB-relevant audit
worker
payment
notifications
```

---

## P-002 — Structured logs

Standardize:

```text
timestamp
level
service
requestId
route
status
latency
errorCode
```

No secrets.

---

## P-003 — Metrics integrity

Verify metrics are actually derived from live application behavior.

No fake/static metrics.

---

## P-004 — Trace evaluation

Evaluate actual benefit of OpenTelemetry.

If adopted, instrument:

```text
HTTP
DB
Redis
worker
external providers
```

Avoid observability infrastructure with no collector/backend.

---

# Q. SECURITY

## Q-001 — Security headers

Verify:

```text
CSP
HSTS
X-Content-Type-Options
frame policy
referrer policy
```

according to actual deployment needs.

---

## Q-002 — CORS

Audit exact allowed origins per environment.

No wildcard production policy unless explicitly justified.

---

## Q-003 — CSRF

Determine actual cookie/auth model and enforce CSRF protection where necessary.

---

## Q-004 — Rate-limit correctness

Verify all sensitive paths use correct limits.

Do not use one global limiter for all actions.

---

## Q-005 — Request/body limits

Audit:

```text
JSON
multipart
archive
file uploads
webhooks
```

for safe size limits.

---

## Q-006 — Secret leak audit

Search source, logs, errors, admin and CI for:

```text
password
token
private key
payment secret
OAuth credential
DRM key
```

---

# R. PERFORMANCE / LOAD

## R-001 — Baseline

Record:

```text
API p50
API p95
API p99
Home latency
DB latency
memory
CPU
bundle size
```

---

## R-002 — Hot endpoint profiling

Profile top endpoints by:

```text
traffic
latency
DB usage
error rate
```

---

## R-003 — Concurrency audit

Stress:

```text
checkout
webhook
payout
license activation
resource publish
server heartbeat
notifications
```

Find race conditions.

---

# S. FAILURE / RECOVERY

## S-001 — Worker crash recovery

Kill worker during:

```text
claim
processing
completion
retry
```

Verify recovery.

---

## S-002 — Database restart

Restart DB during active application workload.

Verify controlled recovery.

---

## S-003 — Redis restart

Restart Redis.

Verify the application degrades safely according to feature:

```text
cache
rate limit
queue
lock
```

---

## S-004 — Provider outage

Simulate payment provider timeout/unavailability.

Verify:

* no duplicate order;
* no false purchase;
* retry/recovery;
* clear user status.

---

# T. SIMPLIFICATION PASS

## T-001 — Remove dead systems

Delete obsolete:

```text
libraries
helpers
routes
config
tests
scripts
compatibility layers
```

only after reference verification.

---

## T-002 — Merge duplicate systems

Merge duplicate:

```text
logging
errors
configuration
API clients
pagination
money
storage
authorization
events
```

---

## T-003 — Minimize moving parts

For every infrastructure dependency answer:

```text
Why does MTA Market need this?
What breaks without it?
Can PostgreSQL/Redis/current runtime already solve it?
```

Remove unjustified infrastructure.

---

# U. FINAL VERIFICATION

## U-001 — Clean environment

From clean checkout:

```text
python startup.py doctor
python startup.py dev
python startup.py stop
```

No undocumented manual steps.

---

## U-002 — Release rehearsal

Run:

```text
python startup.py release
```

and verify:

```text
DB
Redis
API
WEB
worker
health
smoke
```

---

## U-003 — Full critical journeys

Verify:

```text
register
login
link identity
publish resource
moderate
buy
pay
webhook
ledger
license
download
update
rollback
refund
payout
premium
advertising
admin
```

---

## U-004 — Documentation correctness

Compare documentation to code.

Remove every claim that cannot be demonstrated.

---

## U-005 — Final architecture report

Create:

```text
documents/development/completed/PLAN-020-AUDIT.md
```

with:

```text
finding
severity
current
change
reason
risk
verification
```

---

# DEFINITION OF DONE

PLAN-020 is complete only when:

```text
[ ] architecture boundaries verified
[ ] unnecessary abstractions removed
[ ] compatibility layers reviewed
[ ] Prisma stack verified
[ ] ORM strategy verified
[ ] transactions audited
[ ] database schema audited
[ ] indexes/query plans audited

[ ] OpenAPI matches implementation
[ ] API client is canonical
[ ] errors are canonical
[ ] pagination is bounded
[ ] outbox is crash-safe
[ ] workers are idempotent
[ ] retries are bounded
[ ] Redis usage is justified
[ ] cache invalidation verified

[ ] payments audited
[ ] ledger reconciles
[ ] subscriptions audited
[ ] entitlement/license consistency verified
[ ] DRM/module contract verified

[ ] sessions verified
[ ] identity linking verified
[ ] authorization audited
[ ] admin privilege boundaries verified
[ ] audit coverage verified

[ ] storage isolation verified
[ ] signed URLs verified
[ ] artifact immutability verified

[ ] frontend architecture audited
[ ] React Query/Zustand boundaries verified
[ ] API duplication removed
[ ] Next rendering audited
[ ] bundle/performance audited

[ ] startup/config semantics unified
[ ] Docker topology verified
[ ] CI duplication reduced
[ ] request IDs unified
[ ] structured logging verified
[ ] metrics verified
[ ] security middleware audited
[ ] rate limits audited
[ ] secret exposure audited

[ ] concurrency failures tested
[ ] provider outages tested
[ ] worker recovery tested
[ ] DB/Redis recovery tested

[ ] dead code removed
[ ] unjustified dependencies removed
[ ] duplicate abstractions merged
[ ] final architecture documented
```

# FINAL RULE

Do not finish PLAN-020 by saying:

> “all systems work.”

Finish with concrete evidence:

```text
WHAT WAS AUDITED
WHAT WAS FOUND
WHAT WAS CHANGED
WHAT WAS REMOVED
WHAT WAS KEPT
WHAT REMAINS
WHY IT REMAINS
```

The goal of PLAN-020 is to leave MTA Market with the **simplest technically justified architecture capable of supporting the existing product and the next growth phase**.
