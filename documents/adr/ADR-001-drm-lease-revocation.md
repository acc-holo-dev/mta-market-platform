# ADR-001: DRM lease revocation policy

Status: current
Version: 1.0
Last verified: 2026-09-09 (tests/drm-g6.test.ts, G-008/G-009 suite)

## Context

PLAN G-008 requires an explicit, tested answer for what happens to an
already-issued lease when its installation is revoked. Two options exist:

1. immediate — revocation cuts off the lease right away;
2. expire-at-lease-end — the lease remains cryptographically valid until its
   natural `expiresAt`; only future leases are blocked.

## Decision

**Expire-at-lease-end** for the data plane, **immediate cutoff** for the
management plane:

- Future lease issuance for a revoked installation is denied
  (`DRM_INSTALLATION_REVOKED`, HTTP 403).
- Challenge verification and heartbeats from a revoked installation are also
  denied — the management plane is cut off immediately.
- A lease signed before revocation remains verifiable until its natural
  `expiresAt` (with the protocol's tolerated clock skew, see
  `lib/drm/protocol.ts`). It was issued against a then-valid entitlement and
  is signed by a server key; unless the key itself is revoked, existing
  leases are allowed to run out rather than being retroactively invalidated.
  This avoids breaking running MTA servers mid-session on an administrative
  action and matches how the lease TTL (7 days) bounds any abuse window.

If a shorter cutoff is ever required for a specific revocation (compromised
key, abuse), the operator revokes the installation AND the server signing
key chain / requests key rotation — a revoked server key invalidates leases
verifiable only by it (`DRM_SERVER_KEY_REVOKED`).

## Consequences

- Revocation is enforced at the next renewal attempt, not instantly.
- The maximum residual access window equals the remaining lease TTL.
- Tests: `tests/drm-g6.test.ts` ("G-008/G-009") documents the exact
  observable behavior: activation 403, heartbeat 403, and the signed lease
  itself remaining verifiable until expiry.
