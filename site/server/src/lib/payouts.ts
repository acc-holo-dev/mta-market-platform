// PLAN-018 A-007: seller payout lifecycle service.
//
// Lifecycle: PENDING --approve--> PROCESSING --complete--> COMPLETED
//                     \                  \--> fail --> FAILED
//                      \--> cancel --> CANCELLED
// (action "process" is accepted as an alias of "approve" — both start the
// payout; there is no separate PROCESSING entry from the admin UI.)
//
// Invariants:
// - The available balance is the SERVER-computed SellerBalance cache (derived
//   from the ledger, lib/ledger.ts) — never a frontend-provided number.
// - At most one OPEN payout (PENDING|PROCESSING) per seller: the second
//   request is rejected with 409 while the first is unresolved.
// - The ledger is untouched until COMPLETED: approve/cancel/fail move no
//   money. Nothing needs releasing on fail/cancel because nothing was ever
//   reserved — the balance check happens at request time, and completion
//   re-checks live state (the transaction aborts when the balance went
//   negative in the meantime).
// - COMPLETED is the only money-moving transition: ONE database transaction
//   applies the seller balance delta, the legacy SELLER_PAYOUT
//   FinancialTransaction row (the reconciliation PAYOUT source), and the
//   balanced double-entry posting `payout:<id>`:
//       DEBIT  seller_available:<seller>  amount
//       CREDIT platform_cash              amount
//   The deterministic transaction id + the unique
//   (transactionId, accountId, direction) index make a replay a no-op
//   (same exactly-once pattern as lib/refunds.ts).
// - Every transition is CAS-guarded (where {id, status: expected}) and
//   audited (before/after) + mirrored into SystemLog.

import { db } from "../prisma/db.js";
import { logger } from "./logger.js";
import { withKeyLock } from "./keyLock.js";
import { recordAudit } from "./audit.js";
import { logSystem } from "./systemLog.js";
import {
  applySellerBalanceDelta,
  affectedCount,
  LEDGER_ACCOUNT_CODES,
  postLedgerEntries,
  isLedgerTransactionBalanced,
  type LedgerEntryInput,
} from "./ledger.js";

export type PayoutStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type PayoutAction = "approve" | "process" | "complete" | "fail" | "cancel";

/** Thrown by payout operations; routes map {status, code, message} → response. */
export class PayoutError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "PayoutError";
  }
}

/** Minimal transaction handle type (db or a db.transaction() callback). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any;

/**
 * A-007: payout transition table (from → actions[]), exported for docs/tests.
 * "process" is listed where "approve" is accepted (alias).
 */
