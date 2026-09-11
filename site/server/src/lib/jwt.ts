// JWT utility for MTA Market authentication
// TASK A-001/D-005: access and refresh tokens are structurally distinct.
// A refresh token must never be accepted as an access token and vice versa.
// Refresh tokens carry a unique jti so every issued token is distinct
// (rotation auditing; also prevents hash collisions for identical payloads).
import jwt from "jsonwebtoken";
import crypto from "crypto";

if (!process.env.JWT_SECRET) {
  throw new Error(
    "FATAL: JWT_SECRET environment variable is required. Generate with: openssl rand -base64 64"
  );
}

const JWT_SECRET: string = process.env.JWT_SECRET;
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || "15m";
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || "7d";

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
}

interface AccessJWTPayload extends JWTPayload {
  type: "access";
}

interface RefreshJWTPayload extends JWTPayload {
  type: "refresh";
}

export function generateAccessToken(payload: JWTPayload): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign({ ...payload, type: "access" } satisfies AccessJWTPayload, JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRY,
  } as any);
}

export function generateRefreshToken(payload: JWTPayload): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign(
    { ...payload, type: "refresh", jti: crypto.randomBytes(16).toString("hex") },
    JWT_SECRET,
    { expiresIn: JWT_REFRESH_EXPIRY } as any
  );
}

export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AccessJWTPayload;
    // SECURITY: reject refresh tokens presented as access tokens.
    if (decoded.type !== "access") {
      return null;
    }
    return { userId: decoded.userId, email: decoded.email, role: decoded.role };
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as RefreshJWTPayload;
    // SECURITY: reject access tokens presented as refresh tokens.
    if (decoded.type !== "refresh") {
      return null;
    }
    return { userId: decoded.userId, email: decoded.email, role: decoded.role };
  } catch {
    return null;
  }
}