/**
 * TASK-019: Artifact Signing - Cryptography Service
 * 
 * Ed25519 keypair generation and signing/verification using Node.js crypto.
 */

import { createHash, generateKeyPairSync, sign, verify } from 'crypto';
import type { KeyPair, SigningInput, VerificationInput, VerificationResult } from './types';

/**
 * Generate Ed25519 keypair for artifact signing
 * 
 * @returns Base64 encoded public and private keys
 */
export function generatePublisherKeypair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'der'
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der'
    }
  });

  return {
    publicKey: publicKey.toString('base64'),
    privateKey: privateKey.toString('base64')
  };
}

/**
 * Sign artifact manifest + artifact hash
 * 
 * IMPORTANT: This function should only be called server-side.
 * Private keys must NEVER be exposed to clients or stored in database.
 * 
 * @param input - Manifest, artifact hash, and private key
 * @returns Base64 encoded signature
 */
export function signArtifact(input: SigningInput): string {
  const { manifest, artifactHash, privateKey } = input;

  // 1. Create canonical signing payload
  const payload = createSigningPayload(manifest, artifactHash);

  // 2. Decode private key from base64
  const privateKeyBuffer = Buffer.from(privateKey, 'base64');

  // 3. Create signature
  const signature = sign(
    null, // Ed25519 doesn't use a digest
    Buffer.from(payload, 'utf-8'),
    {
      key: privateKeyBuffer,
      format: 'der',
      type: 'pkcs8'
    }
  );

  return signature.toString('base64');
}

/**
 * Verify artifact signature
 * 
 * @param input - Manifest, signature, public key, and artifact hash
 * @returns Verification result with details
 */
export function verifyArtifactSignature(input: VerificationInput): VerificationResult {
  const { manifest, signature, publicKey, artifactHash } = input;

  try {
    // 1. Verify artifact hash matches the manifest's declared artifact hash.
    // NOTE: manifest.sha256 is the ARTIFACT file hash, not the manifest's own
    // hash. The manifest integrity is bound via hashManifest(manifest) inside
    // the signing payload (see createSigningPayload) — do not conflate the two.
    if (artifactHash !== manifest.sha256) {
      return {
        valid: false,
        errors: ['Artifact hash mismatch'],
        warnings: []
      };
    }

    // 2. Create canonical signing payload (must match signArtifact exactly)
    const payload = createSigningPayload(manifest, artifactHash);

    // 3. Decode public key and signature
    const publicKeyBuffer = Buffer.from(publicKey, 'base64');
    const signatureBuffer = Buffer.from(signature, 'base64');

    // 4. Verify signature
    const isValid = verify(
      null, // Ed25519 doesn't use a digest
      Buffer.from(payload, 'utf-8'),
      {
        key: publicKeyBuffer,
        format: 'der',
        type: 'spki'
      },
      signatureBuffer
    );

    if (!isValid) {
      return {
        valid: false,
        errors: ['Invalid signature'],
        warnings: []
      };
    }

    return {
      valid: true,
      errors: [],
      warnings: [],
      signature: {
        algorithm: 'EdDSA',
        keyId: manifest.signature.keyId,
        verified: true
      },
      manifest: {
        valid: true,
        formatVersion: manifest.formatVersion
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
 * Create canonical signing payload from manifest and artifact hash
 * 
 * The payload format is:
 * manifestHash + "|" + artifactHash
 * 
 * This ensures both manifest and artifact integrity.
 */
function createSigningPayload(manifest: any, artifactHash: string): string {
  const manifestHash = hashManifest(manifest);
  return `${manifestHash}|${artifactHash}`;
}

/**
 * Hash manifest using SHA-256
 * 
 * Creates canonical JSON representation before hashing to ensure
 * consistent hashing across different serializations.
 */
export function hashManifest(manifest: any): string {
  const canonical = canonicalJSON(manifest);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Create canonical JSON representation
 * 
 * Rules:
 * 1. Remove signature field (if present) before hashing
 * 2. Sort object keys alphabetically
 * 3. No whitespace
 * 4. UTF-8 encoding
 */
export function canonicalJSON(obj: any): string {
  // Remove signature field for canonical representation
  const { signature, ...rest } = obj;

  // Recursively sort keys
  const sorted = sortKeys(rest);

  // Stringify without whitespace
  return JSON.stringify(sorted);
}

/**
 * Recursively sort object keys alphabetically
 */
function sortKeys(obj: any): any {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const sorted: any = {};
  const keys = Object.keys(obj).sort();

  for (const key of keys) {
    sorted[key] = sortKeys(obj[key]);
  }

  return sorted;
}

/**
 * Hash file buffer using SHA-256
 */
export function hashFile(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validate key format
 */
export function isValidPublicKey(publicKey: string): boolean {
  try {
    const buffer = Buffer.from(publicKey, 'base64');
    // Ed25519 public key in SPKI format is 44 bytes
    return buffer.length === 44;
  } catch {
    return false;
  }
}

/**
 * Validate signature format
 */
export function isValidSignature(signature: string): boolean {
  try {
    const buffer = Buffer.from(signature, 'base64');
    // Ed25519 signature is 64 bytes
    return buffer.length === 64;
  } catch {
    return false;
  }
}
