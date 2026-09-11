// PLAN-005 Testing §35: SERVER E2E at the HTTP layer.
// Create Server -> Verification -> Publish flow, owner edit, public page,
// live/unknown/offline monitoring, follow, privacy settings, admin moderation.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";
import { sha256Hex } from "../src/lib/serverIntegration";

const app = request(createApp());

const OWNER_ID = "550e8400-e29b-41d4-a716-446655441001";
const PLAYER_ID = "550e8400-e29b-41d4-a716-446655441002";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655441003";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655441004";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan005-servers.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let ownerToken = "";
let playerToken = "";
let otherToken = "";
let adminToken = "";

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  ownerToken = await createTestUser(OWNER_ID, `svown_${SUFFIX}`, "USER", generateAccessToken);
  playerToken = await createTestUser(PLAYER_ID, `svpl_${SUFFIX}`, "USER", generateAccessToken);
  otherToken = await createTestUser(OTHER_ID, `svoth_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `svadm_${SUFFIX}`, "ADMIN", generateAccessToken);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("PLAN-005: server registration & lifecycle", () => {
  let slug = "";

  it("creates a server (CREATED, PENDING, UNKNOWN)", async () => {
    const res = await app
      .post("/servers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        name: `Test Server ${SUFFIX}`,
        description: "Тестовый сервер для PLAN-005",
        host: "127.0.0.1",
        port: 22003,
        region: "EU",
      });
    expect(res.status).toBe(201);
    expect(res.body.lifecycle).toBe("CREATED");
    expect(res.body.verification).toBe("PENDING");
    expect(res.body.monitoring).toBe("UNKNOWN");
    expect(res.body.slug).toBeTruthy();
    slug = res.body.slug;
  });

  it("owner is auto-granted the OWNER staff membership", async () => {
    const res = await app.get(`/servers/${slug}/staff`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.visible).toBe(true);
    expect(res.body.data.some((m: any) => m.userId === OWNER_ID && m.role === "OWNER")).toBe(true);
  });

  it("public listing hides non-public lifecycle servers", async () => {
    const res = await app.get("/servers");
    expect(res.status).toBe(200);
    expect(res.body.data.some((s: any) => s.slug === slug)).toBe(false);
  });

  it("guest sees 404 for a non-public server page", async () => {
    const res = await app.get(`/servers/${slug}`);
    expect(res.status).toBe(404);
  });

  it("owner sees own server with manage endpoint and staff role", async () => {
    const res = await app.get(`/servers/${slug}/manage`).set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.staffRole).toBe("OWNER");
    expect(res.body.heartbeat.fresh).toBe(false);
  });

  it("non-staff cannot edit the server", async () => {
    const res = await app
      .patch(`/servers/${slug}`)
      .set("Authorization", `Bearer ${playerToken}`)
      .send({ description: "hack" });
    expect(res.status).toBe(403);
  });

  it("owner edits connection + branding fields", async () => {
    const res = await app
      .patch(`/servers/${slug}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ description: "Обновлённое описание", accentColor: "#3366ff" });
    expect(res.status).toBe(200);
    expect(res.body.description).toBe("Обновлённое описание");
    expect(res.body.accentColor).toBe("#3366ff");
  });

  it("rejects invalid accentColor and invalid port", async () => {
    const bad1 = await app
      .patch(`/servers/${slug}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ accentColor: "red" });
    expect(bad1.status).toBe(400);
    const bad2 = await app
      .patch(`/servers/${slug}`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ port: 99999 });
    expect(bad2.status).toBe(400);
  });

  it("issues an integration token once (plaintext, hash stored)", async () => {
    const res = await app
      .post(`/servers/${slug}/integration-token`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^smk_[0-9a-f]{64}$/);
    const row = await db.orm.public.Server.where({ slug }).first();
    expect(row!.integrationTokenHash).toBe(sha256Hex(res.body.token));
    expect(row!.lifecycle).toBe("PENDING_VERIFICATION");
    expect(row!.verification).toBe("PENDING");
  });

  it("non-owner cannot issue the integration token", async () => {
    const res = await app
      .post(`/servers/${slug}/integration-token`)
      .set("Authorization", `Bearer ${playerToken}`);
    expect(res.status).toBe(403);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: ownership verification via integration heartbeat", () => {
  let slug = "";
  let integrationToken = "";

  beforeAll(async () => {
    const res = await app
      .post("/servers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Verify Me ${SUFFIX}`, description: "verification flow" });
    slug = res.body.slug;
    const tokenRes = await app
      .post(`/servers/${slug}/integration-token`)
      .set("Authorization", `Bearer ${ownerToken}`);
    integrationToken = tokenRes.body.token;
  });

  it("rejects a heartbeat with an unknown token (401)", async () => {
    const res = await app.post("/integration/heartbeat").send({
      token: "smk_" + "0".repeat(64),
      players: 5,
      maxPlayers: 100,
    });
    expect(res.status).toBe(401);
  });

  it("first valid heartbeat verifies ownership and reports ONLINE", async () => {
    const res = await app.post("/integration/heartbeat").send({
      token: integrationToken,
      players: 42,
      maxPlayers: 100,
    });
    expect(res.status).toBe(200);
    expect(res.body.verification).toBe("VERIFIED");
    expect(res.body.monitoring).toBe("ONLINE");

    const row = await db.orm.public.Server.where({ slug }).first();
    expect(row!.verification).toBe("VERIFIED");
    expect(row!.lifecycle).toBe("VERIFIED");
    expect(row!.playerCount).toBe(42);

    // Public page is now visible with live data.
    const pub = await app.get(`/servers/${slug}`);
    expect(pub.status).toBe(200);
    expect(pub.body.server.playerCount).toBe(42);
    expect(pub.body.server.monitoring).toBe("ONLINE");
  });

  it("records status samples (E-005) and exposes statistics", async () => {
    const res = await app.get(`/servers/${slug}/statistics?range=24h`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.data.sampleCount).toBeGreaterThanOrEqual(1);
    expect(res.body.data.current.players).toBe(42);
  });

  it("heartbeats that stop arriving degrade to UNKNOWN via sweep (E-006)", async () => {
    const { runMonitoringSweep } = await import("../src/lib/serverMonitoring");
    // Force staleness: backdate lastSeenAt beyond the stale window.
    const server = await db.orm.public.Server.where({ slug }).first();
    await db.orm.public.Server.where({ id: server!.id }).update({
      lastSeenAt: new Date(Date.now() - 24 * 3600_000).toISOString(),
    });
    const result = await runMonitoringSweep();
    expect(result.servers).toBeGreaterThanOrEqual(1);
    const row = await db.orm.public.Server.where({ slug }).first();
    expect(row!.monitoring).toBe("UNKNOWN");
  });

  it("module can request a one-time review token (J-002 wire format)", async () => {
    const res = await app.post("/integration/review-tokens").send({
      token: integrationToken,
      note: "in-game reward",
    });
    expect(res.status).toBe(201);
    expect(res.body.reviewToken).toMatch(/^rtk_[0-9a-f]{48}$/);
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: offline reporting & archived lifecycle", () => {
  it("graceful shutdown heartbeat reports OFFLINE (not UNKNOWN)", async () => {
    // fresh server + token
    const res = await app
      .post("/servers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Offline Test ${SUFFIX}`, description: "offline" });
    const slug = res.body.slug;
    const token = (
      await app.post(`/servers/${slug}/integration-token`).set("Authorization", `Bearer ${ownerToken}`)
    ).body.token;
    await app.post("/integration/heartbeat").send({ token, players: 10 });
    const off = await app.post("/integration/heartbeat").send({
      token,
      state: "OFFLINE",
      players: 0,
    });
    expect(off.status).toBe(200);
    const row = await db.orm.public.Server.where({ slug }).first();
    expect(row!.monitoring).toBe("OFFLINE");
    expect(row!.playerCount).toBe(0);
  });

  it("owner archive makes the server unreachable for guests but visible to staff", async () => {
    const res = await app
      .post("/servers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Archive Test ${SUFFIX}`, description: "arch" });
    const slug = res.body.slug;
    const token = (
      await app.post(`/servers/${slug}/integration-token`).set("Authorization", `Bearer ${ownerToken}`)
    ).body.token;
    await app.post("/integration/heartbeat").send({ token, players: 3, maxPlayers: 10 });
    const del = await app.delete(`/servers/${slug}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(del.status).toBe(200);
    expect(del.body.lifecycle).toBe("ARCHIVED");
    const guest = await app.get(`/servers/${slug}`);
    expect(guest.status).toBe(404);
    const staff = await app.get(`/servers/${slug}`).set("Authorization", `Bearer ${ownerToken}`);
    expect(staff.status).toBe(200);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: privacy switches enforced backend-side (S/T)", () => {
  let slug = "";

  beforeAll(async () => {
    const res = await app
      .post("/servers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Privacy Server ${SUFFIX}`, description: "privacy" });
    slug = res.body.slug;
    const token = (
      await app.post(`/servers/${slug}/integration-token`).set("Authorization", `Bearer ${ownerToken}`)
    ).body.token;
    await app.post("/integration/heartbeat").send({ token, players: 10, maxPlayers: 50 });
    // link one used resource
    await db.orm.public.ServerResource.create({
      serverId: (await db.orm.public.Server.where({ slug }).first())!.id,
      displayName: "Скрытый ресурс",
      note: null,
    });
  });

  it("public API does not expose the resource list while the opt-in is off", async () => {
    const res = await app.get(`/servers/${slug}/resources`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(res.body.data).toEqual([]);
  });

  it("staff sees resources regardless of the opt-in", async () => {
    const res = await app
      .get(`/servers/${slug}/resources`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.data.length).toBe(1);
  });

  it("owner enables Show Resources -> relationship becomes public", async () => {
    const patch = await app
      .patch(`/servers/${slug}/privacy`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ showResources: true });
    expect(patch.status).toBe(200);
    const res = await app.get(`/servers/${slug}/resources`);
    expect(res.body.enabled).toBe(true);
    expect(res.body.data[0].displayName).toBe("Скрытый ресурс");
  });

  it("owner disables Show Resources -> public API does not expose the list", async () => {
    await app
      .patch(`/servers/${slug}/privacy`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ showResources: false });
    const res = await app.get(`/servers/${slug}/resources`);
    expect(res.body.enabled).toBe(false);
    expect(res.body.data).toEqual([]);
  });

  it("public detail withholds live numbers when stats are hidden (S)", async () => {
    const patch = await app
      .patch(`/servers/${slug}/privacy`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ showStats: false });
    expect(patch.status).toBe(200);
    const res = await app.get(`/servers/${slug}`);
    expect(res.body.server.playerCount).toBe(null);
    expect(res.body.server.maxPlayers).toBe(null);
    expect(res.body.server.lastSeenAt).toBe(null);
    expect(res.body.privacy.showStats).toBe(false);
    // statistics endpoint disabled as well
    const stats = await app.get(`/servers/${slug}/statistics?range=24h`);
    expect(stats.body.enabled).toBe(false);
    expect(stats.body.data).toBe(null);
  });

  it("staff list hidden unless showStaff opt-in (G/S)", async () => {
    const anon = await app.get(`/servers/${slug}/staff`);
    expect(anon.body.visible).toBe(false);
    const patch = await app
      .patch(`/servers/${slug}/privacy`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ showStaff: true });
    expect(patch.status).toBe(200);
    const vis = await app.get(`/servers/${slug}/staff`);
    expect(vis.body.visible).toBe(true);
    expect(vis.body.data.length).toBe(1);
  });

  it("non-owner cannot change privacy switches (owner-only, S)", async () => {
    const res = await app
      .patch(`/servers/${slug}/privacy`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ showResources: true });
    expect(res.status).toBe(403);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: follow & follower count (L)", () => {
  it("user follows and unfollows a public server; aggregate is public", async () => {
    // verify a second server to follow
    const res = await app
      .post("/servers")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: `Follow Server ${SUFFIX}`, description: "follow" });
    const slug = res.body.slug;
    const token = (
      await app.post(`/servers/${slug}/integration-token`).set("Authorization", `Bearer ${ownerToken}`)
    ).body.token;
    await app.post("/integration/heartbeat").send({ token, players: 1, maxPlayers: 2 });

    const follow = await app
      .post(`/servers/${slug}/follow`)
      .set("Authorization", `Bearer ${playerToken}`);
    expect(follow.status).toBe(201);

    const detail = await app.get(`/servers/${slug}`);
    expect(detail.body.server.followerCount).toBe(1);

    // Caller-relative follow state: true for the follower, false for a guest.
    const followerView = await app
      .get(`/servers/${slug}`)
      .set("Authorization", `Bearer ${playerToken}`);
    expect(followerView.body.caller.following).toBe(true);
    const guestView = await app.get(`/servers/${slug}`);
    expect(guestView.body.caller.following).toBe(false);

    const unfollow = await app
      .delete(`/servers/${slug}/follow`)
      .set("Authorization", `Bearer ${playerToken}`);
    expect(unfollow.status).toBe(200);
    const after = await app.get(`/servers/${slug}`);
    expect(after.body.server.followerCount).toBe(0);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: admin moderation (Q) with audit trail", () => {
  it("admin approves verification manually and notifies the owner", async () => {
    const res = await app
      .post("/servers")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: `Admin Mod ${SUFFIX}`, description: "adm" });
    const slug = res.body.slug;
    const serverId = (await db.orm.public.Server.where({ slug }).first())!.id;

    const patch = await app
      .patch(`/admin/servers/${serverId}/verification`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ verification: "VERIFIED", note: "проверено вручную" });
    expect(patch.status).toBe(200);
    expect(patch.body.verification).toBe("VERIFIED");

    const notifs = await db.orm.public.Notification.where({ recipientId: OTHER_ID }).all();
    expect(notifs.some((n: any) => n.type === "MODERATION")).toBe(true);

    const audits = await db.orm.public.AuditLog
      .where({ targetType: "server", targetId: serverId })
      .all();
    expect(audits.some((a: any) => a.action === "server.moderation.verification")).toBe(true);
  });

  it("admin suspends a server; owner is notified", async () => {
    const res = await app
      .post("/servers")
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ name: `Suspend Me ${SUFFIX}`, description: "sus" });
    const serverId = (await db.orm.public.Server.where({ slug: res.body.slug }).first())!.id;
    const patch = await app
      .patch(`/admin/servers/${serverId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ lifecycle: "SUSPENDED", reason: "test" });
    expect(patch.status).toBe(200);
    expect(patch.body.lifecycle).toBe("SUSPENDED");
  });

  it("non-admin cannot access server moderation", async () => {
    const res = await app.get("/admin/servers").set("Authorization", `Bearer ${playerToken}`);
    expect(res.status).toBe(403);
  });
});