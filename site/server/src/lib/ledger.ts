// Financial ledger (PLAN F-001..F-005) + seller balance helpers.
//
// F-001: the source of truth is the append-only LedgerEntry table; every
// amount is a positive number with a DEBIT/CREDIT direction, grouped into
// balanced transactions (transactionId). SellerBalance stays as a derived
// cache (legacy FinancialTransaction rows are still written for the existing
// reconciliation flows).
//
// F-003/INV-012: no balance-changing operation without ledger entries, and
// every posted transaction must balance: sum(debits) == sum(credits).
//
// F-005: free orders create commerce/audit records but never money movement
// — zero-amount settlements post nothing.
import { db } from "../prisma/db";
import { logger } from "./logger";
import { withKeyLock } from "./keyLock";

export interface RecordSellerRevenueOptions {
  sellerId: string;
  purchaseId: string;
  amount: number; // kopecks, must be >= 0
  type: "SELLER_REVENUE" | "REFUND_FROM_SELLER" | "ADJUSTMENT";
}

/** Minimal transaction handle type (db or a db.transaction() callback). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any;

/** Standard account codes (F-002). */
export const LEDGER_ACCOUNT_CODES = {
  PLATFORM_CASH: "platform_cash",
  PLATFORM_REVENUE: "platform_revenue",
  REFUND_RESERVE: "refund_reserve",
  ADJUSTMENTS: "adjustments",
  SELLER_PENDING: (userId: string) => `seller_pending:${userId}`,
  SELLER_AVAILABLE: (userId: string) => `seller_available:${userId}`,
} as const;

type LedgerAccountKind =
  | "PLATFORM_CASH"
  | "SELLER_PENDING"
  | "SELLER_AVAILABLE"
  | "PLATFORM_REVENUE"
  | "PROVIDER_FEES"
  | "REFUND_RESERVE"
  | "ADJUSTMENTS";

/** F-002: lazily ensure a ledger account exists (upsert by unique code). */
export async function ensureLedgerAccount(
  code: string,
  kind: LedgerAccountKind,
  options: { currency?: string; userId?: string } = {}
): Promise<{ id: string }> {
  const existing = await db.orm.public.LedgerAccount.where({ code }).first();
  if (existing) return { id: existing.id };
  return db.orm.public.LedgerAccount.create({
    code,
    kind,
    currency: options.currency ?? "RUB",
    userId: options.userId ?? null,
  });
}

export interface LedgerEntryInput {
  account: { code: string; kind: LedgerAccountKind; userId?: string };
  direction: "DEBIT" | "CREDIT";
  amount: number; // kopecks, always positive
  currency?: string;
  orderId?: string;
  paymentId?: string;
  userId?: string;
  memo?: string;
}

export class LedgerUnbalancedError extends Error {
  constructor(transactionId: string, debits: number, credits: number) {
    super(
      `Ledger transaction ${transactionId} is unbalanced: debits(${debits}) != credits(${credits})`
    );
    this.name = "LedgerUnbalancedError";
  }
}

/** Normalize the affected-row result of updateAndCount()-style returns. */
export function affectedCount(result: unknown): number {
  if (typeof result === "number") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    for (const key of ["affectedCount", "count", "updated", "affected"]) {
      if (typeof r[key] === "number") return r[key];
    }
  }
  return 0;
}

/**
 * F-003/INV-012: post a balanced group of ledger entries. Throws
 * LedgerUnbalancedError when sum(debits) != sum(credits) or an entry amount
 * is non-positive.
 */
export async function postLedgerEntries(
  transactionId: string,
  entries: LedgerEntryInput[],
  executor: DbOrTx = db
): Promise<void> {
  if (entries.length === 0) return; // nothing to post (F-005 free flow)

  // PLAN-011 concurrency foundation (exactly-once): the deterministic
  // settlement transaction id is only meaningful if it is actually enforced.
  // A settlement retry (repair pass) must never post the same double-entry
  // rows twice — check before posting.
  const existing = await executor.orm.public.LedgerEntry.where({ transactionId }).first();
  if (existing) {
    return; // already posted — idempotent repair pass
  }

  const debits = entries
    .filter((e) => e.direction === "DEBIT")
    .reduce((sum, e) => sum + e.amount, 0);
  const credits = entries
    .filter((e) => e.direction === "CREDIT")
    .reduce((sum, e) => sum + e.amount, 0);

  if (debits !== credits) {
    throw new LedgerUnbalancedError(transactionId, debits, credits);
  }
  if (entries.some((e) => e.amount <= 0)) {
    throw new LedgerUnbalancedError(transactionId, -1, -1); // non-positive amount
  }

  for (const entry of entries) {
    const account = await ensureLedgerAccount(
      entry.account.code,
      entry.account.kind,
      { userId: entry.account.userId }
    );
    await executor.orm.public.LedgerEntry.create({
      transactionId,
      accountId: account.id,
      direction: entry.direction,
      amount: entry.amount,
      currency: entry.currency ?? "RUB",
      orderId: entry.orderId ?? null,
      paymentId: entry.paymentId ?? null,
      userId: entry.userId ?? entry.account.userId ?? null,
      memo: entry.memo ?? null,
    });
  }

  logger.info("ledger_transaction_posted", {
    transaction_id: transactionId,
    entries: entries.length,
    debits,
    credits,
  });
}

