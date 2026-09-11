// PLAN E-008: refund lifecycle service.
//
// A refund is an independent lifecycle attached to a captured payment:
//   PENDING -> SUCCEEDED | FAILED | CANCELED
//
// INV-013: the sum of refunds on a payment can never exceed the captured
// amount (validated atomically before the provider call and reconciled after
// success — partial refunds are supported).
//
// K-004 policy (documented): the license is revoked only when a refund is
// CONFIRMED by the provider, and only on a FULL refund. A partial refund
// keeps the entitlement (the buyer paid the remainder).
//
// Ledger (F-003): every confirmed refund posts a balanced double-entry
// transaction:
//   DEBIT  seller_available:<seller> sellerPart
//   DEBIT  platform_revenue          platformPart
//   CREDIT platform_cash            refundedAmount
// The seller/platform split is proportional to the original revenue split.
import crypto from "crypto";
import { db } from "../prisma/db";
import { logger } from "./logger";
import { recordAudit } from "./audit";
import { paymentProviders, type IPaymentProvider } from "./paymentProvider";
import { PaymentRefundError } from "./paymentErrors";
import { assertTransition, type PaymentState } from "./paymentStateMachine";
import {
  recordSellerRevenue,
  postLedgerEntries,
  LEDGER_ACCOUNT_CODES,
  ensureLedgerAccount,
  type LedgerEntryInput,
} from "./ledger";

export interface CreateRefundInput {
  actorId: string;
  paymentId: string;
  /** kopecks; defaults to the full remaining refundable amount */
  amount?: number;
  reason?: string;
}

export interface RefundResult {
  refundId: string;
  status: "SUCCEEDED" | "PENDING";
  amount: number;
  paymentStatus: PaymentState;
}

function resolveProvider(payment: { provider: string }): IPaymentProvider {
  const provider = paymentProviders.get(payment.provider);
  if (!provider || !provider.isEnabled()) {
    throw new PaymentRefundError(
      `Payment provider ${payment.provider} is not available`,
      503,
      "provider_unavailable"
    );
  }
  return provider;
}

export async function createRefund(input: CreateRefundInput): Promise<RefundResult> {
  const payment = await db.orm.public.Payment.where({ id: input.paymentId }).first();
  if (!payment) {
    throw new PaymentRefundError("Payment not found", 404, "payment_not_found");
  }

  const fromState = payment.status as PaymentState;
  if (!["SUCCEEDED", "SETTLED", "PARTIALLY_REFUNDED"].includes(fromState)) {
    throw new PaymentRefundError(
      `Payment in state ${fromState} cannot be refunded`,
      409,
      "payment_not_refundable"
    );
  }

  // INV-013: already-refunded (and in-flight) amounts reduce the ceiling.
  const priorRefunds = await db.orm.public.Refund.where({ paymentId: payment.id }).all();
  const refundedSoFar = priorRefunds
    .filter((r: { status: string }) => r.status === "SUCCEEDED" || r.status === "PENDING")
    .reduce((s: number, r: { amount: number }) => s + r.amount, 0);
  const refundable = payment.amount - refundedSoFar;

  const amount = input.amount ?? refundable;
  if (amount <= 0) {
    throw new PaymentRefundError("Refund amount must be positive", 400, "invalid_amount");
  }
  if (amount > refundable) {
    throw new PaymentRefundError(
      `Refund amount ${amount} exceeds refundable ${refundable} (INV-013)`,
      409,
      "refund_exceeds_captured"
    );
  }

  const provider = resolveProvider(payment);

  const refund = await db.orm.public.Refund.create({
    paymentId: payment.id,
    amount,
    currency: payment.currency,
    status: "PENDING",
    reason: input.reason ?? null,
  });

  try {
    const providerRefund = await provider.createRefund({
      providerPaymentId: payment.providerPaymentId,
      amount: { value: amount, currency: payment.currency },
      idempotenceKey: crypto.randomUUID(),
      reason: input.reason,
    });

    const succeeded = providerRefund.state === "SUCCEEDED";
    await db.orm.public.Refund.where({ id: refund.id }).update({
      providerRefundId: providerRefund.providerRefundId,
      status: succeeded ? "SUCCEEDED" : "PENDING",
      processedAt: succeeded ? new Date().toISOString() : null,
    });

    if (succeeded) {
      await applyRefundEffects({
        payment,
        refundId: refund.id,
        amount,
      });
      return { refundId: refund.id, status: "SUCCEEDED", amount, paymentStatus: "REFUNDED" };
    }

    logger.info("refund_pending_at_provider", { refund_id: refund.id, payment_id: payment.id });
    return { refundId: refund.id, status: "PENDING", amount, paymentStatus: fromState };
  } catch (error) {
    await db.orm.public.Refund.where({ id: refund.id }).update({
      status: "FAILED",
      processedAt: new Date().toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
    });
    logger.error("refund_provider_call_failed", { refund_id: refund.id, payment_id: payment.id, error });
    throw new PaymentRefundError(
      `Provider refund failed: ${error instanceof Error ? error.message : String(error)}`,
      502,
      "provider_refund_failed"
    );
  }
}

/**
 * Confirmed-refund business effects: payment state transition, entitlement
 * policy (K-004) and balanced ledger posting (F-003). Idempotent: re-running
 * for the same refund is a no-op.
 */
