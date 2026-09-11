/**
 * TASK-020 / PLAN A-006: DRM Protocol v2 Service
 *
 * High-level service for DRM v2 protocol operations, rewritten against the
 * contract ORM (db.orm.public.*) — the previous version targeted a classic
 * Prisma Client API that does not exist in this project.
 *
 * Ownership model (PLAN INV-007):
 * - installation registration requires an authenticated user AND a license
 *   the user owns (license -> purchase.buyerId);
 * - the installation is permanently bound to that license at registration;
 * - lease activation can only happen for the bound license of a verified
 *   installation (challenge/response proves possession of the private key).
 */

import { db } from '../../prisma/db';
import type {
  InstallationRegistration,
  InstallationResponse,
  ChallengeVerification,
  VerificationResult,
  LeaseRequest,
  SignedLease,
  ServerKeyPair,
  HeartbeatRequest,
  HeartbeatResponse,
  Capability
} from './types';
import {
  generateChallenge,
  verifyChallengeResponse,
  signLease,
  calculateLeaseExpiry
} from './crypto';
import { DRM_ERROR_CODES } from './types';
import { LEASE_DURATION_SECONDS, DEK_ALGORITHM } from './protocol';

// Default lease duration (G-001 protocol constant)
const DEFAULT_LEASE_DURATION_SECONDS = LEASE_DURATION_SECONDS;

/**
 * Generate server signing keypair.
 *
 * Should be called once during initial setup (CLI: pnpm drm:keygen).
 * Private key MUST be stored securely (ENV/KMS/Vault) — it is returned
 * exactly once and never persisted by this service.
 */
export async function createServerSigningKey(): Promise<ServerKeyPair> {
  const { generatePublisherKeypair } = await import('../artifact/crypto');

  // Check if active key already exists
  const existingKey = await db.orm.public.ServerSigningKey.where({
    status: 'ACTIVE'
  }).first();

  if (existingKey) {
    throw new Error('Active server signing key already exists');
  }

  // Generate keypair
  const { publicKey, privateKey } = generatePublisherKeypair();

  // Store public key in database
  const key = await db.orm.public.ServerSigningKey.create({
    keyType: 'ED25519',
    publicKey,
    algorithm: 'EdDSA',
    status: 'ACTIVE'
  });

  return {
    keyId: key.id,
    publicKey,
    privateKey // Caller must store securely
  };
}

/**
 * Register new installation for a license the authenticated user owns.
 *
 * Client generates keypair and sends public key. Server verifies license
 * ownership, binds the installation to the license and issues a challenge
 * for possession-of-private-key verification.
 */
export async function registerInstallation(
  input: InstallationRegistration,
  ownerId: string
): Promise<InstallationResponse> {
  const { publicKey, licenseId, mtaVersion, moduleVersion, serverSerial, serverName } = input;

  // License must exist and be active
  const license = await db.orm.public.License.where({ id: licenseId }).first();

  if (!license) {
    throw new Error(DRM_ERROR_CODES.INVALID_LICENSE);
  }

  if (license.status !== 'ACTIVE') {
    throw new Error(`License is ${license.status.toLowerCase()}`);
  }

  // INV-007: the authenticated user must own the license
  // (license -> purchase -> buyerId)
  const purchase = await db.orm.public.Purchase.where({ id: license.purchaseId }).first();

  if (!purchase) {
    throw new Error(DRM_ERROR_CODES.INVALID_LICENSE);
  }

  if (purchase.buyerId !== ownerId) {
    throw new Error(DRM_ERROR_CODES.LICENSE_NOT_OWNED);
  }

  // Public key must not already be registered
  const existing = await db.orm.public.Installation.where({ publicKey }).first();

  if (existing) {
    throw new Error('Installation with this public key already exists');
  }

  // Generate challenge
  const challenge = generateChallenge();

  // Create installation record (pending verification), bound to the license
  const installation = await db.orm.public.Installation.create({
    licenseId,
    publicKey,
    challenge,
    serverSerial: serverSerial || null,
    serverName: serverName || null,
    mtaVersion,
    moduleVersion,
    status: 'PENDING_VERIFICATION'
  });

  return {
    installationId: installation.id,
    challenge
  };
}