export const PAYOUT_TRANSITIONS: Record<PayoutStatus, PayoutAction[]> = {
  PENDING: ["approve", "process", "cancel"],
  PROCESSING: ["complete", "fail"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

/** Int4 ceiling guard: keeps amountMinor inside the PostgreSQL int range. */
export const MAX_PAYOUT_AMOUNT_MINOR = 2_000_000_000;

/** Row shape surfaced by this module (the ORM row type is not nameable across
 * pnpm store paths — TS2742, mirrors lib/reconciliation/service.ts). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PayoutRow = any;

/** Server-computed available balance for a seller (0 when the row is missing). */
export async function getAvailableBalance(sellerId: string): Promise<number> {
  const row = await db.orm.public.SellerBalance.where({ userId: sellerId }).first();
  return Number(row?.availableAmount ?? 0);
}

/** The seller's unresolved payout, if any (status PENDING|PROCESSING). */
export async function getOpenPayout(sellerId: string): Promise<PayoutRow | null> {
  const pending = await db.orm.public.PayoutRequest
    .where({ sellerId, status: "PENDING" })
    .orderBy((m: any) => m.requestedAt.desc())
    .first();
  if (pending) return pending;
  return await db.orm.public.PayoutRequest
    .where({ sellerId, status: "PROCESSING" })
    .orderBy((m: any) => m.requestedAt.desc())
    .first();
}

/**
 * Request a payout: validates the amount and the server-computed available
 * balance, rejects when an OPEN payout already exists (409), creates the
 * PENDING row, audits + SystemLogs. No money moves here.
 */
export async function requestPayout(input: {
  sellerId: string;
  amountMinor: number;
  note?: string | null;
  auditContext?: { ip?: string | null; requestId?: string | null };
}): Promise<PayoutRow> {
  const { sellerId } = input;
  const amountMinor = Number(input.amountMinor);

  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new PayoutError(
      400,
      "invalid_amount",
      "Сумма выплаты должна быть положительным целым числом"
    );
  }
  if (amountMinor > MAX_PAYOUT_AMOUNT_MINOR) {
    throw new PayoutError(400, "amount_too_large", "Сумма выплаты превышает допустимый максимум");
  }

  // Serialize the check-then-create pair per seller (single-process topology;
  // the open-payout rule is re-checked against fresh rows inside the lock).
  return withKeyLock(`payout:${sellerId}`, async () => {
    const open = await getOpenPayout(sellerId);
    if (open) {
      throw new PayoutError(409, "open_payout_exists", "У вас уже есть незавершённая заявка на выплату");
    }

    // Server-computed truth only (F-003/INV-012): never a client value.
    const available = await getAvailableBalance(sellerId);
    if (available < amountMinor) {
      throw new PayoutError(
        409,
        "insufficient_balance",
        `Недостаточно средств для выплаты: доступно ${available}, запрошено ${amountMinor}`
      );
    }

    const payout = await db.orm.public.PayoutRequest.create({
      sellerId,
      amountMinor,
      currency: "RUB",
      status: "PENDING",
      note: input.note ?? null,
    });

    await recordAudit({
      actorId: sellerId,
      action: "payout_requested",
      targetType: "payout_request",
      targetId: payout.id,
      after: { amountMinor, currency: "RUB", status: "PENDING", available },
      ip: input.auditContext?.ip ?? null,
      requestId: input.auditContext?.requestId ?? null,
    });
    await logSystem({
      level: "INFO",
      service: "api",
      message: "payout_requested",
      meta: { payout_id: payout.id, seller_id: sellerId, amount_minor: amountMinor },
    });
    logger.info("payout_requested", { payout_id: payout.id, seller_id: sellerId, amountMinor });
    return payout;
  });
}

/**
 * Admin transition. CAS-guarded on the observed status; every applied
 * transition writes audit (before/after) + SystemLog. "complete" posts the
 * balanced ledger transaction and moves the seller balance atomically.
 */
export async function transitionPayout(input: {
  payoutId: string;
  action: PayoutAction;
  actorId: string;
  reason?: string | null;
  ledgerTxnId?: string | null;
  payoutRef?: string | null;
  auditContext?: { ip?: string | null; requestId?: string | null };
}): Promise<PayoutRow> {
  const { payoutId, action, actorId } = input;

  if (!["approve", "process", "complete", "fail", "cancel"].includes(action)) {
    throw new PayoutError(400, "invalid_action", "Неизвестное действие над выплатой");
  }

  const payout = await db.orm.public.PayoutRequest.where({ id: payoutId }).first();
  if (!payout) {
    throw new PayoutError(404, "payout_not_found", "Заявка на выплату не найдена");
  }

  const from = payout.status as PayoutStatus;

  // Idempotent replay: re-completing an already-COMPLETED payout is an honest
  // no-op (the ledger effects are exactly-once; mirrors the payment CAS
  // "already in target state" acknowledgment).
  if (action === "complete" && from === "COMPLETED") {
    return payout;
  }

  const allowed = PAYOUT_TRANSITIONS[from] ?? [];
  if (!allowed.includes(action)) {
    throw new PayoutError(
      409,
      "invalid_payout_transition",
      `Переход «${action}» недопустим из статуса ${from}`
    );
  }

  const target: PayoutStatus =
    action === "approve" || action === "process"
      ? "PROCESSING"
      : action === "cancel"
        ? "CANCELLED"
        : action === "complete"
          ? "COMPLETED"
          : "FAILED";

  const now = new Date().toISOString();

  // Money-free transitions: CAS the row, record the decision, audit, done.
  // The ledger was never touched on the way here, so there is nothing to
  // release on cancel/fail (documented above).
  if (target !== "COMPLETED") {
    const transitioned = await db.orm.public.PayoutRequest
      .where({ id: payoutId, status: from })
      .updateAndCount({
        status: target,
        decidedAt: now,
        reviewedById: actorId,
      });
    if (affectedCount(transitioned) !== 1) {
      throw new PayoutError(
        409,
        "payout_state_conflict",
        "Статус выплаты изменился параллельно; повторите действие"
      );
    }
    await auditAndLogTransition(payout, target, action, actorId, input);
    return (await db.orm.public.PayoutRequest.where({ id: payoutId }).first())!;
  }

  // COMPLETED: settle through the ledger (the only money-moving transition).
  // withKeyLock serializes retries of the same payout; the effects themselves
  // are idempotent (marker check + deterministic ledger transaction id).
  return withKeyLock(`payout:${payoutId}`, async () => {
    const ledgerTxnId = input.ledgerTxnId?.trim() || `payout:${payoutId}`;
    const current = await db.orm.public.PayoutRequest.where({ id: payoutId }).first();
    if (!current || current.status !== "PROCESSING") {
      // Another writer (or a retry) already moved the row.
      if (current?.status === "COMPLETED") {
        return current; // idempotent replay of the same completion
      }
      throw new PayoutError(
        409,
        "invalid_payout_transition",
        `Переход «complete» недопустим из статуса ${current?.status ?? from}`
      );
    }

    const amount = Number(current.amountMinor);
    const sellerId = current.sellerId as string;

    await db.transaction(async (tx: DbOrTx) => {
      // Idempotency marker: a posted `payout:<id>` ledger transaction proves
      // the effects were already committed (unique transactionId+account+
      // direction makes a replay impossible at the database level).
      const posted = await tx.orm.public.LedgerEntry
        .where({ transactionId: ledgerTxnId })
        .first();
      if (!posted) {
        // CAS again inside the transaction: only one completion applies.
        const transitioned = await tx.orm.public.PayoutRequest
          .where({ id: payoutId, status: "PROCESSING" })
          .updateAndCount({
            status: "COMPLETED",
            decidedAt: now,
            reviewedById: actorId,
            ledgerTxnId,
            payoutRef: input.payoutRef ?? null,
          });
        if (affectedCount(transitioned) !== 1) {
          throw new PayoutError(
            409,
            "payout_state_conflict",
            "Статус выплаты изменился параллельно; повторите действие"
          );
        }

        // Seller cache: available drops; totalEarned is untouched (already
        // earned). Atomic delta applied by the database (lib/ledger.ts §8).
        const balanceAfter = await applySellerBalanceDelta(sellerId, -amount, 0, tx);
        if (balanceAfter < 0) {
          // Defensive invariant (should be unreachable: one open payout per
          // seller + balance re-checked live). Rolls the whole tx back.
          throw new PayoutError(
            409,
            "insufficient_balance",
            "Недостаточно средств: баланс изменился с момента заявки"
          );
        }

        // Legacy reconciliation row (PAYOUT reports read SELLER_PAYOUT rows).
        await tx.orm.public.FinancialTransaction.create({
          userId: sellerId,
          type: "SELLER_PAYOUT",
          amount,
          balanceAfter,
          relatedPayoutId: payoutId,
          metadata: { payout_ref: input.payoutRef ?? null, reason: input.reason ?? null },
        });

        // Balanced double-entry posting (INV-012): the seller's claim is
        // extinguished (DEBIT), cash leaves the platform (CREDIT).
        const entries: LedgerEntryInput[] = [
          {
            account: {
              code: LEDGER_ACCOUNT_CODES.SELLER_AVAILABLE(sellerId),
              kind: "SELLER_AVAILABLE",
              userId: sellerId,
            },
            direction: "DEBIT",
            amount,
            userId: sellerId,
            memo: `payout:${payoutId}`,
          },
          {
            account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_CASH, kind: "PLATFORM_CASH" },
            direction: "CREDIT",
            amount,
            memo: `payout:${payoutId}`,
          },
        ];
        await postLedgerEntries(ledgerTxnId, entries, tx);
      }
      // posted marker present → the completion already committed elsewhere;
      // this replay is an honest no-op (row state reconciled below).
    });

    const settledRow = await db.orm.public.PayoutRequest.where({ id: payoutId }).first();
    // Cheap self-check: a completed payout's ledger transaction must balance.
    if (!(await isLedgerTransactionBalanced(ledgerTxnId))) {
      logger.error("payout_ledger_unbalanced", { payout_id: payoutId, ledger_txn_id: ledgerTxnId });
    }

    await auditAndLogTransition(payout, "COMPLETED", action, actorId, input, settledRow);
    logger.info("payout_completed", {
      payout_id: payoutId,
      seller_id: sellerId,
      amount,
      ledger_txn_id: ledgerTxnId,
    });
    return settledRow!;
  });
}

