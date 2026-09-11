/**
 * TASK-018 + PLAN B-003: Reconciliation Service
 *
 * Financial reconciliation between internal ledger and payment providers.
 * Written against the contract ORM (db.orm.public.*).
 *
 * PLAN B-003 rules implemented here:
 * - never auto-corrects money: only creates alerts (ReconciliationReport +
 *   ReconciliationMismatch are the persistent, alertable records);
 * - every step emits structured logs (B-006) with provider/report/counts —
 *   these log lines are the metrics source until O-001 lands;
 * - provider source availability is explicit: when the provider side cannot
 *   be fetched (provider disabled / refund & payout provider APIs not yet
 *   implemented — see Phase E/F), the comparison does NOT invent
 *   MISSING_PROVIDER mismatches. The report honestly shows
 *   internalCount with providerCount=0 instead.
 */

import { db } from '../../prisma/db';
import { logger } from '../logger';
import { getYooKassaPayment, YOOKASSA_ENABLED, type YooKassaPayment } from '../yookassa';
import type {
  ReconciliationInput,
  ReconciliationResult,
  Mismatch,
  InternalTransaction,
  ProviderTransaction,
  ReconciliationSummary
} from './types';

const PROVIDER_FETCH_CONCURRENCY = 5;

/** Result of fetching the provider side of a report. */
interface ProviderFetchResult {
  transactions: ProviderTransaction[];
  /** true when a real provider source was reachable and authoritative. */
  available: boolean;
  /** Transient fetch failures (network/5xx): skipped, NOT counted as mismatches. */
  fetchFailures: number;
  /** Mismatches discovered during fetching itself (e.g. provider 404). */
  mismatches: Mismatch[];
}

/**
 * Run reconciliation for a time period.
 *
 * Compares internal financial records with provider records.
 * Never auto-corrects money - only creates alerts.
 */
export async function reconcile(input: ReconciliationInput): Promise<ReconciliationResult> {
  const { provider, reportType, periodStart, periodEnd } = input;
  const log = logger.child({ provider, report_type: reportType });

  log.info("reconciliation_started", {
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  });

  // Create report record
  const report = await db.orm.public.ReconciliationReport.create({
    provider,
    reportType: reportType as 'PAYMENT' | 'REFUND' | 'PAYOUT',
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    internalCount: 0,
    internalTotal: 0,
    providerCount: 0,
    providerTotal: 0,
    mismatchCount: 0,
    status: 'IN_PROGRESS'
  });

  try {
    // 1. Fetch internal transactions
    const internalTransactions = await fetchInternalTransactions(
      provider,
      reportType,
      periodStart,
      periodEnd
    );

    // 2. Fetch provider transactions
    const providerFetch = await fetchProviderTransactions(
      provider,
      reportType,
      periodStart,
      periodEnd,
      internalTransactions
    );

    // 3. Calculate totals
    const internalTotal = internalTransactions.reduce((sum, t) => sum + t.amount, 0);
    const providerTotal = providerFetch.transactions.reduce((sum, t) => sum + t.amount, 0);

    // 4. Compare transactions
    const mismatches = compareTransactions(
      internalTransactions,
      providerFetch.transactions,
      providerFetch.available,
      providerFetch.mismatches
    );

    // 5. Store mismatches (the alertable record)
    if (mismatches.length > 0) {
      for (const m of mismatches) {
        await db.orm.public.ReconciliationMismatch.create({
          reportId: report.id,
          type: m.type,
          internalId: m.internalId ?? null,
          providerId: m.providerId ?? null,
          expectedAmount: m.expectedAmount ?? null,
          actualAmount: m.actualAmount ?? null,
          description: m.description
        });
      }

      await sendAlert(report.id, mismatches);
    }

    // 6. Update report
    await db.orm.public.ReconciliationReport.where({ id: report.id }).update({
      internalCount: internalTransactions.length,
      internalTotal,
      providerCount: providerFetch.transactions.length,
      providerTotal,
      mismatchCount: mismatches.length,
      status: 'COMPLETED',
      completedAt: new Date().toISOString()
    });

    log.info("reconciliation_report_completed", {
      report_id: report.id,
      internal_count: internalTransactions.length,
      internal_total: internalTotal,
      provider_count: providerFetch.transactions.length,
      provider_total: providerTotal,
      provider_source_available: providerFetch.available,
      provider_fetch_failures: providerFetch.fetchFailures,
      mismatch_count: mismatches.length,
      status: mismatches.length > 0 ? 'mismatches_found' : 'ok',
    });

    return {
      reportId: report.id,
      internalCount: internalTransactions.length,
      internalTotal,
      providerCount: providerFetch.transactions.length,
      providerTotal,
      mismatches,
      status: mismatches.length > 0 ? 'mismatches_found' : 'ok'
    };

  } catch (error) {
    log.error("reconciliation_report_failed", {
      report_id: report.id,
      error,
    });

    // Update report as failed — persistent alertable record.
    await db.orm.public.ReconciliationReport.where({ id: report.id }).update({
      status: 'FAILED',
      completedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });

    throw error;
  }
}

