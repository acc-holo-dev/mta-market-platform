/**
 * PLAN B-003: Reconciliation Scheduler
 *
 * Periodic execution of the existing reconciliation system (REUSE: the
 * service in lib/reconciliation is NOT rewritten — this file only wires it
 * into the runtime and adds the daily cycle):
 *
 *   1. payment reconciliation   (every ENABLED provider — PLAN-016 P-006;
 *                                real provider re-fetch where supported)
 *   2. refund reconciliation    (internal REFUNDED payments; provider refund
 *                                API per capability — no fake mismatches)
 *   3. payout reconciliation    (internal SELLER_PAYOUT ledger; provider payout
 *                                source arrives with the payouts phase)
 *   4. provider event mismatch  (PaymentProviderEvent vs Payment)
 *   5. internal ledger check    (purchases vs seller balances — full scan)
 *
 * Errors produce: a structured log line (metric source until O-001) and a
 * persistent alertable record (ReconciliationReport with status FAILED /
 * mismatch rows). A failing step never crashes the server.
 */

import { reconcile, checkProviderEventMismatches } from '../lib/reconciliation/service.js';
import { paymentProviders } from '../lib/paymentProvider.js';
// PLAN-016: register the provider implementations for the cycle.
import '../lib/providers/payment-yookassa.js';
import '../lib/providers/payment-tbank.js';
import '../lib/providers/payment-crypto.js';
import { reconcileAllPurchases } from '../lib/reconciliation/internal.js';
import { logger } from '../lib/logger.js';
// PLAN-019 A-006: date helpers are native Date math — no date-fns dependency.
import type { CycleResult, CycleStepResult } from '../lib/reconciliation/types.js';

export type { CycleResult, CycleStepResult };

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily, per plan E-009
const DEFAULT_INITIAL_DELAY_MS = 60 * 1000;

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function windowFor(now: Date, intervalMs: number): { periodStart: Date; periodEnd: Date } {
  // Daily-style window ending at the moment the cycle runs. Interval-sized
  // windows tile the timeline without gaps when the scheduler fires on schedule.
  return {
    periodStart: new Date(now.getTime() - intervalMs),
    periodEnd: now,
  };
}

/** Run yesterday's window (kept for the `reconciliation:run` npm script). */
export async function runDailyReconciliation(): Promise<void> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const periodStart = new Date(yesterday);
  periodStart.setHours(0, 0, 0, 0);
  const periodEnd = new Date(yesterday);
  periodEnd.setHours(23, 59, 59, 999);
  await runReconciliationCycle(now, { periodStart, periodEnd });
}

/**
 * Run one reconciliation cycle over a window (default: the last interval).
 * Each step is independent: a failure is recorded and does not stop the rest.
 */
