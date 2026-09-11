// PLAN E-001/E-002/E-007/E-010: canonical provider-neutral payment layer.
//
// This is THE single payment abstraction in the codebase (E-002):
// routes call the registry/provider, never a provider SDK directly.
// The previous unused duplicate interface here was folded into this
// canonical version; the YooKassa transport stays in lib/yookassa.ts and is
// wrapped by lib/providers/payment-yookassa.ts.
//
// E-007: internal Payment rows are provider-agnostic (provider +
// providerPaymentId); no core invariant depends on YooKassa naming.

import type { Request } from "express";

/** Minor units (kopecks) + ISO 4217. */
export interface PaymentAmount {
  value: number;
  currency: string;
}

/** Provider-neutral payment states — mirrors the PaymentStatus contract enum. */
export type PaymentState =
  | "PENDING"
  | "SUCCEEDED"
  | "SETTLEMENT_PENDING"
  | "SETTLED"
  | "FAILED"
  | "CANCELED"
  | "REFUNDED"
  | "PARTIALLY_REFUNDED";

export interface CreatePaymentRequest {
  amount: PaymentAmount;
  description: string;
  /** Internal order reference echoed by the provider (metadata.order_id). */
  orderId: string;
  returnUrl: string;
  metadata?: Record<string, string>;
}

export interface ProviderPayment {
  providerPaymentId: string;
  state: PaymentState;
  paid: boolean;
  amount: PaymentAmount;
  createdAt: string;
  metadata?: Record<string, string>;
}

export interface ProviderRefundResult {
  providerRefundId: string;
  state: "PENDING" | "SUCCEEDED" | "FAILED" | "CANCELED";
  amount: PaymentAmount;
}

export interface ProviderWebhookContext {
  req: Request;
  /** Raw parsed body. */
  body: unknown;
  sourceIp: string;
}

export type Capability =
  | "payment.create"
  | "payment.verification"
  | "payment.cancel"
  | "refund.create";

/**
 * E-001: provider-neutral payment provider interface.
 */
export interface IPaymentProvider {
  readonly name: string;
  isEnabled(): boolean;
  supportsCapability(capability: Capability): boolean;

  createPayment(request: CreatePaymentRequest): Promise<{
    providerPaymentId: string;
    state: PaymentState;
    redirectUrl?: string;
  }>;

  getPayment(providerPaymentId: string): Promise<ProviderPayment>;

  cancelPayment(providerPaymentId: string): Promise<void>;

  createRefund(input: {
    providerPaymentId: string;
    amount: PaymentAmount;
    idempotenceKey: string;
    reason?: string;
  }): Promise<ProviderRefundResult>;

  /**
   * E-006: verify webhook transport authenticity (IP allowlist, Basic auth,
   * signature — whatever the actual provider protocol requires). Business
   * verification (provider re-fetch) happens in the route/service layer.
   * The structured result lets routes map failure reasons to precise HTTP
   * statuses (403 for untrusted source, 401 for bad credentials).
   */
  verifyWebhook(
    ctx: ProviderWebhookContext
  ): { ok: true } | { ok: false; reason: "ip" | "auth" };
}

/**
 * E-010: registry keeps the architecture ready for T-Bank/Alfa/crypto
 * without implementing them before the canonical flow works.
 */
export class PaymentProviderRegistry {
  private providers = new Map<string, IPaymentProvider>();

  register(provider: IPaymentProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): IPaymentProvider | undefined {
    return this.providers.get(name);
  }

  getEnabled(): IPaymentProvider[] {
    return Array.from(this.providers.values()).filter((p) => p.isEnabled());
  }

  getDefault(): IPaymentProvider | null {
    const enabled = this.getEnabled();
    return enabled.length > 0 ? enabled[0] : null;
  }
}

export const paymentProviders = new PaymentProviderRegistry();
