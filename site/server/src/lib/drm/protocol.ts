/**
 * PLAN G-001: DRM Protocol v2 — frozen protocol contract.
 *
 * This module is the single source of truth for the protocol constants.
 * The module (mta-market-module) implements against these exact values;
 * changing any of them requires a protocol version bump (v3) — never an
 * in-place edit. The human-readable spec (P-008) references this file.
 *
 * Canonical signature input: the lease payload minus the `signature` field,
 * serialized as canonical JSON (keys sorted recursively, no whitespace,
 * UTF-8 bytes) — see lib/artifact/crypto.ts canonicalJSON() and
 * lib/drm/crypto.ts leaseSigningBytes().
 */

export const DRM_PROTOCOL_VERSION = 2;
export const DRM_SUPPORTED_PROTOCOL_VERSIONS = [2] as readonly number[];

/** G-004: lease lifetime (renewable via a fresh nonce at /drm/v2/activate). */
export const LEASE_DURATION_SECONDS = 7 * 24 * 60 * 60;

/** Clock skew tolerated when validating lease timestamps (G-001). */
export const CLOCK_SKEW_SECONDS = 90;

/** G-003: challenge — 32 random bytes, base64-encoded, single use. */
export const CHALLENGE_BYTES = 32;

/** G-004: nonce — 32 random bytes, hex-encoded (64 chars), single use. */
export const NONCE_BYTES = 32;
export const NONCE_HEX_LENGTH = NONCE_BYTES * 2;

/** G-005: artifact encryption envelope. */
// lowercase per the crypto primitive registry (node CipherGCMTypes)
export const DEK_ALGORITHM = "aes-256-gcm";
export const DEK_KEY_BYTES = 32;
export const DEK_WRAP_NONCE_BYTES = 12;
/** Server master key env var (base64, 32 bytes). Never exposed to clients. */
export const DRM_MASTER_KEY_ENV = "DRM_MASTER_KEY";

/** Protocol endpoints (machine API, mounted at /drm). */
export const DRM_ENDPOINTS = {
  SERVER_PUBLIC_KEYS: "/drm/v2/public-keys",
  INSTALLATIONS: "/drm/v2/installations",
  INSTALLATION_VERIFY: (installationId: string) => `/drm/v2/installations/${installationId}/verify`,
  ACTIVATE: "/drm/v2/activate",
  HEARTBEAT: "/drm/v2/heartbeat",
  LEASE: (installationId: string, resourceId: string) =>
    `/drm/v2/leases/${installationId}/${resourceId}`,
  VERSION_DEK: (versionId: string) => `/drm/v2/versions/${versionId}/dek`,
} as const;

/** G-001: request/response wire schemas are the TypeScript types in
 * ./types.ts (InstallationRegistration, InstallationResponse,
 * ChallengeVerification, SignedLease, HeartbeatRequest/Response) — the
 * compiler-checked contract. Error codes are DRM_ERROR_CODES. */

/**
 * G-001: expiry validation with clock skew. A lease is expired only after
 * its expiry time plus the tolerated skew; a lease issued in the future
 * beyond the skew is rejected as invalid.
 */
export function isLeaseExpiredWithSkew(expiresAt: string, now = Date.now()): boolean {
  return now > new Date(expiresAt).getTime() + CLOCK_SKEW_SECONDS * 1000;
}

export function isLeaseIssuanceTimeValid(issuedAt: string, now = Date.now()): boolean {
  return now >= new Date(issuedAt).getTime() - CLOCK_SKEW_SECONDS * 1000;
}
