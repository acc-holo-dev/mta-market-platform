// PLAN-018 A-005 buyer transaction history tests (GET /payments/transactions/mine):
// - unified honest shape: payments (amount, provider, status, createdAt),
//   refunds (independent lifecycle) and the purchase references they belong to;
// - bounded to the 50 most recent per surface;
// - ownership: another buyer sees none of it; unauthenticated → 401.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const BUYER_ID = "550e8400-e29b-41d4-a716-446655446711";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655446712";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655446713";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[transactions.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let buyerToken = "";

const paymentIds: string[] = [];

/** Token for the second buyer (ownership isolation checks). */
function otherToken(): string {
  return generateAccessToken({ userId: OTHER_ID, email: "x@test.local", role: "USER" });
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();

  buyerToken = await createTestUser(BUYER_ID, `tx18buyer_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(OTHER_ID, `tx18other_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(SELLER_ID, `tx18seller_${SUFFIX}`, "USER", generateAccessToken);

  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `tx18-res-${SUFFIX}`,
    title: "Tx fixture",
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 5000,
  });
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/tx18-${SUFFIX}.zip`,
    fileSize: 100,
    fileChecksum: "x",
  });
  // Second resource for the buyer's pending purchase: at most one live
  // (PENDING|COMPLETED) purchase per buyer+resource (purchase_buyer_resource_live_uq).
  const resource2 = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `tx18-res2-${SUFFIX}`,
    title: "Tx fixture 2",
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 5000,
  });
  const version2 = await db.orm.public.ResourceVersion.create({
    resourceId: resource2.id,
    version: "1.0.0",
    fileUrl: `/uploads/tx18b-${SUFFIX}.zip`,
    fileSize: 100,
    fileChecksum: "x",
  });

  // Buyer: one completed purchase (settled payment + SUCCEEDED refund) and one
  // pending purchase (pending payment attempt) — the full honest history.
  const order = await db.orm.public.Order.create({
    buyerId: BUYER_ID,
    status: "COMPLETED",
    currency: "RUB",
    subtotal: 5000,
    finalTotal: 5000,
    completedAt: new Date().toISOString(),
  });
  const item = await db.orm.public.OrderItem.create({
    orderId: order.id,
    itemType: "RESOURCE",
    resourceId: resource.id,
    sellerId: SELLER_ID,
    titleSnapshot: resource.title,
    currency: "RUB",
    basePrice: 5000,
    finalPrice: 5000,
    platformFee: 500,
    sellerNet: 4500,
  });
  const purchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    orderItemId: item.id,
    status: "COMPLETED",
    completedAt: new Date().toISOString(),
    priceSnapshot: 5000,
    finalPrice: 5000,
    platformFee: 500,
    sellerRevenue: 4500,
  });
  const pendingPurchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource2.id,
    versionId: version2.id,
    status: "PENDING",
    priceSnapshot: 5000,
    finalPrice: 5000,
    platformFee: 500,
    sellerRevenue: 4500,
  });

  const settled = await db.orm.public.Payment.create({
    purchaseId: purchase.id,
    provider: "YUKASSA",
    providerPaymentId: `pay-tx18-ok-${SUFFIX}`,
    amount: 5000,
    currency: "RUB",
    status: "SETTLED",
    succeededAt: new Date().toISOString(),
  });
  paymentIds.push(settled.id);
  await db.orm.public.Payment.create({
    purchaseId: pendingPurchase.id,
    provider: "YUKASSA",
    providerPaymentId: `pay-tx18-pend-${SUFFIX}`,
    amount: 5000,
    currency: "RUB",
    status: "PENDING",
  });
  await db.orm.public.Refund.create({
    paymentId: settled.id,
    amount: 5000,
    currency: "RUB",
    status: "SUCCEEDED",
    reason: "buyer changed mind",
    processedAt: new Date().toISOString(),
  });

  // Another buyer's money: must never leak into the first buyer's history.
  const otherPurchase = await db.orm.public.Purchase.create({
    buyerId: OTHER_ID,
    resourceId: resource.id,
    versionId: version.id,
    status: "PENDING",
    priceSnapshot: 5000,
    finalPrice: 5000,
    platformFee: 500,
    sellerRevenue: 4500,
  });
  paymentIds.push(
    (await db.orm.public.Payment.create({
      purchaseId: otherPurchase.id,
      provider: "YUKASSA",
      providerPaymentId: `pay-tx18-other-${SUFFIX}`,
      amount: 5000,
      currency: "RUB",
      status: "SETTLED",
    })).id
  );
});

afterAll(async () => {
  if (!dbAvailable) return;
  // Refunds restrict-delete on payment: refund rows go first.
  for (const id of paymentIds) {
    await db.orm.public.Refund.where({ paymentId: id }).delete().catch(() => undefined);
    await db.orm.public.Payment.where({ id }).delete().catch(() => undefined);
  }
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("buyer transaction history (A-005)", () => {
  it("requires authentication", async () => {
    const res = await app.get("/payments/transactions/mine");
    expect(res.status).toBe(401);
  });

  it("returns the unified history: payments, refunds and purchase refs", async () => {
    const res = await app
      .get("/payments/transactions/mine")
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);

    // Payments: honest projection with the fields the dashboard needs.
    expect(res.body.payments.length).toBe(2);
    const byStatus = new Map<string, any>(
      res.body.payments.map((p: any) => [p.status, p])
    );
    const settled = byStatus.get("SETTLED");
    const pending = byStatus.get("PENDING");
    expect(settled.amount).toBe(5000);
    expect(settled.provider).toBe("YUKASSA");
    expect(settled.createdAt).toBeTruthy();
    expect(settled.succeededAt).toBeTruthy();
    expect(pending.provider).toBe("YUKASSA");

    // Refunds: the SUCCEEDED full refund of the settled payment.
    expect(res.body.refunds.length).toBe(1);
    expect(res.body.refunds[0].amount).toBe(5000);
    expect(res.body.refunds[0].status).toBe("SUCCEEDED");
    expect(res.body.refunds[0].reason).toBe("buyer changed mind");
    expect(res.body.refunds[0].paymentId).toBe(settled.id);

    // Purchase references (the money's "what for").
    expect(res.body.purchases.length).toBe(2);
    const completed = res.body.purchases.find((p: any) => p.status === "COMPLETED");
    expect(completed.finalPrice).toBe(5000);
    expect(completed.resourceId).toBeTruthy();

    expect(res.body.totals).toEqual({ payments: 2, refunds: 1, purchases: 2 });
  });

  it("never leaks another buyer's transactions", async () => {
    const res = await app
      .get("/payments/transactions/mine")
      .set("Authorization", `Bearer ${otherToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.payments.length).toBe(1);
    expect(res.body.refunds.length).toBe(0);
    expect(
      res.body.payments.every((p: any) => p.purchaseId !== null)
    ).toBe(true);
  });
});