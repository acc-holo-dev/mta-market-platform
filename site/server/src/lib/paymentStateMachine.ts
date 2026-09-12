// PLAN E-003 + PLAN-018 A-001: payment state machine.
// Canonical transitions; every Payment row mutation goes through assertTransition.
// Actual provider-specific transitions may be richer — provider implementations
// map their native states onto these.
//
// A-001 hardening (PLAN-018): the transition table is EXPORTED as `TRANSITIONS`
// (from → allowed[]) so docs/tests render the exact table instead of guessing,
// with a module-load completeness self-check (every PaymentState has an entry,
// every target is a known state, no self-transition). `canTransition` stays the
// single guard used by the webhook/payment paths (routes/payments.ts
// transitionPaymentTo, lib/refunds.ts applyRefundEffects).

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

export const PAYMENT_STATES: readonly PaymentState[] = [
  "PENDING",
  "SUCCEEDED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "FAILED",
  "CANCELED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
];

/**
 * A-001: canonical transition table, exported for docs/tests.
 *   PENDING  → captured (SUCCEEDED) | failed | canceled
 *   SUCCEEDED → settlement in progress | settled | refunds (capture confirmed)
 *   SETTLEMENT_PENDING → settled | failed (settlement retry exhausted)
 *   SETTLED  → refunds (money is in the ledger)
 *   PARTIALLY_REFUNDED → REFUNDED (further partial refunds until fully refunded)
 *   FAILED / CANCELED / REFUNDED → terminal (no outgoing transitions)
 */
export const TRANSITIONS: Record<PaymentState, readonly PaymentState[]> = {
  PENDING: ["SUCCEEDED", "FAILED", "CANCELED"],
  SUCCEEDED: ["SETTLEMENT_PENDING", "SETTLED", "PARTIALLY_REFUNDED", "REFUNDED"],
  SETTLEMENT_PENDING: ["SETTLED", "FAILED"],
  SETTLED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  FAILED: [],
  CANCELED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ["REFUNDED"], // further partial refunds until fully refunded
};

// A-001: fail fast (at module load) if the table drifts from the state
// vocabulary — an incomplete or self-referencing table would silently reject
// legal webhook transitions at runtime.
for (const state of PAYMENT_STATES) {
  const allowed = TRANSITIONS[state];
  if (!Array.isArray(allowed)) {
    throw new Error(`paymentStateMachine: TRANSITIONS has no entry for ${state}`);
  }
  for (const target of allowed) {
    if (!PAYMENT_STATES.includes(target)) {
      throw new Error(`paymentStateMachine: TRANSITIONS[${state}] targets unknown state ${target}`);
    }
    if (target === state) {
      throw new Error(`paymentStateMachine: TRANSITIONS[${state}] self-transition is not allowed`);
    }
  }
}

export function canTransition(from: PaymentState, to: PaymentState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: PaymentState, to: PaymentState): void {
  if (!canTransition(from, to)) {
    throw new PaymentStateError(`Illegal payment transition ${from} -> ${to}`);
  }
}

/** Terminal states: no outgoing transitions (A-001, for docs/tests/UI). */
export function isTerminalState(state: PaymentState): boolean {
  return (TRANSITIONS[state] ?? []).length === 0;
}

// PLAN-016 P-003: provider-specific status mappers (fromYooKassaStatus etc.)
// live in their provider files; this module keeps only the neutral
// vocabulary and the canonical transition table.