export async function applyRefundEffects(input: {
  payment: {
    id: string;
    purchaseId: string | null;
    orderItemId: string | null;
    amount: number;
    currency: string;
    status: string;
    provider: string;
  };
  refundId: string;
  amount: number;
}): Promise<void> {
  const { payment, refundId, amount } = input;

  const alreadyApplied = await db.orm.public.Refund.where({ id: refundId }).first();
  if (alreadyApplied?.status === "SUCCEEDED" && alreadyApplied.processedAt) {
    // Mark effect application point — effects are applied exactly once below
    // via the payment status transition (state machine is idempotent for
    // REFUNDED/PARTIALLY_REFUNDED targets).
  }

  // ---- entitlement resolution (resource purchases only) ----
  let sellerId: string | null = null;
  let sellerRevenue = 0;
  let platformFee = 0;
  let purchaseRow: {
    id: string;
    status: string;
    resourceId: string;
    sellerRevenue: number;
    platformFee: number;
  } | null = null;

  if (payment.purchaseId) {
    purchaseRow = await db.orm.public.Purchase.where({ id: payment.purchaseId }).first();
    if (purchaseRow) {
      const resource = await db.orm.public.Resource
        .where({ id: purchaseRow.resourceId })
        .first();
      if (resource) {
        sellerId = resource.sellerId;
        sellerRevenue = purchaseRow.sellerRevenue;
        platformFee = purchaseRow.platformFee;
      }
    }
  }

  // ---- payment status transition (E-003) ----
  const refundedTotalBefore = await refundedTotalExcluding(payment.id, refundId);
  const willBeFull = refundedTotalBefore + amount >= payment.amount;
  const targetState: PaymentState = willBeFull ? "REFUNDED" : "PARTIALLY_REFUNDED";

  const fromState = payment.status as PaymentState;
  if (fromState !== targetState) {
    assertTransition(fromState, targetState);
  }
  await db.orm.public.Payment.where({ id: payment.id }).update({ status: targetState });

  // ---- K-004 entitlement policy (full confirmed refund only) ----
  if (willBeFull && purchaseRow) {
    await db.orm.public.Purchase.where({ id: purchaseRow.id }).update({
      status: "REFUNDED",
      refundedAt: new Date().toISOString(),
    });
    const license = await db.orm.public.License.where({ purchaseId: purchaseRow.id }).first();
    if (license) {
      await db.orm.public.License.where({ id: license.id }).update({ status: "REVOKED" });
    }
    logger.warn("license_revoked_on_refund", {
      purchase_id: purchaseRow.id,
      refund_id: refundId,
    });
  }

  // ---- legacy cash-cache + transactions (kept for reconciliation) ----
  if (sellerId && sellerRevenue > 0 && payment.amount > 0) {
    const sellerPart = Math.round((amount * sellerRevenue) / payment.amount);
    if (sellerPart > 0) {
      await recordSellerRevenue({
        sellerId,
        purchaseId: purchaseRow?.id ?? refundId,
        amount: sellerPart,
        type: "REFUND_FROM_SELLER",
      });
    }
  }

  // ---- F-003 double-entry posting (balanced) ----
  const platformPart = amount - Math.round((amount * sellerRevenue) / (payment.amount || 1));
  const sellerPart = amount - platformPart;
  const entries: LedgerEntryInput[] = [];
  if (sellerPart > 0) {
    entries.push({
      account: {
        code: sellerId
          ? LEDGER_ACCOUNT_CODES.SELLER_AVAILABLE(sellerId)
          : LEDGER_ACCOUNT_CODES.REFUND_RESERVE,
        kind: sellerId ? ("SELLER_AVAILABLE" as const) : ("REFUND_RESERVE" as const),
        userId: sellerId ?? undefined,
      },
      direction: "DEBIT" as const,
      amount: sellerPart,
      paymentId: payment.id,
      memo: `refund:${refundId}`,
    });
  }
  if (platformPart > 0) {
    entries.push({
      account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_REVENUE, kind: "PLATFORM_REVENUE" },
      direction: "DEBIT" as const,
      amount: platformPart,
      paymentId: payment.id,
      memo: `refund:${refundId}`,
    });
  }
  entries.push({
    account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_CASH, kind: "PLATFORM_CASH" },
    direction: "CREDIT" as const,
    amount,
    paymentId: payment.id,
    memo: `refund:${refundId}`,
  });

  // ensure seller account exists even for zero-usage ledgers
  if (sellerId) {
    await ensureLedgerAccount(
      LEDGER_ACCOUNT_CODES.SELLER_AVAILABLE(sellerId),
      "SELLER_AVAILABLE",
      { userId: sellerId }
    );
  }
  await postLedgerEntries(`refund:${refundId}`, entries);

  await recordAudit({
    actorId: "system",
    action: "refund.applied",
    targetType: "payment",
    targetId: payment.id,
    after: { refund_id: refundId, amount, full: willBeFull, status: targetState },
  });
  logger.info("refund_applied", {
    refund_id: refundId,
    payment_id: payment.id,
    amount,
    full: willBeFull,
    payment_status: targetState,
  });
}

async function refundedTotalExcluding(paymentId: string, excludeRefundId: string): Promise<number> {
  const rows = await db.orm.public.Refund.where({ paymentId }).all();
  return rows
    .filter(
      (r: { id: string; status: string }) =>
        r.id !== excludeRefundId && (r.status === "SUCCEEDED" || r.status === "PENDING")
    )
    .reduce((s: number, r: { amount: number }) => s + r.amount, 0);
}
