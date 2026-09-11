/**
 * TASK-020: DRM Protocol v2 Types
 * 
 * Type definitions for DRM Protocol v2 with asymmetric cryptography.
 */

export interface InstallationKeypair {
  publicKey: string;   // Base64 encoded Ed25519 public key
  privateKey: string;  // Base64 encoded Ed25519 private key (client-side only)
}

export interface InstallationRegistration {
  publicKey: string;
  licenseId: string; // License being activated; ownership verified against authenticated user
  mtaVersion: string;
  moduleVersion: string;
  serverSerial?: string;
  serverName?: string;
}

export interface InstallationResponse {
  installationId: string;
  challenge: string;    // Base64 encoded challenge for verification
}

export interface ChallengeVerification {
  installationId: string;
  challengeResponse: string; // Base64 encoded signed challenge
}

export interface VerificationResult {
  verified: boolean;
  installationId: string;
}

export interface LeaseRequest {
  licenseId: string;
  installationId: string;
  nonce: string;        // Random nonce for replay protection
}

export interface SignedLease {
  protocolVersion: 2;
  licenseId: string;
  installationId: string;
  resourceId: string;
  resourceVersionId: string;
  artifactHash: string;
  issuedAt: string;     // ISO 8601 timestamp
  expiresAt: string;    // ISO 8601 timestamp
  nonce: string;
  serverKeyId: string;
  capabilities: Capability[];
  signature: string;    // Base64 encoded Ed25519 signature
}

export type Capability = 'run' | 'update' | 'debug' | 'export';

export interface LeaseVerificationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  lease?: {
    protocolVersion: number;
    licenseId: string;
    expiresAt: string;
    capabilities: Capability[];
  };
}

export interface HeartbeatRequest {
  installationId: string;
  resourceId: string;
  uptime: number;       // Seconds
  lastError?: string;
}

export interface HeartbeatResponse {
  acknowledged: boolean;
  leaseValid: boolean;
  shouldUpdate: boolean;
  updateVersionId?: string;
}

export interface LeasePayload {
  protocolVersion: number;
  licenseId: string;
  installationId: string;
  resourceId: string;
  resourceVersionId: string;
  artifactHash: string;
  issuedAt: string;
  expiresAt: string;
  nonce: string;
  serverKeyId: string; // Bound into the signature: identifies the verifying key
  capabilities: Capability[];
}

export interface ServerKeyPair {
  keyId: string;
  publicKey: string;
  privateKey: string;   // MUST be stored securely (ENV/KMS/Vault)
}

export interface NonceValidation {
  valid: boolean;
  reason?: string;
}

export interface ProtocolVersion {
  version: number;
  supported: boolean;
  deprecated?: boolean;
  minimumModuleVersion?: string;
}

export interface DRMError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

// DRM Error Codes
export const DRM_ERROR_CODES = {
  INVALID_LICENSE: 'DRM_INVALID_LICENSE',
  LICENSE_NOT_OWNED: 'DRM_LICENSE_NOT_OWNED',
  LICENSE_INSTALLATION_MISMATCH: 'DRM_LICENSE_INSTALLATION_MISMATCH',
  INSTALLATION_NOT_FOUND: 'DRM_INSTALLATION_NOT_FOUND',
  INSTALLATION_NOT_VERIFIED: 'DRM_INSTALLATION_NOT_VERIFIED',
  INSTALLATION_REVOKED: 'DRM_INSTALLATION_REVOKED',
  INVALID_CHALLENGE_RESPONSE: 'DRM_INVALID_CHALLENGE_RESPONSE',
  NONCE_ALREADY_USED: 'DRM_NONCE_ALREADY_USED',
  NONCE_EXPIRED: 'DRM_NONCE_EXPIRED',
  LEASE_EXPIRED: 'DRM_LEASE_EXPIRED',
  INVALID_SIGNATURE: 'DRM_INVALID_SIGNATURE',
  PROTOCOL_VERSION_MISMATCH: 'DRM_PROTOCOL_VERSION_MISMATCH',
  ARTIFACT_HASH_MISMATCH: 'DRM_ARTIFACT_HASH_MISMATCH',
  INSUFFICIENT_CAPABILITIES: 'DRM_INSUFFICIENT_CAPABILITIES',
  SERVER_KEY_REVOKED: 'DRM_SERVER_KEY_REVOKED'
} as const;