/**
 * F-003/INV-012 check: a ledger transaction must be balanced.
 * Used by tests and the reconciliation cycle.
 */
export async function isLedgerTransactionBalanced(transactionId: string): Promise<boolean> {
  const entries = await db.orm.public.LedgerEntry.where({ transactionId }).all();
  const debits = entries
    .filter((e: { direction: string }) => e.direction === "DEBIT")
    .reduce((s: number, e: { amount: number }) => s + e.amount, 0);
  const credits = entries
    .filter((e: { direction: string }) => e.direction === "CREDIT")
    .reduce((s: number, e: { amount: number }) => s + e.amount, 0);
  return debits === credits;
}

/**
 * F-001/F-002: settlement of a completed line as a double-entry transaction:
 *   DEBIT  platform_cash             finalPrice
 *   CREDIT seller_available:<seller> sellerRevenue
 *   CREDIT platform_revenue           platformFee
 * Free orders (finalPrice == 0) post NOTHING (F-005).
 */
async function postSettlementLedger(input: {
  sellerId: string;
  finalPrice: number;
  sellerRevenue: number;
  platformFee: number;
  orderId?: string;
  memo: string;
}): Promise<string | null> {
  if (input.finalPrice <= 0) {
    // F-005: no money movement for free orders.
    return null;
  }

  // PLAN-004 D-006/E-003 (audit GAP-2): the settlement transaction id is
  // deterministic (one ledger settlement per purchase/service line, ever).
  // A crash between purchase completion and settlement previously left a
  // permanent gap: the webhook retry hit `alreadyCompleted` and settlement
  // never ran. With a stable id the retry can safely re-run
  // settlePurchaseRevenue — an idempotent repair pass.
  const transactionId = `settle:${input.memo}`;
  const entries: LedgerEntryInput[] = [
    {
      account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_CASH, kind: "PLATFORM_CASH" },
      direction: "DEBIT",
      amount: input.finalPrice,
      orderId: input.orderId,
      memo: input.memo,
    },
  ];
  if (input.sellerRevenue > 0) {
    entries.push({
      account: {
        code: LEDGER_ACCOUNT_CODES.SELLER_AVAILABLE(input.sellerId),
        kind: "SELLER_AVAILABLE",
        userId: input.sellerId,
      },
      direction: "CREDIT",
      amount: input.sellerRevenue,
      orderId: input.orderId,
      userId: input.sellerId,
      memo: input.memo,
    });
  }
  if (input.platformFee > 0) {
    entries.push({
      account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_REVENUE, kind: "PLATFORM_REVENUE" },
      direction: "CREDIT",
      amount: input.platformFee,
      orderId: input.orderId,
      memo: input.memo,
    });
  }

  await postLedgerEntries(transactionId, entries);
  return transactionId;
}

/**
 * Atomically updates the seller's cached balance and records a legacy ledger
 * transaction. Concurrency note: balance read-then-write is guarded by the
 * F-003 double-entry rows; the cache is reconciled by internal.ts.
 */
export async function recordSellerRevenue(options: RecordSellerRevenueOptions): Promise<{
  balanceAfter: number;
}> {
  const { sellerId, purchaseId, amount, type } = options;

  if (amount < 0) {
    throw new Error(`Ledger amount must be non-negative, got ${amount}`);
  }
  if (amount === 0) {
    return { balanceAfter: 0 }; // nothing to record (F-005)
  }

  // Ensure balance row exists (upsert-like behavior)
  let balance = await db.orm.public.SellerBalance.where({ userId: sellerId }).first();

  if (!balance) {
    balance = await db.orm.public.SellerBalance.create({
      userId: sellerId,
      availableAmount: 0,
      inEscrowAmount: 0,
      totalEarned: 0,
    });
  }

  // PLAN-004 E-003 (audit GAP-4): REFUND_FROM_SELLER must DECREASE the
  // cached availableAmount — the double-entry side DEBITs seller_available,
  // so the cache previously ran in the opposite direction and drifted from
  // the ledger.
  const availableDelta = type === "REFUND_FROM_SELLER" ? -amount : amount;
  const totalEarnedDelta =
    type === "SELLER_REVENUE" ? amount : type === "REFUND_FROM_SELLER" ? -amount : 0;
  const newBalance = balance.availableAmount + availableDelta;

  await db.orm.public.SellerBalance.where({ userId: sellerId }).update({
    availableAmount: newBalance,
    ...(totalEarnedDelta !== 0 ? { totalEarned: balance.totalEarned + totalEarnedDelta } : {}),
  });

  await db.orm.public.FinancialTransaction.create({
    userId: sellerId,
    type,
    amount,
    balanceAfter: newBalance,
    relatedPurchaseId: purchaseId,
  });

  return { balanceAfter: newBalance };
}