/**
 * Fetch internal transactions for a period.
 *
 * Internal sources per report type:
 * - PAYMENT: Payment rows of the provider, filtered by createdAt.
 * - REFUND:  Payment rows with status REFUNDED (the refund lifecycle itself
 *            arrives with Phase E / E-008; the completed payment's succeededAt
 *            is the best available in-period timestamp today).
 * - PAYOUT:  FinancialTransaction rows of type SELLER_PAYOUT. There is no
 *            provider payout source yet (Phase F), so externalId stays empty.
 */
async function fetchInternalTransactions(
  provider: string,
  reportType: string,
  periodStart: Date,
  periodEnd: Date
): Promise<InternalTransaction[]> {
  const inPeriod = (value: string | null | undefined): boolean => {
    if (!value) return false;
    const at = new Date(value);
    return at >= periodStart && at <= periodEnd;
  };

  if (reportType === 'PAYOUT') {
    const txs = await db.orm.public.FinancialTransaction.where({ type: 'SELLER_PAYOUT' }).all();
    return txs
      .filter((t) => inPeriod(t.createdAt))
      .map((t) => ({
        id: t.id,
        externalId: t.relatedPayoutId ?? '',
        amount: t.amount,
        status: 'SETTLED',
        createdAt: t.createdAt,
        type: 'payout' as const
      }));
  }

  const payments = await db.orm.public.Payment.where({
    provider: provider.toUpperCase() as 'YUKASSA' | 'STRIPE' | 'TEST'
  }).all();

  if (reportType === 'REFUND') {
    return payments
      .filter((p) => p.status === 'REFUNDED' && inPeriod(p.succeededAt ?? p.createdAt))
      .map((p) => ({
        id: p.id,
        externalId: p.providerPaymentId,
        amount: p.amount,
        status: 'REFUNDED',
        createdAt: p.succeededAt ?? p.createdAt,
        type: 'refund' as const
      }));
  }

  // Default: PAYMENT
  return payments
    .filter((p) => inPeriod(p.createdAt))
    .map((p) => ({
      id: p.id,
      externalId: p.providerPaymentId,
      amount: p.amount,
      status: p.status,
      createdAt: p.createdAt,
      type: 'payment' as const
    }));
}

/**
 * Fetch provider transactions.
 *
 * Real source: YooKassa GET /v3/payments/{id} per internal payment (PLAN
 * E-006: authenticity via provider re-fetch). Enabled only when
 * YOOKASSA_ENABLED=true. Refund/payout provider APIs are not implemented
 * yet (Phase E/F) => available=false for those report types.
 *
 * Bounded concurrency, per-item error tolerance: a transient provider error
 * is logged and skipped (fetchFailures) instead of fabricating a mismatch;
 * a definitive 404 becomes a MISSING_PROVIDER mismatch.
 */
