# PLAN-018 — Productization, Monetization & Closed Beta

## TARGET

Turn the technically consolidated MTA Market into a real commercial platform ready for closed beta.

Priority order:

```text
COMMERCE
→ TRUST
→ UPDATES
→ CREATOR / SERVER
→ PREMIUM
→ ADVERTISING
→ COMMUNITY
→ GROWTH FEATURES
→ CLOSED BETA
```

Do not start a new architecture rewrite.

Do not add features without integrating them into the existing domain model.

Do not implement future functionality as static UI placeholders.

---

# A. COMMERCE

## A-001 — Payment lifecycle

Audit and complete:

```text
ORDER_CREATED
PAYMENT_PENDING
PAYMENT_SUCCEEDED
PAYMENT_FAILED
PAYMENT_CANCELLED
REFUNDED
```

Ensure invalid transitions are rejected.

---

## A-002 — Webhook reliability

For every enabled provider:

- verify signatures;
- validate amount;
- validate currency;
- validate order/payment reference;
- make processing idempotent;
- reject unknown events;
- safely handle duplicate and late events.

Required tests:

```text
duplicate
unknown
amount mismatch
late
cancelled
invalid signature
```

---

## A-003 — Payment reconciliation

Implement reconciliation between:

```text
provider events
↔ payments
↔ orders
↔ ledger
```

Add admin-visible reconciliation status:

```text
MATCHED
MISMATCH
PENDING
RESOLVED
```

---

## A-004 — Refund lifecycle

Implement:

```text
REFUND_REQUESTED
REFUND_PENDING
REFUNDED
REFUND_FAILED
```

Support:

- full refund;
- partial refund where domain permits;
- immutable financial history;
- audit record.

---

## A-005 — Buyer transaction history

Create complete user-facing transaction history:

- purchases;
- payments;
- refunds;
- fees where applicable;
- current state;
- timestamps;
- order/resource references.

---

## A-006 — Seller financial center

Complete:

```text
Available
Pending
Sales
Fees
Refunds
Payouts
Transactions
```

Use existing ledger as source of truth.

Never calculate financial balance from frontend state.

---

## A-007 — Payout lifecycle

Implement/finish:

```text
PAYOUT_PENDING
PAYOUT_PROCESSING
PAYOUT_COMPLETED
PAYOUT_FAILED
```

Add admin review surface.

Audit every payout action.

---

## A-008 — Checkout hardening

Verify:

```text
product
→ price snapshot
→ discount
→ order
→ payment
→ webhook
→ purchase
→ entitlement
```

Frontend must never be trusted for final totals.

---

# B. DISCOUNTS / COMMERCIAL TOOLS

## B-001 — Seller discount campaigns

Support:

- percentage;
- fixed amount;
- start/end;
- active/inactive;
- usage limit;
- per-user limit;
- minimum order;
- product targeting;
- optional coupon code.

---

## B-002 — Discount validation

Add tests for:

```text
active
expired
future
maximum uses
per-user limit
wrong seller
zero total
discount > subtotal
multiple items
```

---

## B-003 — Discount administration

Admin can:

- inspect campaign;
- pause;
- disable;
- inspect usage;
- inspect suspicious activity.

---

## B-004 — Buyer discount UX

Display consistently:

```text
original price
discount
final price
campaign state
```

Fix all card/checkout price alignment.

---

# C. TRUST SYSTEM

## C-001 — Resource verification state

Expose clear verified status using real backend state.

Support:

```text
VERIFIED
UNVERIFIED
FAILED
```

Do not display “verified” based only on UI conventions.

---

## C-002 — Compatibility matrix

Complete resource-version compatibility data:

```text
MTA min/max
OS
architecture
dependencies
native modules
required resources
runtime assumptions
```

Results:

```text
VERIFIED
PARTIAL
UNKNOWN
FAILED
```

---

## C-003 — Resource health

Implement aggregated health calculation.

Possible inputs:

