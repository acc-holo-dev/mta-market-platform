// PLAN-018 I-003: price alerts — upsert/deactivate/list, dispatch guard
// (ADMIN bearer OR X-Worker-Key), and the three sweep paths (PRICE_DROP,
// DISCOUNT_STARTED, VERSION_RELEASED) seeded directly via the ORM.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";
import { notifyVersionReleases, sweepRecentVersionReleases } from "@server/lib/priceAlerts";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655446401";
const WATCHER1_ID = "550e8400-e29b-41d4-a716-446655446402";
const WATCHER2_ID = "550e8400-e29b-41d4-a716-446655446403";
const WATCHER3_ID = "550e8400-e29b-41d4-a716-446655446404";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655446405";
const SUFFIX = Date.now().toString(36);
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

// R1: price-drop + discount playground (starts at 800.00 ₽ = 80000).
const R1 = "00000000-0000-0000-0000-750000000001";
// R2: version-release playground.
const R2 = "00000000-0000-0000-0000-750000000002";
// R3: DRAFT — alerts rejected.
const R3 = "00000000-0000-0000-0000-750000000003";
const V1_R2 = "00000000-0000-0000-0000-750000000101";
const V2_R2 = "00000000-0000-0000-0000-750000000102";

let sellerToken = "";
let watcher1Token = "";
let watcher2Token = "";
let watcher3Token = "";
let adminToken = "";

