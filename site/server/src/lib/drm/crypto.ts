/**
 * TASK-020 / PLAN A-006: DRM Protocol v2 - Cryptography
 *
 * Ed25519 operations for the DRM v2 protocol, implemented directly over
 * well-defined byte payloads:
 * - challenge/response: the signature covers the raw challenge bytes;
 * - lease: the signature covers the canonical JSON of the lease payload
 *   (keys sorted, no whitespace, signature field excluded).
 *
 * The previous implementation routed challenge/lease signing through the
 * artifact-manifest machinery (signArtifact with a "mock manifest"), which
 * was structurally broken: verifyArtifactSignature requires
 * manifest.sha256 === hashManifest(manifest), a self-referential condition
 * the mock could never satisfy. Caught by the (previously never-run)
 * drm-crypto test suite.
 */

import { randomBytes, createHash, sign, verify } from 'crypto';
import { canonicalJSON, generatePublisherKeypair } from '../artifact/crypto';
import { isLeaseExpiredWithSkew, isLeaseIssuanceTimeValid } from './protocol';
import type {
  InstallationKeypair,
  SignedLease,
  LeasePayload,
  LeaseVerificationResult
} from './types';

/** Decode a base64 DER private key (PKCS8) into a node crypto key input. */
function privateKeyInput(base64: string) {
  return {
    key: Buffer.from(base64, 'base64'),
    format: 'der' as const,
    type: 'pkcs8' as const
  };
}

/** Decode a base64 DER public key (SPKI) into a node crypto key input. */
function publicKeyInput(base64: string) {
  return {
    key: Buffer.from(base64, 'base64'),
    format: 'der' as const,
    type: 'spki' as const
  };
}

/**
 * Generate Ed25519 keypair for installation (client-side)
 *
 * Same as publisher keypair, but used for installation identity.
 */
export function generateInstallationKeypair(): InstallationKeypair {
  // Reuse the artifact keypair generator (same Ed25519 DER encoding).
  return generatePublisherKeypair();
}

/**
 * Generate random challenge for installation verification
 *
 * @returns Base64 encoded random challenge (32 bytes)
 */
export function generateChallenge(): string {
  return randomBytes(32).toString('base64');
}

/**
 * Sign challenge with installation private key (client-side in the module).
 * The signature covers the raw challenge bytes.
 */
export function signChallenge(challenge: string, privateKey: string): string {
  const challengeBuffer = Buffer.from(challenge, 'base64');
  const signature = sign(null, challengeBuffer, privateKeyInput(privateKey));
  return signature.toString('base64');
}

/**
 * Verify challenge response signature against the installation public key.
 */
export function verifyChallengeResponse(
  challenge: string,
  challengeResponse: string,
  publicKey: string
): boolean {
  try {
    const challengeBuffer = Buffer.from(challenge, 'base64');
    return verify(
      null,
      challengeBuffer,
      publicKeyInput(publicKey),
      Buffer.from(challengeResponse, 'base64')
    );
  } catch {
    return false;
  }
}

/**
 * Canonical signing bytes for a lease: canonical JSON of the payload
 * (signature field excluded by canonicalJSON, keys sorted, no whitespace).
 */
function leaseSigningBytes(lease: Omit<SignedLease, 'signature'> | LeasePayload): Buffer {
  const canonical = canonicalJSON(lease);
  return Buffer.from(canonical, 'utf-8');
}

/**
 * Sign DRM lease with server's private key.
 */
export function signLease(lease: LeasePayload, privateKey: string): string {
  const signature = sign(null, leaseSigningBytes(lease), privateKeyInput(privateKey));
  return signature.toString('base64');
}

/**
 * Verify lease signature with server's public key, then check expiry and
 * protocol version.
 */
export function verifyLeaseSignature(
  lease: SignedLease,
  serverPublicKey: string
): LeaseVerificationResult {
  try {
    const { signature, ...payload } = lease;

    // 1. Signature over the canonical payload
    const ok = verify(
      null,
      leaseSigningBytes(payload),
      publicKeyInput(serverPublicKey),
      Buffer.from(signature, 'base64')
    );

    if (!ok) {
      return {
        valid: false,
        errors: ['Invalid lease signature'],
        warnings: []
      };
    }

    // 2. Timestamps (G-001): expiry with tolerated clock skew; issuedAt
    // must not be in the future beyond the skew.
    if (isLeaseExpiredWithSkew(lease.expiresAt)) {
      return {
        valid: false,
        errors: ['Lease expired'],
        warnings: []
      };
    }
    if (!isLeaseIssuanceTimeValid(lease.issuedAt)) {
      return {
        valid: false,
        errors: ['Lease issuedAt is in the future beyond tolerated clock skew'],
        warnings: []
      };
    }

    // 3. Protocol version
    if (lease.protocolVersion !== 2) {
      return {
        valid: false,
        errors: [`Unsupported protocol version: ${lease.protocolVersion}`],
        warnings: []
      };
    }

    return {
      valid: true,
      errors: [],
      warnings: [],
      lease: {
        protocolVersion: lease.protocolVersion,
        licenseId: lease.licenseId,
        expiresAt: lease.expiresAt,
        capabilities: lease.capabilities
      }
    };
  } catch (error) {
    return {
      valid: false,
      errors: [`Verification failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      warnings: []
    };
  }
}

/**
 * Generate random nonce for replay protection
 *
 * @returns Random hex string (32 bytes)
 */
export function generateNonce(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Validate nonce format
 *
 * @param nonce - Nonce to validate
 * @returns True if valid format
 */
export function isValidNonce(nonce: string): boolean {
  // Nonce should be 64 hex characters (32 bytes)
  return /^[a-f0-9]{64}$/i.test(nonce);
}

/**
 * Hash lease for storage/comparison
 *
 * @param lease - Lease object
 * @returns SHA-256 hash
 */
export function hashLease(lease: SignedLease): string {
  const canonical = canonicalJSON(lease);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Calculate lease expiry time
 *
 * @param durationSeconds - Duration in seconds
 * @returns ISO 8601 timestamp
 */
export function calculateLeaseExpiry(durationSeconds: number): string {
  const expiryDate = new Date(Date.now() + durationSeconds * 1000);
  return expiryDate.toISOString();
}

/**
 * Check if lease is expired
 *
 * @param expiresAt - ISO 8601 timestamp
 * @returns True if expired
 */
export function isLeaseExpired(expiresAt: string): boolean {
  return Date.now() > new Date(expiresAt).getTime();
}

/**
 * Get remaining lease time in seconds
 *
 * @param expiresAt - ISO 8601 timestamp
 * @returns Seconds remaining (0 if expired)
 */
export function getRemainingLeaseTime(expiresAt: string): number {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.floor(remaining / 1000));
}