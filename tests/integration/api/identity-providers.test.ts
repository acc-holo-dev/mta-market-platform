// PLAN-016 A-004/A-005: VK ID (redirect OAuth) + Telegram (direct login).
// VK exercises the registry-driven HTTP flow against a stubbed id.vk.com
// (global fetch emulation, same harness as identity.test.ts). Telegram is
// tested at the provider level only: the Login Widget payload verification
// is pure and needs no HTTP/DB (routes are integrated by the parent agent).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { resetTestEntities } from "@tests/tools/helpers/db-reset";
import { TelegramProvider, verifyTelegramLoginPayload } from "@server/lib/providers/telegram";
import { identityProviders } from "@server/lib/identityProvider";

// Configure provider credentials BEFORE the app (and its provider registry
// side-effect imports) are loaded. Provider classes read env lazily.
process.env.VK_CLIENT_ID = "test-vk-client-id";
process.env.VK_CLIENT_SECRET = "test-vk-client-secret";
process.env.VK_REDIRECT_URI = "http://localhost:3001/auth/vk/callback";
process.env.TELEGRAM_BOT_TOKEN = "test-telegram-bot-token";
process.env.TELEGRAM_BOT_NAME = "mta_test_bot";

// Side-effect import: registers VkProvider into the global registry
// (routes/auth.ts gets the same import during parent integration).
import "@server/lib/providers/vk";

const app = request(createApp());
// Cookie jar for the VK round-trip: the callback reads the oauth_state
// cookie set by the authorize response (no manual .set("Cookie") needed).
const agent = request.agent(createApp());

// ---------------------------------------------------------------------------
// VK ID emulation through the global fetch stub.
// ---------------------------------------------------------------------------

interface VkUserFixture {
  user: Array<{
    user_id: string | number;
    email?: string;
    email_verified?: boolean;
    first_name?: string;
    last_name?: string;
    avatar?: string;
  }>;
}

let vkUser: VkUserFixture = { user: [{ user_id: "vk-initial" }] };
let tokenCounter = 0;
// Captured JSON bodies sent to the VK token endpoint (provider contract).
const vkTokenRequests: Record<string, unknown>[] = [];

function jsonOk(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

const fetchMock = vi.fn(async (url: unknown, init?: { body?: unknown }) => {
  const u = String(url);
  if (u.startsWith("https://id.vk.com/oauth2/auth")) {
    tokenCounter += 1;
    vkTokenRequests.push(JSON.parse(String(init?.body ?? "{}")));
    return jsonOk({
      access_token: `vkat_${tokenCounter}`,
      token_type: "Bearer",
      expires_in: 86400,
      refresh_token: `vkrt_${tokenCounter}`,
      scope: "email",
      user_id: "vk-stub-token-user",
    });
  }
  if (u.startsWith("https://id.vk.com/oauth2/user_info")) {
    return jsonOk(vkUser);
  }
  return { ok: false, status: 404, text: async () => "not found", json: async () => ({}) };
});

// Emails of OAuth-created users (random uuids outside the test prefix range)
// so afterAll can remove them explicitly.
const oauthUserEmails = new Set<string>();

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn(
      "[identity-providers.test] DATABASE UNAVAILABLE — VK integration tests skipped. " +
        "Start a PostgreSQL with the contract schema applied (prisma db init)."
    );
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  vi.stubGlobal("fetch", fetchMock);
  await resetTestEntities();
});

afterAll(async () => {
  if (!dbAvailable) return;
  // OAuth login creates users with random uuids; delete them by email.
  for (const email of oauthUserEmails) {
    const user = await db.orm.public.User.where({ email }).first().catch(() => null);
    if (user) {
      const sessions = await db.orm.public.Session.where({ userId: user.id }).all();
      for (const s of sessions) {
        await db.orm.public.Session.where({ id: s.id }).delete().catch(() => undefined);
      }
      const accounts = await db.orm.public.Account.where({ userId: user.id }).all();
      for (const a of accounts) {
        await db.orm.public.Account.where({ id: a.id }).delete().catch(() => undefined);
      }
      await db.orm.public.User.where({ id: user.id }).delete().catch(() => undefined);
    }
  }
  await resetTestEntities();
  vi.unstubAllGlobals();
});

function fullCookie(res: request.Response, name: string): string | undefined {
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  if (!setCookie) return undefined;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.find((c) => c.startsWith(`${name}=`));
}

