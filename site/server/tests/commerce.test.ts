// PLAN Block 4 commerce tests:
// - C-003/C-008: free flow (finalTotal == 0 => no payment, atomic completion,
//   exactly one license per order item, duplicate checkout rejected);
// - C-006: immutable price/discount snapshot on OrderItem;
// - C-007: single-use coupon survives concurrent completions (CAS);
// - C-012: Order/OrderItem aggregate wired to Purchase.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";
import { validateDiscount } from "../src/lib/discount";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655446301";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655446302";
const RACE_BASE = 6303; // 20 extra buyers for the coupon race: ...6303..6322
const SUFFIX = Date.now().toString(36);

const PAID_SLUG = `blk4-paid-${SUFFIX}`;
const PAID2_SLUG = `blk4-paid2-${SUFFIX}`;
const PAID3_SLUG = `blk4-paid3-${SUFFIX}`;
const FREE_SLUG = `blk4-free-${SUFFIX}`;

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[commerce.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let buyerToken = "";
let sellerToken = "";

async function seedCampaign(overrides: Record<string, unknown> = {}) {
  return db.orm.public.DiscountCampaign.create({
    sellerId: SELLER_ID,
    name: `camp-${SUFFIX}-${Math.random().toString(36).slice(2, 7)}`,
    type: "PERCENT",
    value: 50,
    currency: "RUB",
    scope: "ALL",
    isActive: true,
    ...overrides,
  });
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();

  buyerToken = await createTestUser(BUYER_ID, `blk4buyer_${SUFFIX}`, "USER", generateAccessToken);
  sellerToken = await createTestUser(SELLER_ID, `blk4seller_${SUFFIX}`, "USER", generateAccessToken);

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
      fileUrl: `/uploads/blk4-${slug}.zip`,
      fileSize: 100,
      fileChecksum: "x",
    });
    return resource;
  };

  await mkResource(PAID_SLUG, "Block4 Paid", 10000);
  await mkResource(PAID2_SLUG, "Block4 Paid 2", 10000);
  await mkResource(PAID3_SLUG, "Block4 Paid 3", 10000);
  await mkResource(FREE_SLUG, "Block4 Free", 0);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("C-003/C-008: free resource flow", () => {
  it("free checkout completes atomically without any payment", async () => {
    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: FREE_SLUG });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("completed");
    expect(res.body.licenseId).toBeTruthy();

    const purchase = await db.orm.public.Purchase.where({ id: res.body.purchaseId }).first();
    expect(purchase?.status).toBe("COMPLETED");
    expect(purchase?.finalPrice).toBe(0);

    // INV-002: no payment provider intent for a zero-total order
    const payments = await db.orm.public.Payment.where({ purchaseId: purchase!.id }).all();
    expect(payments.length).toBe(0);

    // INV-006: exactly one license for the completed purchase
    const licenses = await db.orm.public.License.where({ purchaseId: purchase!.id }).all();
    expect(licenses.length).toBe(1);

    // C-012: order aggregate exists and is completed
    const item = await db.orm.public.OrderItem.where({ id: purchase!.orderItemId }).first();
    expect(item?.itemType).toBe("RESOURCE");
    const order = await db.orm.public.Order.where({ id: item!.orderId }).first();
    expect(order?.status).toBe("COMPLETED");
    expect(order?.finalTotal).toBe(0);
  });

  it("rejects a duplicate checkout for an owned resource (409)", async () => {
    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: FREE_SLUG });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("already_owned");
  });
});