async function fetchProviderTransactions(
  provider: string,
  reportType: string,
  _periodStart: Date,
  _periodEnd: Date,
  internalTransactions: InternalTransaction[]
): Promise<ProviderFetchResult> {
  const result: ProviderFetchResult = { transactions: [], available: false, fetchFailures: 0, mismatches: [] };

  if (provider.toUpperCase() !== 'YUKASSA' || !YOOKASSA_ENABLED) {
    logger.warn("reconciliation_provider_source_unavailable", {
      provider,
      report_type: reportType,
      reason: provider.toUpperCase() !== 'YUKASSA' ? 'provider_not_supported_yet' : 'provider_disabled',
      internal_count: internalTransactions.length,
    });
    return result;
  }

  if (reportType !== 'PAYMENT') {
    // REFUND/PAYOUT provider sources arrive with Phase E/F.
    logger.warn("reconciliation_provider_source_unavailable", {
      provider,
      report_type: reportType,
      reason: 'provider_api_not_implemented_yet',
      internal_count: internalTransactions.length,
    });
    return result;
  }

  result.available = true;
  const targets = internalTransactions.filter((t) => t.externalId);

  // Simple bounded-concurrency pool.
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < targets.length) {
      const current = targets[cursor++];
      try {
        const remote = await getYooKassaPayment(current.externalId);
        result.transactions.push(toProviderTransaction(remote));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/\(HTTP 404\)/.test(message)) {
          // Definitive: the provider does not know this payment. Deliberately
          // NOT recorded here — compareTransactions() flags it as
          // MISSING_PROVIDER when the provider side is otherwise available,
          // which keeps mismatch accounting single-sourced.
          logger.warn("reconciliation_provider_payment_not_found", {
            provider_payment_id: current.externalId,
            internal_id: current.id,
          });
        } else {
          result.fetchFailures += 1;
          logger.warn("reconciliation_provider_fetch_failed", {
            provider_payment_id: current.externalId,
            internal_id: current.id,
            error: message,
          });
        }
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PROVIDER_FETCH_CONCURRENCY, targets.length) }, () => worker())
  );

  return result;
}

/** Map a YooKassa payment object onto the neutral provider transaction. */
function toProviderTransaction(remote: YooKassaPayment): ProviderTransaction {
  // Amounts are stored in kopecks internally; YooKassa returns decimal rubles.
  const amountKopecks = Math.round(parseFloat(remote.amount.value) * 100);
  // Provider status -> internal PaymentStatus vocabulary.
  // PLAN-004 D-004 (audit GAP-9): must match paymentStateMachine's
  // fromYooKassaStatus exactly — 'canceled' is CANCELED there, so mapping it
  // to FAILED here produced false STATUS_MISMATCH alerts on every report.
  const statusMap: Record<string, string> = {
    succeeded: 'SUCCEEDED',
    canceled: 'CANCELED',
    pending: 'PENDING',
    waiting_for_capture: 'PENDING'
  };
  const status = statusMap[remote.status] ?? remote.status;

  return {
    id: remote.id,
    amount: amountKopecks,
    status,
    createdAt: remote.created_at,
    type: 'payment'
  };
}

/**
 * Compare internal and provider transactions.
 *
 * providerAvailable=false means the provider side could not be fetched at
 * all: in that case MISSING_PROVIDER/AMOUNT/STATUS comparisons would be
 * fabricated, so only explicitly pre-fetched mismatches are returned.
 */
