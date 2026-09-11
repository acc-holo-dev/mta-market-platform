// TASK A-010/A-011: Provider webhook hardening + payment amount invariant.
// The YooKassa provider API is mocked; transport checks (IP allowlist, Basic
// Auth), event persistence/dedup, provider re-fetch, amount/currency/reference
// invariants and idempotent business effects are exercised over real HTTP.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

// Mock the provider SDK module BEFORE the app is imported.
vi.mock("../src/lib/yookassa", () => ({
  YOOKASSA_ENABLED: true,
  YOOKASSA_SHOP_ID: "test-shop",
  createYooKassaPayment: vi.fn(),
  getYooKassaPayment: vi.fn(),
  YooKassaWebhook: {},
}));

import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { getYooKassaPayment } from "../src/lib/yookassa";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());
const mockedGetPayment = vi.mocked(getYooKassaPayment);

const BUYER_ID = "550e8400-e29b-41d4-a716-446655440040";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655440041";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[payments-webhook.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

// YooKassa allowlisted IP (185.71.76.0/27) sent through the trusted proxy header
const YK_IP = "185.71.76.5";
const AUTH = "Basic " + Buffer.from("test-shop:whpass").toString("base64");

let purchaseId = "";
let otherPurchaseId = "";

function webhookBody(overrides: Record<string, any> = {}) {
  return {
    type: "notification",
    event: "payment.succeeded",
    object: {
      id: `pay-${SUFFIX}`,
      status: "succeeded",
      paid: true,
      amount: { value: "50.00", currency: "RUB" },
      metadata: { order_id: purchaseId },
      ...overrides,
    },
  };
}

function postWebhook(body: any, withIp = true, auth = AUTH) {
  const req = app.post("/payments/webhook");
  if (withIp) req.set("X-Forwarded-For", YK_IP);
  if (auth) req.set("Authorization", auth);
  return req.send(body);
}

async function cleanup(): Promise<void> {
  await resetTestEntities();
}

beforeAll(async () => {
  if (!dbAvailable) return;
  process.env.YOOKASSA_NOTIFICATION_PASSWORD = "whpass";
  await cleanup();

  await createTestUser(BUYER_ID, `whb_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(SELLER_ID, `whs_${SUFFIX}`, "USER", generateAccessToken);

  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `wh-test-${SUFFIX}`,
    title: "Webhook Test",
    description: "webhook test resource",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 10000,
  });
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/wh-${SUFFIX}.zip`,
    fileSize: 100,
    fileChecksum: "x",
  });

  // Discounted purchase: snapshot 100.00 RUB, final 50.00 RUB — the provider
  // amount must be verified against the FINAL total (A-011).
  // PLAN C-012: purchases are created through the checkout aggregate, so the
  // seeded rows carry an Order + OrderItem linked via Purchase.orderItemId.
  const mkOrderItem = async (title: string, basePrice: number, discountAmount: number, finalPrice: number) => {
    const order = await db.orm.public.Order.create({
      buyerId: BUYER_ID,
      status: "PENDING",
      currency: "RUB",
      subtotal: basePrice,
      discountTotal: discountAmount,
      finalTotal: finalPrice,
    });
    const item = await db.orm.public.OrderItem.create({
      orderId: order.id,
      itemType: "RESOURCE",
      resourceId: resource.id,
      sellerId: SELLER_ID,
      titleSnapshot: title,
      currency: "RUB",
      basePrice,
      discountAmount,
      finalPrice,
      platformFee: Math.round(finalPrice * 0.1),
      sellerNet: finalPrice - Math.round(finalPrice * 0.1),
    });
    return item.id;
  };

  const purchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    status: "PENDING",
    orderItemId: await mkOrderItem("Webhook Test", 10000, 5000, 5000),
    priceSnapshot: 10000,
    discountSnapshot: 5000,
    finalPrice: 5000,
    platformFee: 500,
    sellerRevenue: 4500,
  });
  purchaseId = purchase.id;

  const otherPurchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    status: "PENDING",
    orderItemId: await mkOrderItem("Webhook Test", 10000, 0, 10000),
    priceSnapshot: 10000,
    finalPrice: 10000,
    platformFee: 1000,
    sellerRevenue: 9000,
  });
  otherPurchaseId = otherPurchase.id;

  // Default mock: provider confirms success for the expected amount
  mockedGetPayment.mockResolvedValue({
    id: `pay-${SUFFIX}`,
    status: "succeeded",
    paid: true,
    amount: { value: "50.00", currency: "RUB" },
    confirmation: { type: "redirect", confirmation_url: "https://yk.test" },
    created_at: new Date().toISOString(),
    description: "test",
    metadata: { order_id: purchaseId },
  } as any);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await cleanup();
});