describe.skipIf(!dbAvailable)("C-004..C-006: discount validation and snapshot", () => {
  it("applies a seller campaign and snapshots the line immutably", async () => {
    const campaign = await seedCampaign({ code: `SAVE50-${SUFFIX}`, value: 50 });

    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: PAID_SLUG, discountCode: `SAVE50-${SUFFIX}` });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.amount).toBe(5000);

    const purchase = await db.orm.public.Purchase.where({ id: res.body.purchaseId }).first();
    expect(purchase?.discountSnapshot).toBe(5000);
    expect(purchase?.finalPrice).toBe(5000);

    const item = await db.orm.public.OrderItem.where({ id: purchase!.orderItemId }).first();
    expect(item?.basePrice).toBe(10000);
    expect(item?.discountAmount).toBe(5000);
    expect(item?.discountCampaignId).toBe(campaign.id);
    expect(item?.finalPrice).toBe(5000);
    expect(item?.platformFee).toBe(500);
    expect(item?.sellerNet).toBe(4500);

    // INV-004: seller edits campaign + price afterwards — the snapshot holds
    await db.orm.public.DiscountCampaign.where({ id: campaign.id }).update({ value: 99 });
    await db.orm.public.Resource.where({ id: item!.resourceId }).update({ price: 99999 });
    const itemAfter = await db.orm.public.OrderItem.where({ id: item!.id }).first();
    expect(itemAfter?.discountAmount).toBe(5000);
    expect(itemAfter?.finalPrice).toBe(5000);
  });

  it("rejects an unknown or inactive code (400)", async () => {
    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: PAID2_SLUG, discountCode: `NOPE-${SUFFIX}` });
    expect(res.status).toBe(400);
  });

  it("rejects a per-user-limited code the user already used", async () => {
    const campaign = await seedCampaign({ code: `ONCE-${SUFFIX}`, value: 10, perUserLimit: 1 });
    // Complete one paid purchase consuming the code via the completion path
    const res1 = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: PAID3_SLUG, discountCode: `ONCE-${SUFFIX}` });
    expect(res1.status).toBe(201);
    const simulate = await app
      .post(`/payments/${res1.body.purchaseId}/simulate`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(simulate.status).toBe(200);

    // Direct validation: the same user may not consume it again (C-004)
    const validation = await validateDiscount({
      code: `ONCE-${SUFFIX}`,
      scope: "RESOURCE",
      sellerId: SELLER_ID,
      basePrice: 10000,
      currency: "RUB",
      userId: BUYER_ID,
    });
    expect(validation.valid).toBe(false);
    if (!validation.valid) {
      expect(validation.error).toContain("already used");
    }

    // A fresh checkout of the now-owned resource hits the ownership guard
    const res2 = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: PAID3_SLUG, discountCode: `ONCE-${SUFFIX}` });
    expect(res2.status).toBe(409);
  });
});

describe.skipIf(!dbAvailable)("C-007: single-use coupon under concurrency", () => {
  it("usage_limit=1 with 20 concurrent completions => exactly one consumption", async () => {
    const campaign = await seedCampaign({
      code: `RACE-${SUFFIX}`,
      value: 10,
      usageLimit: 1,
      perUserLimit: null,
    });

    // 20 distinct buyers, each with a pending checkout using the code
    const buyerIds: string[] = [];
    const purchaseIds: string[] = [];
    for (let i = 0; i < 20; i++) {
      // ids inside the cleanup prefix range: 550e8400-...-446655446303..6322
      const fixedId = `550e8400-e29b-41d4-a716-44665544${String(RACE_BASE + i).padStart(4, "0")}`;
      buyerIds.push(fixedId);
      await createTestUser(fixedId, `blk4race${i}_${SUFFIX}`, "USER", generateAccessToken);
      const res = await app
        .post("/purchases")
        .set("Authorization", `Bearer ${generateAccessToken({ userId: fixedId, email: `${fixedId}@test.local`, role: "USER" })}`)
        .send({ resourceSlug: PAID_SLUG, discountCode: `RACE-${SUFFIX}` });
      expect(res.status).toBe(201);
      purchaseIds.push(res.body.purchaseId);
    }

    // Fire all completions concurrently through the simulate path
    const results = await Promise.all(
      purchaseIds.map((pid) =>
        app
          .post(`/payments/${pid}/simulate`)
          .set(
            "Authorization",
            `Bearer ${generateAccessToken({
              userId: buyerIds[purchaseIds.indexOf(pid)],
              email: "x@test.local",
              role: "USER",
            })}`
          )
      )
    );

    const succeeded = results.filter((r) => r.status === 200);
    const rejected = results.filter((r) => r.status === 409);
    expect(succeeded.length).toBe(1);
    expect(rejected.length).toBe(19);

    const usages = await db.orm.public.DiscountUsage.where({ campaignId: campaign.id }).all();
    expect(usages.length).toBe(1);

    const fresh = await db.orm.public.DiscountCampaign.where({ id: campaign.id }).first();
    expect(Number(fresh?.usedCount)).toBe(1);

    const completed = await db.orm.public.Purchase.where({ status: "COMPLETED" }).all();
    expect(completed.filter((p) => purchaseIds.includes(p.id)).length).toBe(1);
  });
});
