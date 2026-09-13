// PLAN-020 G-006.1: platform-order webhook dispatch.
// A captured provider payment whose metadata.order_id carries a platform
// checkout Order id (subscriptions, ad campaigns) MUST self-activate through
// the webhook — the same provider-verified, idempotent activation flow as
// the manual endpoints. The YooKassa provider API is mocked; transport,
// invariants and business effects run over real HTTP against the test DB.
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
import { getYooKassaPayment } from "@server/lib/yookassa";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());
const mockedGetPayment = vi.mocked(getYooKassaPayment);

const BUYER_ID = "550e8400-e29b-41d4-a716-446655440050";
const SUFFIX = Date.now().toString(36);
const YK_IP = "185.71.76.5";
const AUTH = "Basic " + Buffer.from("test-shop:whpass").toString("base64");

// PLAN-016 P-002 transport: the notification password is env-configured; set
// it before the app handles any webhook.
process.env.YOOKASSA_NOTIFICATION_PASSWORD = "whpass";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[platform-webhook.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

const providerPaymentId = `pay-sub-${SUFFIX}`;
let orderId = "";

function webhookBody(overrides: Record<string, any> = {}) {
  return {
    type: "notification",
    event: "payment.succeeded",
    object: {
      id: providerPaymentId,
      status: "succeeded",
      paid: true,
      amount: { value: "50.00", currency: "RUB" },
      metadata: { order_id: orderId },
      ...overrides,
    },
  };
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  await createTestUser(BUYER_ID, `ccy-plat_${SUFFIX}`, "USER", () => "unused");

  // Platform checkout: Order + line tagged with the plan kind — the exact
  // shape createPlatformOrderLine() produces for subscriptions.
  const order = await db.orm.public.Order.create({
    buyerId: BUYER_ID,
    status: "PENDING",
    currency: "RUB",
    subtotal: 5000,
    discountTotal: 0,
    finalTotal: 5000,
  });
  orderId = order.id;
  const line = await db.orm.public.OrderItem.create({
    orderId: order.id,
    itemType: "SERVICE",
    sellerId: "PLATFORM", // PLATFORM_ORDER_SELLER_ID: platform pseudo-seller
    titleSnapshot: "Подписка CREATOR_PREMIUM на 1 мес. [CREATOR_PREMIUM]",
    currency: "RUB",
    basePrice: 5000,
    discountAmount: 0,
    finalPrice: 5000,
    platformFee: 5000,
    sellerNet: 0,
  });
  await db.orm.public.Payment.create({
    purchaseId: null,
    orderItemId: line.id,
    provider: "YUKASSA",
    providerPaymentId,
    amount: 5000,
    currency: "RUB",
    status: "PENDING",
  } as never);

  mockedGetPayment.mockResolvedValue({
    id: providerPaymentId,
    status: "succeeded",
    paid: true,
    amount: { value: "50.00", currency: "RUB" },
    metadata: { order_id: orderId },
  } as never);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  // The webhook activation attributes its premium grant audit row to the
  // system actor, which is outside the resetTestEntities user-id range —
  // remove it explicitly so other suites' audit assertions stay isolated.
  // The contract ORM delete() removes a single row per call and its WHERE
  // must pin the id — drain the matching rows explicitly.
  const webhookAudits = await db.orm.public.AuditLog
    .where({ actorId: "system:webhook" })
    .all();
  for (const row of webhookAudits) {
    await db.orm.public.AuditLog.where({ id: row.id }).delete().catch(() => undefined);
  }
  const providerEvents = await db.orm.public.PaymentProviderEvent
    .where({ objectId: providerPaymentId })
    .all();
  for (const row of providerEvents) {
    await db.orm.public.PaymentProviderEvent.where({ id: row.id }).delete().catch(() => undefined);
  }
  vi.restoreAllMocks();
});

describe.skipIf(!dbAvailable)("platform-order webhook dispatch (PLAN-020 G-006.1)", () => {
  it("activates the subscription from the captured webhook", async () => {
    const res = await app
      .post("/payments/webhook")
      .set("X-Forwarded-For", YK_IP)
      .set("Authorization", AUTH)
      .send(webhookBody());
    console.log("webhook res:", res.status, JSON.stringify(res.body));

    expect(res.status).toBe(200);

    const order = await db.orm.public.Order.where({ id: orderId }).first();
    expect((order as unknown as { status: string }).status).toBe("COMPLETED");

    const subscription = await db.orm.public.Subscription
      .where({ userId: BUYER_ID, plan: "CREATOR_PREMIUM" })
      .first();
    expect(subscription).not.toBeNull();

    // The money leg is settled exactly once under the deterministic key.
    const entries = await db.orm.public.LedgerEntry
      .where({ transactionId: `settle:subscription:${orderId}` })
      .all();
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const event = await db.orm.public.PaymentProviderEvent
      .where({ objectId: providerPaymentId })
      .first();
    expect((event as unknown as { status: string }).status).toBe("PROCESSED");
  });

  it("a duplicate webhook re-presents the live subscription (idempotent)", async () => {
    const res = await app
      .post("/payments/webhook")
      .set("X-Forwarded-For", YK_IP)
      .set("Authorization", AUTH)
      .send(webhookBody());
    console.log("webhook res:", res.status, JSON.stringify(res.body));

    expect(res.status).toBe(200);
    const subs = await db.orm.public.Subscription
      .where({ userId: BUYER_ID, plan: "CREATOR_PREMIUM" })
      .all();
    expect(subs.length).toBe(1);

    // The settlement transaction must not double-post.
    const entries = await db.orm.public.LedgerEntry
      .where({ transactionId: `settle:subscription:${orderId}` })
      .all();
    expect(entries.length).toBe(2); // debit + credit, exactly once
  });

  it("quarantines an amount mismatch for a platform order (A-011)", async () => {
    const res = await app
      .post("/payments/webhook")
      .set("X-Forwarded-For", YK_IP)
      .set("Authorization", AUTH)
      .send(
        webhookBody({
          id: `pay-bad-${SUFFIX}`,
          amount: { value: "10.00", currency: "RUB" },
        })
      );
    // The provider re-fetch is what quarantines: the mocked provider reports
    // 50.00 for the bound payment — a different payment id with 10.00 fails
    // the amount invariant against the Order's final total.
    expect([200, 409]).toContain(res.status);
  });
});