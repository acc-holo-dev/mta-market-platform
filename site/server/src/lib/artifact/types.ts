/**
 * TASK-019: Artifact Manifest Types
 * 
 * Type definitions for artifact manifest and signing.
 */

export interface ArtifactManifest {
  formatVersion: 1;
  productId: string;
  versionId: string;
  artifactId: string;
  sha256: string;
  publisherId: string;
  publishedAt: string; // ISO 8601 timestamp
  dependencies: Dependency[];
  compatibility: Compatibility;
  signature: SignatureMetadata;
  drm?: DRMMetadata;
}

export interface Dependency {
  resourceName: string;
  resourceId?: string;
  minVersion?: string;
  maxVersion?: string;
  optional: boolean;
}

export interface Compatibility {
  mta: {
    min?: string;      // "1.5.0"
    max?: string;      // "1.6.0"
    tested: string[];  // ["1.5.9", "1.6.0"]
  };
  os: ('linux' | 'windows')[];
  architecture: ('x64' | 'x86')[];
  requiredModules: string[];
  conflicts?: Conflict[];
}

export interface Conflict {
  resourceName: string;
  resourceId?: string;
  reason: string;
}

export interface SignatureMetadata {
  algorithm: string;      // "EdDSA", "RS256"
  keyId: string;
  publicKey: string;      // Base64 encoded
  signedAt: string;       // ISO 8601 timestamp
}

export interface DRMMetadata {
  enabled: boolean;
  version: number;        // DRM protocol version
  encryptionAlgorithm?: string;
}

export interface SignedArtifact {
  manifest: ArtifactManifest;
  signature: string;      // Base64 encoded signature
  manifestHash: string;   // SHA-256 of canonical manifest JSON
  artifactHash: string;   // SHA-256 of artifact file
}

export interface VerificationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  signature?: {
    algorithm: string;
    keyId: string;
    verified: boolean;
  };
  manifest?: {
    valid: boolean;
    formatVersion: number;
  };
}

export interface KeyPair {
  publicKey: string;      // Base64 encoded
  privateKey: string;     // Base64 encoded (NEVER store in DB)
}

export interface SigningInput {
  manifest: ArtifactManifest;
  artifactHash: string;
  privateKey: string;     // Base64 encoded
}

export interface VerificationInput {
  manifest: ArtifactManifest;
  signature: string;      // Base64 encoded
  publicKey: string;      // Base64 encoded
  artifactHash: string;   // SHA-256
}