/**
 * Verify installation challenge response.
 *
 * Client signs the challenge with its private key. Server verifies the
 * signature with the registered public key. This proves possession of the
 * installation private key without it ever leaving the installation.
 */
export async function verifyInstallation(
  input: ChallengeVerification
): Promise<VerificationResult> {
  const { installationId, challengeResponse } = input;

  const installation = await db.orm.public.Installation.where({ id: installationId }).first();

  if (!installation) {
    throw new Error(DRM_ERROR_CODES.INSTALLATION_NOT_FOUND);
  }

  if (installation.status === 'REVOKED') {
    throw new Error(DRM_ERROR_CODES.INSTALLATION_REVOKED);
  }

  if (installation.status !== 'PENDING_VERIFICATION') {
    throw new Error('Installation already verified');
  }

  if (!installation.challenge) {
    throw new Error('No challenge found for installation');
  }

  // Verify signature
  const isValid = verifyChallengeResponse(
    installation.challenge,
    challengeResponse,
    installation.publicKey
  );

  if (!isValid) {
    throw new Error(DRM_ERROR_CODES.INVALID_CHALLENGE_RESPONSE);
  }

  // Mark as verified
  await db.orm.public.Installation.where({ id: installationId }).update({
    status: 'ACTIVE',
    verifiedAt: new Date().toISOString(),
    challenge: null // Clear challenge after verification
  });

  return {
    verified: true,
    installationId
  };
}

/**
 * Activate license and generate signed lease.
 *
 * The installation must be verified (challenge passed) and the requested
 * license must be the one the installation is bound to. Ownership was
 * proven at registration time; possession of the installation key was
 * proven at verification time.
 */
export async function activateLicense(
  input: LeaseRequest,
  privateKey: string
): Promise<SignedLease> {
  const { licenseId, installationId, nonce } = input;

  // Validate nonce format
  if (!/^[a-f0-9]{64}$/i.test(nonce)) {
    throw new Error('Invalid nonce format');
  }

  // Check if nonce already used (replay protection)
  const existingLease = await db.orm.public.Lease.where({ nonce }).first();

  if (existingLease) {
    throw new Error(DRM_ERROR_CODES.NONCE_ALREADY_USED);
  }

  // Get installation
  const installation = await db.orm.public.Installation.where({ id: installationId }).first();

  if (!installation) {
    throw new Error(DRM_ERROR_CODES.INSTALLATION_NOT_FOUND);
  }

  if (installation.status === 'REVOKED') {
    throw new Error(DRM_ERROR_CODES.INSTALLATION_REVOKED);
  }

  if (installation.status !== 'ACTIVE') {
    throw new Error(DRM_ERROR_CODES.INSTALLATION_NOT_VERIFIED);
  }

  // INV-007/INV-011: a lease can only be issued for the license the
  // installation is bound to — never for an arbitrary license id.
  if (installation.licenseId !== licenseId) {
    throw new Error(DRM_ERROR_CODES.LICENSE_INSTALLATION_MISMATCH);
  }

  // Get license
  const license = await db.orm.public.License.where({ id: licenseId }).first();

  if (!license) {
    throw new Error(DRM_ERROR_CODES.INVALID_LICENSE);
  }

  if (license.status !== 'ACTIVE') {
    throw new Error(`License is ${license.status.toLowerCase()}`);
  }

  // Resolve the purchase for resource binding
  const purchase = await db.orm.public.Purchase.where({ id: license.purchaseId }).first();

  if (!purchase) {
    throw new Error(DRM_ERROR_CODES.INVALID_LICENSE);
  }

  // PLAN I-005: a YANKED version blocks NEW lease issuance; existing leases
  // keep their natural expiry (ADR-001 policy).
  const licensedVersion = await db.orm.public.ResourceVersion
    .where({ id: license.versionId })
    .first();
  if (licensedVersion && licensedVersion.releaseStatus === 'YANKED') {
    throw new Error(DRM_ERROR_CODES.INSUFFICIENT_CAPABILITIES);
  }

  // Get artifact signature for the licensed version
  const signature = await db.orm.public.ArtifactSignature.where({
    versionId: license.versionId
  }).first();

  if (!signature) {
    throw new Error('Resource version not signed');
  }

  // Get active server signing key
  const serverKey = await db.orm.public.ServerSigningKey.where({ status: 'ACTIVE' }).first();

  if (!serverKey) {
    throw new Error('No active server signing key');
  }

  // Create lease payload (serverKeyId is bound into the signature)
  const issuedAt = new Date().toISOString();
  const expiresAt = calculateLeaseExpiry(DEFAULT_LEASE_DURATION_SECONDS);

  const leasePayload = {
    protocolVersion: 2 as const,
    licenseId,
    installationId,
    resourceId: purchase.resourceId,
    resourceVersionId: license.versionId,
    artifactHash: signature.artifactHash,
    issuedAt,
    expiresAt,
    nonce,
    serverKeyId: serverKey.id,
    capabilities: ['run', 'update'] as Capability[]
  };

  // Sign lease
  const leaseSignature = signLease(leasePayload, privateKey);

  // Store lease in database
  await db.orm.public.Lease.create({
    installationId,
    licenseId,
    resourceId: leasePayload.resourceId,
    resourceVersionId: leasePayload.resourceVersionId,
    artifactHash: leasePayload.artifactHash,
    nonce,
    protocolVersion: 2,
    serverKeyId: serverKey.id,
    signature: leaseSignature,
    capabilities: leasePayload.capabilities,
    issuedAt,
    expiresAt
  });

  // Return signed lease
  return {
    ...leasePayload,
    signature: leaseSignature
  };
}

