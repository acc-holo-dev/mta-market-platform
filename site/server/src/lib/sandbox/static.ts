/**
 * TASK-022: Upload Sandbox - Static Validation
 * 
 * Static analysis of uploaded artifacts before sandbox execution.
 */

import { PassThrough } from 'stream';
import { Parse } from 'unzipper';
import type {
  StaticValidationResult,
  ArchiveEntry,
  SandboxConfig
} from './types';
import { DEFAULT_SANDBOX_CONFIG, SANDBOX_ERROR_CODES } from './types';

/**
 * Validate uploaded artifact statically
 * 
 * Performs checks without executing the artifact:
 * - File size
 * - Archive structure
 * - Path traversal
 * - Symlinks
 * - Compression bombs
 * - File count
 * 
 * @param buffer - Artifact file buffer
 * @param config - Sandbox configuration
 * @returns Validation result
 */
export async function validateArchive(
  buffer: Buffer,
  config: SandboxConfig = DEFAULT_SANDBOX_CONFIG
): Promise<StaticValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suspiciousFiles: string[] = [];
  const entries: ArchiveEntry[] = [];

  // 1. File size check
  if (buffer.length > config.maxArchiveSize) {
    return {
      valid: false,
      errors: [
        `Archive too large: ${(buffer.length / 1024 / 1024).toFixed(2)}MB (max ${(config.maxArchiveSize / 1024 / 1024).toFixed(0)}MB)`
      ],
      warnings: [],
      fileCount: 0,
      totalSize: buffer.length,
      suspiciousFiles: []
    };
  }

  try {
    // 2. Extract and analyze archive structure
    const { entries: extractedEntries, totalUncompressed } = await extractArchiveInfo(buffer);
    entries.push(...extractedEntries);

    // 3. File count check
    const fileCount = entries.filter(e => e.type === 'file').length;
    if (fileCount > config.maxFileCount) {
      errors.push(
        `Too many files: ${fileCount} (max ${config.maxFileCount})`
      );
    }

    // 4. Compression ratio check (bomb detection)
    const compressionRatio = totalUncompressed / buffer.length;
    if (compressionRatio > config.maxCompressionRatio) {
      errors.push(
        `Compression bomb detected: ${compressionRatio.toFixed(0)}:1 ratio (max ${config.maxCompressionRatio}:1)`
      );
    }

    // 5. Path traversal check
    for (const entry of entries) {
      if (hasPathTraversal(entry.path)) {
        errors.push(`Path traversal detected: ${entry.path}`);
      }
    }

    // 6. Symlink check
    const symlinks = entries.filter(e => e.type === 'symlink');
    if (symlinks.length > 0) {
      errors.push(
        `Symlinks not allowed: ${symlinks.map(s => s.path).join(', ')}`
      );
    }

    // 7. Nesting level check
    const maxDepth = Math.max(...entries.map(e => getPathDepth(e.path)));
    if (maxDepth > config.maxNestingLevel) {
      warnings.push(
        `Deep nesting detected: ${maxDepth} levels (recommended max ${config.maxNestingLevel})`
      );
    }

    // 8. Suspicious file detection
    for (const entry of entries) {
      if (isSuspiciousFile(entry.path, config)) {
        suspiciousFiles.push(entry.path);
        warnings.push(`Suspicious file: ${entry.path}`);
      }
    }

    // 9. Extension check
    for (const entry of entries) {
      if (entry.type === 'file') {
        const ext = getFileExtension(entry.path);
        if (ext && !config.allowedExtensions.includes(ext)) {
          warnings.push(`Unusual file extension: ${entry.path}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      fileCount,
      totalSize: buffer.length,
      suspiciousFiles,
      archiveStructure: entries
    };
  } catch (error) {
    return {
      valid: false,
      errors: [
        `Failed to validate archive: ${error instanceof Error ? error.message : 'Unknown error'}`
      ],
      warnings: [],
      fileCount: 0,
      totalSize: buffer.length,
      suspiciousFiles: []
    };
  }
}

/**
 * Extract archive information without extracting files
 */
async function extractArchiveInfo(buffer: Buffer): Promise<{
  entries: ArchiveEntry[];
  totalUncompressed: number;
}> {
  const entries: ArchiveEntry[] = [];
  let totalUncompressed = 0;

  return new Promise((resolve, reject) => {
    // PLAN B-001: static analysis must NOT touch the host filesystem.
    // Parse inspects entries in memory (autodrain discards content);
    // the previous Extract({path}) actually wrote files to a fixed temp dir.
    const parse = Parse();

    parse.on('entry', (entry: any) => {
      const archiveEntry: ArchiveEntry = {
        path: entry.path,
        type: entry.type === 'Directory' ? 'directory' :
              entry.type === 'SymbolicLink' ? 'symlink' : 'file',
        size: entry.vars?.compressedSize || 0,
        uncompressedSize: entry.vars?.uncompressedSize || 0,
        permissions: entry.props?.mode?.toString(8)
      };

      entries.push(archiveEntry);
      totalUncompressed += archiveEntry.uncompressedSize;

      entry.autodrain();
    });

    parse.on('finish', () => {
      resolve({ entries, totalUncompressed });
    });

    parse.on('error', (error: Error) => {
      reject(error);
    });

    // Pipe buffer to parse
    const bufferStream = new PassThrough();
    bufferStream.end(buffer);
    bufferStream.pipe(parse);
  });
}

/**
 * Check if path contains traversal attempts
 */
function hasPathTraversal(path: string): boolean {
  // Normalize path and check for ..
  const normalized = path.replace(/\\/g, '/');
  
  // Check for ../ or ../
  if (normalized.includes('../') || normalized.includes('..\\')) {
    return true;
  }
  
  // Check for absolute paths (starting with /)
  if (normalized.startsWith('/')) {
    return true;
  }
  
  // Check for drive letters (Windows)
  if (/^[a-zA-Z]:/.test(normalized)) {
    return true;
  }
  
  return false;
}

/**
 * Get path depth (number of directory levels)
 */
function getPathDepth(path: string): number {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(p => p.length > 0);
  return parts.length;
}

/**
 * Check if file is suspicious based on patterns
 */
function isSuspiciousFile(path: string, config: SandboxConfig): boolean {
  for (const pattern of config.blockedPatterns) {
    if (pattern.test(path)) {
      return true;
    }
  }
  return false;
}

/**
 * Get file extension
 */
function getFileExtension(path: string): string | null {
  const match = path.match(/\.([^.]+)$/);
  return match ? match[0] : null;
}

/**
 * Validate individual file
 */
export function validateFile(
  path: string,
  size: number,
  config: SandboxConfig = DEFAULT_SANDBOX_CONFIG
): { valid: boolean; error?: string } {
  // File size check
  if (size > config.maxFileSize) {
    return {
      valid: false,
      error: `File too large: ${(size / 1024 / 1024).toFixed(2)}MB`
    };
  }

  // Path traversal check
  if (hasPathTraversal(path)) {
    return {
      valid: false,
      error: 'Path traversal detected'
    };
  }

  // Suspicious file check
  if (isSuspiciousFile(path, config)) {
    return {
      valid: false,
      error: 'Suspicious file pattern'
    };
  }

  return { valid: true };
}

/**
 * Check if MIME type is allowed
 */
export function isAllowedMimeType(mimeType: string): boolean {
  const allowed = [
    'application/zip',
    'application/x-zip-compressed',
    'application/x-compressed',
    'multipart/x-zip'
  ];
  
  return allowed.includes(mimeType);
}
