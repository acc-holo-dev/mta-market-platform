// PLAN-018 A-001 payment state machine hardening tests:
// - the exported TRANSITIONS table is complete and honest (every PaymentState
//   has an entry, targets are known states, terminals are empty);
// - canTransition/assertTransition accept exactly the canonical flow and
//   reject every illegal jump (table-driven over all state pairs);
// - the webhook/payment paths honor the guard end-to-end: a PENDING payment
//   cannot be refunded, a settled one can (refund path asserts the transition
//   through the provider-confirmed lifecycle).
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
import {
  TRANSITIONS,
  PAYMENT_STATES,
  canTransition,
  assertTransition,
  isTerminalState,
  type PaymentState,
} from "@server/lib/paymentStateMachine";
import { PaymentStateError } from "@server/lib/paymentErrors";
import { createRefund } from "@server/lib/refunds";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());
const mockedRefund = vi.mocked(createYooKassaRefund);

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655446721";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655446722";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655446723";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[payment-transitions.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let adminToken = "";

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  adminToken = await createTestUser(ADMIN_ID, `pt18admin_${SUFFIX}`, "ADMIN", generateAccessToken);
  await createTestUser(SELLER_ID, `pt18seller_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(BUYER_ID, `pt18buyer_${SUFFIX}`, "USER", generateAccessToken);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("TRANSITIONS table completeness (A-001)", () => {
  it("covers every PaymentState and only targets known states", () => {
    for (const state of PAYMENT_STATES) {
      expect(Array.isArray(TRANSITIONS[state])).toBe(true);
      for (const target of TRANSITIONS[state]) {
        expect(PAYMENT_STATES).toContain(target);
        expect(target).not.toBe(state); // no self-transitions
      }
    }
  });

  it("marks exactly the documented terminal states", () => {
    expect(isTerminalState("FAILED")).toBe(true);
    expect(isTerminalState("CANCELED")).toBe(true);
    expect(isTerminalState("REFUNDED")).toBe(true);
    expect(isTerminalState("PENDING")).toBe(false);
    expect(isTerminalState("SETTLED")).toBe(false);
    expect(isTerminalState("PARTIALLY_REFUNDED")).toBe(false);
  });

  it("matches the canonical flow used by the webhook path", () => {
    // happy path: capture → settle → refund
    expect(canTransition("PENDING", "SUCCEEDED")).toBe(true);
    expect(canTransition("SUCCEEDED", "SETTLEMENT_PENDING")).toBe(true);
    expect(canTransition("SUCCEEDED", "SETTLED")).toBe(true);
    expect(canTransition("SETTLEMENT_PENDING", "SETTLED")).toBe(true);
    expect(canTransition("SETTLEMENT_PENDING", "FAILED")).toBe(true);
    expect(canTransition("SETTLED", "PARTIALLY_REFUNDED")).toBe(true);
    expect(canTransition("SETTLED", "REFUNDED")).toBe(true);
    expect(canTransition("PARTIALLY_REFUNDED", "REFUNDED")).toBe(true);
  });
});

describe.skipIf(!dbAvailable)("illegal transitions rejected (table-driven)", () => {
  it("rejects every pair not present in TRANSITIONS", () => {
    for (const from of PAYMENT_STATES) {
      for (const to of PAYMENT_STATES) {
        const allowed = TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(allowed);
        if (!allowed) {
          expect(() => assertTransition(from, to)).toThrow(PaymentStateError);
          try {
            assertTransition(from, to);
          } catch (error) {
            expect((error as Error).message).toContain(`Illegal payment transition ${from} -> ${to}`);
          }
        }
      }
    }
  });

  it("keeps the money-integrity invariants of the table", () => {
    // captured money cannot silently go back to PENDING
    expect(canTransition("SUCCEEDED" as PaymentState, "PENDING")).toBe(false);
    expect(canTransition("SETTLED" as PaymentState, "PENDING")).toBe(false);
    expect(canTransition("REFUNDED" as PaymentState, "PARTIALLY_REFUNDED")).toBe(false);
    // a refunded payment is terminal; refunds never flow backwards
    expect(TRANSITIONS["REFUNDED"]).toHaveLength(0);
    // failed/canceled payments cannot resurrect
    expect(TRANSITIONS["FAILED"]).toHaveLength(0);
    expect(TRANSITIONS["CANCELED"]).toHaveLength(0);
  });
});

describe.skipIf(!dbAvailable)("guard honored by the refund path", () => {
  it("refuses to refund a payment whose state cannot leave PENDING (409)", async () => {
    const payment = await db.orm.public.Payment.create({
      purchaseId: null,
      provider: "TEST",
      providerPaymentId: `pay-pt18-pend-${SUFFIX}`,
      amount: 1000,
      currency: "RUB",
      status: "PENDING",
    });
    await expect(createRefund({ actorId: ADMIN_ID, paymentId: payment.id })).rejects.toMatchObject({
      name: "PaymentRefundError",
      status: 409,
      code: "payment_not_refundable",
    });
    await db.orm.public.Payment.where({ id: payment.id }).delete().catch(() => undefined);
  });

  it("refuses to refund a CANCELED payment (409)", async () => {
    const payment = await db.orm.public.Payment.create({
      purchaseId: null,
      provider: "TEST",
      providerPaymentId: `pay-pt18-cancel-${SUFFIX}`,
      amount: 1000,
      currency: "RUB",
      status: "CANCELED",
    });
    await expect(createRefund({ actorId: ADMIN_ID, paymentId: payment.id })).rejects.toMatchObject({
      code: "payment_not_refundable",
    });
    await db.orm.public.Payment.where({ id: payment.id }).delete().catch(() => undefined);
  });

  it("refuses a refund on a fully REFUNDED payment (409)", async () => {
    const resource = await db.orm.public.Resource.create({
      sellerId: SELLER_ID,
      slug: `pt18-res-${SUFFIX}`,
      title: "PT fixture",
      description: "fixture",
      type: "SCRIPT",
      status: "PUBLISHED",
      price: 2000,
    });
    const version = await db.orm.public.ResourceVersion.create({
      resourceId: resource.id,
      version: "1.0.0",
      fileUrl: `/uploads/pt18-${SUFFIX}.zip`,
      fileSize: 100,
      fileChecksum: "x",
    });
    const purchase = await db.orm.public.Purchase.create({
      buyerId: BUYER_ID,
      resourceId: resource.id,
      versionId: version.id,
      status: "REFUNDED",
      priceSnapshot: 2000,
      finalPrice: 2000,
      platformFee: 200,
      sellerRevenue: 1800,
    });
    const payment = await db.orm.public.Payment.create({
      purchaseId: purchase.id,
      provider: "YUKASSA",
      providerPaymentId: `pay-pt18-full-${SUFFIX}`,
      amount: 2000,
      currency: "RUB",
      status: "REFUNDED",
    });
    await expect(createRefund({ actorId: ADMIN_ID, paymentId: payment.id })).rejects.toMatchObject({
      code: "payment_not_refundable",
    });
    await db.orm.public.Payment.where({ id: payment.id }).delete().catch(() => undefined);
  });

  it("performs SUCCEEDED → PARTIALLY_REFUNDED through the guard end-to-end", async () => {
    const resource = await db.orm.public.Resource.create({
      sellerId: SELLER_ID,
      slug: `pt18-res2-${SUFFIX}`,
      title: "PT fixture 2",
      description: "fixture",
      type: "SCRIPT",
      status: "PUBLISHED",
      price: 5000,
    });
    const version = await db.orm.public.ResourceVersion.create({
      resourceId: resource.id,
      version: "1.0.0",
      fileUrl: `/uploads/pt18b-${SUFFIX}.zip`,
      fileSize: 100,
      fileChecksum: "x",
    });
    const order = await db.orm.public.Order.create({
      buyerId: BUYER_ID,
      status: "COMPLETED",
      currency: "RUB",
      subtotal: 5000,
      finalTotal: 5000,
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
      priceSnapshot: 5000,
      finalPrice: 5000,
      platformFee: 500,
      sellerRevenue: 4500,
    });
    const payment = await db.orm.public.Payment.create({
      purchaseId: purchase.id,
      provider: "YUKASSA",
      providerPaymentId: `pay-pt18-part-${SUFFIX}`,
      amount: 5000,
      currency: "RUB",
      status: "SUCCEEDED",
      succeededAt: new Date().toISOString(),
    });

    mockedRefund.mockResolvedValueOnce({
      id: `ref-pt18-${SUFFIX}`,
      status: "succeeded",
      amount: { value: "20.00", currency: "RUB" },
    });

    const res = await app
      .post("/payments/refunds")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ paymentId: payment.id, amount: 2000 });
    expect(res.status).toBe(201);

    // The guard enforced a legal partial transition; the row reflects it.
    const after = await db.orm.public.Payment.where({ id: payment.id }).first();
    expect(after?.status).toBe("PARTIALLY_REFUNDED");
    expect(canTransition("PARTIALLY_REFUNDED", "REFUNDED")).toBe(true);

    await db.orm.public.Refund.where({ id: res.body.refundId }).delete().catch(() => undefined);
    await db.orm.public.Payment.where({ id: payment.id }).delete().catch(() => undefined);
  });
});