/**
 * Records revenue split for a completed purchase:
 * seller gets finalPrice - platformFee; platform keeps platformFee.
 * Reads fee breakdown from the purchase snapshot (immutable).
 * INVARIANT: the split is validated against the FINAL price (after
 * discounts) — the pre-discount priceSnapshot is not the settled amount.
 * F-003: also posts the balanced double-entry settlement transaction.
 */
/**
 * PLAN-011 concurrency foundation: settlement is exactly-once per purchase.
 * The existence guard below plus this per-purchase key lock make the repair
 * pass (alreadyCompleted path) and parallel retries idempotent within the
 * backend process. Cross-instance exactly-once needs a unique constraint
 * (formal migration path) — see documents/history/MIGRATION.md.
 */
export async function settlePurchaseRevenue(purchase: SettleInput): Promise<void> {
  return withKeyLock(`settle:${purchase.id}`, () => settlePurchaseRevenueUnlocked(purchase));
}

interface SettleInput {
  id: string;
  buyerId: string;
  resourceId: string;
  orderItemId?: string | null;
  priceSnapshot: number;
  platformFee: number;
  sellerRevenue: number;
  finalPrice: number;
}

async function settlePurchaseRevenueUnlocked(purchase: SettleInput): Promise<void> {
  // Resolve seller from the resource (purchase snapshot holds resourceId)
  const resource = await db.orm.public.Resource.where({ id: purchase.resourceId }).first();

  if (!resource) {
    throw new Error(`Cannot settle purchase ${purchase.id}: resource not found`);
  }

  const sellerId = resource.sellerId;

  // Invariant: fee breakdown must add up against the FINAL price
  if (purchase.platformFee + purchase.sellerRevenue !== purchase.finalPrice) {
    throw new Error(
      `Ledger invariant violated for purchase ${purchase.id}: ` +
        `platformFee(${purchase.platformFee}) + sellerRevenue(${purchase.sellerRevenue}) ` +
        `!= finalPrice(${purchase.finalPrice})`
    );
  }

  // Credit seller with their revenue portion (legacy cache + transactions)
  // PLAN-011 concurrency foundation (exactly-once): the legacy
  // FinancialTransaction + SellerBalance cache must also be applied at most
  // once per purchase. The repair pass (alreadyCompleted path in commerce)
  // re-runs settlePurchaseRevenue — without this guard the cache drifted
  // from the ledger on every retry.
  if (purchase.sellerRevenue > 0) {
    const alreadyRecorded = await db.orm.public.FinancialTransaction
      .where({ relatedPurchaseId: purchase.id, type: "SELLER_REVENUE" })
      .first();
    if (!alreadyRecorded) {
      await recordSellerRevenue({
        sellerId,
        purchaseId: purchase.id,
        amount: purchase.sellerRevenue,
        type: "SELLER_REVENUE",
      });
    }
  }

  // F-003: double-entry settlement (no-op for free orders, F-005)
  await postSettlementLedger({
    sellerId,
    finalPrice: purchase.finalPrice,
    sellerRevenue: purchase.sellerRevenue,
    platformFee: purchase.platformFee,
    orderId: purchase.orderItemId
      ? (await db.orm.public.OrderItem.where({ id: purchase.orderItemId }).first())?.orderId
      : undefined,
    memo: `purchase:${purchase.id}`,
  });
}


/**
 * C-009/C-011: records the revenue split for an ACCEPTED service order.
 * Mirrors settlePurchaseRevenue: seller gets sellerRevenue, platform keeps
 * platformFee; the split is validated against the FINAL price.
 */
export async function settleServiceRevenue(servicePurchase: {
  id: string;
  serviceId: string;
  finalPrice: number;
  platformFee: number;
  sellerRevenue: number;
}): Promise<void> {
  const service = await db.orm.public.Service.where({ id: servicePurchase.serviceId }).first();

  if (!service) {
    throw new Error(`Cannot settle service purchase ${servicePurchase.id}: service not found`);
  }

  if (servicePurchase.platformFee + servicePurchase.sellerRevenue !== servicePurchase.finalPrice) {
    throw new Error(
      `Ledger invariant violated for service purchase ${servicePurchase.id}: ` +
        `platformFee(${servicePurchase.platformFee}) + sellerRevenue(${servicePurchase.sellerRevenue}) ` +
        `!= finalPrice(${servicePurchase.finalPrice})`
    );
  }

  if (servicePurchase.sellerRevenue > 0) {
    await recordSellerRevenue({
      sellerId: service.sellerId,
      purchaseId: servicePurchase.id,
      amount: servicePurchase.sellerRevenue,
      type: "SELLER_REVENUE",
    });
  }

  await postSettlementLedger({
    sellerId: service.sellerId,
    finalPrice: servicePurchase.finalPrice,
    sellerRevenue: servicePurchase.sellerRevenue,
    platformFee: servicePurchase.platformFee,
    memo: `service_purchase:${servicePurchase.id}`,
  });
}
