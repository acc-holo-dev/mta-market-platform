// TASK A-001: JWT type distinction unit tests (no DB required).
// Access and refresh tokens must be structurally distinct: a refresh token
// must never verify as an access token and vice versa (PLAN D-005).
import { describe, it, expect } from "vitest";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from "../src/lib/jwt";

const payload = { userId: "550e8400-e29b-41d4-a716-446655440000", email: "u@test.local", role: "USER" };

describe("JWT token type distinction", () => {
  it("verifies a valid access token", () => {
    const token = generateAccessToken(payload);
    const decoded = verifyAccessToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe(payload.userId);
    expect(decoded!.email).toBe(payload.email);
    expect(decoded!.role).toBe(payload.role);
  });

  it("verifies a valid refresh token", () => {
    const token = generateRefreshToken(payload);
    const decoded = verifyRefreshToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded!.userId).toBe(payload.userId);
  });

  it("rejects a refresh token presented as an access token", () => {
    const refreshToken = generateRefreshToken(payload);
    expect(verifyAccessToken(refreshToken)).toBeNull();
  });

  it("rejects an access token presented as a refresh token", () => {
    const accessToken = generateAccessToken(payload);
    expect(verifyRefreshToken(accessToken)).toBeNull();
  });

  it("rejects a token without a type claim (legacy tokens)", () => {
    // Simulate a legacy token signed with the same secret but no type claim.
    const jwt = require("jsonwebtoken");
    const legacy = jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: "15m" });
    expect(verifyAccessToken(legacy)).toBeNull();
    expect(verifyRefreshToken(legacy)).toBeNull();
  });

  it("rejects garbage tokens", () => {
    expect(verifyAccessToken("not-a-token")).toBeNull();
    expect(verifyRefreshToken("not-a-token")).toBeNull();
  });
});