describe.skipIf(!dbAvailable)("VK ID provider (PLAN-016 A-004)", () => {
  it("GET /auth/vk redirects to the VK ID authorize URL and sets the oauth_state cookie", async () => {
    const authorize = await app.get("/auth/vk");
    expect(authorize.status).toBe(302);

    const location = String(authorize.headers.location);
    expect(location).toContain("https://id.vk.com/authorize");
    const params = new URL(location).searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe("test-vk-client-id");
    expect(params.get("redirect_uri")).toBe("http://localhost:3001/auth/vk/callback");
    expect(params.get("scope")).toBe("email");
    expect(params.get("v")).toBe("5.131");
    expect(params.get("state")).toMatch(/^[0-9a-f]{32}$/);
    // No PKCE — consistent with the other redirect providers.
    expect(params.get("code_challenge")).toBeNull();

    // State cookie is HttpOnly and SameSite=Lax (shared CSRF cookie attrs).
    const stateCookie = fullCookie(authorize, "oauth_state");
    expect(stateCookie).toBeTruthy();
    expect(stateCookie!.toLowerCase()).toContain("httponly");
    expect(stateCookie!.toLowerCase()).toContain("samesite=lax");
  });

  it("rejects a callback with a state mismatch (400)", async () => {
    const callback = await app
      .get("/auth/vk/callback?code=the_code&state=deadbeef")
      .set("Cookie", "oauth_state=cafebabe");

    expect(callback.status).toBe(400);
    expect(callback.body.error).toBe("Invalid state");
  });

  it("login creates user + account + session and redirects to /auth/callback", async () => {
    vkUser = {
      user: [
        {
          user_id: "vk-user-1",
          email: "vk1@example.com",
          email_verified: true,
          first_name: "Ivan",
          last_name: "Petrov",
          avatar: "https://cdn.vk.example/ava1.jpg",
        },
      ],
    };
    oauthUserEmails.add("vk1@example.com");

    // The agent persists the oauth_state cookie from the authorize response.
    const authorize = await agent.get("/auth/vk");
    expect(authorize.status).toBe(302);
    const state = new URL(String(authorize.headers.location)).searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await agent.get(`/auth/vk/callback?code=the_code&state=${state}`);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe("http://localhost:3000/auth/callback");

    const refreshCookie = fullCookie(callback, "refresh_token");
    expect(refreshCookie).toBeTruthy();
    expect(refreshCookie!.toLowerCase()).toContain("httponly");

    // Provider contract: the token exchange posted the VK ID JSON body.
    const tokenBody = vkTokenRequests.at(-1)!;
    expect(tokenBody).toMatchObject({
      grant_type: "authorization_code",
      code: "the_code",
      client_id: "test-vk-client-id",
      client_secret: "test-vk-client-secret",
      redirect_uri: "http://localhost:3001/auth/vk/callback",
      state,
      code_verifier: "",
    });

    const user = await db.orm.public.User.where({ email: "vk1@example.com" }).first();
    expect(user).toBeTruthy();
    expect(user!.emailVerified).toBeTruthy();
    expect(user!.displayName).toBe("Ivan Petrov");
    expect(user!.avatar).toBe("https://cdn.vk.example/ava1.jpg");

    const account = await db.orm.public.Account.where({
      provider: "VK",
      providerAccountId: "vk-user-1",
    }).first();
    expect(account).toBeTruthy();
    expect(account!.userId).toBe(user!.id);
    expect(account!.accessToken).toBe("vkat_1");
    expect(account!.refreshToken).toBe("vkrt_1");

    const sessions = await db.orm.public.Session.where({ userId: user!.id }).all();
    expect(sessions.length).toBe(1);
  });

  it("creates a synthetic @vk.local email when VK provides no email", async () => {
    vkUser = {
      user: [{ user_id: "vk-user-2", first_name: "No", last_name: "Email" }],
    };

    const authorize = await agent.get("/auth/vk");
    expect(authorize.status).toBe(302);
    const state = new URL(String(authorize.headers.location)).searchParams.get("state");

    const callback = await agent.get(`/auth/vk/callback?code=the_code&state=${state}`);
    expect(callback.status).toBe(302);

    const user = await db.orm.public.User.where({ email: "vk-user-2@vk.local" }).first();
    expect(user).toBeTruthy();
    expect(user!.emailVerified).toBeFalsy();
    expect(user!.displayName).toBe("No Email");

    const account = await db.orm.public.Account.where({
      provider: "VK",
      providerAccountId: "vk-user-2",
    }).first();
    expect(account).toBeTruthy();
    expect(account!.userId).toBe(user!.id);
  });
});

// ---------------------------------------------------------------------------
// Telegram direct login (PLAN-016 A-005) — provider-level unit tests.
// ---------------------------------------------------------------------------

const TELEGRAM_BOT_TOKEN = "test-telegram-bot-token";

/** Compute the real Telegram Login Widget signature for a payload. */
function signTelegramPayload(
  payload: Record<string, unknown>,
  botToken: string = TELEGRAM_BOT_TOKEN
): string {
  const dataCheckString = Object.keys(payload)
    .filter((key) => key !== "hash" && payload[key] !== undefined && payload[key] !== null)
    .sort()
    .map((key) => `${key}=${String(payload[key])}`)
    .join("\n");
  const secretKey = crypto.createHash("sha256").update(botToken, "utf8").digest();
  return crypto.createHmac("sha256", secretKey).update(dataCheckString, "utf8").digest("hex");
}