/**
 * Record heartbeat from installation.
 *
 * Updates last seen timestamp and reports lease validity. Revoked
 * installations are rejected outright.
 */
export async function recordHeartbeat(
  input: HeartbeatRequest
): Promise<HeartbeatResponse> {
  const { installationId, resourceId } = input;

  const installation = await db.orm.public.Installation.where({ id: installationId }).first();

  if (!installation) {
    throw new Error(DRM_ERROR_CODES.INSTALLATION_NOT_FOUND);
  }

  if (installation.status === 'REVOKED') {
    throw new Error(DRM_ERROR_CODES.INSTALLATION_REVOKED);
  }

  // Update installation heartbeat
  await db.orm.public.Installation.where({ id: installationId }).update({
    lastHeartbeat: new Date().toISOString()
  });

  // Latest lease for this installation + resource
  const leases = await db.orm.public.Lease
    .where({ installationId, resourceId })
    .orderBy((m) => m.issuedAt.desc())
    .limit(1)
    .all();
  const lease = leases[0];

  const leaseValid = lease ? new Date(lease.expiresAt) > new Date() : false;

  // PLAN R-002: safe update flow — the server only ADVISES an update. When a
  // newer PUBLISHED version exists (not YANKED/DEPRECATED), tell the module
  // via shouldUpdate + updateVersionId; the module decides whether and when
  // to update (compatibility + signature checks happen on its side).
  let shouldUpdate = false;
  let updateVersionId: string | undefined;
  if (lease) {
    const versions = await db.orm.public.ResourceVersion
      .where({ resourceId })
      .orderBy((m) => m.publishedAt.desc())
      .all();
    const newest = versions.find((v) => v.releaseStatus === 'PUBLISHED');
    if (newest && newest.id !== lease.resourceVersionId) {
      shouldUpdate = true;
      updateVersionId = newest.id;
    }
  }

  return {
    acknowledged: true,
    leaseValid,
    shouldUpdate,
    updateVersionId
  };
}

