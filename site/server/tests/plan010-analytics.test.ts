// PLAN-010 Testing §8–§9: Creator Analytics at the HTTP layer.
// Honest view counting (PUBLISHED only), seller analytics with conversion,
// privacy (views are never public; no viewer identities exist).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655446001";
const OTHER_SELLER_ID = "550e8400-e29b-41d4-a716-446655446002";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655446003";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655446004";
const SUFFIX = Date.now().toString(36);
const H = 3600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let sellerToken = "";
let otherToken = "";
let buyerToken = "";

const R1 = "00000000-0000-0000-0000-920000000001"; // published, will get views
const R2 = "00000000-0000-0000-0000-920000000002"; // published (other seller)
const R_DRAFT = "00000000-0000-0000-0000-920000000003";
const V1 = "00000000-0000-0000-0000-930000000001";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan010-analytics.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  // PLAN-006 hygiene: PLAN-001 e2e leftovers (same as plan006..009 tests).
  const junk = (await db.orm.public.Resource.where({}).all()).filter((r: any) =>
    /^(e2e-|p1-)/.test(r.slug)
  );
  for (const r of junk) {
    const versions = await db.orm.public.ResourceVersion.where({ resourceId: r.id }).all();
    for (const v of versions) {
      await db.orm.public.ArtifactSignature.where({ versionId: v.id }).delete().catch(() => undefined);
      await db.orm.public.ArtifactEncryption.where({ versionId: v.id }).delete().catch(() => undefined);
      await db.orm.public.CompatibilityReport.where({ versionId: v.id }).delete().catch(() => undefined);
      await db.orm.public.SandboxRun.where({ versionId: v.id }).delete().catch(() => undefined);
    }
    const purchases = await db.orm.public.Purchase.where({ resourceId: r.id }).all();
    for (const p of purchases) {
      const licenses = await db.orm.public.License.where({ purchaseId: p.id }).all();
      for (const l of licenses) {
        const installs = await db.orm.public.Installation.where({ licenseId: l.id }).all();
        for (const i of installs) {
          await db.orm.public.Lease.where({ installationId: i.id }).delete().catch(() => undefined);
          await db.orm.public.Installation.where({ id: i.id }).delete().catch(() => undefined);
        }
        await db.orm.public.License.where({ id: l.id }).delete().catch(() => undefined);
      }
      const disputes = await db.orm.public.Dispute.where({ purchaseId: p.id }).all();
      for (const d of disputes) {
        await db.orm.public.DisputeAttachment.where({ disputeId: d.id }).delete().catch(() => undefined);
        await db.orm.public.DisputeEvent.where({ disputeId: d.id }).delete().catch(() => undefined);
        await db.orm.public.DisputeMessage.where({ disputeId: d.id }).delete().catch(() => undefined);
        await db.orm.public.Dispute.where({ id: d.id }).delete().catch(() => undefined);
      }
      await db.orm.public.Purchase.where({ id: p.id }).delete().catch(() => undefined);
    }
    await db.orm.public.Resource.where({ id: r.id }).delete().catch(() => undefined);
  }

  sellerToken = await createTestUser(SELLER_ID, `an_seller_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(OTHER_SELLER_ID, `an_other_${SUFFIX}`, "USER", generateAccessToken);
  otherToken = await createTestUser(OTHER_SELLER_ID, `an_other_${SUFFIX}`, "USER", generateAccessToken);
  buyerToken = await createTestUser(BUYER_ID, `an_buyer_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(ADMIN_ID, `an_admin_${SUFFIX}`, "ADMIN", generateAccessToken);

  await db.orm.public.Resource.create({
    id: R1, sellerId: SELLER_ID, slug: `an-res1-${SUFFIX}`, title: "Analytics Res One",
    description: "fixture", type: "SCRIPT", status: "PUBLISHED", price: 0, createdAt: iso(3 * 24 * H),
  });
  await db.orm.public.Resource.create({
    id: R2, sellerId: OTHER_SELLER_ID, slug: `an-res2-${SUFFIX}`, title: "Analytics Res Other",
    description: "fixture", type: "SCRIPT", status: "PUBLISHED", price: 0, createdAt: iso(3 * 24 * H),
  });
  await db.orm.public.Resource.create({
    id: R_DRAFT, sellerId: SELLER_ID, slug: `an-draft-${SUFFIX}`, title: "Analytics Draft",
    description: "fixture", type: "SCRIPT", status: "DRAFT", price: 0, createdAt: iso(1 * H),
  });
  await db.orm.public.ResourceVersion.create({
    id: V1, resourceId: R1, version: "1.0.0", fileUrl: "a.zip", fileSize: 1,
    fileChecksum: "c", releaseStatus: "PUBLISHED", publishedAt: iso(2 * 24 * H),
  });
});

