// PLAN-018 B-001/B-002 discount campaign API tests:
// - seller CRUD: create (PERCENT/FIXED, window, limits, code), scoped
//   resourceIds, list with usage counts, PATCH/DELETE only when inactive,
//   activate/deactivate with expiry guard, wrong-seller isolation;
// - API-side validation rejections (percent range, fixed vs cheapest product,
//   window sanity, usage limits, duplicate codes);
// - B-002 checkout-side enforcement with an API-created campaign:
//   expired/future window, max-uses, per-user limit, wrong-seller code,
//   zero-total (free checkout never consumes usage), discount == cheapest
//   product (zero-total boundary), and one full checkout completion flow.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655446731";
const SELLER2_ID = "550e8400-e29b-41d4-a716-446655446724";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655446725";
const BUYER2_ID = "550e8400-e29b-41d4-a716-446655446728";
const BUYER3_ID = "550e8400-e29b-41d4-a716-446655446729";
const SUFFIX = Date.now().toString(36);

const PAID_SLUG = `d18-paid-${SUFFIX}`;
const PAID2_SLUG = `d18-paid2-${SUFFIX}`;
const CHEAP_SLUG = `d18-cheap-${SUFFIX}`;
const FREE_SLUG = `d18-free-${SUFFIX}`;

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[discounts-api.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let sellerToken = "";
let seller2Token = "";
let buyerToken = "";
let buyer2Token = "";
let buyer3Token = "";

let paidResource: { id: string } | null = null;
let paid2Resource: { id: string } | null = null;
let cheapResource: { id: string } | null = null;

async function createCampaign(token: string, body: Record<string, unknown>) {
  return app.post("/seller/discounts").set("Authorization", `Bearer ${token}`).send(body);
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();

  sellerToken = await createTestUser(SELLER_ID, `d18seller_${SUFFIX}`, "USER", generateAccessToken);
  seller2Token = await createTestUser(SELLER2_ID, `d18seller2_${SUFFIX}`, "USER", generateAccessToken);
  buyerToken = await createTestUser(BUYER_ID, `d18buyer_${SUFFIX}`, "USER", generateAccessToken);
  buyer2Token = await createTestUser(BUYER2_ID, `d18buyer2_${SUFFIX}`, "USER", generateAccessToken);
  buyer3Token = await createTestUser(BUYER3_ID, `d18buyer3_${SUFFIX}`, "USER", generateAccessToken);

  // Only the primary seller gets an approved profile (B-001 gate).
  await db.orm.public.SellerProfile.create({
    userId: SELLER_ID,
    status: "APPROVED",
    payoutEnabled: false,
    displayName: `d18seller_${SUFFIX}`,
  });

  const mkResource = async (slug: string, title: string, price: number) => {
    const resource = await db.orm.public.Resource.create({
      sellerId: SELLER_ID,
      slug,
      title,
      description: "fixture",
      type: "SCRIPT",
      status: "PUBLISHED",
      price,
    });
    await db.orm.public.ResourceVersion.create({
      resourceId: resource.id,
      version: "1.0.0",
      fileUrl: `/uploads/d18-${slug}.zip`,
      fileSize: 100,
      fileChecksum: "x",
    });
    return resource;
  };

  paidResource = await mkResource(PAID_SLUG, "D18 Paid", 10000);
  paid2Resource = await mkResource(PAID2_SLUG, "D18 Paid 2", 10000);
  cheapResource = await mkResource(CHEAP_SLUG, "D18 Cheap", 5000);
  await mkResource(FREE_SLUG, "D18 Free", 0);

  // Another seller's catalog for wrong-seller checks.
  const foreign = await db.orm.public.Resource.create({
    sellerId: SELLER2_ID,
    slug: `d18-foreign-${SUFFIX}`,
    title: "D18 Foreign",
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 3000,
  });
  await db.orm.public.ResourceVersion.create({
    resourceId: foreign.id,
    version: "1.0.0",
    fileUrl: `/uploads/d18-foreign-${SUFFIX}.zip`,
    fileSize: 100,
    fileChecksum: "x",
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("seller discount CRUD (B-001)", () => {
  it("rejects creation without an approved seller profile (403)", async () => {
    const res = await createCampaign(buyerToken, { type: "PERCENT", value: 10 });
    expect(res.status).toBe(403);
  });

  it("rejects a foreign resource in resourceIds (400)", async () => {
    const foreign = await db.orm.public.Resource
      .where({ slug: `d18-foreign-${SUFFIX}` })
      .first();
    const res = await createCampaign(sellerToken, {
      type: "PERCENT",
      value: 10,
      resourceIds: [foreign!.id],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("resource_not_owned");
  });

  it("creates a catalog-wide percent campaign and a scoped multi-resource batch", async () => {
    const res = await createCampaign(sellerToken, {
      type: "PERCENT",
      value: 25,
      code: `D18-${SUFFIX}`,
      perUserLimit: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.campaigns.length).toBe(1);
    expect(res.body.campaigns[0].scope).toBe("ALL");
    expect(res.body.campaigns[0].isActive).toBe(true);
    expect(res.body.campaigns[0].usedCount).toBe(0);

    const scoped = await createCampaign(sellerToken, {
      type: "FIXED",
      value: 1000,
      resourceIds: [paidResource!.id, paid2Resource!.id],
    });
    expect(scoped.status).toBe(201);
    expect(scoped.body.campaigns.length).toBe(2);
    expect(scoped.body.campaigns.every((c: any) => c.scope === "RESOURCE")).toBe(true);
    expect(scoped.body.campaigns.map((c: any) => c.scopeId).sort())
      .toEqual([paidResource!.id, paid2Resource!.id].sort());
  });

  it("rejects percent values outside 1..99 (400)", async () => {
    expect((await createCampaign(sellerToken, { type: "PERCENT", value: 0 })).status).toBe(400);
    expect((await createCampaign(sellerToken, { type: "PERCENT", value: 100 })).status).toBe(400);
    expect((await createCampaign(sellerToken, { type: "PERCENT", value: 12.5 })).status).toBe(400);
  });

  it("rejects a fixed discount above the cheapest product (400)", async () => {
    const res = await createCampaign(sellerToken, { type: "FIXED", value: 6000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("дешёвого товара");
  });

  it("accepts a fixed discount equal to the cheapest product", async () => {
    const res = await createCampaign(sellerToken, { type: "FIXED", value: 5000, usageLimit: 5 });
    expect(res.status).toBe(201);
  });

  it("rejects invalid windows (400)", async () => {
    const inverted = await createCampaign(sellerToken, {
      type: "PERCENT",
      value: 10,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
      endsAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(inverted.status).toBe(400);
    const pastEnd = await createCampaign(sellerToken, {
      type: "PERCENT",
      value: 10,
      endsAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(pastEnd.status).toBe(400);
  });

  it("rejects invalid usage limits (400)", async () => {
    const zeroLimit = await createCampaign(sellerToken, { type: "PERCENT", value: 10, usageLimit: 0 });
    expect(zeroLimit.status).toBe(400);
    const perUser2 = await createCampaign(sellerToken, { type: "PERCENT", value: 10, perUserLimit: 2 });
    expect(perUser2.status).toBe(400);
  });

  it("rejects a duplicate promo code (409)", async () => {
    const code = `DUP-${SUFFIX}`;
    const first = await createCampaign(sellerToken, { type: "PERCENT", value: 10, code });
    expect(first.status).toBe(201);
    const second = await createCampaign(sellerToken, { type: "PERCENT", value: 20, code });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("code_already_exists");
  });

  it("lists own campaigns with usage counts (and not other sellers')", async () => {
    const res = await app.get("/seller/discounts").set("Authorization", `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.discounts.every((c: any) => c.sellerId === SELLER_ID)).toBe(true);
    expect(res.body.discounts.every((c: any) => typeof c.usageCount === "number")).toBe(true);
  });

  it("blocks PATCH/DELETE of an active campaign, allows them after deactivate", async () => {
    const created = await createCampaign(sellerToken, {
      type: "PERCENT",
      value: 15,
      code: `EDIT-${SUFFIX}`,
    });
    const id = created.body.campaigns[0].id;

    const patchActive = await app
      .patch(`/seller/discounts/${id}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ value: 30 });
    expect(patchActive.status).toBe(409);
    expect(patchActive.body.code).toBe("campaign_active");

    const deleteActive = await app
      .delete(`/seller/discounts/${id}`)
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(deleteActive.status).toBe(409);

    const deactivated = await app
      .post(`/seller/discounts/${id}/deactivate`)
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.isActive).toBe(false);

    const patched = await app
      .patch(`/seller/discounts/${id}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ value: 30 });
    expect(patched.status).toBe(200);
    expect(patched.body.value).toBe(30);

    const deleted = await app
      .delete(`/seller/discounts/${id}`)
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(deleted.status).toBe(200);
  });

  it("isolates campaigns per seller (404 for a foreign campaign)", async () => {
    const created = await createCampaign(sellerToken, {
      type: "PERCENT",
      value: 10,
      code: `OWN-${SUFFIX}`,
    });
    const id = created.body.campaigns[0].id;

    const foreignPatch = await app
      .patch(`/seller/discounts/${id}`)
      .set("Authorization", `Bearer ${seller2Token}`)
      .send({ value: 99 });
    expect(foreignPatch.status).toBe(404);

    const foreignDelete = await app
      .delete(`/seller/discounts/${id}`)
      .set("Authorization", `Bearer ${seller2Token}`);
    expect(foreignDelete.status).toBe(404);

    const foreignState = await app
      .post(`/seller/discounts/${id}/deactivate`)
      .set("Authorization", `Bearer ${seller2Token}`);
    expect(foreignState.status).toBe(404);
  });

  it("refuses to activate an expired campaign (409)", async () => {
    const created = await createCampaign(sellerToken, {
      type: "PERCENT",
      value: 10,
      code: `EXPA-${SUFFIX}`,
    });
    const id = created.body.campaigns[0].id;
    await app.post(`/seller/discounts/${id}/deactivate`).set("Authorization", `Bearer ${sellerToken}`);
    await db.orm.public.DiscountCampaign.where({ id }).update({
      endsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await app
      .post(`/seller/discounts/${id}/activate`)
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("campaign_expired");
  });
});

describe.skipIf(!dbAvailable)("B-002: checkout-side validation with API-created campaigns", () => {
  it("runs the full checkout flow with an API-created campaign (per-user limit)", async () => {
    const code = `CHECKOUT-${SUFFIX}`;
    const created = await createCampaign(sellerToken, {
      type: "PERCENT",
      value: 50,
      code,
      perUserLimit: 1,
    });
    expect(created.status).toBe(201);

    const checkout = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: PAID_SLUG, discountCode: code });
    expect(checkout.status).toBe(201);
    expect(checkout.body.amount).toBe(5000);

    // Complete the purchase: usage is consumed at completion (C-007).
    const simulate = await app
      .post(`/payments/${checkout.body.purchaseId}/simulate`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(simulate.status).toBe(200);

    // The seller list shows the honest usage count.
    const listed = await app.get("/seller/discounts").set("Authorization", `Bearer ${sellerToken}`);
    const campaign = listed.body.discounts.find((c: any) => c.code === code);
    expect(campaign.usageCount).toBe(1);

    // Per-user limit: the same buyer cannot consume it again (400 at checkout).
    const secondAttempt = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: PAID2_SLUG, discountCode: code });
    expect(secondAttempt.status).toBe(400);
    expect(secondAttempt.body.code).toBe("discount_invalid");
  });

  it("rejects an expired campaign at checkout (400)", async () => {
    const code = `EXPIRED-${SUFFIX}`;
    const created = await createCampaign(sellerToken, { type: "PERCENT", value: 20, code });
    await db.orm.public.DiscountCampaign.where({ id: created.body.campaigns[0].id }).update({
      endsAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: PAID2_SLUG, discountCode: code });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("discount_invalid");
  });

  it("rejects a future campaign at checkout (400)", async () => {
    const code = `FUTURE-${SUFFIX}`;
    const created = await createCampaign(sellerToken, {
      type: "PERCENT",
      value: 20,
      code,
      startsAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(created.status).toBe(201);
    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: PAID2_SLUG, discountCode: code });
    expect(res.status).toBe(400);
  });

  it("rejects another seller's code at checkout (wrong-seller, 400)", async () => {
    // seller2 has no approved profile → seed their campaign directly; the
    // checkout-side seller scoping is what is under test here.
    const code = `FOREIGN-${SUFFIX}`;
    const campaign = await db.orm.public.DiscountCampaign.create({
      sellerId: SELLER2_ID,
      name: code,
      code,
      type: "PERCENT",
      value: 30,
      currency: "RUB",
      scope: "ALL",
      isActive: true,
    });
    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: PAID2_SLUG, discountCode: code });
    expect(res.status).toBe(400);
    // No usage consumed on the foreign campaign.
    const usages = await db.orm.public.DiscountUsage.where({ campaignId: campaign.id }).all();
    expect(usages.length).toBe(0);
  });

  it("caps the usage limit at checkout (max-uses, 400)", async () => {
    const code = `MAXUSE-${SUFFIX}`;
    const created = await createCampaign(sellerToken, {
      type: "PERCENT",
      value: 10,
      code,
      usageLimit: 1,
      perUserLimit: null,
    });
    // Burn the single use directly (completion-time consumption is covered by
    // the checkout flow test above).
    await db.orm.public.DiscountCampaign.where({ id: created.body.campaigns[0].id }).update({
      usedCount: 1,
    });
    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyer2Token}`)
      .send({ resourceSlug: PAID2_SLUG, discountCode: code });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("discount_invalid");
  });

  it("zero-total (free) checkout never consumes usage", async () => {
    const code = `FREE-${SUFFIX}`;
    await createCampaign(sellerToken, { type: "PERCENT", value: 20, code });
    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyer3Token}`)
      .send({ resourceSlug: FREE_SLUG, discountCode: code });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("completed");
    // A zero-total order applies no discount and consumes nothing.
    const usages = await db.orm.public.DiscountUsage.where({ orderId: res.body.orderId }).all();
    expect(usages.length).toBe(0);
  });

  it("a fixed discount equal to the cheapest price makes that checkout free", async () => {
    const code = `FREEEQ-${SUFFIX}`;
    // Catalog cheapest = 5000 (D18 Cheap); a 5000-kopeck fixed campaign is
    // accepted (== cheapest) and zeroes that item's price.
    const created = await createCampaign(sellerToken, {
      type: "FIXED",
      value: 5000,
      code,
      resourceIds: [cheapResource!.id],
    });
    expect(created.status).toBe(201);
    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyer2Token}`)
      .send({ resourceSlug: CHEAP_SLUG, discountCode: code });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("completed"); // zero-total: completed without payment
    expect(res.body.discount).toEqual({
      applied: true,
      amount: 5000,
      originalPrice: 5000,
      finalPrice: 0,
    });
    const payments = await db.orm.public.Payment.where({ purchaseId: res.body.purchaseId }).all();
    expect(payments.length).toBe(0);
  });
});