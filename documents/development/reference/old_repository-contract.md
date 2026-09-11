status: current
version: 1.1
last_verified: 2026-09-10


> **Пути (PLAN-011):** этот документ описывает прежнюю трёхрепозиторную
> структуру (frozen). Соответствие старых путей путям монорепо —
> [../../history/MIGRATION.md](../../history/MIGRATION.md); замороженные
> значения не менялись.

# Repository contract

What each repository owns, what it must never own, and the rules that let the
three release independently. Product overview: [../../PROJECT.md](../../PROJECT.md).

## mta-market-document (product documentation + development plan system)

**Owns:**

- Product overview ([../../PROJECT.md](../../PROJECT.md)).
- Development Plan system ([../README.md](../README.md)): ACTIVE/COMPLETED plans,
  [CURRENT.md](../CURRENT.md), completed plan records.
- Frozen cross-repo contracts (this directory): DRM Protocol v2
  ([drm-protocol-v2.md](old_drm-protocol-v2.md)), compatibility matrix
  ([compatibility-matrix.md](old_compatibility-matrix.md)).
- Future ideas ([../../IDEAS/IDEAS.md](../../IDEAS/IDEAS.md)) — not commitments.

**Must never own:**

- A second copy of implementation code or database schema "for reference" —
  the schema lives in `mta-market-site/apps/server/src/prisma/contract.prisma`,
  the frozen protocol constants live in
  `mta-market-site/apps/server/src/lib/drm/protocol.ts`.
- Marketing claims. Statuses must be backed by cited evidence.

**Truth rule:** this repo specifies; the code repositories verify. When a spec
and code disagree, either the spec is updated (with a dated, honest note) or
the code is fixed — a silent divergence is a defect in both.

## mta-market-site (marketplace)

**Owns:**

- `apps/server` — Express + TypeScript API: auth orchestration (OAuth
  Discord/Yandex/Google, session rotation), catalog, moderation, commerce,
  payment orchestration + provider adapters (YooKassa), double-entry ledger,
  refunds, reconciliation, DRM v2 server side, artifact signing/encryption,
  upload sandbox, observability.
- `apps/web` — Next.js 15 + React 19 thin frontend (13 pages).
- `src/prisma/contract.prisma` — the only database schema source (43 models).
- Docker/nginx topology, backup script, CI.

**Must never own:**

- The MTA module runtime (no C++, no MTA ABI code).
- Client private keys. The installation private key is generated client-side
  and never transmitted (`INV-010`); the server stores only public keys.
- A second DRM protocol dialect. `lib/drm/protocol.ts` is the frozen contract;
  the spec document mirrors it, it does not fork it.

**Release independence:** the site deploys independently (docker images from
CI) as long as it keeps serving the frozen `/drm/v2` contract and the module
it serves remains within the compatibility matrix
([compatibility-matrix.md](old_compatibility-matrix.md)). Old modules are handled
by keeping the previous server signing key trusted during rotation
(G-007) and by the deprecation policy of `/drm/v1` (410 Gone, A-007).

## mta-market-module (native module)

**Owns:**

- `source/sdk/**` — MTA ABI SDK (Lua bindings, events, runtime).
- `source/drm/**` — DRM client subsystem: JSON canonicalizer (byte-matches the
  server's canonical form), strict base64, Ed25519, AES-256-GCM AEAD, HTTPS
  client (TLS 1.2+, cert validation, bounded retries, 1 MiB response cap),
  encrypted key store (machine-derived key on Linux, DPAPI on Windows),
  license lifecycle client (ensure identity → register with browser-assisted
  bearer token → verify challenge → activate/verify/renew lease → heartbeat →
  lease-gated DEK fetch → payload decryption).
- `tests_drm/` + standalone `source/drm/Makefile` (unit tests, no MTA server).
- `docs/H-001-inventory.md` — verified inventory and platform matrix.

**Must never own:**

- Marketplace business logic (pricing, moderation, payments). It consumes
  `/drm/v2/*` only.
- Any copy of the server's master key or server private keys.
- A second source of truth for the protocol; it implements the frozen
  constants (`DRM_PROTOCOL_VERSION = 2`, lease TTL 7 d, skew 90 s, nonce
  32 bytes hex-64, challenge 32 bytes base64).

**Release independence:** the module releases on its own cadence (CMake
presets, CI build matrix Linux/MinGW/MSVC). A module release is compatible
with a site release iff it appears together in a compatibility-matrix row.

## Compatibility rules

1. DRM Protocol v2 is frozen. Adding/changing endpoints, formats, constants
   ⇒ protocol v3 ⇒ new compatibility row + spec update in this repo first.
2. The artifact manifest `formatVersion` is `1`. A manifest version bump
   requires a spec update and a server that can still verify older manifests
   or an explicit migration note.
3. API compatibility: REST paths (`/auth`, `/resources`, `/payments`,
   `/drm`, `/admin`, …) may gain additive fields; breaking changes to
   machine-consumed endpoints (anything under `/drm`) follow rule 1.
   OpenAPI is the intended canonical API contract (P-007, not yet introduced).
4. Server key rotation must keep one PREVIOUS signing key trusted so that
   already-issued leases verify across a site release boundary.
5. Version ranges between site and module are recorded in
   [compatibility-matrix.md](old_compatibility-matrix.md); a row is added only
   after verification, never in advance.

## Cross-repo change protocol

| Change | Must update | Verified by |
|---|---|---|
| Any `lib/drm/protocol.ts` constant | `drm-protocol-v2.md` (this folder), compatibility matrix, module `source/drm/` | protocol compatibility test + suites on both sides |
| Contract schema change | schema stays in site (no doc copy) | `db.orm` contract check, server test suite |
| New payment provider | provider adapter + state-machine tests in site | webhook/state-machine tests of the new provider |
| Security-relevant change | implementation + test in site; compatibility row if protocol-affecting | the linked test |