describe.skipIf(!dbAvailable)("A-010/A-011: webhook hardening", () => {
  it("rejects webhooks from non-allowlisted IPs (403)", async () => {
    const res = await postWebhook(webhookBody(), false); // no trusted XFF -> direct peer IP
    expect(res.status).toBe(403);
  });

  it("rejects forged Basic Auth (401)", async () => {
    const res = await postWebhook(webhookBody(), true, "Basic " + Buffer.from("test-shop:wrong").toString("base64"));
    expect(res.status).toBe(401);
  });

  it("processes a valid webhook: purchase completed, license created", async () => {
    const res = await postWebhook(webhookBody());
    expect(res.status).toBe(200);

    const purchase = await db.orm.public.Purchase.where({ id: purchaseId }).first();
    expect(purchase!.status).toBe("COMPLETED");
    const license = await db.orm.public.License.where({ purchaseId: purchaseId }).first();
    expect(license).toBeTruthy();
  });

  it("replaying the same event 10 times produces ONE business effect", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await postWebhook(webhookBody());
      expect(res.status).toBe(200);
    }
    const licenses = await db.orm.public.License.where({ purchaseId: purchaseId }).all();
    expect(licenses.length).toBe(1);
    const purchases = await db.orm.public.Purchase.where({ id: purchaseId }).all();
    expect(purchases.length).toBe(1);
  });

  it("rejects a wrong amount (quarantine, no entitlement)", async () => {
    // Provider confirms 100.00 (the PRE-discount price) while the order's
    // final total is 50.00 — the invariant must fail and quarantine.
    mockedGetPayment.mockResolvedValueOnce({
      id: `pay-wrong-${SUFFIX}`,
      status: "succeeded",
      paid: true,
      amount: { value: "100.00", currency: "RUB" },
    } as any);
    const body = webhookBody();
    body.object.id = `pay-wrong-${SUFFIX}`;
    body.object.amount = { value: "100.00", currency: "RUB" };

    const res = await postWebhook(body);
    expect(res.status).toBe(409);

    const purchase = await db.orm.public.Purchase.where({ id: purchaseId }).first();
    expect(purchase!.status).toBe("COMPLETED"); // unchanged by the quarantined event
    const licenses = await db.orm.public.License.where({ purchaseId: purchaseId }).all();
    expect(licenses.length).toBe(1); // only the one from the valid webhook test
  });

  it("rejects wrong currency (409)", async () => {
    mockedGetPayment.mockResolvedValueOnce({
      id: `pay-cur-${SUFFIX}`,
      status: "succeeded",
      paid: true,
      amount: { value: "50.00", currency: "USD" },
    } as any);
    const body = webhookBody();
    body.object.id = `pay-cur-${SUFFIX}`;
    body.object.amount = { value: "50.00", currency: "USD" };

    const res = await postWebhook(body);
    expect(res.status).toBe(409);
  });

  it("rejects when provider state is not succeeded (409)", async () => {
    mockedGetPayment.mockResolvedValueOnce({
      id: `pay-pend-${SUFFIX}`,
      status: "pending",
      paid: false,
      amount: { value: "50.00", currency: "RUB" },
    } as any);
    const body = webhookBody();
    body.object.id = `pay-pend-${SUFFIX}`;

    const res = await postWebhook(body);
    expect(res.status).toBe(409);
  });

  it("rejects a provider payment bound to a different purchase (409, quarantined)", async () => {
    // Payment row bound to purchase A; webhook claims purchase B with the
    // amount that matches B — only the reference check can catch this.
    // (One payment per purchase: clear the row the valid-webhook test created.)
    await db.orm.public.Payment.where({ purchaseId: purchaseId }).delete().catch(() => undefined);
    await db.orm.public.Payment.create({
      purchaseId: purchaseId,
      provider: "YUKASSA",
      providerPaymentId: `pay-bound-${SUFFIX}`,
      amount: 10000,
      currency: "RUB",
      status: "PENDING",
    });

    mockedGetPayment.mockResolvedValueOnce({
      id: `pay-bound-${SUFFIX}`,
      status: "succeeded",
      paid: true,
      amount: { value: "100.00", currency: "RUB" },
    } as any);
    const body = webhookBody();
    body.object.id = `pay-bound-${SUFFIX}`;
    body.object.amount = { value: "100.00", currency: "RUB" };
    body.object.metadata = { order_id: otherPurchaseId };

    const res = await postWebhook(body);
    expect(res.status).toBe(409);

    const other = await db.orm.public.Purchase.where({ id: otherPurchaseId }).first();
    expect(other!.status).toBe("PENDING");
  });

  it("acknowledges non-succeeded event types without business effects", async () => {
    const body = webhookBody();
    body.event = "payment.canceled";
    body.object.id = `pay-cancel-${SUFFIX}`;

    const res = await postWebhook(body);
    expect(res.status).toBe(200);
    const licenses = await db.orm.public.License.where({ purchaseId: purchaseId }).all();
    expect(licenses.length).toBe(1); // unchanged
  });

  it("rejects unknown purchase reference (404)", async () => {
    const body = webhookBody();
    body.object.id = `pay-unknown-${SUFFIX}`;
    body.object.metadata = { order_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" };

    const res = await postWebhook(body);
    expect(res.status).toBe(404);
  });

  it("rejects missing order_id metadata (400)", async () => {
    const body = webhookBody();
    body.object.id = `pay-nometa-${SUFFIX}`;
    body.object.metadata = {};

    const res = await postWebhook(body);
    expect(res.status).toBe(400);
  });
});