function makePayload(id: number, authDateSeconds: number): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id,
    first_name: "Tale",
    last_name: "Racer",
    username: `tale_${id}`,
    photo_url: `https://t.me/i/userpic/${id}.jpg`,
    auth_date: authDateSeconds,
  };
  payload.hash = signTelegramPayload(payload);
  return payload;
}

describe("Telegram provider (PLAN-016 A-005, direct login)", () => {
  it("verifies a validly signed Login Widget payload", () => {
    const nowMs = Date.now();
    const payload = makePayload(900000123, Math.floor(nowMs / 1000));

    const user = verifyTelegramLoginPayload(payload, TELEGRAM_BOT_TOKEN, nowMs);

    expect(user.providerId).toBe("900000123");
    expect(user.username).toBe("tale_900000123");
    expect(user.displayName).toBe("Tale Racer");
    expect(user.avatar).toBe("https://t.me/i/userpic/900000123.jpg");
    expect(user.verified).toBe(false);
    expect(user.email).toBeUndefined();
    expect(user.metadata?.raw).toBe(payload);
  });

  it("rejects a tampered payload (signature mismatch)", () => {
    const nowMs = Date.now();
    const payload = makePayload(900000124, Math.floor(nowMs / 1000));
    payload.first_name = "Evil";

    expect(() =>
      verifyTelegramLoginPayload(payload, TELEGRAM_BOT_TOKEN, nowMs)
    ).toThrow("Telegram login signature mismatch");
  });

  it("rejects a hash of the wrong length without crashing timingSafeEqual", () => {
    const nowMs = Date.now();
    const payload = makePayload(900000125, Math.floor(nowMs / 1000));
    payload.hash = "short";

    expect(() =>
      verifyTelegramLoginPayload(payload, TELEGRAM_BOT_TOKEN, nowMs)
    ).toThrow("Telegram login signature mismatch");
  });

  it("rejects a payload signed with a different bot token", () => {
    const nowMs = Date.now();
    const payload = makePayload(900000126, Math.floor(nowMs / 1000));

    expect(() =>
      verifyTelegramLoginPayload(payload, "another-bot-token", nowMs)
    ).toThrow("Telegram login signature mismatch");
  });

  it("rejects a stale auth_date (older than 24 h)", () => {
    const nowMs = Date.now();
    const stale = Math.floor(nowMs / 1000) - 25 * 60 * 60;
    const payload = makePayload(900000127, stale);

    expect(() =>
      verifyTelegramLoginPayload(payload, TELEGRAM_BOT_TOKEN, nowMs)
    ).toThrow("Telegram login expired");
  });

  it("rejects a payload missing required fields", () => {
    expect(() => verifyTelegramLoginPayload({}, TELEGRAM_BOT_TOKEN, Date.now())).toThrow(
      "Telegram login payload is missing user id"
    );
    expect(() =>
      verifyTelegramLoginPayload({ id: 1 }, TELEGRAM_BOT_TOKEN, Date.now())
    ).toThrow("Telegram login payload is missing auth_date");
    expect(() =>
      verifyTelegramLoginPayload({ id: 1, auth_date: Math.floor(Date.now() / 1000) }, TELEGRAM_BOT_TOKEN, Date.now())
    ).toThrow("Telegram login payload is missing hash");
  });

  it("verifyDirectLogin maps the payload and rejects a replayed one", async () => {
    const provider = new TelegramProvider();
    const payload = makePayload(777000111, Math.floor(Date.now() / 1000));

    const first = await provider.verifyDirectLogin({ payload, sourceIp: "127.0.0.1" });
    expect(first.providerId).toBe("777000111");
    expect(first.email).toBeUndefined();

    await expect(
      provider.verifyDirectLogin({ payload, sourceIp: "127.0.0.1" })
    ).rejects.toThrow("Telegram login replay detected");
  });

  it("exposes the direct-mode interface contract (no redirect OAuth)", async () => {
    const provider = new TelegramProvider();

    expect(provider.name).toBe("telegram");
    expect(provider.displayName).toBe("Telegram");
    expect(provider.mode).toBe("direct");
    expect(provider.isEnabled()).toBe(true);
    expect(provider.getRedirectUri()).toBe("");
    expect(provider.botName).toBe("mta_test_bot");

    expect(() => provider.getAuthorizationUrl({ redirectUri: "https://x" })).toThrow(
      "Telegram uses direct login (Login Widget)"
    );
    await expect(
      provider.handleCallback({ code: "c", redirectUri: "" })
    ).rejects.toThrow("Telegram Login Widget does not use code exchange");
    await expect(provider.getUserInfo("t")).rejects.toThrow(
      "Telegram does not expose an API token for user info"
    );
  });

  it("is disabled without TELEGRAM_BOT_TOKEN and self-registers into the registry", () => {
    const provider = new TelegramProvider();

    const original = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
    try {
      expect(provider.isEnabled()).toBe(false);
    } finally {
      process.env.TELEGRAM_BOT_TOKEN = original;
    }

    expect(identityProviders.get("telegram")).toBeInstanceOf(TelegramProvider);
  });
});
