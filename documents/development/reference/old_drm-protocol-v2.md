status: current
version: 1.0
last_verified: 2026-09-09


> **Пути (PLAN-011):** этот документ описывает прежнюю трёхрепозиторную
> структуру (frozen). Соответствие старых путей путям монорепо —
> [../../history/MIGRATION.md](../../history/MIGRATION.md); замороженные
> значения не менялись.

# DRM Protocol v2 — frozen protocol contract

**Source of truth:** `mta-market-site/apps/server/src/lib/drm/protocol.ts`
(constants) and `apps/server/src/lib/drm/types.ts` (wire types). This document
is the human-readable mirror (P-008). If it disagrees with those files, the
files win and this document must be corrected. Changing any constant here or
there requires a protocol version bump (v3) — never an in-place edit.

Client implementation: `mta-market-module/source/drm/**` (inventory:
`mta-market-module/docs/H-001-inventory.md`).

## Frozen constants

| Constant | Value | Name in `protocol.ts` |
|---|---|---|
| Protocol version | `2` (supported: `[2]`) | `DRM_PROTOCOL_VERSION`, `DRM_SUPPORTED_PROTOCOL_VERSIONS` |
| Lease TTL | `604800` s (7 days, renewable via fresh nonce at `/drm/v2/activate`) | `LEASE_DURATION_SECONDS` |
| Clock skew tolerance | `90` s (expiry and issuance validation) | `CLOCK_SKEW_SECONDS` |
| Challenge | 32 random bytes, base64, single use | `CHALLENGE_BYTES` |
| Nonce | 32 random bytes, hex-encoded (64 chars), single use | `NONCE_BYTES`, `NONCE_HEX_LENGTH` |
| DEK algorithm | `aes-256-gcm` | `DEK_ALGORITHM` |
| DEK size | 32 bytes | `DEK_KEY_BYTES` |
| DEK wrap nonce | 12 bytes (GCM) | `DEK_WRAP_NONCE_BYTES` |
| Server master key env | `DRM_MASTER_KEY` (base64, 32 bytes; never exposed to clients) | `DRM_MASTER_KEY_ENV` |

## Canonical JSON (signature input)

The signature input for leases and the canonical serializer in the module are
defined by `canonicalJSON()` in `apps/server/src/lib/artifact/crypto.ts` and
byte-matched by `source/drm/json.cpp` in the module:

- keys sorted recursively;
- no whitespace;
- UTF-8 bytes;
- the `signature` field is stripped from the payload being signed;
- number tokens preserved verbatim (no re-formatting).

Lease signing bytes: canonical JSON of the lease payload (see
`leaseSigningBytes()` in `apps/server/src/lib/drm/crypto.ts`).
DEK possession proof: Ed25519 signature over the base64 encoding of the ASCII
bytes `dek:<versionId>:<nonce>`.

## Keys

| Key | Where generated | Where stored |
|---|---|---|
| Installation Ed25519 keypair | client (module) | private key only in the module key store (`source/drm/key_store.cpp`: AES-256-GCM encrypted file, 0600, machine-derived key on Linux / DPAPI on Windows); public key registered server-side. INV-010: the private key never leaves the installation. |
| Server signing key (Ed25519) | server CLI (`pnpm drm:keygen` / `createServerSigningKey()`) | public key in DB (`ServerSigningKey`, status ACTIVE/PREVIOUS); private key in `DRM_SERVER_PRIVATE_KEY` env, returned exactly once |
| Server master key (AES-256-GCM) | operator | `DRM_MASTER_KEY` env; wraps per-version DEKs (`ArtifactEncryption`) |

A lease carries `serverKeyId`; clients verify the signature against the
trusted key set (`GET /drm/v2/public-keys` — ACTIVE + PREVIOUS). A lease
signed by a REVOKED/EXPIRED server key is rejected
(`DRM_SERVER_KEY_REVOKED`).

Rotation (`rotateServerSigningKey()`): ACTIVE → PREVIOUS (still trusted for
existing leases), new keypair becomes ACTIVE, new private key installed into
`DRM_SERVER_PRIVATE_KEY` by the operator. Tested in
`mta-market-site/tests/drm-g6.test.ts`.

## Endpoints (machine API, mounted at `/drm`)

