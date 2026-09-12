// PLAN-016 C3: crypto invoice (Cryptomus-class) implementation of
// IPaymentProvider. Wraps the HTTP transport (lib/cryptoinvoice.ts).
//
// AMOUNT CONTRACT — underpay/overpay (never invent entitlement):
//   * overpay   (paid_amount > required, e.g. payment_status "paid_over"):
//     ACCEPTED — the buyer overpaid; the entitlement is granted for the
//     internal order, the surplus is an operator matter (out of API scope).
//   * exact pay (paid_amount == required): ACCEPTED.
//   * underpay  (paid_amount < required * (1 - tolerance%); statuses
//     "wrong_amount" / "underpaid"): the invoice maps to FAILED / quarantine
//     — a partial crypto payment NEVER completes an order.
//   * when the provider response does not carry paid_amount, the reported
//     status is trusted (the provider applied its own amount checks);
//     explicit wrong-amount statuses still map to FAILED.
// Refunds are out of the provider API scope (capability refund.create is
// not supported) and invoices cannot be canceled via the API.
import {
  createInvoice,
  getInvoiceStatus,
  verifyCryptoCallback,
  CRYPTO_ENABLED,
  CRYPTO_INVOICE_TTL_SEC,
  CRYPTO_UNDERPAY_TOLERANCE_PCT,
  type CryptoInvoiceResult,
} from "../cryptoinvoice.js";
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

/** Statuses where money has (fully or partially) arrived — amount-checked. */
const CRYPTO_FUNDED_STATUSES = new Set([
  "paid",
  "paid_over",
  "confirming",
  "confirmed",
]);
/** Invoice still open / in flight (pre-confirmation checks included). */
const CRYPTO_PENDING_STATUSES = new Set(["check", "process", "verify", "confirm_check"]);
/** Buyer abandoned the invoice / invoice closed. */
const CRYPTO_CANCELED_STATUSES = new Set(["cancel", "canceled", "expire", "expired"]);
/** Provider itself asserts the paid amount is wrong. */
const CRYPTO_WRONG_AMOUNT_STATUSES = new Set(["underpaid", "wrong_amount"]);

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Amount gate for funded invoices: is the received amount below the
 * required one beyond the configured tolerance?
 * Returns "unknown" when the response carries no usable figures — the
 * caller then decides whether to trust the provider status.
 */
function underpayVerdict(
  invoice: Pick<CryptoInvoiceResult, "amount" | "paid_amount">
): "underpaid" | "acceptable" | "unknown" {
  const paidAmount = toNumber(invoice.paid_amount);
  const required = toNumber(invoice.amount);
  if (paidAmount === undefined || required === undefined || required <= 0) {
    return "unknown";
  }
  const threshold = required * (1 - CRYPTO_UNDERPAY_TOLERANCE_PCT / 100);
  // Overpay is accepted (entitlement granted); only a shortfall fails.
  return paidAmount + 1e-9 < threshold ? "underpaid" : "acceptable";
}

/**
 * Cryptomus payment_status → neutral state + paid flag (provider-local
 * mapper — the shared state machine stays untouched):
 *
 *   check / process / verify / confirm_check → PENDING  paid:false
 *   paid / paid_over / confirming / confirmed → SUCCEEDED paid:true
 *       (ONLY when the paid amount passes the tolerance gate;
 *        an underpaid invoice → FAILED, never partial-completed)
 *   wrong_amount / underpaid → FAILED paid:false (tolerance may rescue)
 *   cancel / canceled / expire / expired → CANCELED paid:false
 *   fail / system_fail → FAILED paid:false
 *   refund_* → REFUNDED paid:true (money moved back; out of API scope)
 *   anything else → PENDING paid:false (conservative default)
 */
export function fromCryptoStatus(
  invoice: Pick<CryptoInvoiceResult, "payment_status" | "amount" | "paid_amount">
): { state: PaymentState; paid: boolean } {
  const status = invoice.payment_status ?? "";
  if (CRYPTO_FUNDED_STATUSES.has(status)) {
    const verdict = underpayVerdict(invoice);
    return verdict === "underpaid"
      ? { state: "FAILED", paid: false }
      : { state: "SUCCEEDED", paid: true };
  }
  if (CRYPTO_WRONG_AMOUNT_STATUSES.has(status)) {
    // The provider already asserted a wrong amount: with no usable figures
    // that assertion stands (FAILED); within tolerance it can be rescued.
    return underpayVerdict(invoice) === "acceptable"
      ? { state: "SUCCEEDED", paid: true }
      : { state: "FAILED", paid: false };
  }
  if (CRYPTO_CANCELED_STATUSES.has(status)) {
    return { state: "CANCELED", paid: false };
  }
  if (status === "fail" || status === "system_fail") {
    return { state: "FAILED", paid: false };
  }
  if (status.startsWith("refund")) {
    return { state: "REFUNDED", paid: true };
  }
  if (CRYPTO_PENDING_STATUSES.has(status)) {
    return { state: "PENDING", paid: false };
  }
  return { state: "PENDING", paid: false };
}

export class CryptoInvoicePaymentProvider implements IPaymentProvider {
  readonly name = "CRYPTO";

  isEnabled(): boolean {
    return CRYPTO_ENABLED;
  }