```text
installation success
update success
refund rate
compatibility
sandbox result
```

Expose explainable factors.

---

## C-004 — Seller health score

Create explainable seller score from:

```text
installation success
refund rate
update reliability
support response
compatibility
```

Never use an opaque score.

---

## C-005 — Trust UI consistency

Use the same trust semantics across:

- ResourceCard;
- resource page;
- ServerCard;
- server page;
- Creator;
- Search;
- Reviews;
- Activity.

---

# D. VERSIONING / UPDATE SYSTEM

## D-001 — Release manifest

Complete version manifest:

```text
resource
version
artifact hash
manifest hash
publisher
build id
signature
key id
```

Artifact remains immutable.

---

## D-002 — Verification pipeline

Enforce:

```text
manifest
→ signature
→ hash
→ compatibility
→ staged installation
→ health check
→ activation
```

---

## D-003 — Rollback

Maintain last known-good version.

On failed activation:

```text
new version
→ failure
→ rollback
→ restore previous
→ record incident
```

---

## D-004 — Release channels foundation

Prepare:

```text
stable
beta
legacy
```

Do not enable automatic broad rollout without policy.

---

## D-005 — Update Center

User sees:

```text
Installed
Latest
Compatibility
Health
Update available
```

and available actions:

```text
Update
Rollback
View changelog
```

---

# E. CREATOR PLATFORM

## E-001 — Creator Studio

Complete:

```text
Overview
Resources
Services
Orders
Sales
Customers
Reviews
Promotions
Payouts
Analytics
```

---

## E-002 — Creator profile

Complete:

```text
Verified Creator
Sales
Rating
Resources
Services
Followers
```

Add clear public trust/reputation data.

---

## E-003 — Creator following

Implement:

```text
Follow
Unfollow
Following feed
New resource notification
New version notification
Price change notification
```

---

## E-004 — Creator publishing flow

Complete:

```text
Basic info
Pricing
Compatibility
Dependencies
Artifact
Validation
Sandbox
Moderation
Publish
```

Do not bypass moderation.

---

## E-005 — Creator analytics

Implement meaningful MVP analytics:

```text
views
downloads/acquisitions
sales
conversion
revenue
refunds
rating
resource health
```

Use bounded aggregations.

---

# F. SERVER PLATFORM

## F-001 — Server owner dashboard

Implement:

```text
Overview
Live
Statistics
Reviews
News
Updates
Followers
Promotion
```

---

## F-002 — Server following

Support:

```text
Follow
Unfollow
Notifications
Activity
```

---

## F-003 — Server verification

Admin-controlled:

```text
Verified
Pending
Rejected
Suspended
```

---

## F-004 — Server statistics

Provide:

```text
24H
7D
30D
```

with:

- peak;
- average;
- uptime;
- trend.

---

## F-005 — Server privacy

Resource visibility remains explicit owner opt-in.

Never automatically publish which resources a server uses.

---

# G. COMMUNITY

## G-001 — Resource-linked discussions

Allow discussion context to reference a resource.

---

## G-002 — Server-linked discussions

Allow discussion context to reference a server.

---

## G-003 — Community moderation

Admin/moderator can:

- review reports;
- lock;
- remove;
- restore;
- pin;
- moderate replies.

---

## G-004 — Community notifications

Integrate:

```text
reply
mention
followed thread activity
server discussion activity
resource discussion activity
```

---

## G-005 — Activity feed

Complete unified activity feed using existing domain events.

Avoid duplicate event creation.

---

# H. SEARCH / DISCOVERY

## H-001 — Global search

Search:

```text
Resources
Services
Servers
Creators
Discussions
News
```

---

## H-002 — Search filters

Implement useful filters:

```text
type
category
price
verified
compatibility
rating
sales
updated
```

---

## H-003 — Search ranking

Use safe existing signals first:

```text relevance
activity
sales
rating
trust
compatibility
recency
```

Do not introduce Elasticsearch/Meilisearch without demonstrated scale need.

