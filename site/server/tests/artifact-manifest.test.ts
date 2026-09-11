/**
 * TASK-019: Artifact Signing - Manifest Tests
 */

import { describe, it, expect } from 'vitest';
import {
  generateManifest,
  attachSignatureMetadata,
  validateManifest,
  parseManifest,
  serializeManifest
} from '../src/lib/artifact/manifest';

describe('Artifact Signing - Manifest', () => {
  describe('generateManifest', () => {
    it('should generate valid manifest', async () => {
      const artifactBuffer = Buffer.from('test artifact content');
      
      const manifest = await generateManifest({
        resourceId: 'resource-123',
        versionId: 'version-456',
        sellerId: 'seller-789',
        artifactBuffer,
        version: '1.0.0',
        drmEnabled: true
      });

      expect(manifest.formatVersion).toBe(1);
      expect(manifest.productId).toBe('resource-123');
      expect(manifest.versionId).toBe('version-456');
      expect(manifest.publisherId).toBe('seller-789');
      expect(manifest.artifactId).toBe('resource-123-1.0.0');
      expect(manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(manifest.publishedAt).toBeDefined();
      expect(manifest.dependencies).toEqual([]);
      expect(manifest.compatibility).toBeDefined();
      expect(manifest.signature).toBeDefined();
      expect(manifest.drm).toBeDefined();
      expect(manifest.drm?.enabled).toBe(true);
      expect(manifest.drm?.version).toBe(2);
    });

    it('should generate manifest without DRM', async () => {
      const artifactBuffer = Buffer.from('test');
      
      const manifest = await generateManifest({
        resourceId: 'resource-123',
        versionId: 'version-456',
        sellerId: 'seller-789',
        artifactBuffer,
        version: '1.0.0',
        drmEnabled: false
      });

      expect(manifest.drm).toBeUndefined();
    });

    it('should include dependencies', async () => {
      const artifactBuffer = Buffer.from('test');
      
      const dependencies = [
        {
          resourceName: 'base-library',
          resourceId: 'lib-123',
          minVersion: '1.0.0',
          optional: false
        }
      ];

      const manifest = await generateManifest({
        resourceId: 'resource-123',
        versionId: 'version-456',
        sellerId: 'seller-789',
        artifactBuffer,
        version: '1.0.0',
        dependencies
      });

      expect(manifest.dependencies).toEqual(dependencies);
    });

    it('should include custom compatibility', async () => {
      const artifactBuffer = Buffer.from('test');
      
      const compatibility = {
        mta: {
          min: '1.5.0',
          max: '1.6.0',
          tested: ['1.5.9']
        },
        os: ['linux'] as ('linux' | 'windows')[],
        architecture: ['x64'] as ('x64' | 'x86')[],
        requiredModules: ['mta-market-module']
      };

      const manifest = await generateManifest({
        resourceId: 'resource-123',
        versionId: 'version-456',
        sellerId: 'seller-789',
        artifactBuffer,
        version: '1.0.0',
        compatibility
      });

      expect(manifest.compatibility.mta.min).toBe('1.5.0');
      expect(manifest.compatibility.mta.max).toBe('1.6.0');
      expect(manifest.compatibility.mta.tested).toEqual(['1.5.9']);
      expect(manifest.compatibility.os).toEqual(['linux']);
      expect(manifest.compatibility.requiredModules).toEqual(['mta-market-module']);
    });
  });

  describe('attachSignatureMetadata', () => {
    it('should attach signature metadata to manifest', async () => {
      const artifactBuffer = Buffer.from('test');
      
      const manifest = await generateManifest({
        resourceId: 'resource-123',
        versionId: 'version-456',
        sellerId: 'seller-789',
        artifactBuffer,
        version: '1.0.0'
      });

      const keyId = 'key-123';
      const publicKey = 'base64-encoded-public-key';

      const updated = attachSignatureMetadata(manifest, keyId, publicKey);

      expect(updated.signature.keyId).toBe(keyId);
      expect(updated.signature.publicKey).toBe(publicKey);
      expect(updated.signature.signedAt).toBeDefined();
      expect(new Date(updated.signature.signedAt).getTime()).toBeGreaterThan(0);
    });

    it('should preserve original manifest', async () => {
      const artifactBuffer = Buffer.from('test');
      
      const manifest = await generateManifest({
        resourceId: 'resource-123',
        versionId: 'version-456',
        sellerId: 'seller-789',
        artifactBuffer,
        version: '1.0.0'
      });

      const originalKeyId = manifest.signature.keyId;

      attachSignatureMetadata(manifest, 'new-key', 'new-public-key');

      // Original should not be modified
      expect(manifest.signature.keyId).toBe(originalKeyId);
    });
  });

  describe('validateManifest', () => {
    it('should validate correct manifest', async () => {
      const artifactBuffer = Buffer.from('test');
      
      const manifest = await generateManifest({
        resourceId: 'resource-123',
        versionId: 'version-456',
        sellerId: 'seller-789',
        artifactBuffer,
        version: '1.0.0'
      });

      const result = validateManifest(manifest);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject manifest with missing required fields', () => {
      const manifest = {
        formatVersion: 1,
        productId: 'resource-123'
        // Missing other required fields
      };

      const result = validateManifest(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes('versionId'))).toBe(true);
    });

    it('should reject invalid format version', () => {
      const manifest = {
        formatVersion: 99,
        productId: 'resource-123',
        versionId: 'version-456',
        artifactId: 'artifact-789',
        sha256: 'a'.repeat(64),
        publisherId: 'seller-123',
        publishedAt: new Date().toISOString(),
        compatibility: {}
      };

      const result = validateManifest(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid or missing formatVersion');
    });

    it('should reject invalid SHA-256 hash', () => {
      const manifest = {
        formatVersion: 1,
        productId: 'resource-123',
        versionId: 'version-456',
        artifactId: 'artifact-789',
        sha256: 'not-a-valid-hash',
        publisherId: 'seller-123',
        publishedAt: new Date().toISOString(),
        compatibility: {}
      };

      const result = validateManifest(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid SHA-256 hash format');
    });

    it('should reject invalid timestamp', () => {
      const manifest = {
        formatVersion: 1,
        productId: 'resource-123',
        versionId: 'version-456',
        artifactId: 'artifact-789',
        sha256: 'a'.repeat(64),
        publisherId: 'seller-123',
        publishedAt: 'not-a-timestamp',
        compatibility: {}
      };

      const result = validateManifest(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid publishedAt timestamp');
    });

    it('should reject non-array dependencies', () => {
      const manifest = {
        formatVersion: 1,
        productId: 'resource-123',
        versionId: 'version-456',
        artifactId: 'artifact-789',
        sha256: 'a'.repeat(64),
        publisherId: 'seller-123',
        publishedAt: new Date().toISOString(),
        dependencies: 'not-an-array',
        compatibility: {}
      };

      const result = validateManifest(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Dependencies must be an array');
    });

    it('should reject missing compatibility object', () => {
      const manifest = {
        formatVersion: 1,
        productId: 'resource-123',
        versionId: 'version-456',
        artifactId: 'artifact-789',
        sha256: 'a'.repeat(64),
        publisherId: 'seller-123',
        publishedAt: new Date().toISOString()
        // Missing compatibility
      };

      const result = validateManifest(manifest);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing or invalid compatibility object');
    });
  });

  describe('parseManifest', () => {
    it('should parse valid manifest JSON', async () => {
      const artifactBuffer = Buffer.from('test');
      
      const original = await generateManifest({
        resourceId: 'resource-123',
        versionId: 'version-456',
        sellerId: 'seller-789',
        artifactBuffer,
        version: '1.0.0'
      });

      const json = JSON.stringify(original);
      const parsed = parseManifest(json);

      expect(parsed.formatVersion).toBe(original.formatVersion);
      expect(parsed.productId).toBe(original.productId);
      expect(parsed.versionId).toBe(original.versionId);
    });

    it('should throw error for invalid JSON', () => {
      expect(() => parseManifest('not valid json')).toThrow();
    });

    it('should throw error for invalid manifest structure', () => {
      const json = JSON.stringify({ invalid: 'manifest' });
      expect(() => parseManifest(json)).toThrow('Invalid manifest');
    });
  });

  describe('serializeManifest', () => {
    it('should serialize manifest to formatted JSON', async () => {
      const artifactBuffer = Buffer.from('test');
      
      const manifest = await generateManifest({
        resourceId: 'resource-123',
        versionId: 'version-456',
        sellerId: 'seller-789',
        artifactBuffer,
        version: '1.0.0'
      });

      const json = serializeManifest(manifest);

      expect(typeof json).toBe('string');
      expect(json).toContain('"formatVersion": 1');
      expect(json).toContain('"productId": "resource-123"');
      
      // Should be formatted (contains newlines)
      expect(json.includes('\n')).toBe(true);
    });

    it('should produce parseable JSON', async () => {
      const artifactBuffer = Buffer.from('test');
      
      const manifest = await generateManifest({
        resourceId: 'resource-123',
        versionId: 'version-456',
        sellerId: 'seller-789',
        artifactBuffer,
        version: '1.0.0'
      });

      const json = serializeManifest(manifest);
      const parsed = JSON.parse(json);

      expect(parsed.formatVersion).toBe(manifest.formatVersion);
    });
  });
});
