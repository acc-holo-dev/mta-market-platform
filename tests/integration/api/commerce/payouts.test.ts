// PLAN-018 A-007 payout lifecycle integration tests:
// - seller request: server-computed balance gate (never frontend state),
//   open-payout guard (409), invalid amounts (400);
// - full happy path: seller request → admin approve → complete with ledger
//   settlement (balanced `payout:<id>` transaction, SellerBalance delta,
//   SELLER_PAYOUT FinancialTransaction row);
// - state machine guards: illegal transitions rejected (409), "process"
//   alias, fail/cancel move no money (ledger untouched until COMPLETED);
// - admin surface: finance.view reads, finance.payout transitions, USER 403.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";
import { settlePurchaseRevenue, isLedgerTransactionBalanced } from "@server/lib/ledger";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655446701";
const NOT_SELLER_ID = "550e8400-e29b-41d4-a716-446655446702";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655446704";
const FINANCE_ID = "550e8400-e29b-41d4-a716-446655446705";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[payouts.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let sellerToken = "";
let adminToken = "";
let financeToken = "";
let userToken = "";

/** Seed a COMPLETED purchase and settle it so the seller balance grows by
 * 90% of finalPrice (10% platform fee — the A-011 split). */
async function seedSettledRevenue(sellerId: string, finalPrice: number): Promise<number> {
  const resource = await db.orm.public.Resource.create({
    sellerId,
    slug: `payout-res-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Payout fixture",
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: finalPrice,
  });
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/payout-${SUFFIX}.zip`,
    fileSize: 100,
    fileChecksum: "x",
  });
  const order = await db.orm.public.Order.create({
    buyerId: ADMIN_ID,
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
    sellerId,
    titleSnapshot: resource.title,
    currency: "RUB",
    basePrice: finalPrice,
    finalPrice,
    platformFee,
    sellerNet: finalPrice - platformFee,
  });
  await db.orm.public.Purchase.create({
    buyerId: ADMIN_ID,
    resourceId: resource.id,
    versionId: version.id,
    orderItemId: item.id,
    status: "COMPLETED",
    completedAt: new Date().toISOString(),
    priceSnapshot: finalPrice,
    finalPrice,
    platformFee,
    sellerRevenue: finalPrice - platformFee,
  }).then(async (purchase: any) => {
    await settlePurchaseRevenue({
      id: purchase.id,
      buyerId: ADMIN_ID,
      resourceId: resource.id,
      orderItemId: item.id,
      priceSnapshot: finalPrice,
      platformFee,
      sellerRevenue: finalPrice - platformFee,
      finalPrice,
    });
    return purchase;
  });
  return finalPrice - platformFee;
}

async function requestPayout(token: string, amountMinor: number) {
  return app
    .post("/seller/payouts")
    .set("Authorization", `Bearer ${token}`)
    .send({ amountMinor });
}

async function transition(
  token: string,
  payoutId: string,
  action: string,
  extra: Record<string, unknown> = {}
) {
  return app
    .post(`/admin/finance/payouts/${payoutId}/transition`)
    .set("Authorization", `Bearer ${token}`)
    .send({ action, ...extra });
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();

  sellerToken = await createTestUser(SELLER_ID, `pay18seller_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(NOT_SELLER_ID, `pay18user_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `pay18admin_${SUFFIX}`, "ADMIN", generateAccessToken);
  // createTestUser caps roles at USER/MODERATOR/ADMIN — a FINANCE user is
  // created directly to exercise the finance.payout permission bundle.
  await db.orm.public.User.create({
    id: FINANCE_ID,
    email: `pay18fin_${SUFFIX}@test.local`,
    username: `pay18fin_${SUFFIX}`,
    role: "FINANCE",
    status: "ACTIVE",
  });
  financeToken = generateAccessToken({
    userId: FINANCE_ID,
    email: `pay18fin_${SUFFIX}@test.local`,
    role: "FINANCE",
  });
  userToken = generateAccessToken({ userId: NOT_SELLER_ID, email: "x@test.local", role: "USER" });

  // Approved seller profile with platform-granted payout eligibility (L-001).
  await db.orm.public.SellerProfile.create({
    userId: SELLER_ID,
    status: "APPROVED",
    payoutEnabled: true,
    displayName: `pay18seller_${SUFFIX}`,
  });

  await seedSettledRevenue(SELLER_ID, 10000); // available becomes 9000
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("seller payout request (A-007)", () => {
  it("reports the server-computed balance", async () => {
    const res = await app
      .get("/seller/payouts/balance")
      .set("Authorization", `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.available).toBe(9000);
    expect(res.body.inEscrow).toBe(0);
    expect(res.body.currency).toBe("RUB");
  });

  it("rejects a payout above the available balance (409, ru text)", async () => {
    const res = await requestPayout(sellerToken, 9001);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("insufficient_balance");
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toContain("Недостаточно средств");
  });

  it("rejects non-positive and non-integer amounts (400)", async () => {
    const zero = await requestPayout(sellerToken, 0);
    expect(zero.status).toBe(400);
    const negative = await requestPayout(sellerToken, -500);
    expect(negative.status).toBe(400);
    const fractional = await requestPayout(sellerToken, 100.5);
    expect(fractional.status).toBe(400);
  });

  it("creates a PENDING payout within the balance", async () => {
    const res = await requestPayout(sellerToken, 5000);
    expect(res.status).toBe(201);
    expect(res.body.payout.status).toBe("PENDING");
    expect(res.body.payout.amountMinor).toBe(5000);
    expect(res.body.payout.currency).toBe("RUB");
    expect(res.body.payout.sellerId).toBe(SELLER_ID);
  });

  it("rejects a second request while an open payout exists (409)", async () => {
    const res = await requestPayout(sellerToken, 1000);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("open_payout_exists");
    expect(res.body.error).toContain("незавершённая");
  });

  it("rejects payout requests without an approved seller profile (403)", async () => {
    const res = await requestPayout(userToken, 1000);
    expect(res.status).toBe(403);
  });

  it("lists own payouts newest-first", async () => {
    const res = await app.get("/seller/payouts").set("Authorization", `Bearer ${sellerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.payouts[0].amountMinor).toBe(5000);
  });
});

describe.skipIf(!dbAvailable)("payout lifecycle transitions (A-007)", () => {
  it("approve → complete settles the ledger exactly once", async () => {
    const open = await db.orm.public.PayoutRequest
      .where({ sellerId: SELLER_ID, status: "PENDING" })
      .first();
    expect(open).toBeTruthy();
    const payoutId = open!.id as string;

    // USER role has no finance.view/finance.payout → 403.
    const forbidden = await transition(userToken, payoutId, "approve");
    expect(forbidden.status).toBe(403);

    // FINANCE role holds finance.payout → the approve goes through.
    const approved = await transition(financeToken, payoutId, "approve");
    expect(approved.status).toBe(200);
    expect(approved.body.payout.status).toBe("PROCESSING");
    expect(approved.body.payout.reviewedById).toBe(FINANCE_ID);

    // approve is no longer legal from PROCESSING.
    const doubleApprove = await transition(adminToken, payoutId, "approve");
    expect(doubleApprove.status).toBe(409);
    expect(doubleApprove.body.code).toBe("invalid_payout_transition");
    // cancel is not legal from PROCESSING either.
    const cancelFromProcessing = await transition(adminToken, payoutId, "cancel");
    expect(cancelFromProcessing.status).toBe(409);

    const completed = await transition(adminToken, payoutId, "complete", {
      payoutRef: `bank-ref-${SUFFIX}`,
    });
    expect(completed.status).toBe(200);
    expect(completed.body.payout.status).toBe("COMPLETED");
    expect(completed.body.payout.decidedAt).toBeTruthy();
    // reviewedById/decidedAt reflect the LAST transition actor (the completing
    // admin here); the approve actor was audited separately.
    expect(completed.body.payout.reviewedById).toBe(ADMIN_ID);
    expect(completed.body.payout.ledgerTxnId).toBe(`payout:${payoutId}`);
    expect(completed.body.payout.payoutRef).toBe(`bank-ref-${SUFFIX}`);

    // Balanced double-entry settlement (INV-012).
    expect(await isLedgerTransactionBalanced(`payout:${payoutId}`)).toBe(true);
    const entries = await db.orm.public.LedgerEntry
      .where({ transactionId: `payout:${payoutId}` })
      .all();
    expect(entries.length).toBe(2);
    const debit = entries.find((e: any) => e.direction === "DEBIT")!;
    const credit = entries.find((e: any) => e.direction === "CREDIT")!;
    expect(debit.amount).toBe(5000);
    expect(debit.userId).toBe(SELLER_ID);
    expect(credit.amount).toBe(5000);
    const sellerAccount = await db.orm.public.LedgerAccount.where({ id: debit.accountId }).first();
    expect(sellerAccount!.kind).toBe("SELLER_AVAILABLE");
    expect(sellerAccount!.code).toBe(`seller_available:${SELLER_ID}`);
    const cashAccount = await db.orm.public.LedgerAccount.where({ id: credit.accountId }).first();
    expect(cashAccount!.kind).toBe("PLATFORM_CASH");

    // Seller cache dropped by exactly the payout amount (9000 - 5000).
    const balance = await db.orm.public.SellerBalance.where({ userId: SELLER_ID }).first();
    expect(Number(balance!.availableAmount)).toBe(4000);
    // totalEarned untouched by the payout.
    expect(Number(balance!.totalEarned)).toBe(9000);

    // Legacy reconciliation row for PAYOUT reports.
    const legacy = await db.orm.public.FinancialTransaction
      .where({ relatedPayoutId: payoutId, type: "SELLER_PAYOUT" })
      .first();
    expect(legacy).toBeTruthy();
    expect(Number(legacy!.amount)).toBe(5000);

    // Idempotent replay: completing again stays COMPLETED, ledger unchanged.
    const replay = await transition(adminToken, payoutId, "complete");
    expect(replay.status).toBe(200);
    expect(replay.body.payout.status).toBe("COMPLETED");
    const entriesAfter = await db.orm.public.LedgerEntry
      .where({ transactionId: `payout:${payoutId}` })
      .all();
    expect(entriesAfter.length).toBe(2);

    // Balance is now exhausted for a 5000 request.
    const again = await requestPayout(sellerToken, 5000);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("insufficient_balance");
  });

  it("cancel from PENDING moves no money", async () => {
    // available was 4000 after the completed payout; +1800 from this settle.
    await seedSettledRevenue(SELLER_ID, 2000); // 4000 → 5800
    const created = await requestPayout(sellerToken, 2000);
    expect(created.status).toBe(201);
    const payoutId = created.body.payout.id;

    const cancelled = await transition(adminToken, payoutId, "cancel");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.payout.status).toBe("CANCELLED");
    expect(cancelled.body.payout.decidedAt).toBeTruthy();

    const balance = await db.orm.public.SellerBalance.where({ userId: SELLER_ID }).first();
    expect(Number(balance!.availableAmount)).toBe(5800);
    const legacy = await db.orm.public.FinancialTransaction
      .where({ relatedPayoutId: payoutId })
      .all();
    expect(legacy.length).toBe(0);
  });

  it("process alias approves, then fail from PROCESSING moves no money", async () => {
    const created = await requestPayout(sellerToken, 1500);
    expect(created.status).toBe(201);
    const payoutId = created.body.payout.id;

    const processing = await transition(adminToken, payoutId, "process");
    expect(processing.status).toBe(200);
    expect(processing.body.payout.status).toBe("PROCESSING");

    // complete is legal here, but the tested path is fail: no ledger row.
    const failed = await transition(financeToken, payoutId, "fail", { reason: "bank rejected" });
    expect(failed.status).toBe(200);
    expect(failed.body.payout.status).toBe("FAILED");

    const balance = await db.orm.public.SellerBalance.where({ userId: SELLER_ID }).first();
    expect(Number(balance!.availableAmount)).toBe(5800);
    const ledgerRows = await db.orm.public.LedgerEntry
      .where({ transactionId: `payout:${payoutId}` })
      .all();
    expect(ledgerRows.length).toBe(0);
    const legacy = await db.orm.public.FinancialTransaction
      .where({ relatedPayoutId: payoutId })
      .all();
    expect(legacy.length).toBe(0);
  });

  it("records a caller-provided ledgerTxnId on completion", async () => {
    const created = await requestPayout(sellerToken, 1000);
    const payoutId = created.body.payout.id;
    await transition(adminToken, payoutId, "approve");
    const completed = await transition(adminToken, payoutId, "complete", {
      ledgerTxnId: `bank-txn-${SUFFIX}`,
      payoutRef: `payout-ref-${SUFFIX}`,
    });
    expect(completed.status).toBe(200);
    expect(completed.body.payout.ledgerTxnId).toBe(`bank-txn-${SUFFIX}`);
    expect(await isLedgerTransactionBalanced(`bank-txn-${SUFFIX}`)).toBe(true);
  });

  it("rejects transitions for an unknown payout (404)", async () => {
    const res = await transition(adminToken, "00000000-0000-0000-0000-000000000000", "approve");
    expect(res.status).toBe(404);
  });

  it("rejects an unknown action (400)", async () => {
    const created = await requestPayout(sellerToken, 500);
    const res = await transition(adminToken, created.body.payout.id, "teleport");
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!dbAvailable)("admin finance surfaces", () => {
  it("lists payouts with a status filter and pagination (finance.view)", async () => {
    const res = await app
      .get("/admin/finance/payouts?status=COMPLETED")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.payouts.every((p: any) => p.status === "COMPLETED")).toBe(true);

    const paged = await app
      .get("/admin/finance/payouts?page=1&limit=2")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(paged.status).toBe(200);
    expect(paged.body.payouts.length).toBeLessThanOrEqual(2);
  });

  it("rejects admin finance reads for a plain USER (403)", async () => {
    const res = await app.get("/admin/finance/payouts").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });
});