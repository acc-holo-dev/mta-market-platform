// PLAN-016 C3: T-Bank payment provider adapter tests.
// Harness style mirrors tests/integration/api/payments-webhook.test.ts:
// environment variables are set BEFORE the modules are imported (the
// transports read env at module load and fail fast when enabled without
// credentials), and the provider API is mocked at the fetch boundary — the
// REAL transport (token formulas, pinned by literals below) and the REAL
// adapter run end-to-end. No database is required.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Env gate BEFORE the dynamic imports below (module-load constants).
process.env.TBANK_ENABLED = "true";
process.env.TBANK_TERMINAL_KEY = "test-terminal";
process.env.TBANK_PASSWORD = "test-password";
process.env.TBANK_API_URL = "https://tbank.test";

const { paymentProviders } = await import("@server/lib/paymentProvider");
const {
  TBankPaymentProvider,
  tBankPaymentProvider,
  fromTBankStatus,
} = await import("@server/lib/providers/payment-tbank");
const { verifyTBankNotification } = await import("@server/lib/tbank");
import type { ProviderWebhookContext } from "@server/lib/paymentProvider";

// Pinned token literals — the comment spells out the exact hashed input so
// the T-Bank token formulas are frozen, not just self-consistent.
// Init token: values of {Amount:"29900", Description:"Test payment",
// OrderId:"order-1", TerminalKey:"test-terminal"} sorted by key,
// concatenated as strings, with "test-password" appended, SHA-256 hex.
const PINNED_INIT_TOKEN = "d23fa698fda8a0ee46384432cb809fb8344bf83b2ef88650035d962d9773ba37";
// Notification token: key+value pairs of the body below sorted by key
// ("Amount29900", "OrderIdorder-1", "PaymentId123", "StatusCONFIRMED",
// "Successtrue", "TerminalKeytest-terminal"), concatenated, with
// "test-password" appended, SHA-256 hex.
const PINNED_NOTIFICATION_TOKEN =
  "c0686776b50647602c13463a3e43c65023a6067d2b5f52ae4f21f88ae4cf3fdf";

const provider = tBankPaymentProvider;

const fetchMock = vi.fn();

function respondJson(payload: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function lastBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse(String(call[1].body));
}

function ctx(body: unknown): ProviderWebhookContext {
  return { req: {} as ProviderWebhookContext["req"], body, sourceIp: "1.2.3.4" };
}

beforeAll(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  fetchMock.mockReset();
});