function compareTransactions(
  internal: InternalTransaction[],
  provider: ProviderTransaction[],
  providerAvailable: boolean,
  prefetched: Mismatch[]
): Mismatch[] {
  if (!providerAvailable) {
    return [...prefetched];
  }

  const mismatches: Mismatch[] = [...prefetched];

  // Create maps for quick lookup
  const internalMap = new Map(internal.map(t => [t.externalId, t]));
  const providerMap = new Map(provider.map(t => [t.id, t]));

  // Check provider records against internal records
  for (const providerTx of provider) {
    const internalTx = internalMap.get(providerTx.id);

    if (!internalTx) {
      mismatches.push({
        type: 'MISSING_INTERNAL',
        providerId: providerTx.id,
        actualAmount: providerTx.amount,
        description: `Transaction ${providerTx.id} exists in provider but not in internal records`
      });
      continue;
    }

    // Check amount mismatch
    if (internalTx.amount !== providerTx.amount) {
      mismatches.push({
        type: 'AMOUNT_MISMATCH',
        internalId: internalTx.id,
        providerId: providerTx.id,
        expectedAmount: internalTx.amount,
        actualAmount: providerTx.amount,
        description: `Amount mismatch: internal ${internalTx.amount}, provider ${providerTx.amount}`
      });
    }

    // Check status mismatch
    if (internalTx.status !== providerTx.status) {
      mismatches.push({
        type: 'STATUS_MISMATCH',
        internalId: internalTx.id,
        providerId: providerTx.id,
        description: `Status mismatch: internal ${internalTx.status}, provider ${providerTx.status}`
      });
    }
  }

  // Check for missing provider records
  for (const internalTx of internal) {
    if (internalTx.externalId && !providerMap.has(internalTx.externalId)) {
      mismatches.push({
        type: 'MISSING_PROVIDER',
        internalId: internalTx.id,
        providerId: internalTx.externalId,
        expectedAmount: internalTx.amount,
        description: `Transaction ${internalTx.id} exists internally but not in provider records`
      });
    }
  }

  return mismatches;
}

/**
 * Send alert for mismatches.
 * The alertable record is the persisted ReconciliationReport +
 * ReconciliationMismatch rows; this adds the structured log line that
 * monitoring can alert on (metrics infra arrives with O-001).
 */
async function sendAlert(reportId: string, mismatches: Mismatch[]): Promise<void> {
  logger.error("reconciliation_alert", {
    report_id: reportId,
    mismatch_count: mismatches.length,
    by_type: mismatches.reduce<Record<string, number>>((acc, m) => {
      acc[m.type] = (acc[m.type] ?? 0) + 1;
      return acc;
    }, {}),
  });

  for (const mismatch of mismatches) {
    logger.warn("reconciliation_mismatch", {
      report_id: reportId,
      mismatch_type: mismatch.type,
      internal_id: mismatch.internalId ?? null,
      provider_id: mismatch.providerId ?? null,
      description: mismatch.description,
    });
  }
}

/**
 * PLAN B-003: provider event mismatch reconciliation.
 *
 * Every webhook event persisted in PaymentProviderEvent must be explainable:
 * - the event must reference an existing internal Payment (objectId);
 * - the event must have been processed successfully (status != FAILED).
 * Violations become mismatches on a persisted report (provider=PROVIDER_EVENTS).
 */