export async function runReconciliationCycle(
  now: Date = new Date(),
  windowOverride?: { periodStart: Date; periodEnd: Date }
): Promise<CycleResult> {
  const intervalMs = parsePositiveInt(process.env.RECONCILIATION_INTERVAL_MS) ?? DEFAULT_INTERVAL_MS;
  const { periodStart, periodEnd } = windowOverride ?? windowFor(now, intervalMs);
  const startedAt = now.toISOString();

  logger.info("reconciliation_cycle_started", {
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  });

  const steps: CycleStepResult[] = [];

  // PLAN-016 P-006: payment/refund reconciliation runs for every ENABLED
  // provider, not a hardcoded one. Per-provider results are aggregated; a
  // provider without a provider-side report source still reports its
  // internalCount honestly (existing service mechanism, no fake mismatches).
  const enabledProviders = paymentProviders.getEnabled().map((p) => p.name);

  // 1. Payment reconciliation (per enabled provider)
  await runStep(steps, "payment_reconciliation", async () => {
    let internalCount: number | undefined = 0;
    let providerCount: number | undefined = 0;
    let mismatchCount: number | undefined = 0;
    let reportId: string | undefined;
    let status: CycleStepResult["status"] = "completed";
    for (const providerName of enabledProviders) {
      const result = await reconcile({
        provider: providerName,
        reportType: "PAYMENT",
        periodStart,
        periodEnd,
      });
      reportId = result.reportId;
      if (result.status === "mismatches_found") status = "mismatches_found";
      internalCount += result.internalCount;
      providerCount += result.providerCount;
      mismatchCount += result.mismatches.length;
    }
    return { reportId, status, internalCount, providerCount, mismatchCount };
  });

  // 2. Refund reconciliation (internal REFUNDED payments; provider refund API
  // per provider when it exposes one — crypto adapters do not).
  await runStep(steps, "refund_reconciliation", async () => {
    let internalCount: number | undefined = 0;
    let providerCount: number | undefined = 0;
    let mismatchCount: number | undefined = 0;
    let reportId: string | undefined;
    let status: CycleStepResult["status"] = "completed";
    for (const providerName of enabledProviders) {
      const result = await reconcile({
        provider: providerName,
        reportType: "REFUND",
        periodStart,
        periodEnd,
      });
      if (result.status === "mismatches_found") status = "mismatches_found";
      internalCount += result.internalCount;
      providerCount += result.providerCount;
      mismatchCount += result.mismatches.length;
    }
    return { reportId, status, internalCount, providerCount, mismatchCount };
  });

  // 3. Payout reconciliation (internal SELLER_PAYOUT ledger; provider payout
  // sources arrive with the payouts phase — reported honestly as internal
  // counts).
  await runStep(steps, "payout_reconciliation", async () => {
    let internalCount: number | undefined = 0;
    let providerCount: number | undefined = 0;
    let mismatchCount: number | undefined = 0;
    let reportId: string | undefined;
    let status: CycleStepResult["status"] = "completed";
    for (const providerName of enabledProviders) {
      const result = await reconcile({
        provider: providerName,
        reportType: "PAYOUT",
        periodStart,
        periodEnd,
      });
      if (result.status === "mismatches_found") status = "mismatches_found";
      internalCount += result.internalCount;
      providerCount += result.providerCount;
      mismatchCount += result.mismatches.length;
    }
    return { reportId, status, internalCount, providerCount, mismatchCount };
  });

  // 4. Provider event mismatch
  await runStep(steps, "provider_event_mismatch", async () => {
    const result = await checkProviderEventMismatches(periodStart, periodEnd);
    return {
      reportId: result.reportId,
      status: result.status === 'mismatches_found' ? 'mismatches_found' : 'completed',
      internalCount: result.internalCount,
      providerCount: result.providerCount,
      mismatchCount: result.mismatches.length,
    };
  });

  // 5. Internal ledger check (purchases vs seller balances; full scan, log-only)
  await runStep(steps, "internal_ledger_check", async () => {
    const result = await reconcileAllPurchases();
    logger.info("reconciliation_internal_ledger", {
      total_purchases: result.totalPurchases,
      sellers_checked: result.sellersChecked,
      discrepancy_count: result.discrepancies.length,
      balanced: result.summary.balanced,
      difference: result.summary.difference,
    });
    for (const d of result.discrepancies) {
      logger.warn("reconciliation_internal_ledger_discrepancy", {
        severity: d.severity,
        discrepancy_type: d.type,
        seller_id: d.sellerId ?? null,
        purchase_id: d.purchaseId ?? null,
        difference: d.difference,
        description: d.description,
      });
    }
    return {
      status: result.discrepancies.length > 0 ? 'mismatches_found' : 'completed',
      mismatchCount: result.discrepancies.length,
    };
  });

  const finishedAt = new Date().toISOString();
  const failed = steps.filter((s) => s.status === 'failed').length;

  logger.info("reconciliation_cycle_completed", {
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
    step_count: steps.length,
    failed_steps: failed,
    steps: steps.map((s) => ({ step: s.step, status: s.status, mismatch_count: s.mismatchCount ?? null })),
  });

  return { window: { periodStart, periodEnd }, steps, startedAt, finishedAt };
}

