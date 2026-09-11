/**
 * TASK-018: Reconciliation Types
 * 
 * Type definitions for financial reconciliation.
 */

export type ReconciliationReportType = 'PAYMENT' | 'REFUND' | 'PAYOUT';
export type MismatchType = 'MISSING_INTERNAL' | 'MISSING_PROVIDER' | 'AMOUNT_MISMATCH' | 'STATUS_MISMATCH';

export interface ReconciliationInput {
  provider: string;
  reportType: ReconciliationReportType;
  periodStart: Date;
  periodEnd: Date;
}

export interface ReconciliationResult {
  reportId: string;
  internalCount: number;
  internalTotal: number;
  providerCount: number;
  providerTotal: number;
  mismatches: Mismatch[];
  status: 'ok' | 'mismatches_found';
}

export interface Mismatch {
  type: MismatchType;
  internalId?: string;
  providerId?: string;
  expectedAmount?: number;
  actualAmount?: number;
  description: string;
}

export interface InternalTransaction {
  id: string;
  externalId: string;
  amount: number;
  status: string;
  createdAt: string;
  type: 'payment' | 'refund' | 'payout';
}

export interface ProviderTransaction {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  type: 'payment' | 'refund' | 'payout';
}

export interface ReconciliationSummary {
  totalReports: number;
  reportsWithMismatches: number;
  totalMismatches: number;
  unresolvedMismatches: number;
  totalAmountDiscrepancy: number;
}

export interface AlertConfig {
  enabled: boolean;
  channels: ('email' | 'webhook' | 'slack')[];
  threshold: number; // Only alert if mismatch count >= threshold
}

/** PLAN B-003: one step inside a reconciliation cycle. */
export interface CycleStepResult {
  step:
    | 'payment_reconciliation'
    | 'refund_reconciliation'
    | 'payout_reconciliation'
    | 'provider_event_mismatch'
    | 'internal_ledger_check';
  status: 'completed' | 'mismatches_found' | 'failed' | 'skipped';
  reportId?: string;
  internalCount?: number;
  providerCount?: number;
  mismatchCount?: number;
  error?: string;
}

/** PLAN B-003: result of a full reconciliation cycle. */
export interface CycleResult {
  window: { periodStart: Date; periodEnd: Date };
  steps: CycleStepResult[];
  startedAt: string;
  finishedAt: string;
}
