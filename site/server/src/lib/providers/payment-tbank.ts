// PLAN-016 C3: T-Bank (Tinkoff EACQ) implementation of IPaymentProvider.
// Wraps the HTTP transport (lib/tbank.ts) — the only place where T-Bank
// specifics meet the neutral payment layer. The state mapping is implemented
// HERE (provider-local mapper, mirroring the YooKassa provider mapper's conservatism) —
// the shared state machine (lib/paymentStateMachine.ts) stays
// provider-agnostic and was not modified.
import {
  cancelPayment as cancelTBankPayment,
  getState,
  initPayment,
  refund as refundTBankPayment,
  verifyTBankNotification,
  TBANK_ENABLED,
  TBANK_TERMINAL_KEY,
  type TBankStateResponse,
} from "../tbank.js";
import type {
  Capability,
  CreatePaymentRequest,
  IPaymentProvider,
  ParsedWebhook,
  PaymentState,
  ProviderPayment,
  ProviderRefundResult,
  ProviderWebhookContext,
} from "../paymentProvider.js";

/**
 * T-Bank payment status → neutral PaymentState.
 *
 *   NEW / FORMSHOWED            → PENDING   (session issued, buyer not back)
 *   AUTHORIZED / CONFIRMED      → SUCCEEDED (money captured)
 *   REJECTED / DEADLINE_EXPIRED → FAILED
 *   CANCELED / REVERSED         → CANCELED
 *   REFUNDED                    → REFUNDED
 *   PARTIALLY_REFUNDED          → PARTIALLY_REFUNDED
 *   anything else               → PENDING   (conservative default, E-003)
 */
const TBANK_STATUS_MAP: Record<string, PaymentState> = {
  NEW: "PENDING",
  FORMSHOWED: "PENDING",
  AUTHORIZED: "SUCCEEDED",
  CONFIRMED: "SUCCEEDED",
  REJECTED: "FAILED",
  DEADLINE_EXPIRED: "FAILED",
  CANCELED: "CANCELED",
  REVERSED: "CANCELED",
  REFUNDED: "REFUNDED",
  PARTIALLY_REFUNDED: "PARTIALLY_REFUNDED",
};

export function fromTBankStatus(status: string): PaymentState {
  return TBANK_STATUS_MAP[status] ?? "PENDING";
}

/** Neutral states that imply the buyer's money reached the terminal. */
const PAID_STATES = new Set<PaymentState>([
  "SUCCEEDED",
  "SETTLEMENT_PENDING",
  "SETTLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
]);

function stateFailure(res: { Message?: string; Details?: string }, action: string): Error {
  const detail = `${res.Message ?? ""} ${res.Details ?? ""}`.trim();
  return new Error(`TBank ${action} failed${detail ? `: ${detail}` : ""}`);
}

export class TBankPaymentProvider implements IPaymentProvider {
  readonly name = "TBANK";

  isEnabled(): boolean {
    return TBANK_ENABLED;
  }

  supportsCapability(capability: Capability): boolean {
    // GetState polling is allowed (PLAN-016 P-004: invoice-style providers
    // confirm by re-fetch; T-Bank supports the same for redirect flows).
    switch (capability) {
      case "payment.create":
      case "payment.verification":
      case "payment.cancel":
      case "refund.create":
      case "payment.poll":
        return this.isEnabled();
    }
  }

