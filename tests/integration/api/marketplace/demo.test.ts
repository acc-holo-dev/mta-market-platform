// PLAN-018 M: live demo session integration tests.
// Flag gate (404), per-user + global caps (409), happy path (RUNNING with
// honest connectionInfo or honest FAILED), TTL sweep → DESTROYED, admin queue.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { UPLOAD_DIR, resolveLocalUploadPath } from "@server/lib/upload";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";
import { buildZip } from "@tests/tools/helpers/zip";

// Live demo is flag-gated on feature.live_demo (FEATURE_LIVE_DEMO override).
process.env.FEATURE_LIVE_DEMO = "true";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655440040";
const U1 = "550e8400-e29b-41d4-a716-446655440041";
const U2 = "550e8400-e29b-41d4-a716-446655440042";
const U3 = "550e8400-e29b-41d4-a716-446655440043";
const U4 = "550e8400-e29b-41d4-a716-446655440044";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440045";
const SUFFIX = Date.now().toString(36);
const SLUG = `demo-test-${SUFFIX}`;
const ARTIFACT_NAME = `demo-artifact-${SUFFIX}.zip`;

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[demo.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

const ARTIFACT = buildZip([
  { path: "resource/meta.xml", content: "<meta><info type='script'/></meta>" },
  { path: "resource/main.lua", content: "print('demo')" },
]);

let sellerToken = "";
let u1 = "";
let u2 = "";
let u3 = "";
let u4 = "";
let adminToken = "";
let slug = "";

let u1Session = "";
let u2Session = "";
let u3Session = "";

async function cleanup(): Promise<void> {
  await resetTestEntities();
  const fixture = resolveLocalUploadPath(`/uploads/${ARTIFACT_NAME}`);
  if (fixture && fs.existsSync(fixture)) fs.unlinkSync(fixture);
}

/** Poll a demo session until it reaches a terminal/transient state. */
async function waitForSettled(
  token: string,
  sessionId: string,
  timeoutMs = 8000
): Promise<{ status: string; body: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  let last = { status: "", body: {} as Record<string, unknown> };
  while (Date.now() < deadline) {
    const res = await app.get(`/demo/${sessionId}`).set("Authorization", `Bearer ${token}`);
    last = { status: String(res.body?.status ?? ""), body: res.body ?? {} };
    if (["RUNNING", "FAILED", "DESTROYED"].includes(last.status)) return last;
    await new Promise((r) => setTimeout(r, 150));
  }
  return last;
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await cleanup();

  sellerToken = await createTestUser(SELLER_ID, `dseller_${SUFFIX}`, "USER", generateAccessToken);
  u1 = await createTestUser(U1, `du1_${SUFFIX}`, "USER", generateAccessToken);
  u2 = await createTestUser(U2, `du2_${SUFFIX}`, "USER", generateAccessToken);
  u3 = await createTestUser(U3, `du3_${SUFFIX}`, "USER", generateAccessToken);
  u4 = await createTestUser(U4, `du4_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `dadmin_${SUFFIX}`, "ADMIN", generateAccessToken);

  fs.writeFileSync(path.resolve(UPLOAD_DIR, ARTIFACT_NAME), ARTIFACT);

  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: SLUG,
    title: "Demo Test",
    description: "desc",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 1000,
  });
  await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/${ARTIFACT_NAME}`,
    fileSize: ARTIFACT.length,
    fileChecksum: "cafef00d".repeat(4),
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await cleanup();
  process.env.FEATURE_LIVE_DEMO = "false";
});

describe.skipIf(!dbAvailable)("live demo — gating and caps", () => {
  it("unauthenticated start is 401", async () => {
    const res = await app.post(`/resources/${SLUG}/demo`);
    expect(res.status).toBe(401);
  });

  it("flag OFF → 404 (route hidden)", async () => {
    process.env.FEATURE_LIVE_DEMO = "false";
    const res = await app.post(`/resources/${SLUG}/demo`).set("Authorization", `Bearer ${u1}`);
    expect(res.status).toBe(404);
    process.env.FEATURE_LIVE_DEMO = "true";
  });

  it("unknown/unpublished resource → 404", async () => {
    const res = await app
      .post("/resources/does-not-exist-xyz/demo")
      .set("Authorization", `Bearer ${u1}`);
    expect(res.status).toBe(404);
  });

  it("happy path: STARTING → RUNNING with honest connectionInfo (or honest FAILED)", async () => {
    const res = await app.post(`/resources/${SLUG}/demo`).set("Authorization", `Bearer ${u1}`);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("STARTING");
    expect(res.body.expiresAt).toBeTruthy();
    u1Session = res.body.sessionId;

    const settled = await waitForSettled(u1, u1Session);
    // The mock sandbox runner reports success → RUNNING with connectionInfo.
    // An honest FAILED (with failureReason) is equally accepted by contract.
    expect(["RUNNING", "FAILED"]).toContain(settled.status);
    if (settled.status === "RUNNING") {
      const info = settled.body.connectionInfo as Record<string, unknown>;
      expect(info.message).toBe("demo session");
      expect(String(info.ref)).toContain("demorun-");
      expect(settled.body.ttlRemainingSeconds).toBeGreaterThan(0);
    } else {
      expect(settled.body.failureReason).toBeTruthy();
    }
  });

  it("per-user cap: second active demo → 409 (user scope)", async () => {
    const res = await app.post(`/resources/${SLUG}/demo`).set("Authorization", `Bearer ${u1}`);
    expect(res.status).toBe(409);
    expect(res.body.scope).toBe("user");
  });

  it("global cap: 3rd fills up, 4th user → 409 (global scope)", async () => {
    const r2 = await app.post(`/resources/${SLUG}/demo`).set("Authorization", `Bearer ${u2}`);
    expect(r2.status).toBe(201);
    u2Session = r2.body.sessionId;
    const r3 = await app.post(`/resources/${SLUG}/demo`).set("Authorization", `Bearer ${u3}`);
    expect(r3.status).toBe(201);
    u3Session = r3.body.sessionId;

    const r4 = await app.post(`/resources/${SLUG}/demo`).set("Authorization", `Bearer ${u4}`);
    expect(r4.status).toBe(409);
    expect(r4.body.scope).toBe("global");
  });
});

describe.skipIf(!dbAvailable)("live demo — status access control", () => {
  it("stranger cannot read someone else's session (403)", async () => {
    const res = await app.get(`/demo/${u1Session}`).set("Authorization", `Bearer ${u4}`);
    expect(res.status).toBe(403);
  });

  it("owner reads TTL + connectionInfo; admin can read too", async () => {
    const owner = await app.get(`/demo/${u1Session}`).set("Authorization", `Bearer ${u1}`);
    expect(owner.status).toBe(200);
    expect(owner.body.expiresAt).toBeTruthy();
    expect(owner.body).toHaveProperty("ttlRemainingSeconds");

    const admin = await app.get(`/demo/${u1Session}`).set("Authorization", `Bearer ${adminToken}`);
    expect(admin.status).toBe(200);
  });

  it("stranger cannot destroy (403); owner destroy → DESTROYED", async () => {
    const stranger = await app.delete(`/demo/${u3Session}`).set("Authorization", `Bearer ${u4}`);
    expect(stranger.status).toBe(403);

    const owner = await app.delete(`/demo/${u3Session}`).set("Authorization", `Bearer ${u3}`);
    expect(owner.status).toBe(200);
    expect(owner.body.status).toBe("DESTROYED");

    const check = await app.get(`/demo/${u3Session}`).set("Authorization", `Bearer ${u3}`);
    expect(check.body.status).toBe("DESTROYED");
  });
});

describe.skipIf(!dbAvailable)("live demo — admin surface and TTL sweep", () => {
  it("non-admin cannot access the queue (403)", async () => {
    const res = await app.get("/admin/demo").set("Authorization", `Bearer ${u4}`);
    expect(res.status).toBe(403);
  });

  it("admin queue lists sessions with status filter", async () => {
    const res = await app.get("/admin/demo").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);

    const destroyed = await app
      .get("/admin/demo?status=DESTROYED")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(destroyed.status).toBe(200);
    expect(destroyed.body.data.some((s: { id: string }) => s.id === u3Session)).toBe(true);
  });

  it("manual sweep expires an overdue session → DESTROYED", async () => {
    // Force u2's session past its TTL.
    await db.orm.public.DemoSession.where({ id: u2Session }).update({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const res = await app.post("/admin/demo/sweep").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.swept).toBeGreaterThanOrEqual(1);
    expect(res.body.destroyed).toContain(u2Session);

    const check = await app.get(`/demo/${u2Session}`).set("Authorization", `Bearer ${u2}`);
    expect(check.body.status).toBe("DESTROYED");
  });

  it("non-admin cannot trigger the sweep (403)", async () => {
    const res = await app.post("/admin/demo/sweep").set("Authorization", `Bearer ${u4}`);
    expect(res.status).toBe(403);
  });
});