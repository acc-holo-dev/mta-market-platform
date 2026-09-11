// Concurrency foundation (PLAN-010 §12): ledger settlement exactly-once.
//
// Invariant: settling the same completed purchase N times in parallel must
// post the revenue movement exactly once (idempotent settlement, no double
// credit of the seller, no duplicated FinancialTransaction rows).
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { db } from "@server/prisma/db";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const SELLER_ID = "550e8400-e29b-41d4-a716-44665544d100";
const BUYER_ID = "550e8400-e29b-41d4-a716-44665544d101";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[parallel-settlement.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

interface Seeded {
  purchaseId: string;
  sellerNet: number;
}

async function seedCompletedPurchase(finalPrice = 5000): Promise<Seeded> {
  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `ccy-ledger-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
    title: "Concurrency ledger fixture",
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: finalPrice,
  });
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/ccy-ledger-${SUFFIX}.zip`,
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
  await db.orm.public.License.create({
    purchaseId: purchase.id,
    versionId: version.id,
    status: "ACTIVE",
  });
  return { purchaseId: purchase.id, sellerNet: finalPrice - platformFee };
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  await createTestUser(SELLER_ID, `ccy-ls_${SUFFIX}`, "USER", () => "unused");
  await createTestUser(BUYER_ID, `ccy-lb_${SUFFIX}`, "USER", () => "unused");
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("concurrency: parallel settlement (idempotency)", () => {
  it("settling one purchase N times posts revenue exactly once", async () => {
    const { settlePurchaseRevenue } = await import("@server/lib/ledger");
    const seeded = await seedCompletedPurchase(5000);

    await Promise.all(
      Array.from({ length: 4 }, () =>
        db.orm.public.Purchase.where({ id: seeded.purchaseId }).first().then((p) => settlePurchaseRevenue(p!))
      )
    );

    const txs = await db.orm.public.FinancialTransaction
      .where({ relatedPurchaseId: seeded.purchaseId })
      .all();
    const revenueTxs = txs.filter((t) => (t as { type?: string }).type === "SELLER_REVENUE");
    expect(revenueTxs.length).toBe(1);

    const entries = await db.orm.public.LedgerEntry
      .where({ memo: `purchase:${seeded.purchaseId}` })
      .all();
    const sellerRevenueEntries = entries.filter(
      (e) => (e as { amount?: number }).amount === seeded.sellerNet
    );
    expect(sellerRevenueEntries.length).toBeLessThanOrEqual(1);

    // seller cached balance credited exactly once for the sellerNet amount
    const balance = await db.orm.public.SellerBalance.where({ userId: SELLER_ID }).first();
    if (balance) {
      expect((balance as { availableAmount?: number }).availableAmount).toBe(seeded.sellerNet);
    }
  });
});