  async createPayment(request: CreatePaymentRequest): Promise<{
    providerPaymentId: string;
    state: PaymentState;
    redirectUrl?: string;
    confirmation?: { type: "redirect"; redirectUrl?: string };
  }> {
    const init = await initPayment({
      amountRubles: (request.amount.value / 100).toFixed(2),
      orderId: request.orderId,
      description: request.description,
      returnUrl: request.returnUrl,
    });
    if (init.Success === false) {
      throw stateFailure(init, "init");
    }
    const paymentUrl = init.PaymentURL ?? undefined;
    return {
      providerPaymentId: String(init.PaymentId ?? ""),
      state: "PENDING",
      redirectUrl: paymentUrl,
      confirmation: { type: "redirect", redirectUrl: paymentUrl },
    };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const state: TBankStateResponse = await getState(providerPaymentId);
    if (state.Success === false) {
      throw stateFailure(state, "getState");
    }
    const paymentState = fromTBankStatus(state.Status ?? "");
    // Amount is kopecks per T-Bank docs.
    const kopecks = Math.round(
      typeof state.Amount === "number" ? state.Amount : parseFloat(String(state.Amount ?? "0"))
    );
    return {
      providerPaymentId: String(state.PaymentId ?? providerPaymentId),
      state: paymentState,
      paid: PAID_STATES.has(paymentState),
      amount: { value: Number.isFinite(kopecks) ? kopecks : 0, currency: "RUB" },
      // T-Bank GetState does not reliably expose a creation timestamp; the
      // poll time is used as a fallback (consumers rely on state/amount).
      createdAt: state.CreatedAt ?? new Date().toISOString(),
      metadata: state.OrderId ? { order_id: state.OrderId } : undefined,
    };
  }

  async cancelPayment(providerPaymentId: string): Promise<void> {
    const cancelled = await cancelTBankPayment(providerPaymentId);
    if (cancelled.Success === false) {
      throw stateFailure(cancelled, "cancel");
    }
  }

  async createRefund(input: {
    providerPaymentId: string;
    amount: { value: number; currency: string };
    idempotenceKey: string;
    reason?: string;
  }): Promise<ProviderRefundResult> {
    const refund = await refundTBankPayment(
      input.providerPaymentId,
      input.amount.value,
      input.idempotenceKey
    );
    if (refund.Success === false) {
      throw stateFailure(refund, "refund");
    }
    return {
      providerRefundId: String(refund.RefundId ?? ""),
      // T-Bank /v2/Refund completes synchronously — the refund is created in
      // the succeeded state (no async refinement event follows).
      state: "SUCCEEDED",
      amount: input.amount,
    };
  }

  /**
   * Transport authenticity for T-Bank notifications: the payload's `Token`
   * (SHA-256 over the notification's own fields + terminal Password) plus a
   * terminal-key ownership check. JSON body expected (configure the terminal
   * to send application/json); raw bytes are irrelevant to the token.
   */
  verifyWebhook(
    ctx: ProviderWebhookContext
  ): { ok: true } | { ok: false; reason: "ip" | "auth" | "signature" } {
    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      return { ok: false, reason: "signature" };
    }
    if (TBANK_TERMINAL_KEY && body.TerminalKey !== TBANK_TERMINAL_KEY) {
      // Payload not addressed to this merchant.
      return { ok: false, reason: "auth" };
    }
    if (!verifyTBankNotification(body)) {
      return { ok: false, reason: "signature" };
    }
    return { ok: true };
  }

  /**
   * PLAN-016 P-002: T-Bank wire format → neutral event shape. Business truth
   * is still re-fetched by the route handler (getPayment); this only routes
   * the event and its idempotency key.
   */
  parseWebhook(ctx: ProviderWebhookContext): ParsedWebhook | null {
    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") return null;
    const paymentId = body.PaymentId;
    const status = body.Status;
    if (
      (typeof paymentId !== "number" && typeof paymentId !== "string") ||
      paymentId === "" ||
      typeof status !== "string" ||
      status === ""
    ) {
      return null;
    }
    const orderRef =
      typeof body.OrderId === "string"
        ? body.OrderId
        : body.OrderId !== undefined && body.OrderId !== null
          ? String(body.OrderId)
          : undefined;
    const eventType =
      status === "CONFIRMED" || status === "AUTHORIZED"
        ? "payment.succeeded"
        : status === "REJECTED"
          ? "payment.failed"
          : status === "CANCELED"
            ? "payment.canceled"
            : `tbank.${status}`;
    return {
      providerEventId: `${String(paymentId)}:${status}`,
      eventType,
      providerPaymentId: String(paymentId),
      orderRef,
      metadata: orderRef ? { order_id: orderRef } : undefined,
    };
  }
}

export const tBankPaymentProvider = new TBankPaymentProvider();

// Self-registration into the global registry (E-010 / PLAN-016 C3).
import { paymentProviders } from "../paymentProvider.js";
paymentProviders.register(tBankPaymentProvider);
