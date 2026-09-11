// PLAN Block 5 tests:
// - E-003: payment state machine (legal/illegal transitions);
// - E-008: refund lifecycle — full refund revokes the entitlement (K-004),
//   partial refund keeps it, INV-013 caps refunds at the captured amount;
// - F-001/F-002/F-003: double-entry ledger — balanced settlement and refund
//   transactions (INV-012), unbalanced posts rejected;
// - F-005: free orders create no money movement.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

vi.mock("../src/lib/yookassa", () => ({
  YOOKASSA_ENABLED: true,
  YOOKASSA_SHOP_ID: "test-shop",
  createYooKassaPayment: vi.fn(),
  getYooKassaPayment: vi.fn(),
  createYooKassaRefund: vi.fn(),
  YooKassaWebhook: {},
}));

import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { createYooKassaRefund } from "../src/lib/yookassa";
import {
  assertTransition,
  canTransition,
} from "../src/lib/paymentStateMachine";
import { PaymentStateError } from "../src/lib/paymentErrors";
import {
  postLedgerEntries,
  isLedgerTransactionBalanced,
  LedgerUnbalancedError,
  LEDGER_ACCOUNT_CODES,
} from "../src/lib/ledger";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());
const mockedRefund = vi.mocked(createYooKassaRefund);