async function runStep(
  steps: CycleStepResult[],
  step: CycleStepResult['step'],
  fn: () => Promise<Omit<CycleStepResult, 'step'>>
): Promise<void> {
  try {
    const partial = await fn();
    steps.push({ step, ...partial });
  } catch (error) {
    // Structured log = metric + alert source; the FAILED report row (persisted
    // inside the service) is the alertable record.
    logger.error("reconciliation_step_failed", { step, error });
    steps.push({ step, status: 'failed', error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Start the periodic reconciliation scheduler.
 *
 * Env:
 * - RECONCILIATION_INTERVAL_MS   (default: 24h)
 * - RECONCILIATION_INITIAL_DELAY_MS (default: 60s after boot)
 * - RECONCILIATION_ENABLED=false disables the scheduler entirely.
 * NODE_ENV=test disables it so test suites never trigger background jobs.
 *
 * Returns a stop() handle (used by tests / graceful shutdown).
 */
export function startReconciliationScheduler(opts?: {
  intervalMs?: number;
  initialDelayMs?: number;
}): { stop: () => void; idle: () => Promise<void> } {
  const disabled =
    process.env.NODE_ENV === 'test' || process.env.RECONCILIATION_ENABLED === 'false';

  if (disabled) {
    logger.info("reconciliation_scheduler_disabled", {
      reason: process.env.RECONCILIATION_ENABLED === 'false' ? 'env_disabled' : 'test_env',
    });
    return { stop: () => undefined, idle: async () => undefined };
  }

  const intervalMs =
    opts?.intervalMs ?? parsePositiveInt(process.env.RECONCILIATION_INTERVAL_MS) ?? DEFAULT_INTERVAL_MS;
  const initialDelayMs =
    opts?.initialDelayMs ?? parsePositiveInt(process.env.RECONCILIATION_INITIAL_DELAY_MS) ?? DEFAULT_INITIAL_DELAY_MS;

  let stopped = false;
  let running = false;

  const tick = (): void => {
    if (stopped || running) return;
    running = true;
    void runReconciliationCycle()
      .catch((error) => {
        // runReconciliationCycle already per-step catches; this is a safety net.
        logger.error("reconciliation_cycle_crashed", { error });
      })
      .finally(() => {
        running = false;
      });
  };

  const initialTimer = setTimeout(tick, initialDelayMs);
  const intervalTimer = setInterval(tick, intervalMs);

  logger.info("reconciliation_scheduler_started", {
    interval_ms: intervalMs,
    initial_delay_ms: initialDelayMs,
  });

  return {
    stop: () => {
      stopped = true;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
      logger.info("reconciliation_scheduler_stopped", {});
    },
    // PLAN-020 S-001a: expose cycle completion for tests/observability — a
    // started cycle legitimately finishes after stop() (graceful semantics);
    // callers that need deterministic post-stop state await this.
    idle: async (): Promise<void> => {
      while (running) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    },
  };
}

/**
 * Run reconciliation for a specific date range (backfill / manual runs).
 * PLAN-016 P-001/P-006: no hardcoded provider — with no explicit provider the
 * backfill covers every ENABLED provider (same contract as the cycle).
 */
export async function runReconciliationForDateRange(
  startDate: Date,
  endDate: Date,
  provider?: string
): Promise<void> {
  const providerNames =
    provider && provider.length > 0 ? [provider.toUpperCase()] : paymentProviders.getEnabled().map((p) => p.name);

  logger.info("reconciliation_backfill_started", {
    provider: providerNames.join(","),
    period_start: startDate.toISOString(),
    period_end: endDate.toISOString(),
  });

  for (const providerName of providerNames) {
    await reconcile({
      provider: providerName,
      reportType: 'PAYMENT',
      periodStart: startDate,
      periodEnd: endDate
    });
  }
  await checkProviderEventMismatches(startDate, endDate);
}