/** Audit (before/after) + SystemLog for every applied payout transition. */
async function auditAndLogTransition(
  before: PayoutRow,
  afterStatus: PayoutStatus,
  action: PayoutAction,
  actorId: string,
  input: { reason?: string | null; payoutRef?: string | null; auditContext?: { ip?: string | null; requestId?: string | null } },
  after?: PayoutRow
): Promise<void> {
  await recordAudit({
    actorId,
    action: "payout_transitioned",
    targetType: "payout_request",
    targetId: before.id,
    before: { status: before.status, amountMinor: before.amountMinor },
    after: {
      status: afterStatus,
      amountMinor: before.amountMinor,
      sellerId: before.sellerId,
      reason: input.reason ?? null,
      payoutRef: after?.payoutRef ?? input.payoutRef ?? null,
      ledgerTxnId: after?.ledgerTxnId ?? null,
    },
    ip: input.auditContext?.ip ?? null,
    requestId: input.auditContext?.requestId ?? null,
  });
  await logSystem({
    level: "INFO",
    service: "api",
    message: "payout_transitioned",
    meta: {
      payout_id: before.id,
      seller_id: before.sellerId,
      action,
      from: before.status,
      to: afterStatus,
      actor_id: actorId,
      reason: input.reason ?? null,
    },
  });
}

export interface ListPayoutsFilters {
  sellerId?: string;
  status?: PayoutStatus | null;
  page?: number;
  limit?: number;
}

/** Paginated payout list (admin + seller surfaces share this). */
export async function listPayouts(filters: ListPayoutsFilters): Promise<{
  data: PayoutRow[];
  total: number;
  page: number;
  limit: number;
}> {
  const page = Math.max(1, Number(filters.page ?? 1) || 1);
  const limit = Math.min(Math.max(1, Number(filters.limit ?? 20)), 100);

  const base = () => {
    let q = db.orm.public.PayoutRequest.where({});
    if (filters.sellerId) q = q.where({ sellerId: filters.sellerId });
    if (filters.status) q = q.where({ status: filters.status });
    return q;
  };

  const [rows, totalAgg] = await Promise.all([
    base()
      .orderBy((m: any) => m.requestedAt.desc())
      .limit(limit)
      .offset((page - 1) * limit)
      .all(),
    base().aggregate((a: any) => ({ total: a.count() })),
  ]);

  const total = Number((totalAgg as { total?: number }).total ?? 0);
  return { data: rows as PayoutRow[], total, page, limit };
}