/**
 * Revoke installation.
 *
 * Prevents future lease generation for this installation. Already issued
 * leases keep their natural expiry (documented policy, see ADR-001).
 */
export async function revokeInstallation(
  installationId: string,
  revokedBy: string,
  reason: string
): Promise<void> {
  await db.orm.public.Installation.where({ id: installationId }).update({
    status: 'REVOKED',
    revokedAt: new Date().toISOString(),
    revokedBy,
    revocationReason: reason
  });
}

/**
 * Get active server public key.
 *
 * Used by clients to verify lease signatures.
 */
export async function getServerPublicKey(): Promise<string> {
  const key = await db.orm.public.ServerSigningKey.where({ status: 'ACTIVE' }).first();

  if (!key) {
    throw new Error('No active server signing key');
  }

  return key.publicKey;
}

/**
 * Get active (unexpired) lease for installation and resource.
 */
export async function getActiveLease(
  installationId: string,
  resourceId: string
): Promise<SignedLease | null> {
  const leases = await db.orm.public.Lease
    .where({ installationId, resourceId })
    .orderBy((m) => m.issuedAt.desc())
    .limit(1)
    .all();
  const lease = leases[0];

  if (!lease || new Date(lease.expiresAt) <= new Date()) {
    return null;
  }

  return {
    protocolVersion: 2,
    licenseId: lease.licenseId,
    installationId: lease.installationId,
    resourceId: lease.resourceId,
    resourceVersionId: lease.resourceVersionId,
    artifactHash: lease.artifactHash,
    issuedAt: lease.issuedAt,
    expiresAt: lease.expiresAt,
    nonce: lease.nonce,
    serverKeyId: lease.serverKeyId,
    capabilities: lease.capabilities as Capability[],
    signature: lease.signature
  };
}
/**
 * PLAN G-007: rotate the server signing key.
 * The current ACTIVE key becomes PREVIOUS (still trusted for verification of
 * existing leases); a new keypair is created and becomes ACTIVE. The new
 * private key is returned exactly once and must be installed into the
 * DRM_SERVER_PRIVATE_KEY environment by the operator — leases are signed
 * with the private key matching the ACTIVE key id.
 */
export async function rotateServerSigningKey(): Promise<ServerKeyPair> {
  const { generatePublisherKeypair } = await import('../artifact/crypto');

  const current = await db.orm.public.ServerSigningKey.where({ status: 'ACTIVE' }).first();
  if (current) {
    await db.orm.public.ServerSigningKey.where({ id: current.id }).update({
      status: 'PREVIOUS'
    });
  }

  const { publicKey, privateKey } = generatePublisherKeypair();
  const key = await db.orm.public.ServerSigningKey.create({
    keyType: 'ED25519',
    publicKey,
    algorithm: 'EdDSA',
    status: 'ACTIVE'
  });

  return { keyId: key.id, publicKey, privateKey };
}

/**
 * PLAN G-007: keys a module must trust during rotation — the ACTIVE key plus
 * the PREVIOUS key (existing leases stay verifiable). REVOKED/EXPIRED keys
 * are never returned.
 */
export async function getTrustedServerKeys(): Promise<
  Array<{ keyId: string; publicKey: string; status: 'ACTIVE' | 'PREVIOUS' }>
> {
  const rows = await db.orm.public.ServerSigningKey
    .where({ status: 'ACTIVE' })
    .all();
  const previous = await db.orm.public.ServerSigningKey
    .where({ status: 'PREVIOUS' })
    .all();
  return [
    ...rows.map((k) => ({ keyId: k.id, publicKey: k.publicKey, status: 'ACTIVE' as const })),
    ...previous.map((k) => ({ keyId: k.id, publicKey: k.publicKey, status: 'PREVIOUS' as const }))
  ];
}

export interface VersionDekRequest {
  versionId: string;
  installationId: string;
  nonce: string;
  /** Ed25519 signature (base64) over the ASCII bytes `dek:${versionId}:${nonce}` */
  signature: string;
}

