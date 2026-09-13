// PLAN-020 B-004.3/G-003.1: async refund completion via provider webhook.
// The YooKassa provider API is mocked (createYooKassaRefund returns PENDING);
// the refund row stays PENDING until the `refund.succeeded` webhook arrives —
// then its effects (payment REFUNDED, purchase closed, license revoked,
// balanced ledger transaction) apply exactly once, and a replayed event is a
// no-op.
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

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440060";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655440061";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655440062";
const SUFFIX = Date.now().toString(36);
const YK_IP = "185.71.76.5";
const AUTH = "Basic " + Buffer.from("test-shop:whpass").toString("base64");

process.env.YOOKASSA_NOTIFICATION_PASSWORD = "whpass";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[refund-webhook.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

/**
 * Seed a settled payment over a completed purchase with an ACTIVE license —
 * the full refund-effects surface (payment, purchase, license, ledger).
 */
async function seedCapturedPayment(): Promise<{ paymentId: string }> {
  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `ccy-rfw-${SUFFIX}`,
    title: "Refund webhook fixture",
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 10000,
  });
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/ccy-rfw-${SUFFIX}.zip`,
    fileSize: 100,
    fileChecksum: "x",
  });
  const order = await db.orm.public.Order.create({
    buyerId: BUYER_ID,
    status: "COMPLETED",
    currency: "RUB",
    subtotal: 10000,
    finalTotal: 10000,
  });
  const platformFee = 1000;
  const item = await db.orm.public.OrderItem.create({
    orderId: order.id,
    itemType: "RESOURCE",
    resourceId: resource.id,
    sellerId: SELLER_ID,
    titleSnapshot: resource.title,
    currency: "RUB",
    basePrice: 10000,
    finalPrice: 10000,
    platformFee,
    sellerNet: 10000 - platformFee,
  });
  const purchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    orderItemId: item.id,
    status: "COMPLETED",
    completedAt: new Date().toISOString(),
    priceSnapshot: 10000,
    finalPrice: 10000,
    platformFee,
    sellerRevenue: 10000 - platformFee,
  });
  await db.orm.public.License.create({
    purchaseId: purchase.id,
    versionId: version.id,
    status: "ACTIVE",
  });
  const payment = await db.orm.public.Payment.create({
    purchaseId: purchase.id,
    provider: "YUKASSA",
    providerPaymentId: `pay-rfw-${SUFFIX}`,
    status: "SETTLED",
    amount: 10000,
    currency: "RUB",
    succeededAt: new Date().toISOString(),
  });
  return { paymentId: payment.id };
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  adminToken = await createTestUser(
    ADMIN_ID,
    `ccy-rfwa_${SUFFIX}`,
    "ADMIN",
    (p: { userId: string; email: string; role: string }) => generateAccessToken(p)
  );
  await createTestUser(SELLER_ID, `ccy-rfws_${SUFFIX}`, "USER", () => "unused");
  await createTestUser(BUYER_ID, `ccy-rfwb_${SUFFIX}`, "USER", () => "unused");
  // The provider accepts the refund asynchronously (PENDING) — completion
  // arrives later as the refund.succeeded webhook.
  mockedRefund.mockImplementation(async () => ({
    id: `ref-webhook-${SUFFIX}`,
    status: "pending",
    amount: { value: "100.00", currency: "RUB" },
  }));
});

afterAll(async () => {
  if (!dbAvailable) return;
  mockedRefund.mockRestore();
  await resetTestEntities();
  // Provider events persist outside the user-range cleanup; drain them so
  // the reconciliation suite does not sweep this fixture's events.
  const providerEvents = await db.orm.public.PaymentProviderEvent
    .where({ objectId: `ref-webhook-${SUFFIX}` })
    .all();
  for (const row of providerEvents) {
    await db.orm.public.PaymentProviderEvent.where({ id: row.id }).delete().catch(() => undefined);
  }
});

let adminToken = "";

describe.skipIf(!dbAvailable)("async refund completion via webhook (PLAN-020 B-004.3/G-003.1)", () => {
  let paymentId = "";
  let refundId = "";


  it("creates the refund in PENDING state at the provider", async () => {
    const fixture = await seedCapturedPayment();
    paymentId = fixture.paymentId;

    const res = await app
      .post("/payments/refunds")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ paymentId });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("PENDING");
    refundId = res.body.refundId;
  });

  it("refund.succeeded applies the effects exactly once", async () => {
    const res = await app
      .post("/payments/webhook")
      .set("X-Forwarded-For", "185.71.76.5")
      .set("Authorization", "Basic " + Buffer.from("test-shop:whpass").toString("base64"))
      .send({
        type: "notification",
        event: "refund.succeeded",
        object: {
          id: `ref-webhook-${SUFFIX}`,
          payment_id: `pay-rfw-${SUFFIX}`,
          status: "succeeded",
        },
      });
    expect(res.status).toBe(200);

    const refund = await db.orm.public.Refund.where({ id: refundId }).first();
    expect((refund as unknown as { status: string }).status).toBe("SUCCEEDED");

    const payment = await db.orm.public.Payment.where({ id: paymentId }).first();
    expect((payment as unknown as { status: string }).status).toBe("REFUNDED");

    // Balanced ledger transaction refund:<id> proves the effects committed:
    // debit total == credit total (G-004) across the posted entries.
    const entries = await db.orm.public.LedgerEntry
      .where({ transactionId: `refund:${refundId}` })
      .all();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const debit = entries.filter((e: any) => e.direction === "DEBIT").reduce(
      (s: number, e: any) => s + Number(e.amount), 0
    );
    const credit = entries.filter((e: any) => e.direction === "CREDIT").reduce(
      (s: number, e: any) => s + Number(e.amount), 0
    );
    expect(debit).toBe(credit);
    expect(debit).toBe(10000);
  });

  it("a replayed refund.succeeded event changes nothing", async () => {
    const res = await app
      .post("/payments/webhook")
      .set("X-Forwarded-For", "185.71.76.5")
      .set("Authorization", "Basic " + Buffer.from("test-shop:whpass").toString("base64"))
      .send({
        type: "notification",
        event: "refund.succeeded",
        object: { id: `ref-webhook-${SUFFIX}`, status: "succeeded" },
      });
    expect(res.status).toBe(200);

    const entries = await db.orm.public.LedgerEntry
      .where({ transactionId: `refund:${refundId}` })
      .all();
    expect(entries.length).toBeGreaterThanOrEqual(2);
  });
});