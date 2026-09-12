// PLAN-018 K-004/K-005 integration tests: seller-facing advertising billing.
// Covers: seller creates campaign + checkout order (DRAFT + PENDING, owned by
// the seller, placement pricing), CAS order link (idempotent, conflict on
// relink), billing status follows payment capture, mine list, admin approval
// flow untouched (K-006), ownership hiding, flag-off 404.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";
import { isLedgerTransactionBalanced } from "@server/lib/ledger";
import { AD_PLACEMENT_PRICING, linkCampaignToOrder } from "@server/lib/adsBilling";

const app = request(createApp());

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655447901";
const SELLER_ID_REF = "550e8400-e29b-41d4-a716-446655447902";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655447903";
const SELLER_ID = SELLER_ID_REF;
const SUFFIX = Date.now().toString(36);

let adminToken = "";
let sellerToken = "";
let otherToken = "";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[campaign-billing.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

/** FK-safe cleanup for everything this suite created (db-reset is frozen). */
async function cleanupWaveEntities(): Promise<void> {
  const advertisers = [SELLER_ID_REF, OTHER_ID];
  const campaigns = (await db.orm.public.AdCampaign.where({}).all()) as Array<{
    id: string;
    advertiserId: string;
    orderId: string | null;
  }>;
  for (const campaign of campaigns) {
    if (!advertisers.includes(campaign.advertiserId)) continue;
    if (campaign.orderId) {
      const items = (await db.orm.public.OrderItem.where({ orderId: campaign.orderId }).all()) as Array<{ id: string }>;
      for (const item of items) {
        const payments = (await db.orm.public.Payment.where({ orderItemId: item.id } as any).all()) as Array<{ id: string }>;
        for (const p of payments) {
          await db.orm.public.Payment.where({ id: p.id }).delete().catch(() => undefined);
        }
      }
      await db.orm.public.LedgerEntry.where({ orderId: campaign.orderId } as any).delete().catch(() => undefined);
      await db.orm.public.Order.where({ id: campaign.orderId }).delete().catch(() => undefined);
    }
    const metrics = (await db.orm.public.AdMetric.where({ campaignId: campaign.id }).all()) as Array<{ id: string }>;
    for (const m of metrics) {
      await db.orm.public.AdMetric.where({ id: m.id }).delete().catch(() => undefined);
    }
    await db.orm.public.AdCampaign.where({ id: campaign.id }).delete().catch(() => undefined);
  }
}

beforeAll(async () => {
  if (!dbAvailable) return;
  // FEATURE_* env override contract: features.yaml has advertising: false.
  process.env.FEATURE_ADVERTISING = "true";
  await resetTestEntities();
  adminToken = await createTestUser(ADMIN_ID, `cbadmin_${SUFFIX}`, "ADMIN", generateAccessToken);
  sellerToken = await createTestUser(SELLER_ID_REF, `cbseller_${SUFFIX}`, "USER", generateAccessToken);
  otherToken = await createTestUser(OTHER_ID, `cbother_${SUFFIX}`, "USER", generateAccessToken);
});

afterAll(async () => {
  if (!dbAvailable) return;
  delete process.env.FEATURE_ADVERTISING;
  await cleanupWaveEntities();
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("advertising campaign billing (K-004/K-005)", () => {
  let campaignId = "";
  let orderId = "";

  it("prices every placement per the K-004 table", () => {
    expect(AD_PLACEMENT_PRICING).toEqual({
      HOME_HERO: 500000,
      HOME_RAIL_SECONDARY: 200000,
      MARKET_FEATURED: 300000,
      SERVER_FEATURED: 250000,
      COMMUNITY_FEATURED: 150000,
    });
  });

  it("seller creates a campaign with a checkout order at the placement price", async () => {
    const res = await app
      .post("/advertising/campaigns")
      .set(auth(sellerToken))
      .send({
        name: "Seller hero campaign",
        placement: "HOME_HERO",
        title: "Продвигаю сервер",
        body: "Заходи играть",
      });
    expect(res.status).toBe(201);
    const campaign = res.body.campaign;
    expect(campaign.status).toBe("DRAFT");
    expect(campaign.reviewStatus).toBe("PENDING");
    expect(campaign.advertiserId).toBe(SELLER_ID);
    expect(campaign.orderId).toBe(res.body.checkout.orderId);
    expect(res.body.checkout.amountMinor).toBe(500000);
    expect(res.body.checkout.simulate).toBe(true);
    campaignId = campaign.id;
    orderId = res.body.checkout.orderId;

    // The checkout is a normal commerce Order with one priced platform line.
    const order = (await db.orm.public.Order.where({ id: orderId }).first()) as any;
    expect(order.status).toBe("PENDING");
    expect(order.buyerId).toBe(SELLER_ID);
    expect(order.finalTotal).toBe(500000);
    const item = (await db.orm.public.OrderItem.where({ orderId }).first()) as any;
    expect(item.itemType).toBe("SERVICE");
    expect(item.sellerId).toBe("PLATFORM");
    expect(item.basePrice).toBe(500000);

    // Anonymous creation is rejected.
    const anon = await app.post("/advertising/campaigns").send({ name: "x", placement: "HOME_HERO", title: "t", body: "b" });
    expect(anon.status).toBe(401);
  });

  it("link is idempotent for the same order and conflicts on a different one", async () => {
    const again = await linkCampaignToOrder(campaignId, orderId);
    expect(again.alreadyLinked).toBe(true);
    expect(again.campaign.orderId).toBe(orderId);

    // A second order for the relink attempt is rejected (money already bound).
    const second = await app
      .post("/advertising/campaigns")
      .set(auth(sellerToken))
      .send({ name: "Second", placement: "MARKET_FEATURED", title: "t2", body: "b2" });
    expect(second.status).toBe(201);
    const secondOrderId = second.body.checkout.orderId as string;
    const conflict = await app
      .post(`/advertising/campaigns/${second.body.campaign.id}/activate-payment`)
      .set(auth(sellerToken))
      .send({});
    expect(conflict.status).toBe(200); // its own order completes fine

    const relink = linkCampaignToOrder(campaignId, secondOrderId);
    await expect(relink).rejects.toMatchObject({ status: 409 });
    const missing = linkCampaignToOrder("550e8400-e29b-41d4-a716-4466554479ff", orderId);
    await expect(missing).rejects.toMatchObject({ status: 404 });
  });

  it("billing status follows the payment: pending before capture, paid after", async () => {
    const mine = await app.get("/advertising/campaigns/mine").set(auth(sellerToken));
    expect(mine.status).toBe(200);
    const before = mine.body.data.find((c: any) => c.id === campaignId);
    expect(before.billing.linked).toBe(true);
    expect(before.billing.paid).toBe(false);
    expect(before.billing.orderStatus).toBe("PENDING");
    expect(before.billing.amountMinor).toBe(500000);

    const capture = await app.post(`/advertising/campaigns/${campaignId}/activate-payment`).set(auth(sellerToken)).send({});
    expect(capture.status).toBe(200);
    expect(capture.body.billing.paid).toBe(true);
    expect(capture.body.billing.orderStatus).toBe("COMPLETED");
    expect(capture.body.alreadyCompleted).toBe(false);

    // The paid booking settled platform revenue (balanced double entry).
    expect(await isLedgerTransactionBalanced(`settle:ad-campaign:${orderId}`)).toBe(true);

    // Idempotent replay.
    const replay = await app.post(`/advertising/campaigns/${campaignId}/activate-payment`).set(auth(sellerToken)).send({});
    expect(replay.status).toBe(200);
    expect(replay.body.alreadyCompleted).toBe(true);
  });

  it("a bound payment attempt drives billing status through the same endpoint", async () => {
    const created = await app
      .post("/advertising/campaigns")
      .set(auth(sellerToken))
      .send({ name: "Paid attempt", placement: "COMMUNITY_FEATURED", title: "t", body: "b" });
    const id = created.body.campaign.id as string;
    const checkoutOrderId = created.body.checkout.orderId as string;
    const item = (await db.orm.public.OrderItem.where({ orderId: checkoutOrderId }).first()) as any;

    // Simulate a provider payment attempt bound to the checkout line (the
    // shape the payments webhook would confirm).
    const payment = (await db.orm.public.Payment.create({
      purchaseId: null,
      orderItemId: item.id,
      provider: "TEST",
      providerPaymentId: `test-${checkoutOrderId}-${SUFFIX}`,
      amount: 150000,
      currency: "RUB",
      status: "PENDING",
      metadata: { kind: "AD_CAMPAIGN", orderId: checkoutOrderId },
    } as any)) as any;

    let mine = await app.get("/advertising/campaigns/mine").set(auth(sellerToken));
    let row = mine.body.data.find((c: any) => c.id === id);
    expect(row.billing.paid).toBe(false);
    expect(row.billing.paymentStatus).toBe("PENDING");
    expect(row.billing.paymentId).toBe(payment.id);

    const capture = await app
      .post(`/advertising/campaigns/${id}/activate-payment`)
      .set(auth(sellerToken))
      .send({ paymentId: payment.id });
    expect(capture.status).toBe(200);
    expect(capture.body.billing.paid).toBe(true);
    expect(capture.body.billing.orderStatus).toBe("COMPLETED");

    mine = await app.get("/advertising/campaigns/mine").set(auth(sellerToken));
    const after = mine.body.data.find((c: any) => c.id === id);
    expect(after.billing.paid).toBe(true);
    expect(after.billing.amountMinor).toBe(150000);
    expect(after.metrics).toEqual({ impressions: 0, clicks: 0 });
    expect(after.analytics.totals).toBeDefined();
  });

  it("hides campaigns from non-owners and keeps the admin approval flow (K-006)", async () => {
    const foreign = await app.post(`/advertising/campaigns/${campaignId}/activate-payment`).set(auth(otherToken)).send({});
    expect(foreign.status).toBe(404);
    const empty = await app.get("/advertising/campaigns/mine").set(auth(otherToken));
    expect(empty.status).toBe(200);
    expect(empty.body.data).toHaveLength(0);

    // The admin review flow still works on the paid campaign and serving
    // reflects it (public placement endpoints untouched).
    const approve = await app.post(`/admin/advertising/campaigns/${campaignId}/transition`).set(auth(adminToken)).send({ action: "approve" });
    expect(approve.status).toBe(200);
    expect(approve.body.reviewStatus).toBe("APPROVED");
    const activate = await app.post(`/admin/advertising/campaigns/${campaignId}/transition`).set(auth(adminToken)).send({ action: "activate" });
    expect(activate.status).toBe(200);
    expect(activate.body.status).toBe("ACTIVE");
    const serving = await app.get("/advertising/placements/HOME_HERO");
    expect(serving.body.items.map((i: any) => i.id)).toContain(campaignId);
  });

  it("answers 401 without a token and 404 with the advertising flag off", async () => {
    const anon = await app.post("/advertising/campaigns").send({ name: "x", placement: "HOME_HERO", title: "t", body: "b" });
    expect(anon.status).toBe(401);
    const anonMine = await app.get("/advertising/campaigns/mine");
    expect(anonMine.status).toBe(401);

    process.env.FEATURE_ADVERTISING = "false";
    try {
      const purchase = await app
        .post("/advertising/campaigns")
        .set(auth(sellerToken))
        .send({ name: "x", placement: "HOME_HERO", title: "t", body: "b" });
      expect(purchase.status).toBe(404);
      expect(purchase.body).toEqual({ error: "Not found" });
      const mine = await app.get("/advertising/campaigns/mine").set(auth(sellerToken));
      expect(mine.status).toBe(404);
    } finally {
      process.env.FEATURE_ADVERTISING = "true";
    }
  });
});