---

# I. PERSONAL EXPERIENCE

## I-001 — My MTA dashboard

Show:

```text
Since last visit
Updates
Notifications
Following activity
Purchases
Open orders
Disputes
```

---

## I-002 — Favorites

Complete:

```text
resources
servers
creators
discussions
```

where supported.

---

## I-003 — Price alerts

Prepare notifications for:

```text
price drop
discount started
version released
```

---

## I-004 — License center

Show:

```text
Resource
Version
License
Installation
Status
Expiration
Update
```

---

# J. PREMIUM

## J-001 — Premium entitlement model

Implement feature entitlements, not UI-only badges.

Prepare:

```text
CREATOR_PREMIUM
SERVER_PREMIUM
ANALYTICS_PREMIUM
PROMOTION_PREMIUM
```

Only expose plans backed by real entitlements.

---

## J-002 — Creator Premium

Define and implement the first useful package, for example:

- advanced analytics;
- enhanced creator profile;
- increased promotion capabilities.

---

## J-003 — Server Premium

Implement initial package:

- enhanced statistics;
- featured placement;
- additional server customization where supported.

---

## J-004 — Subscription lifecycle

Support:

```text
ACTIVE
PAST_DUE
GRACE_PERIOD
CANCELLED
EXPIRED
```

Handle:

- renewal;
- failed payment;
- cancellation;
- reactivation;
- refunds;
- expiration.

---

## J-005 — Premium administration

Admin can:

- inspect plans;
- enable/disable plans;
- grant entitlement;
- revoke entitlement;
- inspect expiration;
- audit manual changes.

---

# K. ADVERTISING / REVENUE

## K-001 — Campaign lifecycle

Implement:

```text
DRAFT
SCHEDULED
ACTIVE
PAUSED
EXPIRED
CANCELLED
```

---

## K-002 — Placements

Support:

```text
HOME_HERO
HOME_RAIL
MARKET_FEATURED
SERVER_FEATURED
COMMUNITY_FEATURED
SEARCH_PROMOTION
```

---

## K-003 — Paid placement

Implement productized packages:

```text
STANDARD
FEATURED
PREMIUM
PINNED
```

Do not hardcode package behavior in frontend.

---

## K-004 — Campaign billing

Connect campaign purchase/payment to existing commerce model.

Do not create a second payment system.

---

## K-005 — Campaign analytics

Track:

```text
impressions
clicks
CTR
```

Display campaign performance to authorized owners/admins.

---

## K-006 — Admin ad control

Admin can:

- approve;
- reject;
- pause;
- resume;
- pin;
- unpin;
- schedule;
- prioritize;
- preview;
- terminate;
- refund where applicable.

---

# L. PROTECTED DEALS

## L-001 — Deal Room foundation

Prepare bounded transaction workspace:

```text
Buyer
Seller
Offer
Payment
Delivery
Messages
Evidence
Status
```

---

## L-002 — Protected states

Implement:

```text
CREATED
FUNDED
DELIVERING
DELIVERED
ACCEPTED
DISPUTED
RESOLVED
CLOSED
```

---

## L-003 — Evidence

Support:

- messages;
- files;
- delivery evidence;
- dispute events.

Everything sensitive must be access-controlled.

---

# M. LIVE DEMO

## M-001 — Technical foundation

Create a bounded Demo Manager.

Flow:

```text
template
→ clone
→ install resource
→ start
→ TTL
→ destroy
```

---

## M-002 — Security

Reuse sandbox security boundaries.

No arbitrary network access.

No persistent demo server state.

No access to production resources.

---

## M-003 — User experience

Resource page action:

```text
Try Live Demo
```

Show:

- startup state;
- TTL;
- connection information;
- automatic expiration.

---

# N. 3D ASSET STUDIO

## N-001 — Asset pipeline foundation

Support parsing of applicable assets and extract:

```text
polycount
textures
materials
bones
animations
collision
LOD
```

