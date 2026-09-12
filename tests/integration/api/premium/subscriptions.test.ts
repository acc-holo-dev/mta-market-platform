// PLAN-018 J integration tests: premium subscriptions over real entitlements.
// Covers: public plans catalog honesty, purchase → checkout → paid activation
// (explicit paid-activation path), entitlement granted with expiresAt,
// idempotent activation + renewal extension, cancel at period end + revoke on
// sweep, autoRenew grace window, admin transitions + audit, flag-off 404.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";
import { hasEntitlement } from "@server/lib/entitlements";
import { expireSweep, resetSubscriptionSweepGuardForTests } from "@server/lib/subscriptions";
import { isLedgerTransactionBalanced } from "@server/lib/ledger";

const app = request(createApp());

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655447801";
const MOD_ID = "550e8400-e29b-41d4-a716-446655447802";
const USER_ID = "550e8400-e29b-41d4-a716-446655447803";
const USER_CANCEL_ID = "550e8400-e29b-41d4-a716-446655447804";
const USER_GRACE_ID = "550e8400-e29b-41d4-a716-446655447805";
const USER_NORENEW_ID = "550e8400-e29b-41d4-a716-446655447806";
const SUFFIX = Date.now().toString(36);

let adminToken = "";
let modToken = "";
let userToken = "";
let userCancelToken = "";
let userGraceToken = "";
let userNoRenewToken = "";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[subscriptions.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** FK-safe cleanup for everything this suite created (db-reset is frozen). */
async function cleanupWaveEntities(): Promise<void> {
  const buyers = [USER_ID, USER_CANCEL_ID, USER_GRACE_ID, USER_NORENEW_ID];
  // System-actor audit rows (sweep revocations) reference entitlements of our
  // test users; db-reset only prunes audit rows whose ACTOR is in the test
  // range, so these would leak into sibling suites' audit assertions. Remove
  // ours plus rows orphaned by earlier runs (entitlement already deleted).
  const myEntitlements = (await db.orm.public.Entitlement
    .where((e: any) => e.subjectId.in(buyers))
    .all()) as Array<{ id: string }>;
  const myEntitlementIds = new Set(myEntitlements.map((e) => e.id));
  const systemAudits = (await db.orm.public.AuditLog
    .where({ actorId: "system", targetType: "entitlement" } as any)
    .all()) as Array<{ id: string; targetId: string }>;
  for (const row of systemAudits) {
    const owner = (await db.orm.public.Entitlement.where({ id: row.targetId } as any).first()) as { subjectId: string } | null;
    if (!owner || myEntitlementIds.has(row.targetId)) {
      await db.orm.public.AuditLog.where({ id: row.id }).delete().catch(() => undefined);
    }
  }
  for (const userId of buyers) {
    await db.orm.public.Subscription.where({ userId } as any).delete().catch(() => undefined);
  }
  const orders = (await db.orm.public.Order.where({}).all()) as Array<{ id: string; buyerId: string }>;
  for (const order of orders) {
    if (!buyers.includes(order.buyerId)) continue;
    const items = (await db.orm.public.OrderItem.where({ orderId: order.id }).all()) as Array<{ id: string }>;
    for (const item of items) {
      const payments = (await db.orm.public.Payment.where({ orderItemId: item.id } as any).all()) as Array<{ id: string }>;
      for (const p of payments) {
        await db.orm.public.Payment.where({ id: p.id }).delete().catch(() => undefined);
      }
    }
    await db.orm.public.LedgerEntry.where({ orderId: order.id } as any).delete().catch(() => undefined);
    await db.orm.public.Order.where({ id: order.id }).delete().catch(() => undefined);
  }
}

beforeAll(async () => {
  if (!dbAvailable) return;
  // FEATURE_* env override contract (lib/featureFlags.ts): features.yaml has
  // premium: false — the suite forces it on.
  process.env.FEATURE_PREMIUM = "true";
  await resetTestEntities();
  adminToken = await createTestUser(ADMIN_ID, `subsadmin_${SUFFIX}`, "ADMIN", generateAccessToken);
  modToken = await createTestUser(MOD_ID, `subsmod_${SUFFIX}`, "MODERATOR", generateAccessToken);
  userToken = await createTestUser(USER_ID, `subsuser_${SUFFIX}`, "USER", generateAccessToken);
  userCancelToken = await createTestUser(USER_CANCEL_ID, `subscancel_${SUFFIX}`, "USER", generateAccessToken);
  userGraceToken = await createTestUser(USER_GRACE_ID, `subsgrace_${SUFFIX}`, "USER", generateAccessToken);
  userNoRenewToken = await createTestUser(USER_NORENEW_ID, `subsnrnw_${SUFFIX}`, "USER", generateAccessToken);
});

afterAll(async () => {
  if (!dbAvailable) return;
  delete process.env.FEATURE_PREMIUM;
  await cleanupWaveEntities();
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("premium subscriptions", () => {
  it("serves the public plans catalog with honest availability and pricing", async () => {
    const res = await app.get("/subscriptions/plans");
    expect(res.status).toBe(200);
    expect(res.body.featureEnabled).toBe(true);
    const byKind = new Map<string, any>(res.body.plans.map((p: any) => [p.kind, p]));
    expect(byKind.size).toBe(5);
    expect(byKind.get("CREATOR_PREMIUM").priceMinor).toBe(99000);
    expect(byKind.get("CREATOR_PREMIUM").periodDays).toBe(30);
    expect(byKind.get("CREATOR_PREMIUM").available).toBe(true);
    expect(byKind.get("CREATOR_PREMIUM").features.length).toBeGreaterThan(0);
    expect(byKind.get("SERVER_PREMIUM").priceMinor).toBe(149000);
    expect(byKind.get("SERVER_PREMIUM").available).toBe(true);
    for (const future of ["MARKETPLACE_PREMIUM", "ADVERTISING_PREMIUM", "ANALYTICS_PREMIUM"]) {
      expect(byKind.get(future).available).toBe(false);
      expect(typeof byKind.get(future).note).toBe("string");
    }
  });

  it("answers 404 on every surface while the premium flag is off", async () => {
    process.env.FEATURE_PREMIUM = "false";
    try {
      const plans = await app.get("/subscriptions/plans");
      expect(plans.status).toBe(404);
      expect(plans.body).toEqual({ error: "Not found" });
      const purchase = await app.post("/subscriptions").set(auth(userToken)).send({ plan: "CREATOR_PREMIUM" });
      expect(purchase.status).toBe(404);
      const mine = await app.get("/subscriptions/mine").set(auth(userToken));
      expect(mine.status).toBe(404);
      const adminList = await app.get("/admin/subscriptions").set(auth(adminToken));
      expect(adminList.status).toBe(404);
    } finally {
      process.env.FEATURE_PREMIUM = "true";
    }
  });

  it("purchase → activate via the payment path creates the subscription + real entitlement", async () => {
    const checkout = await app.post("/subscriptions").set(auth(userToken)).send({ plan: "CREATOR_PREMIUM" });
    expect(checkout.status).toBe(201);
    expect(checkout.body.checkout.amountMinor).toBe(99000);
    expect(checkout.body.checkout.currency).toBe("RUB");
    expect(checkout.body.checkout.simulate).toBe(true); // no provider configured in tests
    const orderId = checkout.body.checkout.orderId as string;

    // The pending checkout is an Order + one priced platform line.
    const order = (await db.orm.public.Order.where({ id: orderId }).first()) as any;
    expect(order.status).toBe("PENDING");
    expect(order.finalTotal).toBe(99000);
    const item = (await db.orm.public.OrderItem.where({ orderId }).first()) as any;
    expect(item.itemType).toBe("SERVICE");
    expect(item.sellerId).toBe("PLATFORM");
    expect(item.platformFee).toBe(99000);
    expect(item.sellerNet).toBe(0);

    const activation = await app.post(`/subscriptions/${orderId}/activate-payment`).set(auth(userToken)).send({});
    expect(activation.status).toBe(200);
    expect(activation.body.alreadyActive).toBe(false);
    const sub = activation.body.subscription;
    expect(sub.status).toBe("ACTIVE");
    expect(sub.plan).toBe("CREATOR_PREMIUM");
    expect(sub.userId).toBe(USER_ID);
    const expectedEnd = Date.now() + 30 * 24 * 60 * 60 * 1000;
    expect(Math.abs(new Date(sub.expiresAt).getTime() - expectedEnd)).toBeLessThan(60_000);
    expect(sub.lastPaymentId).toBeNull(); // simulate mode: no provider payment row

    expect(await hasEntitlement("USER", USER_ID, "CREATOR_PREMIUM")).toBe(true);
    const entitlement = (await db.orm.public.Entitlement
      .where({ subjectType: "USER", subjectId: USER_ID, kind: "CREATOR_PREMIUM", source: "PLAN_PURCHASE", revokedAt: null } as any)
      .first()) as any;
    expect(entitlement).not.toBeNull();
    expect(entitlement.expiresAt).toBe(sub.expiresAt);
    expect(activation.body.entitlementId).toBe(entitlement.id);

    // The paid activation settled platform revenue into the ledger (balanced).
    expect(await isLedgerTransactionBalanced(`settle:subscription:${orderId}`)).toBe(true);
  });

  it("activation is idempotent: replay re-presents the live subscription", async () => {
    const checkout = await app.post("/subscriptions").set(auth(userToken)).send({ plan: "CREATOR_PREMIUM" });
    const orderId = checkout.body.checkout.orderId as string;
    const first = await app.post(`/subscriptions/${orderId}/activate-payment`).set(auth(userToken)).send({});
    expect(first.status).toBe(200);
    const replay = await app.post(`/subscriptions/${orderId}/activate-payment`).set(auth(userToken)).send({});
    expect(replay.status).toBe(200);
    expect(replay.body.alreadyActive).toBe(true);
    expect(replay.body.subscription.id).toBe(first.body.subscription.id);

    // Exactly one live subscription and one active plan entitlement.
    const subs = (await db.orm.public.Subscription.where({ userId: USER_ID, plan: "CREATOR_PREMIUM" } as any).all()) as any[];
    expect(subs.filter((s) => s.status === "ACTIVE")).toHaveLength(1);
    const ents = (await db.orm.public.Entitlement
      .where({ subjectType: "USER", subjectId: USER_ID, kind: "CREATOR_PREMIUM", source: "PLAN_PURCHASE", revokedAt: null } as any)
      .all()) as any[];
    expect(ents).toHaveLength(1);

    // A second purchase for the same plan EXTENDS the same subscription.
    const checkout2 = await app.post("/subscriptions").set(auth(userToken)).send({ plan: "CREATOR_PREMIUM" });
    const second = await app
      .post(`/subscriptions/${checkout2.body.checkout.orderId}/activate-payment`)
      .set(auth(userToken))
      .send({});
    expect(second.status).toBe(200);
    expect(second.body.subscription.id).toBe(first.body.subscription.id);
    expect(new Date(second.body.subscription.expiresAt).getTime()).toBeGreaterThan(
      new Date(first.body.subscription.expiresAt).getTime()
    );
  });

  it("rejects unknown plans, protects foreign checkouts and honest states", async () => {
    const unknownPlan = await app.post("/subscriptions").set(auth(userToken)).send({ plan: "MARKETPLACE_PREMIUM" });
    expect(unknownPlan.status).toBe(400);
    expect(unknownPlan.body.code).toBe("unknown_plan");

    const unknownOrder = await app
      .post("/subscriptions/550e8400-e29b-41d4-a716-4466554478ff/activate-payment")
      .set(auth(userToken))
      .send({});
    expect(unknownOrder.status).toBe(404);

    // Another user's pending checkout must not be activatable (403).
    const checkout = await app.post("/subscriptions").set(auth(userToken)).send({ plan: "SERVER_PREMIUM" });
    const orderId = checkout.body.checkout.orderId as string;
    const foreign = await app.post(`/subscriptions/${orderId}/activate-payment`).set(auth(userCancelToken)).send({});
    expect(foreign.status).toBe(403);
    // Unknown plan values on the checkout are honest 400s; cleanup the order.
    await db.orm.public.Order.where({ id: orderId }).delete().catch(() => undefined);
  });

  it("cancel takes effect at period end; sweep expires + revokes the entitlement", async () => {
    const checkout = await app.post("/subscriptions").set(auth(userCancelToken)).send({ plan: "SERVER_PREMIUM" });
    const orderId = checkout.body.checkout.orderId as string;
    const activation = await app.post(`/subscriptions/${orderId}/activate-payment`).set(auth(userCancelToken)).send({});
    const subId = activation.body.subscription.id as string;
    expect(await hasEntitlement("USER", USER_CANCEL_ID, "SERVER_PREMIUM")).toBe(true);

    // User cancel takes effect at period end — access is kept until then.
    const cancelled = await app.post(`/subscriptions/${subId}/cancel`).set(auth(userCancelToken)).send({ reason: "too pricey" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.subscription.status).toBe("CANCELLED");
    expect(cancelled.body.subscription.cancelledAt).not.toBeNull();
    expect(await hasEntitlement("USER", USER_CANCEL_ID, "SERVER_PREMIUM")).toBe(true);

    // Resume undoes the period-end cancellation.
    const resumed = await app.post(`/subscriptions/${subId}/resume`).set(auth(userCancelToken)).send({});
    expect(resumed.status).toBe(200);
    expect(resumed.body.subscription.status).toBe("ACTIVE");
    expect(resumed.body.subscription.cancelledAt).toBeNull();

    // Backdate the paid window, then sweep: CANCELLED past period end → EXPIRED.
    await db.orm.public.Subscription.where({ id: subId } as any).update({
      status: "CANCELLED",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    } as any);
    resetSubscriptionSweepGuardForTests();
    const sweep = await expireSweep();
    expect(sweep.expired).toBeGreaterThanOrEqual(1);
    const expired = (await db.orm.public.Subscription.where({ id: subId } as any).first()) as any;
    expect(expired.status).toBe("EXPIRED");
    expect(await hasEntitlement("USER", USER_CANCEL_ID, "SERVER_PREMIUM")).toBe(false);
    const ent = (await db.orm.public.Entitlement
      .where({ subjectType: "USER", subjectId: USER_CANCEL_ID, kind: "SERVER_PREMIUM", source: "PLAN_PURCHASE" } as any)
      .first()) as any;
    expect(ent.revokedAt).not.toBeNull();
  });

  it("autoRenew subscriptions enter GRACE_PERIOD with the entitlement extended, then expire", async () => {
    const checkout = await app.post("/subscriptions").set(auth(userGraceToken)).send({ plan: "SERVER_PREMIUM" });
    const activation = await app
      .post(`/subscriptions/${checkout.body.checkout.orderId}/activate-payment`)
      .set(auth(userGraceToken))
      .send({});
    const subId = activation.body.subscription.id as string;

    await db.orm.public.Subscription.where({ id: subId } as any).update({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    } as any);
    // Keep the entitlement consistent with the (artificially backdated)
    // subscription window — in production both share the same period end.
    await db.orm.public.Entitlement
      .where({ subjectType: "USER", subjectId: USER_GRACE_ID, kind: "SERVER_PREMIUM", source: "PLAN_PURCHASE", revokedAt: null } as any)
      .update({ expiresAt: new Date(Date.now() - 60_000).toISOString() } as any);
    resetSubscriptionSweepGuardForTests();
    await expireSweep();

    const inGrace = (await db.orm.public.Subscription.where({ id: subId } as any).first()) as any;
    expect(inGrace.status).toBe("GRACE_PERIOD");
    expect(inGrace.graceUntil).not.toBeNull();
    // Grace keeps the entitlement alive (expiry extended to graceUntil).
    expect(await hasEntitlement("USER", USER_GRACE_ID, "SERVER_PREMIUM")).toBe(true);
    const ent = (await db.orm.public.Entitlement
      .where({ subjectType: "USER", subjectId: USER_GRACE_ID, kind: "SERVER_PREMIUM", source: "PLAN_PURCHASE", revokedAt: null } as any)
      .first()) as any;
    expect(ent.expiresAt).toBe(inGrace.graceUntil);

    // Grace window passed → EXPIRED + revoke.
    await db.orm.public.Subscription.where({ id: subId } as any).update({
      graceUntil: new Date(Date.now() - 60_000).toISOString(),
    } as any);
    // Mirror the entitlement back into the past (consistent state).
    await db.orm.public.Entitlement
      .where({ subjectType: "USER", subjectId: USER_GRACE_ID, kind: "SERVER_PREMIUM", source: "PLAN_PURCHASE", revokedAt: null } as any)
      .update({ expiresAt: inGrace.graceUntil } as any);
    resetSubscriptionSweepGuardForTests();
    await expireSweep();
    const expired = (await db.orm.public.Subscription.where({ id: subId } as any).first()) as any;
    expect(expired.status).toBe("EXPIRED");
    expect(await hasEntitlement("USER", USER_GRACE_ID, "SERVER_PREMIUM")).toBe(false);
  });

  it("autoRenew=false skips grace: the sweep expires and revokes directly", async () => {
    const checkout = await app.post("/subscriptions").set(auth(userNoRenewToken)).send({ plan: "CREATOR_PREMIUM" });
    const activation = await app
      .post(`/subscriptions/${checkout.body.checkout.orderId}/activate-payment`)
      .set(auth(userNoRenewToken))
      .send({});
    const subId = activation.body.subscription.id as string;
    const off = await app.patch(`/subscriptions/${subId}/auto-renew`).set(auth(userNoRenewToken)).send({ autoRenew: false });
    expect(off.status).toBe(200);
    expect(off.body.subscription.autoRenew).toBe(false);

    await db.orm.public.Subscription.where({ id: subId } as any).update({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    } as any);
    resetSubscriptionSweepGuardForTests();
    await expireSweep();
    const expired = (await db.orm.public.Subscription.where({ id: subId } as any).first()) as any;
    expect(expired.status).toBe("EXPIRED");
    expect(await hasEntitlement("USER", USER_NORENEW_ID, "CREATOR_PREMIUM")).toBe(false);
  });

  it("lists own subscriptions with linked entitlements; admin lists + transitions are audited", async () => {
    const mine = await app.get("/subscriptions/mine").set(auth(userToken));
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBeGreaterThanOrEqual(1);
    const withEnt = mine.body.data.find((s: any) => s.plan === "CREATOR_PREMIUM");
    expect(withEnt.entitlement).not.toBeNull();
    expect(withEnt.entitlement.id).toBeTruthy();

    // Guards: moderator 403, anonymous 401.
    const modList = await app.get("/admin/subscriptions").set(auth(modToken));
    expect(modList.status).toBe(403);
    const anon = await app.get("/admin/subscriptions");
    expect(anon.status).toBe(401);

    const list = await app.get("/admin/subscriptions?status=ACTIVE").set(auth(adminToken));
    expect(list.status).toBe(200);
    const mineRow = list.body.data.find((s: any) => s.userId === USER_GRACE_ID || s.userId === USER_ID);
    expect(mineRow).toBeDefined();
    expect(typeof mineRow.planLabel).toBe("string");
    expect(mineRow.username).toBeTruthy();

    // grant_grace → GRACE_PERIOD; expire → EXPIRED (both audited + logged).
    const subId = mineRow.id as string;
    const grace = await app
      .post(`/admin/subscriptions/${subId}/transition`)
      .set(auth(adminToken))
      .send({ action: "grant_grace", graceDays: 2 });
    expect(grace.status).toBe(200);
    expect(grace.body.subscription.status).toBe("GRACE_PERIOD");
    expect(grace.body.subscription.graceUntil).not.toBeNull();

    const expired = await app.post(`/admin/subscriptions/${subId}/transition`).set(auth(adminToken)).send({ action: "expire" });
    expect(expired.status).toBe(200);
    expect(expired.body.subscription.status).toBe("EXPIRED");

    const audits = (await db.orm.public.AuditLog
      .where({ action: "subscription_admin_transition", actorId: ADMIN_ID } as any)
      .all()) as any[];
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const logs = (await db.orm.public.SystemLog.where({ message: "subscription_admin_transition" } as any).all()) as any[];
    expect(logs.length).toBeGreaterThanOrEqual(2);
  });
});
