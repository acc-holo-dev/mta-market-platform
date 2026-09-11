// Refresh token security utilities
import crypto from "crypto";

/**
 * Hash a refresh token for secure database storage
 * Uses SHA-256 (fast, one-way, sufficient for tokens)
 * 
 * @param token - Raw refresh token (JWT)
 * @returns SHA-256 hash in hex format
 */
export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a cryptographically secure token ID for reuse detection
 * 
 * @returns Random 32-byte hex string
 */
export function generateTokenId(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Verify a raw refresh token against its hash
 * 
 * @param token - Raw refresh token to verify
 * @param hash - Stored hash from database
 * @returns true if token matches hash
 */
export function verifyRefreshTokenHash(token: string, hash: string): boolean {
  const tokenHash = hashRefreshToken(token);
  return crypto.timingSafeEqual(Buffer.from(tokenHash), Buffer.from(hash));
}