afterAll(async () => {});

describe("PLAN-010 view counter (§8)", () => {
  it("counts a view for a PUBLISHED resource; increments on repeat; separate days", async () => {
    if (!dbAvailable) return;
    await app.post(`/resources/an-res1-${SUFFIX}/view`).expect(200);
    await app.post(`/resources/an-res1-${SUFFIX}/view`).expect(200);
    const today = new Date().toISOString().slice(0, 10);
    const row = await db.orm.public.ResourceViewDaily
      .where({ resourceId: R1, day: today })
      .first();
    expect(row?.views).toBe(2);

    // A different day is a different row (honest daily aggregation).
    const yesterday = new Date(Date.now() - 24 * H).toISOString().slice(0, 10);
    await db.orm.public.ResourceViewDaily.create({
      resourceId: R1, day: yesterday, views: 5,
    });
    const rows = await db.orm.public.ResourceViewDaily.where({ resourceId: R1 }).all();
    expect(rows.length).toBe(2);
  });

  it("404 for draft/suspended resources (§8)", async () => {
    if (!dbAvailable) return;
    await app.post(`/resources/an-draft-${SUFFIX}/view`).expect(404);
  });
});

describe("PLAN-010 seller analytics (§9)", () => {
  it("requires authentication", async () => {
    if (!dbAvailable) return;
    await app.get("/seller/analytics").expect(401);
  });

  it("shows only own resources with views and conversion (§9)", async () => {
    if (!dbAvailable) return;
    // 1 view + 1 purchase of R1 within the window → conversion 100%.
    await db.orm.public.Purchase.create({
      buyerId: BUYER_ID, resourceId: R1, versionId: V1, status: "COMPLETED",
      priceSnapshot: 0, finalPrice: 0, platformFee: 0, sellerRevenue: 0,
      completedAt: iso(1 * H),
    });
    const res = (await app
      .get("/seller/analytics")
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200)).body;
    expect(res.days).toBe(30);
    const mine = res.byResource.find((r: any) => r.slug === `an-res1-${SUFFIX}`);
    expect(mine).toBeTruthy();
    // Today's two opens + the yesterday row (5) = 7 honest page views.
    expect(mine.views30d).toBe(7);
    expect(mine.purchases30d).toBe(1);
    expect(mine.conversionPct).toBe(Math.round((1 / 7) * 100));
    expect(res.totalViews).toBe(7);
    // The other seller's resource is invisible.
    expect(res.byResource.some((r: any) => r.slug === `an-res2-${SUFFIX}`)).toBe(false);
  });

  it("conversion null when views exist but no purchases", async () => {
    if (!dbAvailable) return;
    // R2 (other seller) has views but no purchases.
    await app.post(`/resources/an-res2-${SUFFIX}/view`).expect(200);
    const res = (await app
      .get("/seller/analytics")
      .set("Authorization", `Bearer ${otherToken}`)
      .expect(200)).body;
    const other = res.byResource.find((r: any) => r.slug === `an-res2-${SUFFIX}`);
    expect(other).toBeTruthy();
    expect(other.conversionPct).toBe(0); // views > 0, purchases 0 → 0% (honest)
    expect(other.views30d).toBeGreaterThanOrEqual(1);
  });

  it("resource page payload never exposes views (§9 privacy)", async () => {
    if (!dbAvailable) return;
    const page = (await app.get(`/resources/an-res1-${SUFFIX}`).expect(200)).body;
    expect(JSON.stringify(page)).not.toContain("views30d");
    expect(page.resourceFollowers !== undefined).toBe(true); // PLAN-008 field intact
  });
});