const SELLER_ID = "550e8400-e29b-41d4-a716-446655446501";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655446502";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655446503";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[ledger-refunds.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let adminToken = "";
let buyerToken = "";

interface SeedResult {
  purchaseId: string;
  paymentId: string;
  licenseId: string;
}

/** Seed a completed resource purchase with a settled payment + license. */
async function seedCompletedPurchase(finalPrice = 5000): Promise<SeedResult> {
  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `blk5-res-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Block5 ledger fixture",
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: finalPrice,
  });
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/blk5-${SUFFIX}.zip`,
    fileSize: 100,
    fileChecksum: "x",
  });
  const order = await db.orm.public.Order.create({
    buyerId: BUYER_ID,
    status: "PENDING",
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
  const license = await db.orm.public.License.create({
    purchaseId: purchase.id,
    versionId: version.id,
    status: "ACTIVE",
  });
  const payment = await db.orm.public.Payment.create({
    purchaseId: purchase.id,
    provider: "YUKASSA",
    providerPaymentId: `pay-blk5-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
    amount: finalPrice,
    currency: "RUB",
    status: "SETTLED",
    succeededAt: new Date().toISOString(),
  });
  return { purchaseId: purchase.id, paymentId: payment.id, licenseId: license.id };
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();

  await createTestUser(SELLER_ID, `blk5seller_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(BUYER_ID, `blk5buyer_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `blk5admin_${SUFFIX}`, "ADMIN", generateAccessToken);
  buyerToken = generateAccessToken({ userId: BUYER_ID, email: "x@test.local", role: "USER" });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("E-003: payment state machine", () => {
  it("allows the canonical flow and rejects illegal jumps", () => {
    expect(canTransition("PENDING", "SUCCEEDED")).toBe(true);
    expect(canTransition("SUCCEEDED", "SETTLED")).toBe(true);
    expect(canTransition("SETTLED", "REFUNDED")).toBe(true);
    expect(canTransition("SETTLED", "PARTIALLY_REFUNDED")).toBe(true);
    expect(canTransition("PARTIALLY_REFUNDED", "REFUNDED")).toBe(true);

    expect(canTransition("PENDING", "SETTLED")).toBe(false);
    expect(canTransition("REFUNDED", "PENDING")).toBe(false);
    expect(canTransition("FAILED", "SUCCEEDED")).toBe(false);
    expect(() => assertTransition("PENDING", "SETTLED")).toThrow(PaymentStateError);
  });
});

describe.skipIf(!dbAvailable)("F-001..F-003: double-entry ledger", () => {
  it("settlement posts a balanced transaction: cash = seller + platform", async () => {
    const seeded = await seedCompletedPurchase(5000);
    const purchase = await db.orm.public.Purchase.where({ id: seeded.purchaseId }).first();
    await import("../src/lib/ledger").then((m) => m.settlePurchaseRevenue(purchase!));

    const entries = await db.orm.public.LedgerEntry.where({ memo: `purchase:${seeded.purchaseId}` }).all();
    expect(entries.length).toBe(3); // cash DEBIT + seller CREDIT + platform CREDIT

    const debits = entries.filter((e) => e.direction === "DEBIT").reduce((s, e) => s + e.amount, 0);
    const credits = entries.filter((e) => e.direction === "CREDIT").reduce((s, e) => s + e.amount, 0);
    expect(debits).toBe(5000);
    expect(credits).toBe(5000);

    // entries of one settlement share a transactionId that is balanced
    const txId = entries[0].transactionId;
    expect(await isLedgerTransactionBalanced(txId)).toBe(true);
  });

  it("rejects unbalanced postings (INV-012)", async () => {
    await expect(
      postLedgerEntries(`unbalanced-${SUFFIX}`, [
        {
          account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_CASH, kind: "PLATFORM_CASH" },
          direction: "DEBIT",
          amount: 1000,
        },
        {
          account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_REVENUE, kind: "PLATFORM_REVENUE" },
          direction: "CREDIT",
          amount: 900,
        },
      ])
    ).rejects.toThrow(LedgerUnbalancedError);

    await expect(
      postLedgerEntries(`zeropos-${SUFFIX}`, [
        {
          account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_CASH, kind: "PLATFORM_CASH" },
          direction: "DEBIT",
          amount: 0,
        },
        {
          account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_REVENUE, kind: "PLATFORM_REVENUE" },
          direction: "CREDIT",
          amount: 0,
        },
      ])
    ).rejects.toThrow(LedgerUnbalancedError);
  });
});

describe.skipIf(!dbAvailable)("F-005: free orders create no money movement", () => {
  it("zero-price settlement posts nothing", async () => {
    const seeded = await seedCompletedPurchase(0);
    const purchase = await db.orm.public.Purchase.where({ id: seeded.purchaseId }).first();
    await import("../src/lib/ledger").then((m) => m.settlePurchaseRevenue(purchase!));

    const txs = await db.orm.public.FinancialTransaction
      .where({ relatedPurchaseId: seeded.purchaseId })
      .all();
    expect(txs.length).toBe(0);
    const entries = await db.orm.public.LedgerEntry.where({ memo: `purchase:${seeded.purchaseId}` }).all();
    expect(entries.length).toBe(0);
  });
});

describe.skipIf(!dbAvailable)("E-008: refund lifecycle", () => {
  it("rejects a refund request from a non-admin (403)", async () => {
    const res = await app
      .post("/payments/refunds")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ paymentId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(403);
  });

  it("partial refund -> PARTIALLY_REFUNDED, license stays active", async () => {
    mockedRefund.mockResolvedValueOnce({
      id: `ref-part-${SUFFIX}`,
      status: "succeeded",
      amount: { value: "20.00", currency: "RUB" },
    });
    const seeded = await seedCompletedPurchase(5000);
    const purchase = await db.orm.public.Purchase.where({ id: seeded.purchaseId }).first();
    await import("../src/lib/ledger").then((m) => m.settlePurchaseRevenue(purchase!));

    const res = await app
      .post("/payments/refunds")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ paymentId: seeded.paymentId, amount: 2000, reason: "goodwill" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("SUCCEEDED");

    const payment = await db.orm.public.Payment.where({ id: seeded.paymentId }).first();
    expect(payment?.status).toBe("PARTIALLY_REFUNDED");

    const license = await db.orm.public.License.where({ id: seeded.licenseId }).first();
    expect(license?.status).toBe("ACTIVE"); // K-004: partial refund keeps entitlement

    const refundRow = await db.orm.public.Refund.where({ id: res.body.refundId }).first();
    expect(refundRow?.status).toBe("SUCCEEDED");
    expect(refundRow?.providerRefundId).toBe(`ref-part-${SUFFIX}`);

    // refund ledger transaction is balanced (INV-012)
    expect(await isLedgerTransactionBalanced(`refund:${res.body.refundId}`)).toBe(true);
  });

  it("full refund -> REFUNDED, purchase refunded, license revoked", async () => {
    mockedRefund.mockResolvedValueOnce({
      id: `ref-full-${SUFFIX}`,
      status: "succeeded",
      amount: { value: "30.00", currency: "RUB" },
    });
    const seeded = await seedCompletedPurchase(5000);
    const purchase = await db.orm.public.Purchase.where({ id: seeded.purchaseId }).first();
    await import("../src/lib/ledger").then((m) => m.settlePurchaseRevenue(purchase!));

    const res = await app
      .post("/payments/refunds")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ paymentId: seeded.paymentId, reason: "full refund" });
    expect(res.status).toBe(201);

    const payment = await db.orm.public.Payment.where({ id: seeded.paymentId }).first();
    expect(payment?.status).toBe("REFUNDED");

    const purchaseAfter = await db.orm.public.Purchase.where({ id: seeded.purchaseId }).first();
    expect(purchaseAfter?.status).toBe("REFUNDED");

    const license = await db.orm.public.License.where({ id: seeded.licenseId }).first();
    expect(license?.status).toBe("REVOKED"); // K-004: full confirmed refund revokes

    expect(await isLedgerTransactionBalanced(`refund:${res.body.refundId}`)).toBe(true);

    const refunds = await app
      .get(`/payments/${seeded.paymentId}/refunds`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(refunds.status).toBe(200);
    expect(refunds.body.total).toBe(1);
  });

  it("rejects refunds exceeding the captured amount (INV-013, 409)", async () => {
    const seeded = await seedCompletedPurchase(5000);
    const res = await app
      .post("/payments/refunds")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ paymentId: seeded.paymentId, amount: 6000 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("refund_exceeds_captured");
  });

  it("rejects refunding a payment that was never captured (409)", async () => {
    const payment = await db.orm.public.Payment.create({
      purchaseId: null,
      provider: "TEST",
      providerPaymentId: `pay-pend-${SUFFIX}`,
      amount: 1000,
      currency: "RUB",
      status: "PENDING",
    });
    const res = await app
      .post("/payments/refunds")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ paymentId: payment.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("payment_not_refundable");
  });
});
