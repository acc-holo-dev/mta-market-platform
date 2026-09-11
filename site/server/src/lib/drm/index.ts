/**
 * TASK-020: DRM Protocol v2 Module
 * 
 * Complete DRM v2 implementation with asymmetric cryptography.
 */

// Export types
export * from './types';

// Export cryptography functions
export {
  generateInstallationKeypair,
  generateChallenge,
  signChallenge,
  verifyChallengeResponse,
  signLease,
  verifyLeaseSignature,
  generateNonce,
  isValidNonce,
  calculateLeaseExpiry,
  isLeaseExpired,
  getRemainingLeaseTime
} from './crypto';

// Export service functions (main API)
export {
  createServerSigningKey,
  registerInstallation,
  verifyInstallation,
  activateLicense,
  recordHeartbeat,
  revokeInstallation,
  getServerPublicKey,
  rotateServerSigningKey,
  getTrustedServerKeys,
  issueVersionDek,
  getActiveLease
} from './service';
