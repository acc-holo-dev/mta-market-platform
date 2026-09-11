/**
 * TASK-019: Artifact Signing - Cryptography Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generatePublisherKeypair,
  signArtifact,
  verifyArtifactSignature,
  hashManifest,
  canonicalJSON,
  hashFile,
  isValidPublicKey,
  isValidSignature
} from '../src/lib/artifact/crypto';
import type { ArtifactManifest } from '../src/lib/artifact/types';

describe('Artifact Signing - Cryptography', () => {
  describe('generatePublisherKeypair', () => {
    it('should generate valid Ed25519 keypair', () => {
      const keypair = generatePublisherKeypair();
      
      expect(keypair.publicKey).toBeDefined();
      expect(keypair.privateKey).toBeDefined();
      expect(typeof keypair.publicKey).toBe('string');
      expect(typeof keypair.privateKey).toBe('string');
      
      // Ed25519 public key in SPKI format is 44 bytes (base64)
      const publicKeyBuffer = Buffer.from(keypair.publicKey, 'base64');
      expect(publicKeyBuffer.length).toBe(44);
      
      // Private key should be longer
      const privateKeyBuffer = Buffer.from(keypair.privateKey, 'base64');
      expect(privateKeyBuffer.length).toBeGreaterThan(44);
    });

    it('should generate unique keypairs', () => {
      const keypair1 = generatePublisherKeypair();
      const keypair2 = generatePublisherKeypair();
      
      expect(keypair1.publicKey).not.toBe(keypair2.publicKey);
      expect(keypair1.privateKey).not.toBe(keypair2.privateKey);
    });
  });

  describe('signArtifact and verifyArtifactSignature', () => {
    it('should sign and verify artifact successfully', () => {
      const keypair = generatePublisherKeypair();
      const artifactHash = 'a'.repeat(64); // Mock SHA-256 hash
      
      const manifest: ArtifactManifest = {
        formatVersion: 1,
        productId: 'test-product',
        versionId: 'test-version',
        artifactId: 'test-artifact',
        sha256: artifactHash,
        publisherId: 'test-seller',
        publishedAt: new Date().toISOString(),
        dependencies: [],
        compatibility: {
          mta: { tested: [] },
          os: ['linux'],
          architecture: ['x64'],
          requiredModules: []
        },
        signature: {
          algorithm: 'EdDSA',
          keyId: 'test-key',
          publicKey: keypair.publicKey,
          signedAt: new Date().toISOString()
        }
      };

      const signature = signArtifact({
        manifest,
        artifactHash,
        privateKey: keypair.privateKey
      });

      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');

      const result = verifyArtifactSignature({
        manifest,
        signature,
        publicKey: keypair.publicKey,
        artifactHash
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.signature?.verified).toBe(true);
    });

    it('should reject invalid signature', () => {
      const keypair = generatePublisherKeypair();
      const artifactHash = 'a'.repeat(64);
      
      const manifest: ArtifactManifest = {
        formatVersion: 1,
        productId: 'test-product',
        versionId: 'test-version',
        artifactId: 'test-artifact',
        sha256: artifactHash,
        publisherId: 'test-seller',
        publishedAt: new Date().toISOString(),
        dependencies: [],
        compatibility: {
          mta: { tested: [] },
          os: ['linux'],
          architecture: ['x64'],
          requiredModules: []
        },
        signature: {
          algorithm: 'EdDSA',
          keyId: 'test-key',
          publicKey: keypair.publicKey,
          signedAt: new Date().toISOString()
        }
      };

      const signature = signArtifact({
        manifest,
        artifactHash,
        privateKey: keypair.privateKey
      });

      // Tamper with signature
      const tamperedSignature = signature.slice(0, -10) + 'AAAAAAAAAA';

      const result = verifyArtifactSignature({
        manifest,
        signature: tamperedSignature,
        publicKey: keypair.publicKey,
        artifactHash
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject signature with wrong artifact hash', () => {
      const keypair = generatePublisherKeypair();
      const artifactHash = 'a'.repeat(64);
      
      const manifest: ArtifactManifest = {
        formatVersion: 1,
        productId: 'test-product',
        versionId: 'test-version',
        artifactId: 'test-artifact',
        sha256: artifactHash,
        publisherId: 'test-seller',
        publishedAt: new Date().toISOString(),
        dependencies: [],
        compatibility: {
          mta: { tested: [] },
          os: ['linux'],
          architecture: ['x64'],
          requiredModules: []
        },
        signature: {
          algorithm: 'EdDSA',
          keyId: 'test-key',
          publicKey: keypair.publicKey,
          signedAt: new Date().toISOString()
        }
      };

      const signature = signArtifact({
        manifest,
        artifactHash,
        privateKey: keypair.privateKey
      });

      // Use different artifact hash
      const wrongHash = 'b'.repeat(64);

      const result = verifyArtifactSignature({
        manifest,
        signature,
        publicKey: keypair.publicKey,
        artifactHash: wrongHash
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Artifact hash mismatch');
    });
  });

  describe('canonicalJSON', () => {
    it('should sort keys alphabetically', () => {
      const obj = {
        z: 1,
        a: 2,
        m: 3
      };

      const canonical = canonicalJSON(obj);
      expect(canonical).toBe('{"a":2,"m":3,"z":1}');
    });

    it('should remove signature field', () => {
      const obj = {
        name: 'test',
        signature: 'should-be-removed',
        value: 123
      };

      const canonical = canonicalJSON(obj);
      expect(canonical).not.toContain('signature');
      expect(canonical).toBe('{"name":"test","value":123}');
    });

    it('should sort nested objects', () => {
      const obj = {
        outer: {
          z: 1,
          a: 2
        },
        inner: {
          b: 3,
          a: 4
        }
      };

      const canonical = canonicalJSON(obj);
      expect(canonical).toBe('{"inner":{"a":4,"b":3},"outer":{"a":2,"z":1}}');
    });
  });

  describe('hashManifest', () => {
    it('should produce consistent hashes for same manifest', () => {
      const manifest = {
        formatVersion: 1,
        productId: 'test',
        versionId: 'v1'
      };

      const hash1 = hashManifest(manifest);
      const hash2 = hashManifest(manifest);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different manifests', () => {
      const manifest1 = {
        formatVersion: 1,
        productId: 'test1'
      };

      const manifest2 = {
        formatVersion: 1,
        productId: 'test2'
      };

      const hash1 = hashManifest(manifest1);
      const hash2 = hashManifest(manifest2);

      expect(hash1).not.toBe(hash2);
    });

    it('should produce SHA-256 hex string (64 chars)', () => {
      const manifest = { test: 'data' };
      const hash = hashManifest(manifest);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('hashFile', () => {
    it('should hash buffer correctly', () => {
      const buffer = Buffer.from('test data');
      const hash = hashFile(buffer);

      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce same hash for same content', () => {
      const buffer = Buffer.from('test data');
      const hash1 = hashFile(buffer);
      const hash2 = hashFile(buffer);

      expect(hash1).toBe(hash2);
    });

    it('should produce different hash for different content', () => {
      const buffer1 = Buffer.from('test data 1');
      const buffer2 = Buffer.from('test data 2');
      
      const hash1 = hashFile(buffer1);
      const hash2 = hashFile(buffer2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('isValidPublicKey', () => {
    it('should validate correct Ed25519 public key', () => {
      const keypair = generatePublisherKeypair();
      expect(isValidPublicKey(keypair.publicKey)).toBe(true);
    });

    it('should reject invalid base64', () => {
      expect(isValidPublicKey('not-valid-base64!@#')).toBe(false);
    });

    it('should reject wrong length', () => {
      const shortKey = Buffer.from('too-short').toString('base64');
      expect(isValidPublicKey(shortKey)).toBe(false);
    });
  });

  describe('isValidSignature', () => {
    it('should validate correct Ed25519 signature', () => {
      const keypair = generatePublisherKeypair();
      const artifactHash = 'a'.repeat(64);
      
      const manifest: ArtifactManifest = {
        formatVersion: 1,
        productId: 'test',
        versionId: 'v1',
        artifactId: 'a1',
        sha256: artifactHash,
        publisherId: 'seller',
        publishedAt: new Date().toISOString(),
        dependencies: [],
        compatibility: {
          mta: { tested: [] },
          os: ['linux'],
          architecture: ['x64'],
          requiredModules: []
        },
        signature: {
          algorithm: 'EdDSA',
          keyId: 'key1',
          publicKey: keypair.publicKey,
          signedAt: new Date().toISOString()
        }
      };

      const signature = signArtifact({
        manifest,
        artifactHash,
        privateKey: keypair.privateKey
      });

      expect(isValidSignature(signature)).toBe(true);
    });

    it('should reject invalid base64', () => {
      expect(isValidSignature('not-valid-base64!@#')).toBe(false);
    });

    it('should reject wrong length', () => {
      const shortSig = Buffer.from('too-short').toString('base64');
      expect(isValidSignature(shortSig)).toBe(false);
    });
  });
});
