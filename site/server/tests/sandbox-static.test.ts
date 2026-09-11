/**
 * TASK-022: Upload Sandbox - Tests
 */

import { describe, it, expect } from 'vitest';
import { validateFile, isAllowedMimeType } from '../src/lib/sandbox/static';
import { DEFAULT_SANDBOX_CONFIG } from '../src/lib/sandbox/types';

describe('Upload Sandbox - Static Validation', () => {
  describe('validateFile', () => {
    it('should accept valid file', () => {
      const result = validateFile('script.lua', 1024, DEFAULT_SANDBOX_CONFIG);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject file too large', () => {
      const result = validateFile(
        'large.lua',
        200 * 1024 * 1024, // 200MB
        DEFAULT_SANDBOX_CONFIG
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too large');
    });

    it('should reject path traversal', () => {
      const result = validateFile('../../../etc/passwd', 100, DEFAULT_SANDBOX_CONFIG);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject absolute paths', () => {
      const result = validateFile('/etc/passwd', 100, DEFAULT_SANDBOX_CONFIG);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject executable patterns', () => {
      const result = validateFile('malware.exe', 100, DEFAULT_SANDBOX_CONFIG);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Suspicious');
    });

    it('should reject system paths', () => {
      const result = validateFile('/proc/self/mem', 100, DEFAULT_SANDBOX_CONFIG);
      expect(result.valid).toBe(false);
    });
  });

  describe('isAllowedMimeType', () => {
    it('should allow ZIP mime types', () => {
      expect(isAllowedMimeType('application/zip')).toBe(true);
      expect(isAllowedMimeType('application/x-zip-compressed')).toBe(true);
      expect(isAllowedMimeType('application/x-compressed')).toBe(true);
    });

    it('should reject non-ZIP mime types', () => {
      expect(isAllowedMimeType('application/pdf')).toBe(false);
      expect(isAllowedMimeType('text/html')).toBe(false);
      expect(isAllowedMimeType('application/javascript')).toBe(false);
    });
  });

  describe('path traversal detection', () => {
    const testCases = [
      { path: 'normal/file.lua', shouldPass: true },
      { path: 'folder/subfolder/file.lua', shouldPass: true },
      { path: '../file.lua', shouldPass: false },
      { path: 'folder/../../../file.lua', shouldPass: false },
      { path: '/etc/passwd', shouldPass: false },
      { path: 'C:\\Windows\\System32', shouldPass: false },
      { path: './../file.lua', shouldPass: false }
    ];

    testCases.forEach(({ path, shouldPass }) => {
      it(`should ${shouldPass ? 'accept' : 'reject'} "${path}"`, () => {
        const result = validateFile(path, 100, DEFAULT_SANDBOX_CONFIG);
        expect(result.valid).toBe(shouldPass);
      });
    });
  });

  describe('suspicious file patterns', () => {
    const suspiciousFiles = [
      'script.exe',
      'library.dll',
      'native.so',
      'binary.dylib',
      '/etc/shadow',
      '/proc/self/mem',
      '/sys/class/net'
    ];

    suspiciousFiles.forEach((file) => {
      it(`should reject suspicious file: ${file}`, () => {
        const result = validateFile(file, 100, DEFAULT_SANDBOX_CONFIG);
        expect(result.valid).toBe(false);
      });
    });
  });

  describe('allowed extensions', () => {
    const allowedFiles = [
      'script.lua',
      'meta.xml',
      'texture.png',
      'image.jpg',
      'model.dff',
      'texture.txd',
      'collision.col',
      'map.map'
    ];

    allowedFiles.forEach((file) => {
      it(`should accept allowed file: ${file}`, () => {
        const result = validateFile(file, 1024, DEFAULT_SANDBOX_CONFIG);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('sandbox config', () => {
    it('should use default config', () => {
      expect(DEFAULT_SANDBOX_CONFIG.maxFileSize).toBe(100 * 1024 * 1024);
      expect(DEFAULT_SANDBOX_CONFIG.maxFileCount).toBe(1000);
      expect(DEFAULT_SANDBOX_CONFIG.maxCompressionRatio).toBe(100);
      expect(DEFAULT_SANDBOX_CONFIG.timeoutSeconds).toBe(60);
      expect(DEFAULT_SANDBOX_CONFIG.cpuLimit).toBe(1);
      expect(DEFAULT_SANDBOX_CONFIG.memoryLimitMb).toBe(512);
    });

    it('should have allowed extensions', () => {
      expect(DEFAULT_SANDBOX_CONFIG.allowedExtensions).toContain('.lua');
      expect(DEFAULT_SANDBOX_CONFIG.allowedExtensions).toContain('.xml');
      expect(DEFAULT_SANDBOX_CONFIG.allowedExtensions).toContain('.png');
    });

    it('should have blocked patterns', () => {
      expect(DEFAULT_SANDBOX_CONFIG.blockedPatterns.length).toBeGreaterThan(0);
    });
  });
});