describe("T-Bank provider (PLAN-016 C3)", () => {
  it("is registered and enabled under env", () => {
    expect(provider).toBeInstanceOf(TBankPaymentProvider);
    expect(paymentProviders.get("TBANK")).toBe(provider);
    expect(provider.isEnabled()).toBe(true);
  });

  it("exposes the full capability matrix when enabled (incl. payment.poll)", () => {
    expect(provider.supportsCapability("payment.create")).toBe(true);
    expect(provider.supportsCapability("payment.verification")).toBe(true);
    expect(provider.supportsCapability("payment.cancel")).toBe(true);
    expect(provider.supportsCapability("refund.create")).toBe(true);
    expect(provider.supportsCapability("payment.poll")).toBe(true);
  });

  it("createPayment posts /v2/Init with the pinned token and returns a redirect confirmation", async () => {
    fetchMock.mockResolvedValueOnce(
      respondJson({
        Success: true,
        PaymentId: 123456,
        Status: "NEW",
        PaymentURL: "https://tbank.test/pay/123456",
      })
    );

    const result = await provider.createPayment({
      amount: { value: 29900, currency: "RUB" },
      description: "Test payment",
      orderId: "order-1",
      returnUrl: "https://front.test/return",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://tbank.test/v2/Init");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      TerminalKey: "test-terminal",
      Amount: 29900, // kopecks
      OrderId: "order-1",
      Description: "Test payment",
      ReturnUrl: "https://front.test/return",
    });
    expect(body.Token).toBe(PINNED_INIT_TOKEN);

    expect(result).toEqual({
      providerPaymentId: "123456",
      state: "PENDING",
      redirectUrl: "https://tbank.test/pay/123456",
      confirmation: { type: "redirect", redirectUrl: "https://tbank.test/pay/123456" },
    });
  });

  it("createPayment throws on a failed Init (Success=false)", async () => {
    fetchMock.mockResolvedValueOnce(
      respondJson({ Success: false, ErrorCode: "1013", Message: "Authorization failed" })
    );
    await expect(
      provider.createPayment({
        amount: { value: 29900, currency: "RUB" },
        description: "x",
        orderId: "order-1",
        returnUrl: "https://front.test/return",
      })
    ).rejects.toThrow(/TBank init failed/);
  });

  it("getPayment maps CONFIRMED → SUCCEEDED with amount/metadata normalization", async () => {
    fetchMock.mockResolvedValueOnce(
      respondJson({
        Success: true,
        TerminalKey: "test-terminal",
        OrderId: "order-1",
        PaymentId: 123456,
        Status: "CONFIRMED",
        Amount: 29900,
      })
    );

    const payment = await provider.getPayment("123456");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://tbank.test/v2/GetState");
    expect(lastBody()).toMatchObject({ TerminalKey: "test-terminal", PaymentId: "123456" });
    expect(payment.providerPaymentId).toBe("123456");
    expect(payment.state).toBe("SUCCEEDED");
    expect(payment.paid).toBe(true);
    expect(payment.amount).toEqual({ value: 29900, currency: "RUB" });
    expect(payment.metadata).toEqual({ order_id: "order-1" });
    expect(typeof payment.createdAt).toBe("string");
    expect(Number.isNaN(Date.parse(payment.createdAt))).toBe(false);
  });

  it("getPayment maps REJECTED → FAILED and NEW → PENDING", async () => {
    fetchMock.mockResolvedValueOnce(
      respondJson({ Success: true, PaymentId: 1, Status: "REJECTED", Amount: 29900 })
    );
    const rejected = await provider.getPayment("1");
    expect(rejected.state).toBe("FAILED");
    expect(rejected.paid).toBe(false);

    fetchMock.mockResolvedValueOnce(
      respondJson({ Success: true, PaymentId: 2, Status: "NEW", Amount: 29900 })
    );
    const fresh = await provider.getPayment("2");
    expect(fresh.state).toBe("PENDING");
    expect(fresh.paid).toBe(false);
  });

  it("fromTBankStatus covers the documented table with a conservative default", () => {
    expect(fromTBankStatus("NEW")).toBe("PENDING");
    expect(fromTBankStatus("FORMSHOWED")).toBe("PENDING");
    expect(fromTBankStatus("AUTHORIZED")).toBe("SUCCEEDED");
    expect(fromTBankStatus("CONFIRMED")).toBe("SUCCEEDED");
    expect(fromTBankStatus("REJECTED")).toBe("FAILED");
    expect(fromTBankStatus("DEADLINE_EXPIRED")).toBe("FAILED");
    expect(fromTBankStatus("CANCELED")).toBe("CANCELED");
    expect(fromTBankStatus("SOMETHING_ELSE")).toBe("PENDING");
  });

  it("cancelPayment posts /v2/Cancel and throws on provider failure", async () => {
    fetchMock.mockResolvedValueOnce(
      respondJson({ Success: true, PaymentId: 123456, Status: "CANCELED" })
    );
    await expect(provider.cancelPayment("123456")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe("https://tbank.test/v2/Cancel");
    expect(lastBody()).toMatchObject({ TerminalKey: "test-terminal", PaymentId: "123456" });

    fetchMock.mockResolvedValueOnce(
      respondJson({ Success: false, Message: "only NEW can be canceled" })
    );
    await expect(provider.cancelPayment("123456")).rejects.toThrow(/TBank cancel failed/);
  });

  it("createRefund posts /v2/Refund and maps to a synchronous SUCCEEDED result", async () => {
    fetchMock.mockResolvedValueOnce(
      respondJson({ Success: true, PaymentId: 123456, RefundId: 789, Status: "PARTIALLY_REFUNDED" })
    );

    const refund = await provider.createRefund({
      providerPaymentId: "123456",
      amount: { value: 5000, currency: "RUB" },
      idempotenceKey: "idem-1",
    });

    expect(fetchMock.mock.calls[0][0]).toBe("https://tbank.test/v2/Refund");
    expect(lastBody()).toMatchObject({
      TerminalKey: "test-terminal",
      PaymentId: "123456",
      Amount: 5000,
    });
    expect(refund).toEqual({
      providerRefundId: "789",
      state: "SUCCEEDED",
      amount: { value: 5000, currency: "RUB" },
    });

    fetchMock.mockResolvedValueOnce(
      respondJson({ Success: false, Message: "nothing to refund" })
    );
    await expect(
      provider.createRefund({
        providerPaymentId: "123456",
        amount: { value: 5000, currency: "RUB" },
        idempotenceKey: "idem-2",
      })
    ).rejects.toThrow(/TBank refund failed/);
  });

  it("verifyWebhook accepts the valid notification token and rejects tampering", () => {
    const body = {
      TerminalKey: "test-terminal",
      OrderId: "order-1",
      Success: true,
      Status: "CONFIRMED",
      PaymentId: 123,
      Amount: 29900,
      Token: PINNED_NOTIFICATION_TOKEN,
    };
    // Direct transport check + through the provider.
    expect(verifyTBankNotification(body)).toBe(true);
    expect(provider.verifyWebhook(ctx(body))).toEqual({ ok: true });

    // Tampered field → token mismatch → signature.
    const tampered = { ...body, Amount: 9900 };
    expect(verifyTBankNotification(tampered)).toBe(false);
    expect(provider.verifyWebhook(ctx(tampered))).toEqual({ ok: false, reason: "signature" });

    // Foreign terminal key → auth failure (payload not addressed to us).
    const foreign = { ...body, TerminalKey: "other-terminal" };
    expect(provider.verifyWebhook(ctx(foreign))).toEqual({ ok: false, reason: "auth" });
  });

  it("verifyWebhook rejects missing/garbage tokens and foreign terminals", () => {
    expect(
      verifyTBankNotification({ TerminalKey: "test-terminal", Amount: 1 })
    ).toBe(false);
    expect(
      verifyTBankNotification({ TerminalKey: "test-terminal", Amount: 1, Token: "zzz-not-hex" })
    ).toBe(false);
    // Correct terminal, broken token → signature.
    expect(
      provider.verifyWebhook(ctx({ TerminalKey: "test-terminal", Amount: 1 }))
    ).toEqual({ ok: false, reason: "signature" });
    // No terminal key at all → payload is not addressed to this merchant.
    expect(provider.verifyWebhook(ctx({ Amount: 1, Token: PINNED_NOTIFICATION_TOKEN }))).toEqual({
      ok: false,
      reason: "auth",
    });
    expect(provider.verifyWebhook(ctx("not-an-object"))).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("parseWebhook routes succeeded/failed/canceled events with stable ids", () => {
    const succeeded = provider.parseWebhook(
      ctx({ Success: true, Status: "CONFIRMED", PaymentId: 123456, OrderId: "order-1", Amount: 29900 })
    );
    expect(succeeded).toEqual({
      providerEventId: "123456:CONFIRMED",
      eventType: "payment.succeeded",
      providerPaymentId: "123456",
      orderRef: "order-1",
      metadata: { order_id: "order-1" },
    });

    const failed = provider.parseWebhook(
      ctx({ Success: false, Status: "REJECTED", PaymentId: 123456, OrderId: "order-1" })
    );
    expect(failed).not.toBeNull();
    expect(failed!.eventType).toBe("payment.failed");
    expect(failed!.providerEventId).toBe("123456:REJECTED");

    const canceled = provider.parseWebhook(ctx({ Status: "CANCELED", PaymentId: 123456 }));
    expect(canceled).not.toBeNull();
    expect(canceled!.eventType).toBe("payment.canceled");
    expect(canceled!.providerEventId).toBe("123456:CANCELED");

    const other = provider.parseWebhook(ctx({ Status: "FORMSHOWED", PaymentId: 123456 }));
    expect(other!.eventType).toBe("tbank.FORMSHOWED");

    // Unrecognizable payloads → null (route answers 400).
    expect(provider.parseWebhook(ctx({ Status: "CONFIRMED" }))).toBeNull();
    expect(provider.parseWebhook(ctx({ PaymentId: 123456 }))).toBeNull();
    expect(provider.parseWebhook(ctx({}))).toBeNull();
  });
});
