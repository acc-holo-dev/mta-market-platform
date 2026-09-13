> **ВЫПОЛНЕН**: коммит `07bb748` (совместно с PLAN-017/018). Совместная запись исполнения: [EXECUTION-MAP-017-018-019.md](EXECUTION-MAP-017-018-019.md).

# PLAN-019 — Platform Architecture 2.0 & Technology Stack Optimization

## TARGET

Perform a deep technical modernization of `mta-market-platform`.

Focus only on:

```text
architecture
libraries
API
data access
database
cache
queues
events
contracts
storage
auth internals
frontend architecture
native module integration
performance
observability
security primitives
```

Do not start another visual redesign.

Do not add business features unless required to improve an existing technical subsystem.

Do not migrate to microservices.

---

# A. DEPENDENCY / STACK AUDIT

## A-001 — Full dependency inventory

Audit root, web, server, module and workspace dependencies.

For every dependency:

```text
KEEP
UPDATE
REPLACE
REMOVE
```

Record justification.

---

## A-002 — Resolve Prisma version split

Current backend contains different Prisma generations:

```text
@mta-market/server
├── @prisma/client
├── @prisma/orm-postgres
├── prisma CLI
```

Normalize them into one compatible, explicitly supported setup.

Do not leave mixed incompatible major versions.

Validate:

```text
CLI
client
adapter/ORM
generated types
schema tooling
migrations
runtime
```

---

## A-003 — Audit Express stack

Current backend uses:

```text
express 4.x
@types/express 5.x
```

Resolve the major-version mismatch.

Either:

```text
upgrade Express and middleware stack
```

or explicitly pin a compatible 4.x stack.

Do not keep accidental cross-major type/runtime combinations.

---

## A-004 — Frontend dependency audit

Review:

```text
next
react
react-dom
react-query
zustand
axios
lucide-react
tailwind
tailwind-merge
typescript
```

Normalize versions.

Remove dependencies with no meaningful runtime purpose.

---

## A-005 — Remove unnecessary HTTP client dependency

Audit `axios`.

If `fetch + React Query` fully covers its actual usage:

```text
remove axios
```

and migrate all calls to the canonical API client.

---

## A-006 — Remove obsolete utility dependencies

Audit:

```text
commander
cookie-parser
cors
multer
unzipper
date-fns
```

Remove any dependency whose functionality is duplicated by existing platform code, runtime APIs or framework capabilities.

Do not replace libraries unnecessarily.

---

# B. BACKEND MODULAR MONOLITH

## B-001 — Establish module boundaries

Refactor backend into explicit modules:

```text
src/modules/
├── auth/
├── users/
├── marketplace/
├── services/
├── servers/
├── community/
├── content/
├── payments/
├── ledger/
├── licenses/
├── drm/
├── moderation/
├── notifications/
├── advertising/
├── subscriptions/
└── admin/
```

Use actual existing domain names where they differ.

Do not duplicate current services.

---

## B-002 — Define module ownership

Each module owns:

```text
controller/routes
service
repository/data access
schemas
types
events
```

Prevent arbitrary imports across unrelated modules.

---

## B-003 — Dependency direction

Enforce:

```text
HTTP
↓
application/service
↓
domain
↓
data access
↓
infrastructure
```

Controllers must not contain business logic.

Infrastructure must not depend on HTTP.

---

## B-004 — Remove cross-module leaks

Search for:

- direct DB access from unrelated modules;
- direct access to internal services;
- duplicated business rules;
- circular imports.

Replace with explicit service interfaces or domain events.

---

# C. DATA ACCESS / ORM

## C-001 — Audit custom ORM abstraction

Current code uses patterns such as:

```text
db.orm.public.Resource.where(...)
db.orm.public.User.where(...)
```

Audit the abstraction completely.

Determine:

```text
what it solves
what it hides
what it breaks
what it duplicates
```

---

## C-002 — Standardize repository layer

Create consistent repository conventions:

```text
findById
findMany
count
create
update
delete
aggregate
```

No ad-hoc query styles for the same domain.

---

## C-003 — Transaction policy

Define a single transaction abstraction.

Mandatory transactional operations include:

```text
checkout
payment success
purchase creation
entitlement creation
refund
payout
discount redemption
subscription transition
ledger mutation
```

---

## C-004 — Eliminate N+1 queries

Audit:

```text
Home
Market
Resource pages
Server pages
Creator pages
Admin
Activity
Notifications
```

Batch related data.

Do not issue one DB request per rendered row.

---

