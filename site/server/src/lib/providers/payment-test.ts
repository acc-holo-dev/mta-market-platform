// PLAN-016 P-007/D-001: dev-only TEST payment provider (dev-заглушка).
//
// Registered only when PAYMENTS_TEST_ENABLED=true AND the process is not in
// production (the same compile-time honesty rule as the simulate endpoint).
// Surface: crypto_invoice confirmation with a memo and a real TTL; the buyer
// completes the purchase through the existing dev simulate endpoint
// (POST /payments/:id/simulate). No webhook exists (verification capability
// only), no money moves, db-reset removes TEST-provider events like any
// other provider.
import crypto from "crypto";

import type {
  Capability,
  CreatePaymentRequest,
  IPaymentProvider,
  ParsedWebhook,
  ProviderPayment,
  ProviderRefundResult,
} from "../paymentProvider.js";

const TEST_TTL_SEC = Number(process.env.PAYMENTS_TEST_TTL_SEC || "600");
const TEST_ENABLED =
  process.env.PAYMENTS_TEST_ENABLED === "true" && process.env.NODE_ENV !== "production";

export class TestPaymentProvider implements IPaymentProvider {
  readonly name = "TEST";

  isEnabled(): boolean {
    return TEST_ENABLED;
  }

  supportsCapability(capability: Capability): boolean {
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
    state: ProviderPayment["state"];
    confirmation: {
      type: "crypto_invoice";
      memo: string;
      expiresAt: string;
    };
  }> {
    const ttlSec = Number.isFinite(TEST_TTL_SEC) && TEST_TTL_SEC > 0 ? TEST_TTL_SEC : 600;
    return {
      providerPaymentId: `test-${request.orderId}-${crypto.randomUUID().slice(0, 8)}`,
      state: "PENDING",
      confirmation: {
        type: "crypto_invoice",
        memo: "DEV-TEST",
        expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
      },
    };
  }

  // The stub never confirms provider-side; the purchase completes through
  // the documented dev simulate endpoint (P-007).
  async getPayment(providerPaymentId: string): Promise<ProviderPayment> {
    return {
      providerPaymentId,
      state: "PENDING",
      paid: false,
      amount: { value: 0, currency: "RUB" },
      createdAt: new Date().toISOString(),
      metadata: { provider: "TEST", mode: "dev-stub" },
    };
  }

  async cancelPayment(): Promise<void> {
    throw new Error("TEST provider invoices cannot be canceled");
  }

  async createRefund(): Promise<ProviderRefundResult> {
    throw new Error("TEST provider does not support refunds");
  }

  verifyWebhook(): { ok: false; reason: "ip" | "auth" | "signature" } {
    // The stub has no webhook channel at all — a delivery to its route is
    // rejected on transport grounds before any business logic runs.
    return { ok: false, reason: "ip" };
  }

  parseWebhook(): ParsedWebhook | null {
    return null;
  }
}

export const testPaymentProvider = new TestPaymentProvider();

// Self-registration into the global registry (E-010 / PLAN-016 P-007).
import { paymentProviders } from "../paymentProvider.js";
paymentProviders.register(testPaymentProvider);