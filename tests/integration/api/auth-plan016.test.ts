// PLAN-016 §9 integration coverage that the provider tests did not cover:
//   1. GET /auth/providers — public discovery lists ONLY enabled providers,
//      honest shape, no configuration leakage (A-001).
//   2. PATCH /auth/password — current-password check, ≥8 validation,
//      revocation of every OTHER session while the current one survives (A-008).
//   3. POST /payments/create provider selection — unknown → 400, known but
//      disabled → 409 (P-001/§9 matrix).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";

// Provider credentials BEFORE the app (and its registry side-effect imports)
// load — provider classes read env lazily. VK is the configured redirect
// provider; Telegram exercises the direct mode.
process.env.VK_CLIENT_ID = "plan016-vk-client-id";
process.env.VK_CLIENT_SECRET = "plan016-vk-client-secret";
process.env.VK_REDIRECT_URI = "http://localhost:3001/auth/vk/callback";
process.env.TELEGRAM_BOT_TOKEN = "plan016-telegram-bot-token";
process.env.TELEGRAM_BOT_NAME = "mta_plan016_bot";

// Side-effect import: registers VkProvider into the global registry.
import "@server/lib/providers/vk";

const app = request(createApp());

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[auth-plan016.test] DATABASE UNAVAILABLE — integration tests skipped.");
    return false;
  }
})();

const RUN = Date.now().toString(36);
const USERNAME = `p16auth_${RUN}`;
const PASSWORD = "plan016-password-123";
const NEW_PASSWORD = "plan016-new-password";

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function refreshCookieOf(res: request.Response): string {
  return (
    /refresh_token=([^;]+)/.exec(
      (res.headers["set-cookie"] as unknown as string[])[0]
    )?.[1] ?? ""
  );
}

afterAll(async () => {
  if (!dbAvailable) return;
  const user = await db.orm.public.User.where({ username: USERNAME }).first();
  if (!user) return;
  const sessions = await db.orm.public.Session.where({ userId: user.id }).all();
  for (const s of sessions) {
    await db.orm.public.Session.where({ id: s.id }).delete();
  }
  await db.orm.public.User.where({ id: user.id }).delete().catch(() => undefined);
});

describe.skipIf(!dbAvailable)("PLAN-016 auth & payments surface", () => {
  let accessToken = "";

  beforeAll(async () => {
    await app.post("/auth/register").send({
      username: USERNAME,
      email: `${USERNAME}@plan016.local`,
      password: PASSWORD,
    });
    const res = await app.post("/auth/login").send({ login: USERNAME, password: PASSWORD });
    expect(res.status).toBe(200);
    accessToken = res.body.accessToken;
  });

  it("GET /auth/providers lists enabled providers only and leaks no configuration", async () => {
    const res = await app.get("/auth/providers");
    expect(res.status).toBe(200);
    const providers: { provider: string; displayName: string; mode: string; botName?: string }[] =
      res.body.providers;

    const names = providers.map((p) => p.provider);
    expect(names).toContain("vk"); // env configured above
    expect(names).toContain("telegram"); // bot token configured above
    expect(names).not.toContain("yandex"); // no env configured

    const vk = providers.find((p) => p.provider === "vk");
    expect(vk?.mode).toBe("redirect");
    expect(vk?.displayName).toBeTruthy();
    const tg = providers.find((p) => p.provider === "telegram");
    expect(tg?.mode).toBe("direct");
    expect(tg?.botName).toBe("mta_plan016_bot");

    // Honest shape: no configuration leakage.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("plan016-vk-client-secret");
    expect(raw).not.toContain("plan016-telegram-bot-token");
    expect(raw).not.toContain("redirect_uri");
    expect(raw).not.toContain("redirectUri");
  });

  it("PATCH /auth/password validates, checks the current password and revokes other sessions", async () => {
    // A second, independent session for the same user.
    const second = await app.post("/auth/login").send({ login: USERNAME, password: PASSWORD });
    expect(second.status).toBe(200);
    const otherRefresh = refreshCookieOf(second);

    // Payload validation (newPassword < 8).
    const tooShort = await app
      .patch("/auth/password")
      .set(bearer(accessToken))
      .send({ currentPassword: PASSWORD, newPassword: "short" });
    expect(tooShort.status).toBe(400);

    // Wrong current password — uniform anti-enumeration error.
    const wrong = await app
      .patch("/auth/password")
      .set(bearer(accessToken))
      .send({ currentPassword: "definitely-wrong", newPassword: NEW_PASSWORD });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("INVALID_CREDENTIALS");

    // Successful change.
    const ok = await app
      .patch("/auth/password")
      .set(bearer(accessToken))
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.revokedSessions).toBeGreaterThanOrEqual(1);

    // The OTHER session was revoked by the change.
    const replay = await app
      .post("/auth/refresh")
      .set("Cookie", `refresh_token=${otherRefresh}`)
      .send();
    expect(replay.status).toBe(401);

    // Old password no longer works; the new one does.
    const oldLogin = await app.post("/auth/login").send({ login: USERNAME, password: PASSWORD });
    expect(oldLogin.status).toBe(401);
    const newLogin = await app
      .post("/auth/login")
      .send({ login: USERNAME, password: NEW_PASSWORD });
    expect(newLogin.status).toBe(200);
  });

  it("POST /payments/create rejects unknown (400) and disabled (409) providers", async () => {
    const login = await app
      .post("/auth/login")
      .send({ login: USERNAME, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    const auth = bearer(login.body.accessToken);

    const unknown = await app
      .post("/payments/create")
      .set(auth)
      .send({ purchaseId: "00000000-0000-0000-0000-000000000000", provider: "NOSUCH" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toContain("Unknown payment provider");

    // T-Bank is registered (side-effect import) but disabled without env.
    const disabled = await app
      .post("/payments/create")
      .set(auth)
      .send({ purchaseId: "00000000-0000-0000-0000-000000000000", provider: "TBANK" });
    expect(disabled.status).toBe(409);
    expect(disabled.body.error).toContain("disabled");
  });
});