/**
 * PLAN G-005: release the unwrapped DEK of a resource version to an
 * installation that (a) is verified and not revoked, (b) proves possession
 * of its private key by signing a fresh nonce, and (c) holds an unexpired
 * lease for that version's resource. The server master key is never exposed.
 */
export async function issueVersionDek(input: VersionDekRequest): Promise<{
  dekId: string;
  dek: string;
  algorithm: string;
}> {
  const { versionId, installationId, nonce, signature } = input;

  if (!/^[a-f0-9]{64}$/i.test(nonce)) {
    throw new Error('Invalid nonce format');
  }

  const installation = await db.orm.public.Installation.where({ id: installationId }).first();
  if (!installation) {
    throw new Error(DRM_ERROR_CODES.INSTALLATION_NOT_FOUND);
  }
  if (installation.status === 'REVOKED') {
    throw new Error(DRM_ERROR_CODES.INSTALLATION_REVOKED);
  }
  if (installation.status !== 'ACTIVE') {
    throw new Error(DRM_ERROR_CODES.INSTALLATION_NOT_VERIFIED);
  }

  // Possession of the installation private key.
  const { verifyChallengeResponse } = await import('./crypto');
  const possessionProof = Buffer.from(`dek:${versionId}:${nonce}`, 'ascii').toString('base64');
  if (!verifyChallengeResponse(possessionProof, signature, installation.publicKey)) {
    throw new Error(DRM_ERROR_CODES.INVALID_SIGNATURE);
  }

  // A valid, unexpired lease for this installation must cover the version's
  // resource (G-004: a lease for resource A must not unlock resource B).
  const version = await db.orm.public.ResourceVersion.where({ id: versionId }).first();
  if (!version) {
    throw new Error(DRM_ERROR_CODES.ARTIFACT_HASH_MISMATCH);
  }
  const lease = await getActiveLease(installationId, version.resourceId);
  if (!lease || lease.resourceVersionId !== versionId) {
    throw new Error(DRM_ERROR_CODES.INSUFFICIENT_CAPABILITIES);
  }

  const encryption = await db.orm.public.ArtifactEncryption
    .where({ versionId })
    .first();
  if (!encryption) {
    throw new Error('Resource version is not encrypted');
  }

  const { unwrapDek } = await import('../artifact/encryption');
  const dek = unwrapDek({
    wrappedDek: encryption.wrappedDek,
    wrapNonce: encryption.wrapNonce,
    wrapTag: encryption.wrapTag,
  });

  return {
    dekId: encryption.dekId,
    dek: dek.toString('base64'),
    algorithm: encryption.algorithm
  };
}

/**
 * PLAN G-005: create the per-version DEK envelope for a resource version.
 * Server-only operation (publication pipeline / CLI).
 */
export async function createVersionDek(versionId: string): Promise<{
  dekId: string;
  wrappedDek: string;
  wrapNonce: string;
  wrapTag: string;
  algorithm: string;
  /** raw DEK (base64) — returned once for encrypting the artifact payload */
  dek: string;
}> {
  const existing = await db.orm.public.ArtifactEncryption.where({ versionId }).first();
  if (existing) {
    throw new Error('Version already has a DEK');
  }
  const { generateVersionDek, wrapDek } = await import('../artifact/encryption');
  const { dekId, dek } = generateVersionDek();
  const wrapped = wrapDek(dek);
  await db.orm.public.ArtifactEncryption.create({
    versionId,
    dekId,
    algorithm: DEK_ALGORITHM,
    wrappedDek: wrapped.wrappedDek,
    wrapNonce: wrapped.wrapNonce,
    wrapTag: wrapped.wrapTag
  });
  return {
    dekId,
    wrappedDek: wrapped.wrappedDek,
    wrapNonce: wrapped.wrapNonce,
    wrapTag: wrapped.wrapTag,
    algorithm: DEK_ALGORITHM,
    dek: dek.toString('base64')
  };
}
