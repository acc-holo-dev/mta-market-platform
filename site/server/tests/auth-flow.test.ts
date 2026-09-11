// TASK A-001/A-002: Browser auth flow integration tests.
// Exercises the cookie-based session lifecycle over real HTTP (supertest):
// refresh with cookie, rotation, reuse detection, logout, and the
// refresh-token-is-not-an-access-token rule.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken, generateRefreshToken } from "../src/lib/jwt";
import { hashRefreshToken, generateTokenId } from "../src/lib/tokenSecurity";

const app = request(createApp());

const TEST_EMAIL = "auth-flow-test@example.local";
const USER_ID = "550e8400-e29b-41d4-a716-446655440001";

// Decided at file load time so describe.skipIf sees the real value.
const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn(
      "[auth-flow.test] DATABASE UNAVAILABLE — integration tests skipped. " +
        "Start a PostgreSQL with the contract schema applied (prisma db init)."
    );
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;

  // Clean slate for the test user
  const oldSessions = await db.orm.public.Session.where({ userId: USER_ID }).all();
  for (const s of oldSessions) {
    await db.orm.public.Session.where({ id: s.id }).delete();
  }
  await db.orm.public.User.where({ id: USER_ID }).delete().catch(() => undefined);

  await db.orm.public.User.create({
    id: USER_ID,
    email: TEST_EMAIL,
    username: "auth_flow_test",
    displayName: "Auth Flow Test",
    role: "USER",
    status: "ACTIVE",
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  const sessions = await db.orm.public.Session.where({ userId: USER_ID }).all();
  for (const s of sessions) {
    await db.orm.public.Session.where({ id: s.id }).delete();
  }
  await db.orm.public.User.where({ id: USER_ID }).delete().catch(() => undefined);
});

/** Create a session row for the test user and return the raw refresh token. */
async function createSession(): Promise<{ refreshToken: string; tokenFamily: string }> {
  const refreshToken = generateRefreshToken({
    userId: USER_ID,
    email: TEST_EMAIL,
    role: "USER",
  });
  const tokenFamily = generateTokenId();
  await db.orm.public.Session.create({
    userId: USER_ID,
    refreshTokenHash: hashRefreshToken(refreshToken),
    tokenFamily,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
  });
  return { refreshToken, tokenFamily };
}

describe.skipIf(!dbAvailable)("auth cookie flow", () => {
  it("POST /auth/refresh without cookie -> 401", async () => {
    const res = await app.post("/auth/refresh");
    expect(res.status).toBe(401);
  });

  it("refresh with cookie rotates the token and sets a new HttpOnly cookie", async () => {
    const { refreshToken } = await createSession();

    const res = await app
      .post("/auth/refresh")
      .set("Cookie", `refresh_token=${refreshToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();

    // Rotation: a new refresh cookie is set
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie).toBeTruthy();
    const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    expect(cookie).toContain("refresh_token=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=");
  });

  it("replaying the OLD refresh token triggers reuse detection and revokes the family", async () => {
    const { refreshToken, tokenFamily } = await createSession();

    // First (legitimate) use rotates the token
    const first = await app
      .post("/auth/refresh")
      .set("Cookie", `refresh_token=${refreshToken}`)
      .send();
    expect(first.status).toBe(200);

    // Replay of the same (now poisoned) token must be rejected
    const replay = await app
      .post("/auth/refresh")
      .set("Cookie", `refresh_token=${refreshToken}`)
      .send();
    expect(replay.status).toBe(401);
    expect(replay.body.error).toContain("reuse");

    // The whole token family must be revoked: the NEW token from the first
    // response no longer works either.
    const newCookie = (first.headers["set-cookie"] as unknown as string[])[0];
    const newToken = /refresh_token=([^;]+)/.exec(newCookie)![1];
    const withNewToken = await app
      .post("/auth/refresh")
      .set("Cookie", `refresh_token=${newToken}`)
      .send();
    expect(withNewToken.status).toBe(401);

    // All family sessions are gone from the DB
    const remaining = await db.orm.public.Session.where({ tokenFamily }).all();
    expect(remaining.length).toBe(0);
  });

  it("logout deletes the session and clears the cookie", async () => {
    const { refreshToken } = await createSession();

    const res = await app
      .post("/auth/logout")
      .set("Cookie", `refresh_token=${refreshToken}`)
      .send();
    expect(res.status).toBe(200);

    const cleared = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cleared).toContain("refresh_token=;");

    // Session is gone: refresh with the same token fails
    const after = await app
      .post("/auth/refresh")
      .set("Cookie", `refresh_token=${refreshToken}`)
      .send();
    expect(after.status).toBe(401);
  });

  it("GET /auth/me accepts an access token", async () => {
    const accessToken = generateAccessToken({
      userId: USER_ID,
      email: TEST_EMAIL,
      role: "USER",
    });
    const res = await app.get("/auth/me").set("Authorization", `Bearer ${accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(TEST_EMAIL);
    expect(typeof res.body.id).toBe("string");
  });

  it("GET /auth/me rejects a refresh token used as an access token", async () => {
    const { refreshToken } = await createSession();
    const res = await app.get("/auth/me").set("Authorization", `Bearer ${refreshToken}`);
    expect(res.status).toBe(401);
  });

  it("GET /auth/me rejects requests without a token", async () => {
    const res = await app.get("/auth/me");
    expect(res.status).toBe(401);
  });
});