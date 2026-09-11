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
//
// PLAN-012 В§8/В§9/В§10 (transactional correctness):
//   - the cached SellerBalance is mutated ATOMICALLY in SQL
//     ("availableAmount = availableAmount + delta" via the raw lane) — the
//     read-then-write race is gone;
//   - the legacy FinancialTransaction + balance delta + double-entry ledger
//     posting for one settlement happen in ONE database transaction;
//   - the deterministic settlement transaction id
//     (`settle:purchase:<id>` / `settle:service_purchase:<id>`) is enforced
//     by the ledger_entry_tx_account_direction_uq unique index, and the
//     one-SELLER_REVENUE-per-line rule by financial_txn_settlement_once_uq —
//     both hold across backend instances, not just within one process.
import { db } from "../prisma/db.js";
import { logger } from "./logger.js";
import { withKeyLock } from "./keyLock.js";
import { isUniqueViolation } from "./dbErrors.js";

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

/** F-002: lazily ensure a ledger account exists (unique code is the invariant). */
export async function ensureLedgerAccount(
  code: string,
  kind: LedgerAccountKind,
  options: { currency?: string; userId?: string; executor?: DbOrTx } = {}
): Promise<{ id: string }> {
  const executor = options.executor ?? db;
  const existing = await executor.orm.public.LedgerAccount.where({ code }).first();
  if (existing) return { id: existing.id };
  try {
    return await executor.orm.public.LedgerAccount.create({
      code,
      kind,
      currency: options.currency ?? "RUB",
      userId: options.userId ?? null,
    });
  } catch (error) {
    // Two instances ensuring the same account concurrently: the unique code
    // decides — re-read the winner's row.
    if (isUniqueViolation(error, "ledgerAccount_code_key")) {
      const winner = await executor.orm.public.LedgerAccount.where({ code }).first();
      if (winner) return { id: winner.id };
    }
    throw error;
  }
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

/** Thrown when a settlement was already applied (dedup marker hit). */
export class SettlementAlreadyAppliedError extends Error {
  constructor() {
    super("Settlement was already applied for this line");
    this.name = "SettlementAlreadyAppliedError";
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
 *
 * PLAN-012 §10: idempotency is now a DATABASE invariant — the unique
 * (transactionId, accountId, direction) index rejects the second posting of
 * the same balanced transaction even across backend instances. The
 * check-before-insert below stays as the cheap fast path; the insert is
 * also guarded by catching the unique violation.
 */
export async function postLedgerEntries(
  transactionId: string,
  entries: LedgerEntryInput[],
  executor: DbOrTx = db
): Promise<void> {
  if (entries.length === 0) return; // nothing to post (F-005 free flow)

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
    const account = await ensureLedgerAccount(entry.account.code, entry.account.kind, {
      userId: entry.account.userId,
      executor,
    });
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
 * PLAN-012 В§8: ATOMIC balance mutation. The delta is applied by the database
 * itself ("availableAmount = availableAmount + delta" in a single UPDATE with
 * RETURNING) — two concurrent mutations can no longer overwrite each other,
 * whatever the number of backend instances. The row is created if missing.
 */
export async function applySellerBalanceDelta(
  sellerId: string,
  availableDelta: number,
  totalEarnedDelta: number,
  executor: DbOrTx = db
): Promise<number> {
  // Ensure the row exists (the userId is the primary key — a parallel
  // creation is resolved by the primary key, not by a read-then-write race).
  const existing = await executor.orm.public.SellerBalance.where({ userId: sellerId }).first();
  if (!existing) {
    try {
      await executor.orm.public.SellerBalance.create({
        userId: sellerId,
        availableAmount: 0,
        inEscrowAmount: 0,
        totalEarned: 0,
      });
    } catch (error) {
      if (!isUniqueViolation(error, "sellerBalance_pkey")) throw error;
    }
  }

  // The raw lane is authored on the client (db.raw.sql); the plan executes
  // through the supplied executor so it rides the caller's transaction. The
  // client executes plans via runtime(); a transaction context carries
  // execute() directly.
  const plan = db.raw.sql
    `UPDATE "sellerBalance"
     SET "availableAmount" = "availableAmount" + ${availableDelta},
         "totalEarned" = "totalEarned" + ${totalEarnedDelta}
     WHERE "userId" = ${sellerId}
     RETURNING "availableAmount"`
    .returnsRow({ availableAmount: "pg/int4@1" })
    .build();
  const rows =
    typeof executor.execute === "function"
      ? ((await executor.execute(plan)) as Array<{ availableAmount: number }>)
      : ((await executor.runtime().execute(plan)) as Array<{ availableAmount: number }>);
  return Number(rows[0]?.availableAmount ?? 0);
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
 * PLAN-011 concurrency foundation + PLAN-012 В§9/В§10: settlement is
 * exactly-once per purchase. The per-purchase key lock serializes repair
 * passes within one process; the database invariants (unique
 * financialTransaction row per SELLER_REVENUE settlement, unique ledger
 * (transactionId, accountId, direction)) make it exactly-once across
 * instances. The whole settlement — legacy cache, legacy transaction and
 * double-entry rows — is ONE database transaction.
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

  const orderId = purchase.orderItemId
    ? (await db.orm.public.OrderItem.where({ id: purchase.orderItemId }).first())?.orderId
    : undefined;

  // F-003: one database transaction for the legacy cache, the legacy
  // transaction row and the double-entry settlement (В§9). Free orders post
  // nothing (F-005). Exactly-once: the FinancialTransaction row is the dedup
  // marker (pre-checked here, enforced by the
  // financial_txn_settlement_once_uq unique index across instances) — a
  // losing race aborts atomically with nothing applied.
  try {
    await db.transaction(async (tx: DbOrTx) => {
      if (purchase.sellerRevenue > 0) {
        const alreadyRecorded = await tx.orm.public.FinancialTransaction
          .where({ relatedPurchaseId: purchase.id, type: "SELLER_REVENUE" })
          .first();
        if (alreadyRecorded) {
          logger.info("purchase_settlement_already_applied", { purchase_id: purchase.id });
          throw new SettlementAlreadyAppliedError();
        }
        await recordSellerRevenue(
          {
            sellerId,
            purchaseId: purchase.id,
            amount: purchase.sellerRevenue,
            type: "SELLER_REVENUE",
          },
          tx
        );
      }

      await postSettlementLedger(
        {
          sellerId,
          finalPrice: purchase.finalPrice,
          sellerRevenue: purchase.sellerRevenue,
          platformFee: purchase.platformFee,
          orderId,
          memo: `purchase:${purchase.id}`,
        },
        tx
      );
    });
  } catch (error) {
    // A parallel settlement (other instance) won the unique race: the
    // committed winner already applied every effect — our abort is the
    // exactly-once no-op. The ledger unique (transactionId, accountId,
    // direction) covers the free-revenue and partial paths.
    if (
      error instanceof SettlementAlreadyAppliedError ||
      isUniqueViolation(error)
    ) {
      logger.warn("purchase_settlement_race_lost", {
        purchase_id: purchase.id,
        reason: error instanceof SettlementAlreadyAppliedError ? "marker" : "unique",
      });
      return;
    }
    throw error;
  }
}

/**
 * F-001/F-002: settlement of a completed line as a double-entry transaction:
 *   DEBIT  platform_cash             finalPrice
 *   CREDIT seller_available:<seller> sellerRevenue
 *   CREDIT platform_revenue           platformFee
 * Free orders (finalPrice == 0) post NOTHING (F-005).
 * Runs on the supplied executor (db or an open transaction).
 */
async function postSettlementLedger(
  input: {
    sellerId: string;
    finalPrice: number;
    sellerRevenue: number;
    platformFee: number;
    orderId?: string;
    memo: string;
  },
  executor: DbOrTx = db
): Promise<string | null> {
  if (input.finalPrice <= 0) {
    // F-005: no money movement for free orders.
    return null;
  }

  // PLAN-004 D-006/E-003 (audit GAP-2) + PLAN-012 В§10: the settlement
  // transaction id is deterministic (one ledger settlement per purchase /
  // service line, ever); the unique (transactionId, accountId, direction)
  // index turns it into a hard invariant. A crash between purchase
  // completion and settlement leaves a repairable gap: the retry re-runs
  // settlePurchaseRevenue — already-posted entries make it a no-op.
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

  await postLedgerEntries(transactionId, entries, executor);
  return transactionId;
}

/**
 * Atomically updates the seller's cached balance and records the legacy
 * financial transaction.
 *
 * PLAN-012 В§8/В§10:
 *   - the balance delta is applied by the DATABASE (single UPDATE ... +
 *     delta ... RETURNING), never read-then-write in JS;
 *   - the FinancialTransaction row is the dedup marker: for SELLER_REVENUE a
 *     unique partial index (financial_txn_settlement_once_uq) admits exactly
 *     one row per related purchase — a concurrent/repair settlement loses
 *     the race at the database and the balance delta it already applied is
 *     rolled back with the transaction;
 *   - when `executor` is supplied the caller owns the transaction boundary
 *     (settlement composes ledger + cache + marker atomically).
 */
export async function recordSellerRevenue(
  options: RecordSellerRevenueOptions,
  executor?: DbOrTx
): Promise<{
  applied: boolean;
  balanceAfter: number;
}> {
  const { sellerId, purchaseId, amount, type } = options;

  if (amount < 0) {
    throw new Error(`Ledger amount must be non-negative, got ${amount}`);
  }
  if (amount === 0) {
    const current = await db.orm.public.SellerBalance.where({ userId: sellerId }).first();
    return { applied: false, balanceAfter: Number(current?.availableAmount ?? 0) };
  }

  const availableDelta = type === "REFUND_FROM_SELLER" ? -amount : amount;
  const totalEarnedDelta =
    type === "SELLER_REVENUE" ? amount : type === "REFUND_FROM_SELLER" ? -amount : 0;

  const run = async (tx: DbOrTx): Promise<{ applied: boolean; balanceAfter: number }> => {
    // Atomic delta first; the legacy transaction row is the dedup marker.
    const balanceAfter = await applySellerBalanceDelta(
      sellerId,
      availableDelta,
      totalEarnedDelta,
      tx
    );

    try {
      await tx.orm.public.FinancialTransaction.create({
        userId: sellerId,
        type,
        amount,
        balanceAfter,
        relatedPurchaseId: purchaseId,
      });
    } catch (error) {
      if (
        type === "SELLER_REVENUE" &&
        isUniqueViolation(error, "financial_txn_settlement_once_uq")
      ) {
        // This settlement was already applied (concurrent instance or the
        // idempotent repair pass). Throwing rolls back our delta; the caller
        // treats the settlement as already done.
        throw new SettlementAlreadyAppliedError();
      }
      throw error;
    }

    return { applied: true, balanceAfter };
  };

  if (executor) {
    return run(executor);
  }

  try {
    return await db.transaction(run);
  } catch (error) {
    if (error instanceof SettlementAlreadyAppliedError) {
      const current = await db.orm.public.SellerBalance.where({ userId: sellerId }).first();
      return { applied: false, balanceAfter: Number(current?.availableAmount ?? 0) };
    }
    throw error;
  }
}

/**
 * C-009/C-011: records the revenue split for an ACCEPTED service order.
 * Mirrors settlePurchaseRevenue: seller gets sellerRevenue, platform keeps
 * platformFee; the split is validated against the FINAL price.
 * PLAN-012 В§9: one database transaction for the cache, the legacy row and
 * the double-entry settlement; exactly-once is enforced by the same
 * database invariants as purchase settlement.
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

  try {
    await db.transaction(async (tx: DbOrTx) => {
      if (servicePurchase.sellerRevenue > 0) {
        const alreadyRecorded = await tx.orm.public.FinancialTransaction
          .where({ relatedPurchaseId: servicePurchase.id, type: "SELLER_REVENUE" })
          .first();
        if (alreadyRecorded) {
          logger.info("service_settlement_already_applied", {
            service_purchase_id: servicePurchase.id,
          });
          throw new SettlementAlreadyAppliedError();
        }
        await recordSellerRevenue(
          {
            sellerId: service.sellerId,
            purchaseId: servicePurchase.id,
            amount: servicePurchase.sellerRevenue,
            type: "SELLER_REVENUE",
          },
          tx
        );
      }

      await postSettlementLedger(
        {
          sellerId: service.sellerId,
          finalPrice: servicePurchase.finalPrice,
          sellerRevenue: servicePurchase.sellerRevenue,
          platformFee: servicePurchase.platformFee,
          memo: `service_purchase:${servicePurchase.id}`,
        },
        tx
      );
    });
  } catch (error) {
    if (
      error instanceof SettlementAlreadyAppliedError ||
      isUniqueViolation(error)
    ) {
      logger.warn("service_settlement_race_lost", {
        service_purchase_id: servicePurchase.id,
        reason: error instanceof SettlementAlreadyAppliedError ? "marker" : "unique",
      });
      return;
    }
    throw error;
  }
}
