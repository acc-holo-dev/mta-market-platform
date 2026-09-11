/**
 * TASK-022: Upload Sandbox Types
 * 
 * Type definitions for sandbox validation and execution.
 */

export interface StaticValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  fileCount: number;
  totalSize: number;
  suspiciousFiles: string[];
  archiveStructure?: ArchiveEntry[];
}

export interface ArchiveEntry {
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  uncompressedSize: number;
  permissions?: string;
}

export interface SandboxRunOptions {
  artifact: Buffer;
  timeoutSeconds: number;
  cpuLimit: number;
  memoryLimitMb: number;
  networkAllowed: boolean;
}

export interface SandboxRunResult {
  status: 'success' | 'failed' | 'timeout' | 'security_violation';
  exitCode?: number;
  stdout: string;
  stderr: string;
  duration: number;
  compatibilityReport?: CompatibilityReport;
  securityIssues: SecurityIssue[];
}

export interface CompatibilityReport {
  mtaVersion?: {
    min?: string;
    max?: string;
    tested: string[];
  };
  os: ('linux' | 'windows')[];
  architecture: ('x64' | 'x86')[];
  dependencies: Dependency[];
  requiredModules: string[];
  resourceType?: string;
  hasServer?: boolean;
  hasClient?: boolean;
  hasShared?: boolean;
}

export interface Dependency {
  name: string;
  version?: string;
  optional: boolean;
}

export interface SecurityIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  type: string;
  description: string;
  file?: string;
  line?: number;
  recommendation?: string;
}

export interface SandboxConfig {
  maxFileSize: number;          // Bytes
  maxArchiveSize: number;       // Bytes
  maxFileCount: number;
  maxNestingLevel: number;
  maxCompressionRatio: number;
  allowedExtensions: string[];
  blockedPatterns: RegExp[];
  timeoutSeconds: number;
  cpuLimit: number;
  memoryLimitMb: number;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  maxFileSize: 100 * 1024 * 1024,      // 100MB
  maxArchiveSize: 100 * 1024 * 1024,   // 100MB
  maxFileCount: 1000,
  maxNestingLevel: 3,
  maxCompressionRatio: 100,            // 100:1 max compression
  allowedExtensions: ['.lua', '.xml', '.png', '.jpg', '.dff', '.txd', '.col', '.map'],
  blockedPatterns: [
    /\.\./,                            // Path traversal
    /^\/etc\//,                        // System files
    /^\/proc\//,
    /^\/sys\//,
    /\.exe$/i,                         // Executables
    /\.dll$/i,
    /\.so$/i,
    /\.dylib$/i
  ],
  timeoutSeconds: 60,
  cpuLimit: 1,
  memoryLimitMb: 512
};

export interface ContainerConfig {
  image: string;
  cpus: number;
  memory: string;
  network: 'none' | 'bridge';
  user: string;
  readOnly: boolean;
  tmpfs: Record<string, string>;
}

export interface SandboxError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

// Sandbox Error Codes
export const SANDBOX_ERROR_CODES = {
  FILE_TOO_LARGE: 'SANDBOX_FILE_TOO_LARGE',
  TOO_MANY_FILES: 'SANDBOX_TOO_MANY_FILES',
  COMPRESSION_BOMB: 'SANDBOX_COMPRESSION_BOMB',
  PATH_TRAVERSAL: 'SANDBOX_PATH_TRAVERSAL',
  SYMLINK_DETECTED: 'SANDBOX_SYMLINK_DETECTED',
  INVALID_ARCHIVE: 'SANDBOX_INVALID_ARCHIVE',
  MALICIOUS_CONTENT: 'SANDBOX_MALICIOUS_CONTENT',
  EXECUTION_TIMEOUT: 'SANDBOX_EXECUTION_TIMEOUT',
  EXECUTION_FAILED: 'SANDBOX_EXECUTION_FAILED',
  DOCKER_ERROR: 'SANDBOX_DOCKER_ERROR'
} as const;