  supportsCapability(capability: Capability): boolean {
    // Invoice-style provider: confirmed by webhook + payment.poll re-fetch;
    // crypto invoices cannot be canceled and refunds are out of API scope.
    switch (capability) {
      case "payment.create":
      case "payment.verification":
      case "payment.poll":
        return this.isEnabled();
      case "payment.cancel":
      case "refund.create":
        return false;
    }
  }

  async createPayment(request: CreatePaymentRequest): Promise<{
    providerPaymentId: string;
    state: PaymentState;
    redirectUrl?: string;
    confirmation?: {
      type: "crypto_invoice";
      payUrl?: string;
      memo?: string;
      expiresAt?: string;
    };
  }> {
    // The parent flow passes returnUrl only; the callback URL for the
    // provider webhook comes from CRYPTO_WEBHOOK_URL, falling back to the
    // public frontend origin + the per-provider webhook route.
    const callbackUrl =
      process.env.CRYPTO_WEBHOOK_URL ||
      `${process.env.FRONTEND_URL || ""}/api/payments/webhook/CRYPTO`;
    const invoice = await createInvoice({
      amountRub: (request.amount.value / 100).toFixed(2),
      currency: request.amount.currency || "RUB",
      orderId: request.orderId,
      description: request.description,
      callbackUrl,
      returnUrl: request.returnUrl,
    });
    const payUrl = invoice.url ?? undefined;
    return {
      providerPaymentId: String(invoice.uuid ?? ""),
      state: "PENDING",
      redirectUrl: payUrl,
      confirmation: {
        type: "crypto_invoice",
        payUrl,
        // The buyer pays a crypto invoice "to the order of" — the internal
        // order reference rides along as the invoice memo.
        memo: request.orderId,
        expiresAt: new Date(Date.now() + CRYPTO_INVOICE_TTL_SEC * 1000).toISOString(),
      },
    };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const invoice = await getInvoiceStatus(providerPaymentId);
    const { state, paid } = fromCryptoStatus(invoice);
    // The invoice amount is a decimal rubles string ("299.00") → kopecks.
    const amountRubles = toNumber(invoice.amount);
    const kopecks = amountRubles === undefined ? 0 : Math.round(amountRubles * 100);
    return {
      providerPaymentId: String(invoice.uuid ?? providerPaymentId),
      state,
      paid,
      amount: { value: kopecks, currency: "RUB" },
      // The invoice API does not expose a creation timestamp; the poll time
      // is used as a fallback (consumers rely on state/amount).
      createdAt: new Date().toISOString(),
      metadata: invoice.order_id ? { order_id: invoice.order_id } : undefined,
    };
  }

  async cancelPayment(_providerPaymentId: string): Promise<void> {
    throw new Error("Crypto invoices cannot be canceled via API");
  }

  async createRefund(_input: {
    providerPaymentId: string;
    amount: { value: number; currency: string };
    idempotenceKey: string;
    reason?: string;
  }): Promise<ProviderRefundResult> {
    throw new Error("Crypto refunds are out of the provider API scope");
  }

  /**
   * Transport authenticity: Cryptomus callback `sign` — md5 over the base64
   * of the callback JSON without the sign field + api key. Any failure maps
   * to reason "signature" (there is no IP allowlist or Basic auth here).
   */
  verifyWebhook(
    ctx: ProviderWebhookContext
  ): { ok: true } | { ok: false; reason: "ip" | "auth" | "signature" } {
    if (!verifyCryptoCallback(ctx.body, ctx.rawBody)) {
      return { ok: false, reason: "signature" };
    }
    return { ok: true };
  }

  /**
   * PLAN-016 P-002: Cryptomus wire format → neutral event shape. Business
   * truth is still re-fetched by the route handler (getPayment); this only
   * routes the event and its idempotency key.
   */
  parseWebhook(ctx: ProviderWebhookContext): ParsedWebhook | null {
    const body = ctx.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") return null;
    const uuid = body.uuid;
    const status = body.status;
    if (typeof uuid !== "string" || uuid === "" || typeof status !== "string" || status === "") {
      return null;
    }
    const orderRef =
      typeof body.order_id === "string"
        ? body.order_id
        : body.order_id !== undefined && body.order_id !== null
          ? String(body.order_id)
          : undefined;
    const eventType =
      status === "paid" || status === "paid_over" || status === "confirmed"
        ? "payment.succeeded"
        : status === "cancel" || status === "canceled" || status === "expire" || status === "expired"
          ? "payment.canceled"
          : status === "wrong_amount" || status === "underpaid"
            ? "payment.failed"
            : `crypto.${status}`;
    return {
      // One invoice fires several status callbacks (check → paid → …); the
      // [provider, providerEventId, eventType] key keeps them distinct.
      providerEventId: uuid,
      eventType,
      providerPaymentId: uuid,
      orderRef,
      metadata: orderRef ? { order_id: orderRef } : undefined,
    };
  }
}

export const cryptoInvoicePaymentProvider = new CryptoInvoicePaymentProvider();

// Self-registration into the global registry (E-010 / PLAN-016 C3).
import { paymentProviders } from "../paymentProvider.js";
paymentProviders.register(cryptoInvoicePaymentProvider);
