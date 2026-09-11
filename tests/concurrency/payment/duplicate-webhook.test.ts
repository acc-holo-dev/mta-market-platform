// Concurrency foundation (PLAN-010 §12): webhook idempotency.
//
// Invariant: replaying the SAME provider webhook (sequential and parallel)
// produces the business effect exactly once — the purchase completes once,
// one provider event row is recorded, no duplicate license is issued.
// The provider SDK is mocked; transport/auth checks stay over real HTTP.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

vi.mock("@server/lib/yookassa", () => ({
  YOOKASSA_ENABLED: true,
  YOOKASSA_SHOP_ID: "test-shop",
  createYooKassaPayment: vi.fn(),
  getYooKassaPayment: vi.fn(),
  YooKassaWebhook: {},
}));

import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { getYooKassaPayment } from "@server/lib/yookassa";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const mockedGetPayment = vi.mocked(getYooKassaPayment);

const app = request(createApp());

const BUYER_ID = "550e8400-e29b-41d4-a716-44665544e100";
const SELLER_ID = "550e8400-e29b-41d4-a716-44665544e101";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[duplicate-webhook.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

const YK_IP = "185.71.76.5";
const AUTH = "Basic " + Buffer.from("test-shop:whpass").toString("base64");

let purchaseId = "";

function webhookBody() {
  return {
    type: "notification",
    event: "payment.succeeded",
    object: {
      id: `pay-ccy-${SUFFIX}`,
      status: "succeeded",
      paid: true,
      amount: { value: "100.00", currency: "RUB" },
      metadata: { order_id: purchaseId },
    },
  };
}

function postWebhook(body: object) {
  return app
    .post("/payments/webhook")
    .set("X-Forwarded-For", YK_IP)
    .set("Authorization", AUTH)
    .send(body);
}

beforeAll(async () => {
  if (!dbAvailable) return;
  process.env.YOOKASSA_NOTIFICATION_PASSWORD = "whpass";
  await resetTestEntities();
  await createTestUser(BUYER_ID, `ccy-whb_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(SELLER_ID, `ccy-whs_${SUFFIX}`, "USER", generateAccessToken);

  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `ccy-wh-${SUFFIX}`,
    title: "Concurrency webhook fixture",
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 10000,
  });
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/ccy-wh-${SUFFIX}.zip`,
    fileSize: 100,
    fileChecksum: "x",
  });
  const order = await db.orm.public.Order.create({
    buyerId: BUYER_ID,
    status: "PENDING",
    currency: "RUB",
    subtotal: 10000,
    finalTotal: 10000,
  });
  const item = await db.orm.public.OrderItem.create({
    orderId: order.id,
    itemType: "RESOURCE",
    resourceId: resource.id,
    sellerId: SELLER_ID,
    titleSnapshot: resource.title,
    currency: "RUB",
    basePrice: 10000,
    discountAmount: 0,
    finalPrice: 10000,
    platformFee: 1000,
    sellerNet: 9000,
  });
  const purchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    status: "PENDING",
    orderItemId: item.id,
    priceSnapshot: 10000,
    discountSnapshot: 0,
    finalPrice: 10000,
    platformFee: 1000,
    sellerRevenue: 9000,
  });
  purchaseId = purchase.id;
  mockedGetPayment.mockResolvedValue({
    id: `pay-ccy-${SUFFIX}`,
    status: "succeeded",
    paid: true,
    amount: { value: "100.00", currency: "RUB" },
    confirmation: { type: "redirect", confirmation_url: "https://yk.test" },
    created_at: new Date().toISOString(),
    description: "test",
    metadata: { order_id: purchaseId },
  } as any);
  await db.orm.public.Payment.create({
    purchaseId,
    provider: "YUKASSA",
    providerPaymentId: `pay-ccy-${SUFFIX}`,
    status: "PENDING",
    amount: 10000,
    currency: "RUB",
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("concurrency: duplicate webhook replay", () => {
  it("sequential replay completes the purchase exactly once", async () => {
    const body = webhookBody();
    const first = await postWebhook(body);
    const second = await postWebhook(body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const purchase = await db.orm.public.Purchase.where({ id: purchaseId }).first();
    expect(purchase?.status).toBe("COMPLETED");

    const licenses = await db.orm.public.License.where({ purchaseId }).all();
    expect(licenses.length).toBe(1);

    const allEvents = await db.orm.public.PaymentProviderEvent.where({}).all();
    const events = allEvents.filter((e) => e.objectId === `pay-ccy-${SUFFIX}`);
    expect(events.length).toBe(1);
  });

  it("parallel replay does not double-complete", async () => {
    // fresh pending purchase per run: reuse the same provider payment id is
    // already covered above; here the same event is fired concurrently to
    // race the event-dedup path itself.
    const body = webhookBody();
    const results = await Promise.all(Array.from({ length: 4 }, () => postWebhook(body)));
    for (const r of results) expect(r.status).toBe(200);

    const allEvents = await db.orm.public.PaymentProviderEvent.where({}).all();
    const events = allEvents.filter((e) => e.objectId === `pay-ccy-${SUFFIX}`);
    expect(events.length).toBe(1);

    const licenses = await db.orm.public.License.where({ purchaseId }).all();
    expect(licenses.length).toBe(1);
  });
});
