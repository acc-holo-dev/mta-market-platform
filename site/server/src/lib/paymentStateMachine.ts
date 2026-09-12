// PLAN E-003: payment state machine.
// Canonical transitions; every Payment row mutation goes through assertTransition.
// Actual provider-specific transitions may be richer — provider implementations
// map their native states onto these.

import { PaymentStateError } from "./paymentErrors.js";

export type PaymentState =
  | "PENDING"
  | "SUCCEEDED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "FAILED"
  | "CANCELED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

const ALLOWED_TRANSITIONS: Record<PaymentState, PaymentState[]> = {
  PENDING: ["SUCCEEDED", "FAILED", "CANCELED"],
  SUCCEEDED: ["SETTLEMENT_PENDING", "SETTLED", "PARTIALLY_REFUNDED", "REFUNDED"],
  SETTLEMENT_PENDING: ["SETTLED", "FAILED"],
  SETTLED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  FAILED: [],
  CANCELED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ["REFUNDED"], // further partial refunds until fully refunded
};

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransition(from, to)) {
    throw new PaymentStateError(`Illegal payment transition ${from} -> ${to}`);
  }
}

// PLAN-016 P-003: provider-specific status mappers (fromYooKassaStatus etc.)
// live in their provider files; this module keeps only the neutral
// vocabulary and the canonical transition table.
