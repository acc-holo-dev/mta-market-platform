/**
 * TASK-019: Artifact Manifest Generator
 * 
 * Generate artifact manifests with metadata, compatibility info, and signatures.
 */

import type { ArtifactManifest, Dependency, Compatibility } from './types';
import { hashFile } from './crypto';

export interface GenerateManifestInput {
  resourceId: string;
  versionId: string;
  sellerId: string;
  artifactBuffer: Buffer;
  version: string;
  dependencies?: Dependency[];
  compatibility?: Partial<Compatibility>;
  drmEnabled?: boolean;
}

/**
 * Generate artifact manifest from resource version
 * 
 * @param input - Resource version data and artifact buffer
 * @returns Complete artifact manifest (without signature yet)
 */
export async function generateManifest(input: GenerateManifestInput): Promise<ArtifactManifest> {
  const {
    resourceId,
    versionId,
    sellerId,
    artifactBuffer,
    version,
    dependencies = [],
    compatibility,
    drmEnabled = true
  } = input;

  // Calculate artifact hash
  const artifactHash = hashFile(artifactBuffer);

  // Create artifact ID (combination of resource + version)
  const artifactId = `${resourceId}-${version}`;

  // Build manifest
  const manifest: ArtifactManifest = {
    formatVersion: 1,
    productId: resourceId,
    versionId: versionId,
    artifactId: artifactId,
    sha256: artifactHash,
    publisherId: sellerId,
    publishedAt: new Date().toISOString(),
    dependencies: dependencies,
    compatibility: buildCompatibility(compatibility),
    signature: {
      algorithm: 'EdDSA',
      keyId: '', // Will be filled after signing
      publicKey: '', // Will be filled after signing
      signedAt: new Date().toISOString()
    },
    drm: drmEnabled ? {
      enabled: true,
      version: 2,
      encryptionAlgorithm: 'AES-256-GCM'
    } : undefined
  };

  return manifest;
}

/**
 * Build compatibility object with defaults
 */
function buildCompatibility(partial?: Partial<Compatibility>): Compatibility {
  return {
    mta: {
      min: partial?.mta?.min,
      max: partial?.mta?.max,
      tested: partial?.mta?.tested || []
    },
    os: partial?.os || ['linux', 'windows'],
    architecture: partial?.architecture || ['x64'],
    requiredModules: partial?.requiredModules || [],
    conflicts: partial?.conflicts || []
  };
}

/**
 * Update manifest with signature metadata after signing
 */
export function attachSignatureMetadata(
  manifest: ArtifactManifest,
  keyId: string,
  publicKey: string
): ArtifactManifest {
  return {
    ...manifest,
    signature: {
      ...manifest.signature,
      keyId,
      publicKey,
      signedAt: new Date().toISOString()
    }
  };
}

/**
 * Validate manifest structure
 */
export function validateManifest(manifest: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check format version
  if (manifest.formatVersion !== 1) {
    errors.push('Invalid or missing formatVersion');
  }

  // Check required fields
  const requiredFields = [
    'productId',
    'versionId',
    'artifactId',
    'sha256',
    'publisherId',
    'publishedAt'
  ];

  for (const field of requiredFields) {
    if (!manifest[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Validate SHA-256 format (64 hex characters)
  if (manifest.sha256 && !/^[a-f0-9]{64}$/i.test(manifest.sha256)) {
    errors.push('Invalid SHA-256 hash format');
  }

  // Validate ISO 8601 timestamp
  if (manifest.publishedAt && isNaN(Date.parse(manifest.publishedAt))) {
    errors.push('Invalid publishedAt timestamp');
  }

  // Validate dependencies array
  if (manifest.dependencies && !Array.isArray(manifest.dependencies)) {
    errors.push('Dependencies must be an array');
  }

  // Validate compatibility object
  if (!manifest.compatibility || typeof manifest.compatibility !== 'object') {
    errors.push('Missing or invalid compatibility object');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Parse manifest from JSON string
 */
export function parseManifest(json: string): ArtifactManifest {
  try {
    const manifest = JSON.parse(json);
    const validation = validateManifest(manifest);
    
    if (!validation.valid) {
      throw new Error(`Invalid manifest: ${validation.errors.join(', ')}`);
    }
    
    return manifest;
  } catch (error) {
    throw new Error(`Failed to parse manifest: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Serialize manifest to JSON string
 */
export function serializeManifest(manifest: ArtifactManifest): string {
  return JSON.stringify(manifest, null, 2);
}