## C-005 — Query budgets

For major endpoints document:

```text
expected query count
expected max result count
pagination
cache behavior
```

Investigate endpoints with unbounded DB work.

---

# D. DATABASE

## D-001 — Schema audit

Inspect all current tables for:

- redundant columns;
- duplicated state;
- obsolete fields;
- incorrect nullability;
- inconsistent timestamps;
- missing constraints;
- unnecessary JSON blobs.

---

## D-002 — Index audit

Add/remove indexes based on actual query patterns.

Prioritize:

```text
users
resources
resource_versions
orders
payments
ledger_entries
licenses
sessions
audit_events
notifications
activity
server_heartbeats
```

No speculative indexes without query justification.

---

## D-003 — Constraint audit

Verify:

```text
unique
foreign keys
check constraints
enum/state restrictions
cascade behavior
```

Prevent impossible domain states at DB level where appropriate.

---

## D-004 — Money storage

Ensure every monetary field uses exact representation.

Standardize:

```text
Money {
  amountMinor
  currency
}
```

No floating-point financial calculations.

---

## D-005 — Timestamp policy

Standardize:

```text
UTC in database
explicit timezone only in presentation
```

Audit campaign dates, leases, sessions, subscriptions and payment expiry.

---

# E. API ARCHITECTURE

## E-001 — OpenAPI as actual source of truth

Create/normalize:

```text
contracts/api/openapi.yaml
```

Every endpoint must define:

```text
request
response
auth
errors
pagination
idempotency
rate limit class
```

---

## E-002 — Generate/shared API types

Create one generated/shared contract consumed by:

```text
backend
frontend
tests
```

Remove manually duplicated request/response interfaces where generated types can safely replace them.

---

## E-003 — Canonical API client

Replace scattered:

```text
api.ts
api-ext.ts
local fetch helpers
```

with a clear client structure.

Target:

```text
site/web/src/lib/api/
├── client
├── generated
├── auth
├── resources
├── servers
├── community
├── admin
└── commerce
```

---

## E-004 — Canonical error model

