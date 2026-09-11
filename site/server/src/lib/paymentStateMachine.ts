// PLAN E-003: payment state machine.
// Canonical transitions; every Payment row mutation goes through assertTransition.
// Actual provider-specific transitions may be richer — provider implementations
// map their native states onto these.

import { PaymentStateError } from "./paymentErrors";

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

/**
 * Map a YooKassa native payment status onto the neutral state vocabulary.
 * Shared by the YooKassa provider implementation and reconciliation.
 */
export function fromYooKassaStatus(status: string): PaymentState {
  const map: Record<string, PaymentState> = {
    succeeded: "SUCCEEDED",
    canceled: "CANCELED",
    pending: "PENDING",
    waiting_for_capture: "PENDING",
  };
  return map[status] ?? "PENDING";
}
