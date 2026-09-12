// PLAN D-002/D-003/D-004: registry-driven OAuth identity tests.
// Exercises login (user+account+session creation), identity linking,
// unlinking rules, and the oauth_state CSRF check against a stubbed
// Google provider (global fetch emulation via the shared oauth-harness).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities } from "@tests/tools/helpers/db-reset";
import {
  fetchJsonOk,
  createOAuthFetchStub,
  fullCookie,
  cookieHeader,
  deleteOauthUsersByEmail,
  probeDatabaseAvailable,
} from "@tests/tools/helpers/oauth-harness";

// Configure the fake google provider BEFORE the app (and its provider
// registry side-effect imports) are loaded.
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GOOGLE_REDIRECT_URI = "http://localhost:3001/auth/google/callback";

const app = request(createApp());

// Fixed test-range ids (cleaned by resetTestEntities).
const USER_B_ID = "550e8400-e29b-41d4-a716-446655440201";
const USER_C_ID = "550e8400-e29b-41d4-a716-446655440202";

const dbAvailable = await probeDatabaseAvailable("[identity-link.test]");

// ---------------------------------------------------------------------------
// Google provider emulation through the global fetch stub.
// ---------------------------------------------------------------------------

interface GoogleUserFixture {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

let googleUser: GoogleUserFixture = { sub: "sub-initial" };
let tokenCounter = 0;

const fetchMock = createOAuthFetchStub([
  {
    match: (u) => u.startsWith("https://oauth2.googleapis.com/token"),
    respond: () => {
      tokenCounter += 1;
      return fetchJsonOk({
        access_token: `gat_${tokenCounter}`,
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: `grt_${tokenCounter}`,
        scope: "openid email profile",
      });
    },
  },
  {
    match: (u) => u.startsWith("https://openidconnect.googleapis.com/v1/userinfo"),
    respond: () => fetchJsonOk(googleUser),
  },
]);

// Emails of OAuth-created users (random uuids outside the test prefix range)
// so afterAll can remove them explicitly.
const oauthUserEmails = new Set<string>();

beforeAll(async () => {
  if (!dbAvailable) return;
  vi.stubGlobal("fetch", fetchMock);
  await resetTestEntities();
});

afterAll(async () => {
  if (!dbAvailable) return;
  // OAuth login creates users with random uuids; delete them by email.
  await deleteOauthUsersByEmail(oauthUserEmails);
  await resetTestEntities();
  vi.unstubAllGlobals();
});

/** Run a full Google OAuth login with the current stubbed user. */
async function runGoogleLogin(): Promise<request.Response> {
  const authorize = await app.get("/auth/google");
  expect(authorize.status).toBe(302);

  const location = String(authorize.headers.location);
  const state = new URL(location).searchParams.get("state");
  expect(state).toBeTruthy();

  const callback = await app
    .get(`/auth/google/callback?code=the_code&state=${state}`)
    .set("Cookie", `oauth_state=${state}`);

  return callback;
}

describe.skipIf(!dbAvailable)("google oauth login and identity linking", () => {
  it("returns 404 for unknown and unconfigured providers", async () => {
    const unknown = await app.get("/auth/github");
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("Provider not available");

    // Registered but disabled (no Yandex env in tests).
    const disabled = await app.get("/auth/yandex");
    expect(disabled.status).toBe(404);
    expect(disabled.body.error).toBe("Provider not available");
  });

  it("login creates user + account + session and sets the refresh cookie", async () => {
    googleUser = {
      sub: "sub-g-1",
      email: "g1@gmail.example",
      email_verified: true,
      name: "G One",
    };
    oauthUserEmails.add("g1@gmail.example");

    const authorize = await app.get("/auth/google");
    expect(authorize.status).toBe(302);
    expect(String(authorize.headers.location)).toContain("https://accounts.google.com/o/oauth2/v2/auth");

    // State cookie is HttpOnly and SameSite=Lax.
    const stateCookie = fullCookie(authorize, "oauth_state");
    expect(stateCookie).toBeTruthy();
    expect(stateCookie!.toLowerCase()).toContain("httponly");
    expect(stateCookie!.toLowerCase()).toContain("samesite=lax");

    const state = new URL(String(authorize.headers.location)).searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await app
      .get(`/auth/google/callback?code=the_code&state=${state}`)
      .set("Cookie", `oauth_state=${state}`);

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:3000/auth/callback");

    const refreshCookie = fullCookie(callback, "refresh_token");
    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie!.toLowerCase()).toContain("httponly");

    const user = await db.orm.public.User.where({ email: "g1@gmail.example" }).first();
    expect(user).toBeTruthy();
    expect(user!.emailVerified).toBeTruthy();

    const account = await db.orm.public.Account.where({
      provider: "GOOGLE",
      providerAccountId: "sub-g-1",
    }).first();
    expect(account).toBeTruthy();
    expect(account!.userId).toBe(user!.id);
    expect(account!.accessToken).toBe("gat_1");

    const sessions = await db.orm.public.Session.where({ userId: user!.id }).all();
    expect(sessions.length).toBe(1);
  });

  it("second login with the same subject reuses the same user and one account", async () => {
    googleUser = {
      sub: "sub-g-1",
      email: "g1@gmail.example",
      email_verified: true,
      name: "G One",
    };

    const before = await db.orm.public.User.where({ email: "g1@gmail.example" }).first();
    expect(before).toBeTruthy();

    const callback = await runGoogleLogin();
    expect(callback.status).toBe(302);

    const after = await db.orm.public.User.where({ email: "g1@gmail.example" }).first();
    expect(after!.id).toBe(before!.id);

    const accounts = await db.orm.public.Account.where({
      provider: "GOOGLE",
      providerAccountId: "sub-g-1",
    }).all();
    expect(accounts.length).toBe(1);
  });

  it("linking flow attaches a new identity to the authenticated user", async () => {
    const token = generateAccessToken({
      userId: USER_B_ID,
      email: "user-b@test.local",
      role: "USER",
    });
    await db.orm.public.User.where({ id: USER_B_ID }).delete().catch(() => undefined);
    await db.orm.public.User.create({
      id: USER_B_ID,
      email: "user-b@test.local",
      username: "identity_user_b",
      role: "USER",
      status: "ACTIVE",
    });

    googleUser = {
      sub: "sub-link-1",
      email: "link1@gmail.example",
      email_verified: true,
      name: "Link One",
    };

    const authorize = await app
      .get("/auth/google/link")
      .set("Authorization", `Bearer ${token}`);
    expect(authorize.status).toBe(302);

    const state = new URL(String(authorize.headers.location)).searchParams.get("state");
    expect(state).toBeTruthy();
    expect(cookieHeader(authorize, "link_user")).toBeTruthy();

    const sessionsBefore = (await db.orm.public.Session.where({ userId: USER_B_ID }).all()).length;

    const callback = await app
      .get(`/auth/google/callback?code=the_code&state=${state}`)
      .set("Cookie", [
        `oauth_state=${state}`,
        cookieHeader(authorize, "link_user"),
      ].join("; "));

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:3000/account/identities?linked=1");

    // Identity linked, no user created, no session issued.
    const account = await db.orm.public.Account.where({
      provider: "GOOGLE",
      providerAccountId: "sub-link-1",
    }).first();
    expect(account).toBeTruthy();
    expect(account!.userId).toBe(USER_B_ID);

    const linkedUser = await db.orm.public.User.where({ email: "link1@gmail.example" }).first();
    expect(linkedUser).toBeNull();

    const sessionsAfter = (await db.orm.public.Session.where({ userId: USER_B_ID }).all()).length;
    expect(sessionsAfter).toBe(sessionsBefore);
  });

  it("rejects linking an identity already owned by another user (409)", async () => {
    // sub-owner-1 already logged in via Google (owns the identity).
    googleUser = {
      sub: "sub-owner-1",
      email: "owner1@gmail.example",
      email_verified: true,
      name: "Owner One",
    };
    oauthUserEmails.add("owner1@gmail.example");
    const login = await runGoogleLogin();
    expect(login.status).toBe(302);

    const token = generateAccessToken({
      userId: USER_C_ID,
      email: "user-c@test.local",
      role: "USER",
    });
    await db.orm.public.User.where({ id: USER_C_ID }).delete().catch(() => undefined);
    await db.orm.public.User.create({
      id: USER_C_ID,
      email: "user-c@test.local",
      username: "identity_user_c",
      role: "USER",
      status: "ACTIVE",
    });

    const authorize = await app
      .get("/auth/google/link")
      .set("Authorization", `Bearer ${token}`);
    const state = new URL(String(authorize.headers.location)).searchParams.get("state");

    const callback = await app
      .get(`/auth/google/callback?code=the_code&state=${state}`)
      .set("Cookie", [
        `oauth_state=${state}`,
        cookieHeader(authorize, "link_user"),
      ].join("; "));

    // PLAN-017 §63: конфликт привязки — это браузерный редирект-флоу:
    // сервер возвращает 302 на /account/identities?linked=0&error=…,
    // а не JSON-ошибку в пустой вкладке.
    expect(callback.status).toBe(302);
    expect(String(callback.headers.location)).toContain("/account/identities?linked=0");
    expect(String(callback.headers.location)).toContain("error=identity_conflict");

    // The account still belongs to the original (OAuth-login) user.
    const account = await db.orm.public.Account.where({
      provider: "GOOGLE",
      providerAccountId: "sub-owner-1",
    }).first();
    expect(account).toBeTruthy();
    const owner = await db.orm.public.User.where({ email: "owner1@gmail.example" }).first();
    expect(account!.userId).toBe(owner!.id);
  });

  it("refuses to unlink the only login method (409)", async () => {
    googleUser = {
      sub: "sub-owner-1",
      email: "owner1@gmail.example",
      email_verified: true,
    };
    const owner = await db.orm.public.User.where({ email: "owner1@gmail.example" }).first();
    expect(owner).toBeTruthy();

    const token = generateAccessToken({
      userId: owner!.id,
      email: owner!.email,
      role: owner!.role,
    });

    const list = await app
      .get("/auth/identities")
      .set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBe(1);
    expect(list.body[0].provider).toBe("GOOGLE");
    expect(list.body[0].providerAccountId).toBe("sub-owner-1");

    // SECURITY: no token fields ever leave the API.
    for (const field of ["accessToken", "refreshToken", "idToken", "tokenType", "scope"]) {
      expect(list.body[0]).not.toHaveProperty(field);
    }

    const del = await app
      .delete(`/auth/identities/${list.body[0].id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(409);
    expect(del.body.error).toBe("Cannot unlink the only login method");
  });

  it("unlinks a second identity (200) and removes the account", async () => {
    const owner = await db.orm.public.User.where({ email: "owner1@gmail.example" }).first();
    const token = generateAccessToken({
      userId: owner!.id,
      email: owner!.email,
      role: owner!.role,
    });

    // Link a second Google identity to the same user.
    googleUser = {
      sub: "sub-owner-2",
      email: "owner2@gmail.example",
      email_verified: true,
    };

    const authorize = await app
      .get("/auth/google/link")
      .set("Authorization", `Bearer ${token}`);
    expect(authorize.status).toBe(302);
    const state = new URL(String(authorize.headers.location)).searchParams.get("state");

    const callback = await app
      .get(`/auth/google/callback?code=the_code&state=${state}`)
      .set("Cookie", [
        `oauth_state=${state}`,
        cookieHeader(authorize, "link_user"),
      ].join("; "));
    expect(callback.status).toBe(302);

    const list = await app
      .get("/auth/identities")
      .set("Authorization", `Bearer ${token}`);
    expect(list.body.length).toBe(2);

    const target = list.body.find(
      (i: { providerAccountId: string }) => i.providerAccountId === "sub-owner-1"
    );
    expect(target).toBeTruthy();

    const del = await app
      .delete(`/auth/identities/${target.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    const gone = await db.orm.public.Account.where({ id: target.id }).first();
    expect(gone).toBeNull();

    const remaining = await app
      .get("/auth/identities")
      .set("Authorization", `Bearer ${token}`);
    expect(remaining.body.length).toBe(1);
  });

  it("rejects a callback with a state mismatch (400)", async () => {
    const callback = await app
      .get("/auth/google/callback?code=the_code&state=deadbeef")
      .set("Cookie", "oauth_state=cafebabe");

    expect(callback.status).toBe(400);
    expect(callback.body.error).toBe("Invalid state");
  });
});
