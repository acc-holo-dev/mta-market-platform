// PLAN-012 §12/§16: refund correctness under concurrency.
//
// Invariants:
//  - N parallel refund requests for one payment never double-refund — the
//    INV-013 ceiling (per-payment advisory lock + transactional ceiling
//    check) holds across parallel/interleaved requests;
//  - a refund exceeding the remaining refundable amount is rejected 409.
// The provider SDK is mocked (succeeded refunds); transport/auth stay over
// real HTTP via supertest.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

vi.mock("@server/lib/yookassa", () => ({
  YOOKASSA_ENABLED: true,
  YOOKASSA_SHOP_ID: "test-shop",
  createYooKassaPayment: vi.fn(),
  getYooKassaPayment: vi.fn(),
  createYooKassaRefund: vi.fn(),
  YooKassaWebhook: {},
}));

import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { createYooKassaRefund } from "@server/lib/yookassa";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());
const mockedRefund = vi.mocked(createYooKassaRefund);

const ADMIN_ID = "550e8400-e29b-41d4-a716-44665544a700";
const SELLER_ID = "550e8400-e29b-41d4-a716-44665544a701";
const BUYER_ID = "550e8400-e29b-41d4-a716-44665544a702";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[parallel-refund.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let adminToken = "";

/**
 * Seed a settled (captured) payment against a completed purchase of
 * `finalPrice` kopecks, with the settlement applied (seller credited).
 */
async function seedCapturedPayment(finalPrice = 10000): Promise<{ paymentId: string; amount: number }> {
  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `ccy-rf-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Refund race fixture",
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: finalPrice,
  });
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/ccy-rf-${SUFFIX}.zip`,
    fileSize: 100,
    fileChecksum: "x",
  });
  const order = await db.orm.public.Order.create({
    buyerId: BUYER_ID,
    status: "COMPLETED",
    currency: "RUB",
    subtotal: finalPrice,
    finalTotal: finalPrice,
  });
  const platformFee = Math.round(finalPrice * 0.1);
  const item = await db.orm.public.OrderItem.create({
    orderId: order.id,
    itemType: "RESOURCE",
    resourceId: resource.id,
    sellerId: SELLER_ID,
    titleSnapshot: resource.title,
    currency: "RUB",
    basePrice: finalPrice,
    finalPrice,
    platformFee,
    sellerNet: finalPrice - platformFee,
  });
  const purchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    orderItemId: item.id,
    status: "COMPLETED",
    completedAt: new Date().toISOString(),
    priceSnapshot: finalPrice,
    finalPrice,
    platformFee,
    sellerRevenue: finalPrice - platformFee,
  });
  await db.orm.public.License.create({
    purchaseId: purchase.id,
    versionId: version.id,
    status: "ACTIVE",
  });
  const payment = await db.orm.public.Payment.create({
    purchaseId: purchase.id,
    provider: "YUKASSA",
    providerPaymentId: `pay-rf-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
    status: "SETTLED",
    amount: finalPrice,
    currency: "RUB",
    succeededAt: new Date().toISOString(),
  });
  void purchase;
  return { paymentId: payment.id, amount: finalPrice };
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  adminToken = await createTestUser(ADMIN_ID, `ccy-rfa_${SUFFIX}`, "ADMIN", generateAccessToken);
  await createTestUser(SELLER_ID, `ccy-rfs_${SUFFIX}`, "USER", () => "unused");
  await createTestUser(BUYER_ID, `ccy-rfb_${SUFFIX}`, "USER", () => "unused");
  // The provider confirms every refund (the accounting races are the target).
  mockedRefund.mockImplementation(async (input: {
    amountValue: string;
    currency?: string;
  }) => ({
    id: `ref-${Math.random().toString(36).slice(2, 10)}`,
    status: "succeeded",
    amount: { value: input.amountValue, currency: input.currency ?? "RUB" },
  }));
});

afterAll(async () => {
  if (!dbAvailable) return;
  mockedRefund.mockRestore();
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("concurrency: parallel refunds (INV-013)", () => {
  it("N parallel full-amount refunds never exceed one capture (INV-013)", async () => {
    const fixture = await seedCapturedPayment(10000);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        app
          .post("/payments/refunds")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ paymentId: fixture.paymentId }) // default: full remaining
      )
    );

    const succeeded = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 400 || r.status === 409);
    // Exactly one full refund can exist: 1 success + 3 deterministic
    // rejections (409 refund_exceeds_captured, or 400 invalid_amount when
    // the ceiling already dropped to zero).
    expect(succeeded.length).toBe(1);
    expect(succeeded.length + rejected.length).toBe(results.length);

    const refunds = await db.orm.public.Refund.where({ paymentId: fixture.paymentId }).all();
    const refundedTotal = refunds
      .filter((r) => (r as { status: string }).status === "SUCCEEDED")
      .reduce((s: number, r: { amount: number }) => s + r.amount, 0);
    expect(refundedTotal).toBeLessThanOrEqual(fixture.amount);
  });

  it("over-refunding a partially refunded payment is rejected with 409", async () => {
    const fixture = await seedCapturedPayment(10000);

    const first = await app
      .post("/payments/refunds")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ paymentId: fixture.paymentId, amount: 6000 });
    expect(first.status).toBe(201);

    const second = await app
      .post("/payments/refunds")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ paymentId: fixture.paymentId, amount: 6000 });
    expect(second.status).toBe(409);
  });
});
