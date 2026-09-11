// PLAN E-002/E-006/E-008: canonical YooKassa implementation of IPaymentProvider.
// Wraps the YooKassa HTTP transport (lib/yookassa.ts) — the only place where
// YooKassa specifics meet the neutral payment layer. Verification follows the
// actual provider protocol: IP allowlist + HTTP Basic auth on the transport
// side (lib/yookassaWebhook.ts) and provider re-fetch for business checks
// (route/service layer), not invented HMAC headers.

import {
  createYooKassaPayment,
  getYooKassaPayment,
  createYooKassaRefund,
  cancelYooKassaPayment,
  YOOKASSA_ENABLED,
  YOOKASSA_SHOP_ID,
  type YooKassaPayment,
} from "../yookassa";
import { isYooKassaIP, verifyYooKassaAuth } from "../yookassaWebhook";
import { fromYooKassaStatus, type PaymentState } from "../paymentStateMachine";
import type {
  CreatePaymentRequest,
  IPaymentProvider,
  ProviderPayment,
  ProviderRefundResult,
  ProviderWebhookContext,
  Capability,
} from "../paymentProvider";

function toAmount(amount: { value: string; currency: string }): {
  value: number;
  currency: string;
} {
  return {
    value: Math.round(parseFloat(amount.value) * 100),
    currency: amount.currency,
  };
}

export class YooKassaPaymentProvider implements IPaymentProvider {
  readonly name = "YUKASSA";

  isEnabled(): boolean {
    return YOOKASSA_ENABLED;
  }

  supportsCapability(capability: Capability): boolean {
    switch (capability) {
      case "payment.create":
      case "payment.verification":
      case "refund.create":
        return this.isEnabled();
      case "payment.cancel":
        return this.isEnabled();
    }
  }

  async createPayment(request: CreatePaymentRequest): Promise<{
    providerPaymentId: string;
    state: PaymentState;
    redirectUrl?: string;
  }> {
    const payment = await createYooKassaPayment({
      amount: request.amount.value,
      currency: request.amount.currency,
      description: request.description,
      orderId: request.orderId,
      returnUrl: request.returnUrl,
    });
    return {
      providerPaymentId: payment.id,
      state: fromYooKassaStatus(payment.status),
      redirectUrl: payment.confirmation?.confirmation_url,
    };
  }

  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const payment: YooKassaPayment = await getYooKassaPayment(providerPaymentId);
    return {
      providerPaymentId: payment.id,
      state: fromYooKassaStatus(payment.status),
      paid: payment.paid,
      amount: toAmount(payment.amount),
      createdAt: payment.created_at,
      metadata: payment.metadata,
    };
  }

  async cancelPayment(providerPaymentId: string): Promise<void> {
    await cancelYooKassaPayment(providerPaymentId);
  }

  async createRefund(input: {
    providerPaymentId: string;
    amount: { value: number; currency: string };
    idempotenceKey: string;
    reason?: string;
  }): Promise<ProviderRefundResult> {
    const refund = await createYooKassaRefund({
      paymentId: input.providerPaymentId,
      amountValue: (input.amount.value / 100).toFixed(2),
      currency: input.amount.currency,
      idempotenceKey: input.idempotenceKey,
      reason: input.reason,
    });
    return {
      providerRefundId: refund.id,
      // YooKassa refunds are created synchronously in "succeeded"/"pending";
      // async refinement arrives with the refund webhook (E-008 note).
      state: refund.status === "succeeded" ? "SUCCEEDED" : "PENDING",
      amount: toAmount(refund.amount),
    };
  }

  verifyWebhook(
    ctx: ProviderWebhookContext
  ): { ok: true } | { ok: false; reason: "ip" | "auth" } {
    if (!isYooKassaIP(ctx.sourceIp)) {
      return { ok: false, reason: "ip" };
    }
    const notificationPassword = process.env.YOOKASSA_NOTIFICATION_PASSWORD || "";
    if (
      !verifyYooKassaAuth(ctx.req.headers.authorization, YOOKASSA_SHOP_ID, notificationPassword)
    ) {
      return { ok: false, reason: "auth" };
    }
    return { ok: true };
  }
}

export const yooKassaPaymentProvider = new YooKassaPaymentProvider();

// Self-registration into the global registry (E-010).
import { paymentProviders } from "../paymentProvider";
paymentProviders.register(yooKassaPaymentProvider);
