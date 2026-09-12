// PLAN-017 H integration tests: premium entitlement foundation.
// Covers: plans catalog honesty (available flags), idempotent grants,
// unknown-subject 404, revocation semantics, audit rows, owner notifications,
// subject labels + expiry handling, feature-flag honesty (404 when off,
// plans always answer).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";
import { hasEntitlement } from "@server/lib/entitlements";

const app = request(createApp());

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655447601";
const MOD_ID = "550e8400-e29b-41d4-a716-446655447602";
const USER_ID = "550e8400-e29b-41d4-a716-446655447603";
const RESOURCE_ID = "550e8400-e29b-41d4-a716-4466554476a1";
const SERVER_ID = "550e8400-e29b-41d4-a716-4466554476b1";
const UNKNOWN_SUBJECT_ID = "550e8400-e29b-41d4-a716-4466554476c1";
const SUFFIX = Date.now().toString(36);

let adminToken = "";
let modToken = "";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[premium.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  // FEATURE_* env override contract (lib/featureFlags.ts): forced on —
  // config/application/features.yaml has premium: false.
  process.env.FEATURE_PREMIUM = "true";
  await resetTestEntities();
  adminToken = await createTestUser(ADMIN_ID, `pradmin_${SUFFIX}`, "ADMIN", generateAccessToken);
  modToken = await createTestUser(MOD_ID, `prmod_${SUFFIX}`, "MODERATOR", generateAccessToken);
  await createTestUser(USER_ID, `pruser_${SUFFIX}`, "USER", generateAccessToken);
  await db.orm.public.Resource.create({
    id: RESOURCE_ID,
    sellerId: USER_ID,
    slug: `premium-res-${SUFFIX}`,
    title: "Premium Resource",
    description: "premium fixture resource",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 100,
  } as any);
  await db.orm.public.Server.create({
    id: SERVER_ID,
    ownerId: USER_ID,
    slug: `premium-server-${SUFFIX}`,
    name: "Premium Server",
    description: "premium fixture server",
  } as any);
});