---

## N-002 — Reuse extracted data

Use asset metadata in:

```text
preview
moderation
resource page
compatibility
quality score
```

Do not create duplicate parsers for each surface.

---

## N-003 — Preview

Create resource preview surface where technically supported.

---

# O. LEAK RADAR / FORENSICS

## O-001 — Artifact fingerprinting

Generate stable artifact fingerprints.

---

## O-002 — Evidence aggregation

Combine:

```text
fingerprint
watermark
hash similarity
installation evidence
source similarity
external evidence
```

---

## O-003 — Confidence score

Output:

```text
confidence
evidence count
artifact family
```

Never treat a low-confidence match as proof of misconduct.

---

## O-004 — Admin investigation surface

Admin/security users can:

- inspect case;
- review evidence;
- mark false positive;
- confirm;
- dismiss;
- record resolution.

All investigations audited.

---

# P. OBSERVABILITY

## P-001 — Metrics

Implement/verify:

```text
request latency
5xx
DB latency
Redis latency
webhook backlog
payment success
license verification failures
download failures
sandbox failures
queue depth
```

---

## P-002 — Structured logging

Standardize:

```text
request_id
user_id where safe
route
status
latency
error_code
```

Do not log secrets.

---

## P-003 — Alerts

Prepare alerts for:

```text
payment webhook lag
ledger mismatch
5xx spike
DRM verification spike
storage failure
queue backlog
```

---

# Q. SECURITY / PRODUCTION

## Q-001 — Sessions

Complete:

- refresh rotation;
- reuse detection;
- revoke session;
- revoke all sessions;
- active session list.

---

## Q-002 — Authorization

Verify all sensitive actions use permission-based backend authorization.

Do not rely on frontend role visibility.

---

## Q-003 — Rate limits

Protect:

```text
login
refresh
identity linking
checkout
coupons
webhooks
license activation
license verification
downloads
reviews
service orders
```

Use endpoint-appropriate limits.

---

## Q-004 — Security headers / CORS

Audit:

- Helmet/security headers;
- CORS;
- trusted proxy;
- request size limits;
- CSRF strategy where applicable.

---

## Q-005 — Supply chain

CI must check:

```text
dependencies
lockfile
container images
secrets
artifact integrity
release signatures
```

---

## Q-006 — Backup / restore

Define and test:

```text
RPO
RTO
retention
offsite
encryption
restore
```

Back up:

```text
PostgreSQL
object storage
critical configuration
key-recovery metadata
```

---

# R. PRODUCTION OPERATIONS

## R-001 — Production checklist

Do not mark production-ready until:

```text
payment bypass impossible
webhooks verified
idempotency verified
amount validated
reconciliation works
ledger reconciles
seller cannot bypass moderation
uploads sandboxed
artifacts immutable
downloads require entitlement
storage private
tokens protected
```

---

## R-002 — Release process

Standardize:

```text
build
→ validate
→ package
→ sign
→ deploy
→ health check
→ smoke
→ monitor
```

---

## R-003 — Incident workflow

Define operational handling for:

- payment incident;
- storage incident;
- authentication incident;
- DRM incident;
- sandbox incident;
- database incident.

---

# S. CLOSED BETA

## S-001 — Beta readiness

Prepare:

```text
5–10 sellers
20–50 buyers
real resources
real MTA servers
real purchases
real support
real moderation
real disputes
```

---

## S-002 — Beta onboarding

Create onboarding path for:

### Seller

```text
register
→ creator profile
→ seller verification
→ first resource
→ upload
→ moderation
→ publish
```

### Buyer

```text
register
→ discover
→ purchase/free acquisition
→ license
→ install
→ review
```

### Server owner

```text
register
→ add server
→ verify
→ configure page
→ publish news
→ receive reviews
```

---

## S-003 — Support operations

Admin/support must be able to inspect:

- account;
- purchase;
- payment;
- license;
- installation;
- resource;
- server;
- dispute;
- notifications;
- audit trail.