async function notificationCount(userId: string): Promise<number> {
  const agg = await db.orm.public.Notification.where({ recipientId: userId }).aggregate(
    (a: any) => ({ total: a.count() })
  );
  return Number(agg.total ?? 0);
}

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan018-price-alerts.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  sellerToken = await createTestUser(SELLER_ID, `pa_seller_${SUFFIX}`, "USER", generateAccessToken);
  watcher1Token = await createTestUser(WATCHER1_ID, `pa_watch1_${SUFFIX}`, "USER", generateAccessToken);
  watcher2Token = await createTestUser(WATCHER2_ID, `pa_watch2_${SUFFIX}`, "USER", generateAccessToken);
  watcher3Token = await createTestUser(WATCHER3_ID, `pa_watch3_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `pa_admin_${SUFFIX}`, "ADMIN", generateAccessToken);

  await db.orm.public.Resource.create({
    id: R1, sellerId: SELLER_ID, slug: `pa-res1-${SUFFIX}`, title: "Price Alert One",
    description: "fixture", type: "SCRIPT", status: "PUBLISHED", price: 80000,
  });
  await db.orm.public.Resource.create({
    id: R2, sellerId: SELLER_ID, slug: `pa-res2-${SUFFIX}`, title: "Price Alert Two",
    description: "fixture", type: "SCRIPT", status: "PUBLISHED", price: 100000,
  });
  await db.orm.public.Resource.create({
    id: R3, sellerId: SELLER_ID, slug: `pa-res3-${SUFFIX}`, title: "Price Alert Draft",
    description: "fixture", type: "SCRIPT", status: "DRAFT", price: 0,
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("price alert management", () => {
  it("validates, upserts (UNIQUE user+resource), deactivates and reactivates", async () => {
    // Auth + target validation.
    await app.put(`/resources/pa-res1-${SUFFIX}/alert`).send({ events: ["PRICE_DROP"] }).expect(401);
    await app
      .put(`/resources/pa-missing-404/alert`)
      .set("Authorization", `Bearer ${watcher1Token}`)
      .send({ events: ["PRICE_DROP"] })
      .expect(404);
    await app
      .put(`/resources/pa-res3-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher1Token}`)
      .send({ events: ["PRICE_DROP"] })
      .expect(404);
    // Payload validation.
    await app
      .put(`/resources/pa-res1-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher1Token}`)
      .send({ events: [] })
      .expect(400);
    await app
      .put(`/resources/pa-res1-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher1Token}`)
      .send({ events: ["PRICE_DROP", "BOGUS"] })
      .expect(400);
    await app
      .put(`/resources/pa-res1-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher1Token}`)
      .send({ events: ["PRICE_DROP"], targetPriceMinor: -5 })
      .expect(400);
    await app
      .put(`/resources/pa-res1-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher1Token}`)
      .send({ events: ["PRICE_DROP"], targetPriceMinor: "abc" })
      .expect(400);

    // Create.
    const created = (await app
      .put(`/resources/pa-res1-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher1Token}`)
      .send({ events: ["PRICE_DROP", "VERSION_RELEASED"], targetPriceMinor: 70000 })
      .expect(201)).body;
    expect(created.events).toEqual(["PRICE_DROP", "VERSION_RELEASED"]);
    expect(created.targetPriceMinor).toBe(70000);
    expect(created.active).toBe(true);

    // Upsert: same user+resource → same row, updated payload, active again.
    const updated = (await app
      .put(`/resources/pa-res1-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher1Token}`)
      .send({
        events: ["DISCOUNT_STARTED", "PRICE_DROP", "VERSION_RELEASED"],
        targetPriceMinor: 65000,
      })
      .expect(200)).body;
    expect(updated.id).toBe(created.id);
    expect(updated.events).toEqual(["PRICE_DROP", "DISCOUNT_STARTED", "VERSION_RELEASED"]);
    expect(updated.targetPriceMinor).toBe(65000);
    expect(
      (await db.orm.public.PriceAlert.where({ userId: WATCHER1_ID }).all()).length
    ).toBe(1);

    // Deactivate (idempotent), list shows the label with active=false.
    const off = (await app
      .delete(`/resources/pa-res1-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher1Token}`)
      .expect(200)).body;
    expect(off.active).toBe(false);
    const mine = (await app
      .get("/me/alerts")
      .set("Authorization", `Bearer ${watcher1Token}`)
      .expect(200)).body;
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0].active).toBe(false);
    expect(mine.data[0].resource.slug).toBe(`pa-res1-${SUFFIX}`);
    expect(mine.data[0].events).toContain("PRICE_DROP");

    // Reactivation via PUT.
    const reactivated = (await app
      .put(`/resources/pa-res1-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher1Token}`)
      .send({
        events: ["PRICE_DROP", "DISCOUNT_STARTED", "VERSION_RELEASED"],
        targetPriceMinor: 65000,
      })
      .expect(200)).body;
    expect(reactivated.id).toBe(created.id);
    expect(reactivated.active).toBe(true);
  });
});

describe.skipIf(!dbAvailable)("dispatch guard", () => {
  it("requires an ADMIN bearer token or a matching X-Worker-Key", async () => {
    await app.post("/alerts/dispatch").expect(401);
    // Non-admin bearer → 403.
    await app
      .post("/alerts/dispatch")
      .set("Authorization", `Bearer ${watcher1Token}`)
      .expect(403);
    // ADMIN bearer works.
    const admin = (await app
      .post("/alerts/dispatch")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)).body;
    expect(admin.dispatched).toEqual({ priceDrops: 0, discountStarts: 0, versionReleases: 0 });

    // Worker-key path: enabled only when WORKER_KEY is set.
    const previousKey = process.env.WORKER_KEY;
    process.env.WORKER_KEY = "w3-worker-secret";
    try {
      await app
        .post("/alerts/dispatch")
        .set("X-Worker-Key", "wrong-key")
        .set("Authorization", `Bearer ${watcher1Token}`)
        .expect(403);
      const worker = (await app
        .post("/alerts/dispatch")
        .set("X-Worker-Key", "w3-worker-secret")
        .expect(200)).body;
      expect(worker.dispatched).toBeDefined();
    } finally {
      if (previousKey === undefined) delete process.env.WORKER_KEY;
      else process.env.WORKER_KEY = previousKey;
    }
  });
});

describe.skipIf(!dbAvailable)("sweep paths", () => {
  it("PRICE_DROP: notifies when the price falls below the target after the alert was created", async () => {
    // WATCHER2 watches R1 (800.00 ₽) for a drop below 600.00 ₽.
    await app
      .put(`/resources/pa-res1-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher2Token}`)
      .send({ events: ["PRICE_DROP"], targetPriceMinor: 60000 })
      .expect(201);

    // The seller drops the price to 500.00 ₽ (PATCH takes rubles, ×100).
    await app
      .patch(`/resources/pa-res1-${SUFFIX}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ price: 500 })
      .expect(200);
    const dropped = await db.orm.public.Resource.where({ id: R1 }).first();
    expect(dropped!.price).toBe(50000);
    // Sweep precondition: the change happened after the alert was created.
    const alert2 = await db.orm.public.PriceAlert.where({ userId: WATCHER2_ID }).first();
    expect(new Date(dropped!.updatedAt as string).getTime()).toBeGreaterThan(
      new Date(alert2!.createdAt as string).getTime()
    );

    const dispatch = (await app
      .post("/alerts/dispatch")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)).body;
    expect(dispatch.dispatched.priceDrops).toBeGreaterThanOrEqual(1);

    const notifs = await db.orm.public.Notification.where({ recipientId: WATCHER2_ID }).all();
    const drop = notifs.find((n: any) => n.entityType === "priceAlert");
    expect(drop).toBeTruthy();
    expect(drop!.type).toBe("RESOURCE_UPDATE");
    expect(drop!.title).toContain("Price Alert One");

    // Sweep idempotency: a second dispatch does not re-notify.
    const before = await notificationCount(WATCHER2_ID);
    await app
      .post("/alerts/dispatch")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(await notificationCount(WATCHER2_ID)).toBe(before);

    // WATCHER3 subscribes AFTER the drop (target above the current price):
    // nothing changed since their alert was created → no notification.
    await app
      .put(`/resources/pa-res1-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher3Token}`)
      .send({ events: ["PRICE_DROP"], targetPriceMinor: 60000 })
      .expect(201);
    await app
      .post("/alerts/dispatch")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(await notificationCount(WATCHER3_ID)).toBe(0);
  });

  it("DISCOUNT_STARTED: notifies watchers when a campaign goes live within 24h", async () => {
    // WATCHER1 already has DISCOUNT_STARTED on R1 (management test).
    await db.orm.public.DiscountCampaign.create({
      sellerId: SELLER_ID,
      name: `W3 Sale ${SUFFIX}`,
      type: "PERCENT",
      value: 20,
      scope: "RESOURCE",
      scopeId: R1,
      startsAt: iso(3600_000), // went live an hour ago
      isActive: true,
    });
    // Old campaign — outside the 24h window, must not notify.
    await db.orm.public.DiscountCampaign.create({
      sellerId: SELLER_ID,
      name: `Old Sale ${SUFFIX}`,
      type: "PERCENT",
      value: 10,
      scope: "RESOURCE",
      scopeId: R1,
      startsAt: iso(72 * 3600_000),
      isActive: true,
    });

    const dispatch = (await app
      .post("/alerts/dispatch")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)).body;
    expect(dispatch.dispatched.discountStarts).toBe(1);

    const notifs = await db.orm.public.Notification.where({ recipientId: WATCHER1_ID }).all();
    const discount = notifs.find((n: any) => n.entityType === "discountCampaign");
    expect(discount).toBeTruthy();
    expect(discount!.title).toContain("W3 Sale");

    // Idempotency: a repeat dispatch does not re-notify the same campaign.
    const before = await notificationCount(WATCHER1_ID);
    await app
      .post("/alerts/dispatch")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(await notificationCount(WATCHER1_ID)).toBe(before);
  });

  it("VERSION_RELEASED: hook delivery + 24h sweep with dedup", async () => {
    // WATCHER2 watches R2 for releases.
    await app
      .put(`/resources/pa-res2-${SUFFIX}/alert`)
      .set("Authorization", `Bearer ${watcher2Token}`)
      .send({ events: ["VERSION_RELEASED"] })
      .expect(201);

    await db.orm.public.ResourceVersion.create({
      id: V1_R2, resourceId: R2, version: "2.0.0", changelog: "Фикс дрифта",
      fileUrl: "a.zip", fileSize: 1, fileChecksum: "c",
      releaseStatus: "PUBLISHED", publishedAt: iso(3600_000),
    });

    // Inline hook (the function versions.ts/admin publish path will call).
    const hooked = await notifyVersionReleases(R2, {
      id: V1_R2, version: "2.0.0", changelog: "Фикс дрифта",
    });
    expect(hooked).toBe(1);
    const notifs = await db.orm.public.Notification.where({ recipientId: WATCHER2_ID }).all();
    const release = notifs.find((n: any) => n.entityType === "resourceVersion");
    expect(release).toBeTruthy();
    expect(release!.title).toContain("2.0.0");

    // Dedup: the same version never notifies twice.
    const again = await notifyVersionReleases(R2, { id: V1_R2, version: "2.0.0" });
    expect(again).toBe(0);

    // Unpublished resources deliver nothing.
    const draftHook = await notifyVersionReleases(R3, {
      id: "00000000-0000-0000-0000-750000000199", version: "9.9.9",
    });
    expect(draftHook).toBe(0);

    // CRON sweep picks up a fresh release within 24h.
    await db.orm.public.ResourceVersion.create({
      id: V2_R2, resourceId: R2, version: "2.1.0", changelog: null,
      fileUrl: "b.zip", fileSize: 1, fileChecksum: "c",
      releaseStatus: "PUBLISHED", publishedAt: iso(1800_000),
    });
    const swept = await sweepRecentVersionReleases();
    expect(swept).toBe(1);
    const after = await db.orm.public.Notification.where({ recipientId: WATCHER2_ID }).all();
    expect(after.some((n: any) => n.entityType === "resourceVersion" && n.title.includes("2.1.0"))).toBe(true);
    // Sweep idempotency.
    const sweptAgain = await sweepRecentVersionReleases();
    expect(sweptAgain).toBe(0);
  });
});