export async function checkProviderEventMismatches(
  periodStart: Date,
  periodEnd: Date
): Promise<ReconciliationResult> {
  const log = logger.child({ provider: 'PROVIDER_EVENTS', report_type: 'PAYMENT' });
  log.info("reconciliation_events_started", {
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  });

  const report = await db.orm.public.ReconciliationReport.create({
    provider: 'PROVIDER_EVENTS',
    reportType: 'PAYMENT',
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    internalCount: 0,
    internalTotal: 0,
    providerCount: 0,
    providerTotal: 0,
    mismatchCount: 0,
    status: 'IN_PROGRESS'
  });

  try {
    const events = (await db.orm.public.PaymentProviderEvent.where({}).all())
      .filter((e) => {
        const at = new Date(e.receivedAt);
        return at >= periodStart && at <= periodEnd;
      });
    const payments = await db.orm.public.Payment.where({}).all();
    const paymentIds = new Set(payments.map((p) => p.id));

    const mismatches: Mismatch[] = [];
    let matched = 0;

    for (const event of events) {
      if (!paymentIds.has(event.objectId)) {
        mismatches.push({
          type: 'MISSING_INTERNAL',
          providerId: event.providerEventId,
          description: `Provider event ${event.providerEventId} (${event.eventType}) references unknown internal payment ${event.objectId}`
        });
        continue;
      }
      matched += 1;

      if (event.status === 'FAILED') {
        mismatches.push({
          type: 'STATUS_MISMATCH',
          providerId: event.providerEventId,
          description: `Provider event ${event.providerEventId} (${event.eventType}) is FAILED after ${event.attempts} attempt(s)${event.lastError ? `: ${event.lastError}` : ''}`
        });
      }
    }

    if (mismatches.length > 0) {
      for (const m of mismatches) {
        await db.orm.public.ReconciliationMismatch.create({
          reportId: report.id,
          type: m.type,
          internalId: m.internalId ?? null,
          providerId: m.providerId ?? null,
          expectedAmount: m.expectedAmount ?? null,
          actualAmount: m.actualAmount ?? null,
          description: m.description
        });
      }
      await sendAlert(report.id, mismatches);
    }

    await db.orm.public.ReconciliationReport.where({ id: report.id }).update({
      // Field semantics for this report type: internalCount = events matched
      // to an existing payment; providerCount = events received in the period.
      internalCount: matched,
      providerCount: events.length,
      mismatchCount: mismatches.length,
      status: 'COMPLETED',
      completedAt: new Date().toISOString()
    });

    log.info("reconciliation_report_completed", {
      report_id: report.id,
      events_received: events.length,
      events_matched: matched,
      mismatch_count: mismatches.length,
    });

    return {
      reportId: report.id,
      internalCount: matched,
      internalTotal: 0,
      providerCount: events.length,
      providerTotal: 0,
      mismatches,
      status: mismatches.length > 0 ? 'mismatches_found' : 'ok'
    };
  } catch (error) {
    log.error("reconciliation_report_failed", { report_id: report.id, error });
    await db.orm.public.ReconciliationReport.where({ id: report.id }).update({
      status: 'FAILED',
      completedAt: new Date().toISOString(),
      errorMessage: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

/**
 * Get reconciliation summary
 */
export async function getReconciliationSummary(): Promise<ReconciliationSummary> {
  const reports = await db.orm.public.ReconciliationReport.where({}).all();
  const mismatches = await db.orm.public.ReconciliationMismatch.where({}).all();

  const reportsWithMismatches = reports.filter(r => r.mismatchCount > 0).length;
  const unresolvedMismatches = mismatches.filter(m => !m.resolved).length;

  const totalAmountDiscrepancy = mismatches.reduce((sum, m) => {
    if (m.type === 'AMOUNT_MISMATCH' && m.expectedAmount !== null && m.actualAmount !== null) {
      return sum + Math.abs(m.expectedAmount - m.actualAmount);
    }
    return sum;
  }, 0);

  return {
    totalReports: reports.length,
    reportsWithMismatches,
    totalMismatches: mismatches.length,
    unresolvedMismatches,
    totalAmountDiscrepancy
  };
}

/**
 * Resolve mismatch manually
 */
export async function resolveMismatch(
  mismatchId: string,
  resolvedBy: string,
  resolution: string
): Promise<void> {
  await db.orm.public.ReconciliationMismatch.where({ id: mismatchId }).update({
    resolved: true,
    resolvedAt: new Date().toISOString(),
    resolvedBy,
    resolution
  });

  logger.info("reconciliation_mismatch_resolved", { mismatch_id: mismatchId, resolved_by: resolvedBy });
}

/**
 * Get report with mismatches.
 * Return type annotated loosely: the ORM row type is not nameable across
 * pnpm store paths (TS2742) when emitting declarations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getReport(reportId: string): Promise<any | null> {
  const report = await db.orm.public.ReconciliationReport.where({ id: reportId }).first();

  if (!report) {
    return null;
  }

  const mismatches = await db.orm.public.ReconciliationMismatch.where({
    reportId
  }).all();

  return { ...report, mismatches };
}

/**
 * Get all reports (latest first)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getReports(limit: number = 50): Promise<any[]> {
  return await db.orm.public.ReconciliationReport
    .where({})
    .orderBy((m) => m.createdAt.desc())
    .limit(limit)
    .all();
}