---

## S-004 — Beta metrics

Track:

```text
registered users
active users
sellers
published resources
purchases
free acquisitions
conversion
refunds
active servers
players
reviews
support incidents
payment failures
```

---

## S-005 — Beta feedback

Add controlled feedback mechanism for beta users.

Capture:

```text
category
severity
description
route/entity
optional screenshot
status
```

Do not turn support feedback into an uncontrolled issue dump.

---

# T. FINAL PRODUCT QA

## T-001 — End-to-end seller flow

Verify:

```text
register
→ create resource
→ upload
→ validation
→ sandbox
→ moderation
→ publish
→ sale
→ payout
```

---

## T-002 — End-to-end buyer flow

Verify:

```text
register
→ discover
→ inspect trust
→ discount
→ checkout
→ payment
→ webhook
→ purchase
→ entitlement
→ license
→ download
→ installation
→ review
```

---

## T-003 — Free product flow

Verify:

```text
free resource
→ acquisition
→ entitlement
→ license where required
→ installation
→ review eligibility
```

No zero-value payment object.

---

## T-004 — Service flow

Verify:

```text
publish service
→ order
→ payment
→ in progress
→ delivery
→ acceptance
→ dispute/refund path
```

---

## T-005 — Admin flow

Verify:

```text
user
→ role
→ permission
→ moderation
→ audit
→ advertising
→ finance
→ dispute
```

---

## T-006 — Security regression

Run regression against:

```text
auth
payment
webhooks
uploads
DRM
licenses
permissions
downloads
admin
```

---

# U. FINAL ACCEPTANCE

PLAN-018 is complete only when:

```text
[ ] Commerce lifecycle complete
[ ] Payments reconciled
[ ] Refund lifecycle complete
[ ] Seller financial center complete
[ ] Discounts complete
[ ] Trust system complete
[ ] Compatibility complete
[ ] Health/reputation complete
[ ] Updates/rollback complete

[ ] Creator platform complete
[ ] Server owner platform complete
[ ] Community integrations complete
[ ] Search complete
[ ] My MTA complete
[ ] License center complete

[ ] Premium entitlement system complete
[ ] At least first Premium plans operational
[ ] Subscription lifecycle operational

[ ] Advertising campaigns operational
[ ] Paid placements operational
[ ] Ad analytics operational
[ ] Admin advertising controls operational

[ ] Protected Deal foundation operational
[ ] Live Demo operational
[ ] 3D Asset foundation operational
[ ] Leak Radar foundation operational

[ ] Observability operational
[ ] Security hardening verified
[ ] Backup/restore verified
[ ] Production checklist verified

[ ] Seller beta flow verified
[ ] Buyer beta flow verified
[ ] Server beta flow verified
[ ] Support workflow verified
[ ] Beta metrics available
[ ] E2E critical journeys pass
[ ] Unit/integration suite pass
[ ] Release build pass
[ ] Production-like smoke pass
```

# NON-GOALS

Do not:

- rewrite the platform into microservices;
- replace PostgreSQL without evidence;
- replace Redis without evidence;
- introduce Elasticsearch without scale justification;
- rebuild existing domains;
- create duplicate payment/ledger systems;
- create separate test architecture outside the unified runner;
- add roadmap items merely as placeholder UI;
- bypass moderation;
- expose private server-resource relationships;
- expose private telemetry;
- mark future features as implemented when they are only prepared.

# RESULT

After PLAN-018, MTA Market must be capable of operating as a real closed-beta commercial platform:

```text
SELL
BUY
INSTALL
LICENSE
UPDATE
REVIEW
FOLLOW
PROMOTE
SUBSCRIBE
SUPPORT
DISPUTE
ANALYZE
```

with the platform itself controlling:

```text
TRUST
MONEY
CONTENT
SERVERS
CREATORS
ADVERTISING
ACCESS
OPERATIONS
```

and with all critical journeys verified end-to-end.