From `DRM_ENDPOINTS` in `protocol.ts`, implemented in
`apps/server/src/routes/drm/v2.ts`:

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/drm/v2/public-keys` | GET | public | trusted server keys (`{keys: [{keyId, publicKey, status}], algorithm: "EdDSA", keyType: "ED25519"}`) |
| `/drm/v2/installations` | POST | browser-authenticated license owner (INV-007), strict rate limit | register installation: `{publicKey, licenseId, mtaVersion, moduleVersion, serverSerial?, serverName?}` → `{installationId, challenge}` |
| `/drm/v2/installations/:id/verify` | POST | machine, strict rate limit | prove possession: `{installationId, challengeResponse}` (Ed25519 signature over raw challenge bytes) |
| `/drm/v2/activate` | POST | machine (verified installation), strict rate limit | `{licenseId, installationId, nonce}` → signed lease |
| `/drm/v2/heartbeat` | POST | machine (active installation), standard rate limit | `{installationId, resourceId, uptime, lastError?}` → `{acknowledged, leaseValid, shouldUpdate, updateVersionId?}` |
| `/drm/v2/leases/:installationId/:resourceId` | GET | machine | latest unexpired signed lease, or null |
| `/drm/v2/versions/:versionId/dek` | POST | machine (lease holder), strict rate limit | `{installationId, nonce, signature}` → `{dekId, dek, algorithm}` |

Note: `GET /drm/v2/public-key` (singular) also exists in the route file and
returns only the ACTIVE key; the canonical protocol map names
`/drm/v2/public-keys` (plural, rotation-aware). Clients should use the plural
endpoint. This asymmetry is recorded as a known cleanup candidate — the frozen
map in `protocol.ts` is authoritative.

## Wire types (`apps/server/src/lib/drm/types.ts`)

- `InstallationRegistration { publicKey, licenseId, mtaVersion, moduleVersion, serverSerial?, serverName? }`
- `InstallationResponse { installationId, challenge }` — challenge: base64, 32 bytes, single use
- `ChallengeVerification { installationId, challengeResponse }`
- `LeaseRequest { licenseId, installationId, nonce }` — nonce: 64 hex chars
- `SignedLease` / `LeasePayload { protocolVersion: 2, licenseId, installationId, resourceId, resourceVersionId, artifactHash, issuedAt, expiresAt, nonce, serverKeyId, capabilities, signature }`
- `HeartbeatRequest / HeartbeatResponse`
- Capabilities: `'run' | 'update' | 'debug' | 'export'` (server currently issues `['run','update']`)

## Signed lease (canonical JSON of the payload minus `signature`)

```json
{
  "protocolVersion": 2,
  "licenseId": "<uuid>",
  "installationId": "<uuid>",
  "resourceId": "<uuid>",
  "resourceVersionId": "<uuid>",
  "artifactHash": "<64 hex, sha256 of the version artifact>",
  "issuedAt": "<ISO 8601>",
  "expiresAt": "<ISO 8601, issuedAt + 604800 s>",
  "nonce": "<64 hex, single use>",
  "serverKeyId": "<uuid of the ACTIVE ServerSigningKey>",
  "capabilities": ["run", "update"],
  "signature": "<base64 Ed25519 over the canonical payload above>"
}
```

Binding rules (invariants):

- INV-011: the lease binds installation + license + resource/version. The
  installation is permanently bound to its license at registration; activation
  with any other license is rejected (`DRM_LICENSE_INSTALLATION_MISMATCH`).
- The nonce is single-use server-wide (`Lease.nonce` unique; reuse →
  `DRM_NONCE_ALREADY_USED`, HTTP 409) — replay protection.
- `artifactHash` binds the lease to the exact signed artifact.

## Ownership and activation flow

1. Owner authenticates in the browser and registers an installation for a
   license they own (license → purchase → `buyerId` == authenticated user;
   INV-007). License must be ACTIVE.
2. Server issues a single-use challenge.
3. Module signs the raw challenge bytes; server verifies → installation
   becomes ACTIVE (possession of the private key proven).
4. Module activates with a fresh nonce → server checks: installation ACTIVE
   and not revoked, license ACTIVE, license == bound license, no YANKED
   release (`releaseStatus: YANKED` blocks **new** lease issuance, I-005/ADR-001),
   version has an `ArtifactSignature` — then signs and stores the lease.
5. Renewal = activation again with a new nonce before expiry.
6. Heartbeats update `lastHeartbeat` and report lease validity.
7. DEK release: for an encrypted version, the module proves possession
   (Ed25519 over `dek:<versionId>:<nonce>`) and must hold an unexpired lease
   for that exact version; the server unwraps the DEK under `DRM_MASTER_KEY`
   and releases the raw DEK over TLS. The master key never leaves the server.

## DEK envelope (G-005)

- Per resource version: unique 32-byte DEK (`ArtifactEncryption.dekId`).
- Payload encryption: AES-256-GCM, fresh 12-byte nonce, stored as
  `{algorithm, nonce, tag, ciphertext}`; authenticated — any payload
  tampering fails decryption.
- DEK wrapping: AES-256-GCM under `DRM_MASTER_KEY`; stored as
  `{wrappedDek, wrapNonce, wrapTag}`; unwrap server-side only
  (`apps/server/src/lib/artifact/encryption.ts`).

## Revocation policy (ADR-001)

See `mta-market-site/docs/adr/ADR-001-drm-lease-revocation.md`. Summary:

- **Data plane — expire-at-lease-end.** A lease signed before revocation
  stays cryptographically valid until its natural `expiresAt` (+90 s skew).
  Rationale: signed against a then-valid entitlement; avoids killing running
  MTA servers mid-session; residual access window ≤ remaining TTL (≤ 7 days).
- **Management plane — immediate cutoff.** After `INSTALLATION_REVOKED`:
  new activation → 403 `DRM_INSTALLATION_REVOKED`; challenge verification and
  heartbeats → 403.
- **Faster cutoff:** revoke the installation AND rotate/revoke the server
  signing key; leases verifiable only by a revoked server key fail with
  `DRM_SERVER_KEY_REVOKED`.
- YANKED version (I-005): blocks **new** lease issuance; existing leases run
  to natural expiry.

## Error codes (`DRM_ERROR_CODES` in `types.ts`)

| Code | Meaning | HTTP (route mapping) |
|---|---|---|
| `DRM_INVALID_LICENSE` | license missing/invalid | 404 |
| `DRM_LICENSE_NOT_OWNED` | authenticated user does not own the license (INV-007) | 403 |
| `DRM_LICENSE_INSTALLATION_MISMATCH` | activation for a license the installation is not bound to (INV-011) | 403 |
| `DRM_INSTALLATION_NOT_FOUND` | unknown installation | 404 |
| `DRM_INSTALLATION_NOT_VERIFIED` | challenge not verified / not ACTIVE | 403 |
| `DRM_INSTALLATION_REVOKED` | installation revoked | 403 |
| `DRM_INVALID_CHALLENGE_RESPONSE` | wrong key signed the challenge | 401 |
| `DRM_NONCE_ALREADY_USED` | nonce replay | 409 |
| `DRM_NONCE_EXPIRED` | nonce outside validity window | — (reserved) |
| `DRM_LEASE_EXPIRED` | lease past `expiresAt` + skew | — (client verification) |
| `DRM_INVALID_SIGNATURE` | lease/DEK proof signature invalid | 401 |
| `DRM_PROTOCOL_VERSION_MISMATCH` | unsupported protocol version | — (reserved) |
| `DRM_ARTIFACT_HASH_MISMATCH` | version/artifact binding failure | 404 |
| `DRM_INSUFFICIENT_CAPABILITIES` | lease does not cover the requested version (incl. YANKED gate) | 403 |
| `DRM_SERVER_KEY_REVOKED` | signing key revoked/expired | — (client verification) |

Error envelope: `{"error": {"code": "<DRM_...>", "message": "..."}}`.

## Deprecation of v1 (A-007)

`POST /drm/activate` and `POST /drm/verify` return **410 Gone**
(`apps/server/src/routes/drm.ts`). License management endpoints
(`GET /drm/my-licenses`, `DELETE /drm/installations/:id`) remain. There is no
dual-activation window and no compatibility bridge.

## Test evidence

- `mta-market-site/tests/drm-v2.test.ts` — full server-side protocol cycle,
  INV-007/INV-011, nonce reuse rejection, v1 410.
- `mta-market-site/tests/drm-crypto.test.ts` — challenge/lease crypto,
  canonical bytes.
- `mta-market-site/tests/drm-g6.test.ts` — clock skew, key rotation window,
  DEK release with possession proof, revoke cycle (ADR-001 behavior).
- `mta-market-module`: `make -f source/drm/Makefile test` — canonical JSON
  byte-match, Ed25519, AEAD, key store, HTTP client, lease verification
  (ALL TESTS PASSED, Linux x64, 2026-09-09).