All API errors become:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource not found",
    "requestId": "..."
  }
}
```

Remove random legacy error shapes.

---

## E-005 — HTTP status policy

Create a single mapping for:

```text
400
401
403
404
409
422
429
500
502
503
```

No endpoint-specific arbitrary semantics.

---

# F. VALIDATION

## F-001 — Standard validation pipeline

Use one request-validation pattern:

```text
request
→ schema
→ normalized input
→ service
```

---

## F-002 — Zod usage audit

Continue using Zod where it provides value.

Remove duplicated manual validators where equivalent schemas already exist.

---

## F-003 — Shared schemas

Where safe, share schemas for:

```text
pagination
sorting
filters
IDs
money
dates
errors
common query parameters
```

---

# G. IDEMPOTENCY

## G-001 — Idempotency primitive

Create one reusable idempotency mechanism.

Use for:

```text
checkout
payment
webhooks
refunds
payouts
entitlements
licenses
subscriptions
```

---

## G-002 — Webhook idempotency

Store provider event identity.

Repeated provider delivery must not create:

```text
duplicate payment
duplicate purchase
duplicate entitlement
duplicate ledger entry
```

---

# H. EVENTS / OUTBOX / ASYNC

## H-001 — Domain event model

Define canonical events:

```text
USER_REGISTERED
RESOURCE_PUBLISHED
RESOURCE_VERSION_PUBLISHED
PAYMENT_SUCCEEDED
PAYMENT_FAILED
REFUND_COMPLETED
PAYOUT_COMPLETED
DISPUTE_OPENED
DISPUTE_UPDATED
LICENSE_EXPIRING
SECURITY_ALERT
```

---

## H-002 — Outbox pattern

Implement:

```text
domain action
→ database transaction
→ outbox event
→ worker
→ consumer
```

Do not publish critical events before the primary DB transaction is committed.

---

## H-003 — Worker process

Create dedicated worker runtime:

```text
site/server/src/worker/
```

Move appropriate background work out of request processes.

---

## H-004 — Worker jobs

Centralize jobs for:

```text
email
notifications
reconciliation
artifact processing
sandbox
server monitoring
cleanup
analytics aggregation
advertising metrics
subscription processing
```

---

## H-005 — Retry policy

Each job must define:

```text
retry count
backoff
dead-letter behavior
idempotency
failure logging
```

No infinite retries.

---

# I. REDIS

## I-001 — Define Redis responsibilities

Redis may be used for:

```text
cache
rate limits
locks
queues
ephemeral state
```

Do not use Redis as the source of truth for persistent business data.

---

## I-002 — Cache policy

Every cache entry must define:

```text
key
TTL
source
invalidation event
```

No undocumented permanent caches.

---

## I-003 — Distributed locks

Use Redis locking only where necessary:

```text
reconciliation
scheduled jobs
duplicate expensive processing
single-run maintenance tasks
```

Avoid locks around ordinary CRUD.

---

# J. STORAGE

## J-001 — Storage abstraction

Create:

```text
StorageService
```

with standardized:

```text
put
get
delete
exists
presign
copy
```

---

## J-002 — Separate storage classes

Maintain:

```text
public media
private artifacts
temporary files
```

Different access policies for each.

---

## J-003 — Artifact immutability

Published artifacts:

```text
cannot overwrite
cannot reuse ID
checksum immutable
manifest immutable
```

---

# K. ARTIFACT PIPELINE

## K-001 — Pipeline service

Centralize:

```text
Upload
→ Validate
→ Scan
→ Sandbox
→ Normalize
→ Hash
→ Manifest
→ Sign
→ Encrypt
→ Store
→ Moderate
→ Publish
```

---

## K-002 — Pipeline state machine

Persist explicit state.

No hidden boolean combinations representing pipeline progress.

---

## K-003 — Failure recovery

Every pipeline stage must have deterministic failure behavior.

No partially committed artifact state.

---

# L. AUTHENTICATION / SESSION ENGINE

## L-001 — Session abstraction

Standardize session lifecycle:

```text
create
refresh
rotate
revoke
revokeAll
list
```

---

## L-002 — Refresh-token rotation

Verify:

```text
rotation
reuse detection
family invalidation
expiry
revocation
```

---

## L-003 — Session management API

Expose user-facing:

```text
active sessions
device
browser
IP
last used
created
revoke
revoke all others
```

Do not expose sensitive token material.

---

## L-004 — Identity linking

Normalize:

```text
provider
provider user ID
email
verified state
link/unlink
```

Fix the currently known callback/linking inconsistencies during this refactor.

---

# M. AUTH SECURITY

## M-001 — Central authorization engine

Move from ad-hoc role checks toward:

```text
permission check
```

Roles remain permission bundles.

---

## M-002 — Authorization policies

Define reusable policies:

```text canView
canCreate
canEdit
canModerate
canPublish
canRefund
canPayout
canManageAdvertising
canManageRoles
```

---

## M-003 — Rate-limit policy engine

Standardize classes:

```text AUTH
PAYMENT
WEBHOOK
DOWNLOAD
LICENSE
ADMIN
STANDARD
```

Support identity-aware limits where required.

---

# N. FRONTEND ARCHITECTURE

## N-001 — Feature-based organization

Refactor frontend toward:

```text
site/web/src/
├── app/
├── features/
│   ├── marketplace/
│   ├── servers/
│   ├── community/
│   ├── account/
│   ├── admin/
│   ├── advertising/
│   └── commerce/
├── components/
├── lib/
├── store/
└── styles/
```

---

## N-002 — Server vs client state policy

React Query owns server state:

```text
resources
servers
activity
news
notifications
profile
balance
```

Zustand owns local UI state:

```text
theme
sidebar
UI preferences
temporary client state
```

Do not duplicate server data into Zustand.

---

## N-003 — Next.js rendering audit

For every major route determine:

```text
RSC/server-render
SSR
client component
client query
prefetch
revalidation
```

Do not make every page fully client-side by default.

---

## N-004 — Query prefetching

Add prefetch only for high-value navigation.

Do not eagerly fetch entire site datasets.

---

## N-005 — Bundle audit

Inspect:

```text
JS size
client components
large dependencies
duplicate packages
unused imports
```

Reduce initial client bundle where practical.

---

# O. API CACHE / FRONTEND CACHE

## O-001 — Query-key standard

Normalize React Query keys.

No different keys representing the same backend resource.

---

## O-002 — Stale-time policy

Define sensible defaults per domain:

```text
live data
short stale
news
medium stale
static catalog
long stale
notifications
event-driven
```

---

## O-003 — Invalidation events

Centralize invalidation after:

```text resource publish
version publish
purchase
notification
follow
server update
profile update
```

---

# P. PERFORMANCE

## P-001 — Backend profiling

Measure actual:

```text
latency
CPU
memory
DB time
Redis time
external provider time
```

Do not optimize based on assumptions.

---

## P-002 — Slow endpoint report

Identify endpoints above defined thresholds.

For each:

```text
route
p95
query count
DB time
response size
cache hit
```

---

## P-003 — Pagination standard

Use one API pagination contract.

For high-volume data evaluate cursor pagination.

Prioritize:

```text users
resources
activity
notifications
audit
transactions
```

---

## P-004 — Response size limits

Prevent endpoints from returning unnecessarily large payloads.

Add field selection/DTO mapping where useful.

---

# Q. OBSERVABILITY

## Q-001 — Request context

Every request carries:

```text
request_id
```

through:

```text
API
DB logs
worker
payment events
notifications
email
```

---

## Q-002 — Structured logging

Standardize:

```text
request_id
route
method
status
latency
error_code
user_id where safe
```

---

## Q-003 — OpenTelemetry evaluation

Evaluate and, where beneficial, implement OpenTelemetry for:

```text
HTTP
PostgreSQL
Redis
workers
external payment calls
```

Do not introduce a complex tracing platform without a practical backend for collecting traces.

---

## Q-004 — Metrics

Expose:

```text
request latency
5xx
DB latency
Redis latency
queue depth
webhook lag
payment success
license verification failures
download failures
sandbox failures
```

---

# R. ERROR / RESILIENCE

## R-001 — Global error boundary

Backend must convert unexpected exceptions into canonical errors.

Never leak:

```text
stack trace
SQL details
secret values
internal file paths
```

---

## R-002 — External provider isolation

Payment/email/storage/provider failure must not crash the entire API process.

Use:

```text
timeout
retry where safe
circuit/failure handling
async processing
```

---

## R-003 — Graceful shutdown

All services must correctly handle:

```text
SIGTERM
SIGINT
```

Drain:

```text
HTTP
workers
queues
DB connections
Redis
```

before exit.

---

# S. CONTRACTS / NATIVE MODULE

## S-001 — Unified contract tree

Target:

```text
contracts/
├── api/
├── drm/
├── artifacts/
├── events/
└── errors/
```

---

## S-002 — DRM protocol contract

Ensure site and native module use the same versioned:

```text
protocol
manifest
lease
signature
error codes
test vectors
```

---

## S-003 — Shared DRM vectors

Maintain deterministic:

```text
valid signature
invalid signature
expired lease
wrong installation
wrong resource
wrong version
wrong hash
replayed nonce
```

Site and module consume the same vectors.

---

## S-004 — Module ABI/version compatibility

Document and enforce:

```text
module version
protocol version
site/API compatibility
artifact format
```

---

# T. SECURITY ARCHITECTURE

## T-001 — Security middleware audit

Review:

```text
CORS
trusted proxy
security headers
CSRF
body limits
rate limits
cookie policy
```

---

## T-002 — Upload security

Audit:

```text
zip slip
archive bombs
symlinks
oversized files
too many files
invalid metadata
executable payloads
sandbox escape attempts
network abuse
```

---

## T-003 — Supply-chain controls

Verify CI covers:

```text
dependency vulnerabilities
lockfile integrity
secret scanning
container vulnerabilities
artifact integrity
```

---

# U. CODE QUALITY

## U-001 — Remove dead code

Search and remove:

```text
unused files
unused exports
unused dependencies
legacy helpers
obsolete API wrappers
obsolete stores
unused CSS
```

---

## U-002 — Remove plan-era architecture names

Historical references may remain in documentation.

Runtime/source architecture must not depend on PLAN numbering.

---

## U-003 — Type strictness

Audit for:

```text
any
unknown without validation
unsafe casts
duplicated DTOs
optional values incorrectly assumed present
```

Prioritize backend security-sensitive code.

---

## U-004 — Shared utility cleanup

Consolidate duplicate implementations of:

```text money
date
pagination
errors
IDs
logging
authorization
API client
storage
```

---

# V. BUILD / TOOLCHAIN

## V-001 — Node/pnpm policy

One supported:

```text Node version
pnpm version
```

used locally and in CI.

---

## V-002 — TypeScript policy

One central compiler configuration where practical.

Remove contradictory workspace compiler settings.

---

## V-003 — Build cache

Configure Turbo/workspace caching correctly for:

```text build
type-check
lint
tests
```

Do not cache commands with unsafe external side effects.

---

## V-004 — Deterministic builds

Build twice from clean state and verify reproducibility as far as practical.

No undeclared filesystem dependencies.

---

# W. LOCAL OPERATIONAL ARCHITECTURE

## W-001 — `startup.py` as orchestration layer

Preserve PLAN-017's unified interface.

PLAN-019 must make startup orchestration consume:

```text config
Docker
worker
web
api
module
tests
```

rather than duplicating service logic.

---

## W-002 — Service discovery

`startup.py status` must obtain service state from actual runtime health.

Do not infer health only from PID files.

---

## W-003 — Configuration-driven ports

No hardcoded duplicated ports across:

```text Python
Docker
frontend
backend
tests
scripts
```

---

# X. DOCUMENTATION

## X-001 — Architecture source of truth

Update architecture documentation to reflect:

```text modular monolith
API contracts
data access
events
workers
cache
storage
auth
native module
```

---

## X-002 — Dependency policy

Document:

```text supported versions
upgrade policy
breaking-change policy
security update policy
```

---

## X-003 — Operational architecture

Document:

```text startup.py
Docker
services
health checks
worker
queues
config
secrets
```

---

# Y. FINAL TECHNICAL VALIDATION

## Y-001 — Clean install

From clean workspace:

```text
install
generate
build
start
```

must succeed without manual undocumented steps.

---

## Y-002 — Runtime validation

Verify:

```text API
WEB
DB
REDIS
WORKER
MODULE
STORAGE
```

---

## Y-003 — Failure injection

Verify controlled behavior for:

```text DB unavailable
Redis unavailable
storage unavailable
payment provider timeout
email failure
worker restart
duplicate webhook
expired session
```

---

## Y-004 — Performance baseline

Record before/after:

```text cold start
build time
API p95
Home latency
DB query count
bundle size
memory
```

Do not claim performance improvement without measurements.

---

## Y-005 — Final dependency state

Produce final report:

```text
removed dependencies
updated dependencies
replaced dependencies
remaining pinned legacy dependencies
reason for every exception
```

---

# DEFINITION OF DONE

```text
[ ] dependency graph normalized
[ ] Prisma stack consistent
[ ] Express stack consistent
[ ] obsolete dependencies removed
[ ] backend modules bounded
[ ] repository/data-access standard defined
[ ] transactions standardized
[ ] N+1 hotspots removed
[ ] DB schema audited
[ ] DB indexes audited
[ ] money abstraction standardized
[ ] API contract centralized
[ ] generated/shared API types working
[ ] canonical API client working
[ ] canonical errors working
[ ] validation standardized
[ ] idempotency standardized
[ ] domain events standardized
[ ] outbox implemented
[ ] worker architecture implemented
[ ] Redis responsibilities documented
[ ] cache strategy standardized
[ ] storage abstraction implemented
[ ] artifact pipeline centralized
[ ] sessions standardized
[ ] permission engine standardized
[ ] frontend feature structure improved
[ ] server/client state boundaries enforced
[ ] Next rendering strategy audited
[ ] bundle/query performance audited
[ ] OpenTelemetry evaluated/implemented where justified
[ ] observability standardized
[ ] graceful shutdown implemented
[ ] external provider failures isolated
[ ] contracts unified
[ ] DRM/module compatibility centralized
[ ] security middleware audited
[ ] upload security audited
[ ] supply-chain controls verified
[ ] dead code removed
[ ] toolchain standardized
[ ] startup.py integrated with final architecture
[ ] clean install verified
[ ] runtime failure scenarios verified
[ ] performance baseline recorded
[ ] documentation synchronized
```

# NON-GOALS

Do NOT:

```text
introduce microservices
introduce Kubernetes
introduce Kafka without demonstrated need
introduce Elasticsearch without demonstrated need
replace PostgreSQL without evidence
replace Redis without evidence
replace React/Next solely for version numbers
rewrite working domains unnecessarily
create parallel APIs
create parallel ORM layers
create parallel event systems
```

# FINAL RESULT

After PLAN-019 the platform must have:

```text
ONE MODULAR MONOLITH
ONE DATA ACCESS STRATEGY
ONE API CONTRACT
ONE API CLIENT
ONE ERROR MODEL
ONE EVENT MODEL
ONE WORKER MODEL
ONE CACHE STRATEGY
ONE STORAGE ABSTRACTION
ONE AUTHORIZATION MODEL
ONE OBSERVABILITY MODEL
ONE CONTRACT SYSTEM
```

with a technology stack that is:

```text
simpler
more consistent
faster
more observable
easier to maintain
easier for AI agents to modify
safer to extend
cheaper to operate
```

The objective is not to make the codebase more sophisticated.

The objective is to remove accidental complexity and make the existing platform technically coherent before the next major product expansion.