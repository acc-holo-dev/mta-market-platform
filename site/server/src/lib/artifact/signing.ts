/**
 * TASK-019 / PLAN B-002: Artifact Signing Service
 *
 * High-level service for signing and verifying artifacts, rewritten against
 * the contract ORM (db.orm.public.*). This module is the SINGLE signing
 * implementation: the web publication pipeline uses it directly; the CLI
 * (parked in src/attic until the artifact pipeline phase) must import the
 * same functions rather than reimplementing them.
 *
 * Key model (MVP): the PLATFORM signs artifacts on behalf of the publisher
 * with a server-held Ed25519 key (ARTIFACT_SIGNING_PRIVATE_KEY). The manifest
 * records publisherId = sellerId. Per-seller keys (CLI artifact:keygen) can
 * replace this later without changing the verification contract.
 */

import { createPublicKey, createPrivateKey } from "crypto";
import { db } from "../../prisma/db";
import type { ArtifactManifest, SignedArtifact, VerificationResult } from "./types";
import { generatePublisherKeypair, signArtifact, verifyArtifactSignature, hashFile } from "./crypto";
import { generateManifest, attachSignatureMetadata } from "./manifest";

/**
 * Ensure a PublisherKey row exists for the seller, bound to the platform
 * signing key. The private key itself is NEVER stored in the database.
 */
async function ensurePublisherKey(sellerId: string): Promise<{ id: string; publicKey: string }> {
  const privateKey = process.env.ARTIFACT_SIGNING_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("ARTIFACT_SIGNING_PRIVATE_KEY is not configured");
  }

  // Derive the public key (SPKI DER, base64) from the platform private key
  // (stored as base64-encoded PKCS8 DER — same encoding the CLI generates).
  const privateKeyObject = createPrivateKey({
    key: Buffer.from(privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  } as any);
  // createPublicKey derives the public part from a private KeyObject.
  const publicKey = createPublicKey(privateKeyObject)
    .export({ type: "spki", format: "der" })
    .toString("base64");

  const existing = await db.orm.public.PublisherKey.where({ sellerId, status: "ACTIVE" }).first();
  if (existing) {
    if (existing.publicKey !== publicKey) {
      // Platform key rotated: revoke stale rows and issue a fresh one.
      await db.orm.public.PublisherKey.where({ id: existing.id }).update({ status: "REVOKED" });
    } else {
      return { id: existing.id, publicKey: existing.publicKey };
    }
  }

  const key = await db.orm.public.PublisherKey.create({
    sellerId,
    keyType: "ED25519",
    publicKey,
    algorithm: "EdDSA",
    status: "ACTIVE",
  });

  return { id: key.id, publicKey: key.publicKey };
}

/**
 * Sign a resource version's artifact and store the signature.
 *
 * Pipeline (PLAN B-002): artifact -> canonical manifest -> SHA-256 ->
 * publisher metadata -> Ed25519 signature -> ArtifactSignature row.
 *
 * @param versionId - ResourceVersion ID
 * @param artifactBuffer - Raw artifact bytes (from the storage layer)
 */
export async function signVersionArtifact(
  versionId: string,
  artifactBuffer: Buffer
): Promise<SignedArtifact> {
  // 1. Load the version and resolve the seller through the resource
  const versions = await db.orm.public.ResourceVersion.where({ id: versionId }).all();
  const version = versions[0];
  if (!version) {
    throw new Error("Resource version not found");
  }

  const resources = await db.orm.public.Resource.where({ id: version.resourceId }).all();
  const resource = resources[0];
  if (!resource) {
    throw new Error("Resource not found for version");
  }

  const sellerId = resource.sellerId;

  // 2. Platform publisher key (public part persisted, private stays in env)
  const key = await ensurePublisherKey(sellerId);

  // 3. Generate canonical manifest
  const manifest = await generateManifest({
    resourceId: resource.id,
    versionId: version.id,
    sellerId,
    artifactBuffer,
    version: version.version,
    drmEnabled: true
  });

  // 4. Artifact hash
  const artifactHash = hashFile(artifactBuffer);

  // 5. Sign manifest + artifact hash with the platform private key
  const signature = signArtifact({
    manifest,
    artifactHash,
    privateKey: process.env.ARTIFACT_SIGNING_PRIVATE_KEY!
  });

  // 6. Attach signature metadata to the manifest
  const signedManifest = attachSignatureMetadata(manifest, key.id, key.publicKey);

  // 7. Store the signature (one per version, versionId is unique)
  const existing = await db.orm.public.ArtifactSignature.where({ versionId: version.id }).first();
  if (existing) {
    await db.orm.public.ArtifactSignature.where({ id: existing.id }).update({
      keyId: key.id,
      signature,
      algorithm: "EdDSA",
      manifestHash: manifest.sha256,
      artifactHash,
      manifest: signedManifest as any,
      signedAt: new Date().toISOString(),
    });
  } else {
    await db.orm.public.ArtifactSignature.create({
      versionId: version.id,
      keyId: key.id,
      signature,
      algorithm: "EdDSA",
      manifestHash: manifest.sha256,
      artifactHash,
      manifest: signedManifest as any,
    });
  }

  return {
    manifest: signedManifest,
    signature,
    manifestHash: manifest.sha256,
    artifactHash
  };
}

/**
 * Verify a stored artifact signature against the actual bytes.
 *
 * @param versionId - ResourceVersion ID
 * @param artifactBuffer - Artifact bytes to verify
 */
export async function verifyStoredArtifact(
  versionId: string,
  artifactBuffer: Buffer
): Promise<VerificationResult> {
  const signatures = await db.orm.public.ArtifactSignature.where({ versionId }).all();
  const artifactSignature = signatures[0];

  if (!artifactSignature) {
    return {
      valid: false,
      errors: ["No signature found for this artifact"],
      warnings: []
    };
  }

  // The signing key must still be active
  const keys = await db.orm.public.PublisherKey.where({ id: artifactSignature.keyId }).all();
  const key = keys[0];
  if (!key || key.status !== "ACTIVE") {
    return {
      valid: false,
      errors: [`Publisher key is ${key ? key.status.toLowerCase() : "missing"}`],
      warnings: []
    };
  }

  const artifactHash = hashFile(artifactBuffer);

  return verifyArtifactSignature({
    manifest: artifactSignature.manifest as unknown as ArtifactManifest,
    signature: artifactSignature.signature,
    publicKey: key.publicKey,
    artifactHash
  });
}

/**
 * Get the stored manifest for a resource version.
 */
export async function getManifest(versionId: string): Promise<ArtifactManifest | null> {
  const signatures = await db.orm.public.ArtifactSignature.where({ versionId }).all();
  const signature = signatures[0];
  if (!signature) {
    return null;
  }
  return signature.manifest as unknown as ArtifactManifest;
}

/**
 * Check whether a version has a valid stored signature (key active).
 * Used by the publication gate (PLAN B-001: published requires validation
 * and signing).
 */
export async function hasValidSignature(versionId: string): Promise<boolean> {
  const signatures = await db.orm.public.ArtifactSignature.where({ versionId }).all();
  const signature = signatures[0];
  if (!signature) {
    return false;
  }

  const keys = await db.orm.public.PublisherKey.where({ id: signature.keyId }).all();
  const key = keys[0];
  return !!key && key.status === "ACTIVE";
}

/**
 * Generate a new platform signing keypair (CLI helper).
 * The private key MUST be stored in ARTIFACT_SIGNING_PRIVATE_KEY (env/vault).
 */
export function generatePlatformSigningKeypair(): { publicKey: string; privateKey: string } {
  return generatePublisherKeypair();
}