afterAll(async () => {
  if (!dbAvailable) return;
  delete process.env.FEATURE_PREMIUM;
  await resetTestEntities();
});

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe.skipIf(!dbAvailable)("premium entitlement foundation", () => {
  it("plans catalog answers always and reports kind availability honestly", async () => {
    const res = await app.get("/admin/premium/plans").set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.featureEnabled).toBe(true);
    const byKind = new Map<string, any>(res.body.plans.map((p: any) => [p.kind, p]));
    expect(byKind.size).toBe(5);
    for (const kind of ["CREATOR_PREMIUM", "SERVER_PREMIUM", "MARKETPLACE_PREMIUM", "ADVERTISING_PREMIUM", "ANALYTICS_PREMIUM"]) {
      expect(byKind.has(kind)).toBe(true);
    }
    // §50: only plans backed by real entitlements/consumers are available.
    expect(byKind.get("CREATOR_PREMIUM").available).toBe(true);
    expect(byKind.get("SERVER_PREMIUM").available).toBe(true);
    expect(byKind.get("CREATOR_PREMIUM").enabled).toBe(true);
    expect(byKind.get("SERVER_PREMIUM").enabled).toBe(true);
    for (const future of ["MARKETPLACE_PREMIUM", "ADVERTISING_PREMIUM", "ANALYTICS_PREMIUM"]) {
      expect(byKind.get(future).available).toBe(false);
      expect(typeof byKind.get(future).note).toBe("string");
      expect(byKind.get(future).note.length).toBeGreaterThan(0);
      expect(byKind.get(future).enabled).toBe(false);
    }
  });

  it("guards the admin surface: 401 anonymous, 403 moderator", async () => {
    const anon = await app.get("/admin/premium/entitlements");
    expect(anon.status).toBe(401);
    const mod = await app.get("/admin/premium/entitlements").set(auth(modToken));
    expect(mod.status).toBe(403);
    // plans is admin-only too, but always responds for admins.
    const modPlans = await app.get("/admin/premium/plans").set(auth(modToken));
    expect(modPlans.status).toBe(403);
  });

  it("grants a USER entitlement and is idempotent on re-grant", async () => {
    const first = await app
      .post("/admin/premium/entitlements")
      .set(auth(adminToken))
      .send({ subjectType: "USER", subjectId: USER_ID, kind: "CREATOR_PREMIUM", note: "wave grant" });
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);
    expect(first.body.entitlement.source).toBe("ADMIN_GRANT");
    expect(first.body.entitlement.grantedById).toBe(ADMIN_ID);
    expect(first.body.entitlement.revokedAt).toBeNull();

    const second = await app
      .post("/admin/premium/entitlements")
      .set(auth(adminToken))
      .send({ subjectType: "USER", subjectId: USER_ID, kind: "CREATOR_PREMIUM" });
    expect(second.status).toBe(200);
    expect(second.body.created).toBe(false);
    expect(second.body.entitlement.id).toBe(first.body.entitlement.id);

    expect(await hasEntitlement("USER", USER_ID, "CREATOR_PREMIUM")).toBe(true);
  });

  it("grant with an unknown subject is a 404", async () => {
    const res = await app
      .post("/admin/premium/entitlements")
      .set(auth(adminToken))
      .send({ subjectType: "USER", subjectId: UNKNOWN_SUBJECT_ID, kind: "SERVER_PREMIUM" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Subject not found");
  });

  it("grants for RESOURCE/SERVER subjects notify the owner and label the subject", async () => {
    const res = await app
      .post("/admin/premium/entitlements")
      .set(auth(adminToken))
      .send({ subjectType: "RESOURCE", subjectId: RESOURCE_ID, kind: "MARKETPLACE_PREMIUM" });
    expect(res.status).toBe(201);
    const res2 = await app
      .post("/admin/premium/entitlements")
      .set(auth(adminToken))
      .send({ subjectType: "SERVER", subjectId: SERVER_ID, kind: "SERVER_PREMIUM" });
    expect(res2.status).toBe(201);

    const list = await app.get("/admin/premium/entitlements?active=true").set(auth(adminToken));
    expect(list.status).toBe(200);
    const labels = new Map<string, string>(list.body.data.map((e: any) => [e.id, e.subject.label]));
    expect(labels.get(res.body.entitlement.id)).toBe("Premium Resource");
    expect(labels.get(res2.body.entitlement.id)).toBe("Premium Server");

    // Owner notifications: seller/owner == USER_ID for both fixtures.
    const notes = (await db.orm.public.Notification.where({ recipientId: USER_ID }).all()) as any[];
    const titles = notes.map((n) => n.title as string);
    expect(titles.some((t) => t.includes("ресурс"))).toBe(true);
    expect(titles.some((t) => t.includes("сервер"))).toBe(true);
  });

  it("revokes with a mandatory reason; hasEntitlement flips to false; re-revoke is idempotent", async () => {
    const list = await app
      .get(`/admin/premium/entitlements?subjectType=USER&subjectId=${USER_ID}&kind=CREATOR_PREMIUM`)
      .set(auth(adminToken));
    const id = list.body.data[0].id;

    const noReason = await app.delete(`/admin/premium/entitlements/${id}`).set(auth(adminToken)).send({});
    expect(noReason.status).toBe(400);

    const revoked = await app
      .delete(`/admin/premium/entitlements/${id}`)
      .set(auth(adminToken))
      .send({ reason: "test revoke" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.revoked).toBe(true);
    expect(revoked.body.entitlement.revokedAt).not.toBeNull();
    expect(revoked.body.entitlement.revokedById).toBe(ADMIN_ID);
    expect(await hasEntitlement("USER", USER_ID, "CREATOR_PREMIUM")).toBe(false);

    const again = await app
      .delete(`/admin/premium/entitlements/${id}`)
      .set(auth(adminToken))
      .send({ reason: "second revoke" });
    expect(again.status).toBe(200);
    expect(again.body.revoked).toBe(false);

    const missing = await app
      .delete(`/admin/premium/entitlements/${UNKNOWN_SUBJECT_ID}`)
      .set(auth(adminToken))
      .send({ reason: "x" });
    expect(missing.status).toBe(404);

    // Revocation notification reached the owner.
    const notes = (await db.orm.public.Notification.where({ recipientId: USER_ID }).all()) as any[];
    expect(notes.some((n) => n.title === "Премиум-статус отозван")).toBe(true);
  });

  it("writes audit rows for grant and revoke", async () => {
    const grants = (await db.orm.public.AuditLog.where({ action: "premium_entitlement_granted" }).all()) as any[];
    expect(grants.length).toBeGreaterThanOrEqual(3);
    expect(grants.every((g) => g.actorId === ADMIN_ID && g.targetType === "entitlement")).toBe(true);
    const revokes = (await db.orm.public.AuditLog.where({ action: "premium_entitlement_revoked" }).all()) as any[];
    expect(revokes.length).toBeGreaterThanOrEqual(1);
    expect(revokes[0].actorId).toBe(ADMIN_ID);
    expect(revokes[0].after).toContain("test revoke");
  });

  it("expired grants are not entitled and excluded by the active filter", async () => {
    const grant = await app
      .post("/admin/premium/entitlements")
      .set(auth(adminToken))
      .send({
        subjectType: "SERVER",
        subjectId: SERVER_ID,
        kind: "ANALYTICS_PREMIUM",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });
    expect(grant.status).toBe(201);
    expect(await hasEntitlement("SERVER", SERVER_ID, "ANALYTICS_PREMIUM")).toBe(false);

    const active = await app.get("/admin/premium/entitlements?active=true&kind=ANALYTICS_PREMIUM").set(auth(adminToken));
    expect(active.body.data).toHaveLength(0);

    const all = await app.get("/admin/premium/entitlements?subjectType=SERVER&kind=ANALYTICS_PREMIUM").set(auth(adminToken));
    expect(all.body.data).toHaveLength(1);
    expect(all.body.pagination.total).toBe(1);
  });

  it("with the premium flag off admin entitlement routes answer 404, plans still respond", async () => {
    process.env.FEATURE_PREMIUM = "false";
    try {
      const list = await app.get("/admin/premium/entitlements").set(auth(adminToken));
      expect(list.status).toBe(404);
      expect(list.body).toEqual({ error: "Not found" });
      const grant = await app
        .post("/admin/premium/entitlements")
        .set(auth(adminToken))
        .send({ subjectType: "USER", subjectId: USER_ID, kind: "CREATOR_PREMIUM" });
      expect(grant.status).toBe(404);
      const plans = await app.get("/admin/premium/plans").set(auth(adminToken));
      expect(plans.status).toBe(200);
      expect(plans.body.featureEnabled).toBe(false);
      expect(plans.body.plans.every((p: any) => p.enabled === false)).toBe(true);
    } finally {
      process.env.FEATURE_PREMIUM = "true";
    }
  });
});