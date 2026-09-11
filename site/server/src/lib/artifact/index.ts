/**
 * TASK-019: Artifact Signing Module
 * 
 * Complete artifact signing and verification system with Ed25519.
 */

// Export types
export * from './types.js';

// Export cryptography functions
export {
  generatePublisherKeypair,
  signArtifact,
  verifyArtifactSignature,
  hashManifest,
  canonicalJSON,
  hashFile,
  isValidPublicKey,
  isValidSignature
} from './crypto.js';

// Export manifest functions
export {
  generateManifest,
  attachSignatureMetadata,
  validateManifest,
  parseManifest,
  serializeManifest
} from './manifest.js';

// Export signing service (main API) — PLAN B-002: single signing
// implementation shared by the web pipeline (and later the CLI).
export {
  signVersionArtifact,
  verifyStoredArtifact,
  getManifest,
  hasValidSignature,
  generatePlatformSigningKeypair
} from './signing.js';
