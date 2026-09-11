/**
 * TASK-020: DRM Protocol v2 - Cryptography Tests
 */

import { describe, it, expect } from 'vitest';
import {
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
} from '../src/lib/drm/crypto';
import type { LeasePayload, Capability } from '../src/lib/drm/types';

describe('DRM Protocol v2 - Cryptography', () => {
  describe('generateInstallationKeypair', () => {
    it('should generate valid Ed25519 keypair', () => {
      const keypair = generateInstallationKeypair();
      
      expect(keypair.publicKey).toBeDefined();
      expect(keypair.privateKey).toBeDefined();
      expect(typeof keypair.publicKey).toBe('string');
      expect(typeof keypair.privateKey).toBe('string');
      
      const publicKeyBuffer = Buffer.from(keypair.publicKey, 'base64');
      expect(publicKeyBuffer.length).toBe(44);
    });

    it('should generate unique keypairs', () => {
      const keypair1 = generateInstallationKeypair();
      const keypair2 = generateInstallationKeypair();
      
      expect(keypair1.publicKey).not.toBe(keypair2.publicKey);
      expect(keypair1.privateKey).not.toBe(keypair2.privateKey);
    });
  });

  describe('challenge/response', () => {
    it('should generate valid challenge', () => {
      const challenge = generateChallenge();
      
      expect(typeof challenge).toBe('string');
      expect(challenge.length).toBeGreaterThan(0);
      
      const buffer = Buffer.from(challenge, 'base64');
      expect(buffer.length).toBe(32);
    });

    it('should sign and verify challenge successfully', () => {
      const keypair = generateInstallationKeypair();
      const challenge = generateChallenge();
      
      const signature = signChallenge(challenge, keypair.privateKey);
      expect(signature).toBeDefined();
      
      const isValid = verifyChallengeResponse(challenge, signature, keypair.publicKey);
      expect(isValid).toBe(true);
    });

    it('should reject invalid challenge response', () => {
      const keypair = generateInstallationKeypair();
      const challenge = generateChallenge();
      
      const signature = signChallenge(challenge, keypair.privateKey);
      const tamperedSignature = signature.slice(0, -10) + 'AAAAAAAAAA';
      
      const isValid = verifyChallengeResponse(challenge, tamperedSignature, keypair.publicKey);
      expect(isValid).toBe(false);
    });

    it('should reject challenge signed with wrong key', () => {
      const keypair1 = generateInstallationKeypair();
      const keypair2 = generateInstallationKeypair();
      const challenge = generateChallenge();
      
      const signature = signChallenge(challenge, keypair1.privateKey);
      const isValid = verifyChallengeResponse(challenge, signature, keypair2.publicKey);
      
      expect(isValid).toBe(false);
    });
  });

  describe('lease signing and verification', () => {
    it('should sign and verify lease successfully', () => {
      const serverKeypair = generateInstallationKeypair();
      
      const leasePayload: LeasePayload = {
        protocolVersion: 2,
        licenseId: 'license-123',
        installationId: 'installation-456',
        resourceId: 'resource-789',
        resourceVersionId: 'version-abc',
        artifactHash: 'a'.repeat(64),
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        nonce: 'b'.repeat(64),
        serverKeyId: 'key-123',
        capabilities: ['run', 'update'] as Capability[]
      };

      const signature = signLease(leasePayload, serverKeypair.privateKey);
      expect(signature).toBeDefined();

      const signedLease = {
        ...leasePayload,
        signature
      };

      const result = verifyLeaseSignature(signedLease, serverKeypair.publicKey);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject expired lease', () => {
      const serverKeypair = generateInstallationKeypair();
      
      const leasePayload: LeasePayload = {
        protocolVersion: 2,
        licenseId: 'license-123',
        installationId: 'installation-456',
        resourceId: 'resource-789',
        resourceVersionId: 'version-abc',
        artifactHash: 'a'.repeat(64),
        issuedAt: new Date(Date.now() - 100000).toISOString(),
        // Expired beyond the tolerated clock skew (G-001: 90s)
        expiresAt: new Date(Date.now() - (90 + 10) * 1000).toISOString(),
        nonce: 'b'.repeat(64),
        serverKeyId: 'key-123',
        capabilities: ['run'] as Capability[]
      };

      const signature = signLease(leasePayload, serverKeypair.privateKey);
      const signedLease = { ...leasePayload, signature };
      
      const result = verifyLeaseSignature(signedLease, serverKeypair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Lease expired');
    });

    it('should reject invalid signature', () => {
      const serverKeypair = generateInstallationKeypair();
      
      const leasePayload: LeasePayload = {
        protocolVersion: 2,
        licenseId: 'license-123',
        installationId: 'installation-456',
        resourceId: 'resource-789',
        resourceVersionId: 'version-abc',
        artifactHash: 'a'.repeat(64),
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        nonce: 'b'.repeat(64),
        capabilities: ['run'] as Capability[]
      };
      
      const signature = signLease(leasePayload, serverKeypair.privateKey);
      const tamperedSignature = signature.slice(0, -10) + 'AAAAAAAAAA';
      const signedLease = { ...leasePayload, serverKeyId: 'key-123', signature: tamperedSignature };
      
      const result = verifyLeaseSignature(signedLease, serverKeypair.publicKey);
      expect(result.valid).toBe(false);
    });

    it('should reject wrong protocol version', () => {
      const serverKeypair = generateInstallationKeypair();
      
      const leasePayload: any = {
        protocolVersion: 99, // Invalid
        licenseId: 'license-123',
        installationId: 'installation-456',
        resourceId: 'resource-789',
        resourceVersionId: 'version-abc',
        artifactHash: 'a'.repeat(64),
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
        nonce: 'b'.repeat(64),
        serverKeyId: 'key-123',
        capabilities: ['run']
      };

      const signature = signLease(leasePayload, serverKeypair.privateKey);
      const signedLease = { ...leasePayload, signature };
      
      const result = verifyLeaseSignature(signedLease, serverKeypair.publicKey);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('protocol version'))).toBe(true);
    });
  });

  describe('nonce generation and validation', () => {
    it('should generate valid nonce', () => {
      const nonce = generateNonce();
      
      expect(typeof nonce).toBe('string');
      expect(nonce).toMatch(/^[a-f0-9]{64}$/);
      expect(isValidNonce(nonce)).toBe(true);
    });

    it('should generate unique nonces', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      
      expect(nonce1).not.toBe(nonce2);
    });

    it('should validate nonce format', () => {
      expect(isValidNonce('a'.repeat(64))).toBe(true);
      expect(isValidNonce('0123456789abcdef'.repeat(4))).toBe(true);
      
      expect(isValidNonce('short')).toBe(false);
      expect(isValidNonce('z'.repeat(64))).toBe(false);
      expect(isValidNonce('not-hex-at-all')).toBe(false);
    });
  });

  describe('lease expiry', () => {
    it('should calculate lease expiry correctly', () => {
      const durationSeconds = 3600; // 1 hour
      const expiry = calculateLeaseExpiry(durationSeconds);
      
      const expiryDate = new Date(expiry);
      const now = new Date();
      const diff = expiryDate.getTime() - now.getTime();
      
      // Should be approximately 1 hour (with small tolerance)
      expect(diff).toBeGreaterThan(3590000);
      expect(diff).toBeLessThan(3610000);
    });

    it('should detect expired lease', () => {
      const pastTime = new Date(Date.now() - 10000).toISOString();
      expect(isLeaseExpired(pastTime)).toBe(true);
      
      const futureTime = new Date(Date.now() + 10000).toISOString();
      expect(isLeaseExpired(futureTime)).toBe(false);
    });

    it('should calculate remaining lease time', () => {
      // Wider tolerance: the suite runs 20 parallel workers and a GC pause
      // between the two Date.now() calls can eat a second.
      const futureTime = new Date(Date.now() + 5000).toISOString();
      const remaining = getRemainingLeaseTime(futureTime);

      expect(remaining).toBeGreaterThan(2);
      expect(remaining).toBeLessThanOrEqual(5);
      
      const pastTime = new Date(Date.now() - 5000).toISOString();
      expect(getRemainingLeaseTime(pastTime)).toBe(0);
    });
  });
});
