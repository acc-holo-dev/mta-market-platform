// PLAN-016 C3: crypto invoice (Cryptomus-class) provider adapter tests.
// Same harness style as tests/integration/api/payments-webhook.test.ts:
// environment variables are set BEFORE the modules are imported (the
// transport reads env at module load and fails fast when enabled without
// credentials), and the provider API is mocked at the fetch boundary — the
// REAL transport (sign formulas pinned by literals below) and the REAL
// adapter run end-to-end. No database is required.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// Env gate BEFORE the dynamic imports below (module-load constants).
process.env.CRYPTO_ENABLED = "true";
process.env.CRYPTO_MERCHANT_ID = "test-merchant";
process.env.CRYPTO_API_KEY = "test-api-key";
process.env.CRYPTO_API_URL = "https://crypto.test";
process.env.CRYPTO_UNDERPAY_TOLERANCE_PCT = "0";
process.env.CRYPTO_INVOICE_TTL_SEC = "3600";
// Exercise the FRONTEND_URL fallback for the callback URL; pinned here for
// determinism (the vitest config default would supply it too).
process.env.FRONTEND_URL = "http://front.test";
delete process.env.CRYPTO_WEBHOOK_URL;

const { paymentProviders } = await import("@server/lib/paymentProvider");
const {
  CryptoInvoicePaymentProvider,
  cryptoInvoicePaymentProvider,
  fromCryptoStatus,
} = await import("@server/lib/providers/payment-crypto");
const { verifyCryptoCallback } = await import("@server/lib/cryptoinvoice");
import type { ProviderWebhookContext } from "@server/lib/paymentProvider";

// Pinned sign literals — md5(base64(json) + "test-api-key"); the exact JSON
// inputs are spelled out in the comments so the Cryptomus sign formulas are
// frozen, not just self-consistent.
// create-invoice sign over the body below (stable key order).
const PINNED_CREATE_SIGN = "338c91432b22d196a7b443d05257e7b3";
// GET status sign: md5(base64("{}") + api_key) for the bodyless status call.
const PINNED_GET_SIGN = "0db4f34f5bea861da84d4bf70007a463";
// Callback sign over the fixture body below (without the sign field).
const PINNED_CALLBACK_SIGN = "d525e50f15808a25e15a7f680f11ed25";

const provider = cryptoInvoicePaymentProvider;
const CALLBACK_URL = "http://front.test/api/payments/webhook/CRYPTO";

const fetchMock = vi.fn();

function respondJson(payload: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

function invoiceResponse(overrides: Record<string, unknown>, ok = true): Response {
  return respondJson({ state: 0, result: { uuid: "inv-uuid-1", order_id: "order-1", amount: "299.00", ...overrides } }, ok);
}

function ctx(body: unknown, rawBody?: Buffer): ProviderWebhookContext {
  return { req: {} as ProviderWebhookContext["req"], body, rawBody, sourceIp: "1.2.3.4" };
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

describe("Crypto invoice provider (PLAN-016 C3)", () => {
  it("is registered and enabled under env", () => {
    expect(provider).toBeInstanceOf(CryptoInvoicePaymentProvider);
    expect(paymentProviders.get("CRYPTO")).toBe(provider);
    expect(provider.isEnabled()).toBe(true);
  });

  it("exposes the capability matrix: no cancel, no refunds", () => {
    expect(provider.supportsCapability("payment.create")).toBe(true);
    expect(provider.supportsCapability("payment.verification")).toBe(true);
    expect(provider.supportsCapability("payment.poll")).toBe(true);
    expect(provider.supportsCapability("payment.cancel")).toBe(false);
    expect(provider.supportsCapability("refund.create")).toBe(false);
  });

  it("createPayment posts the invoice with the pinned sign and returns a crypto_invoice confirmation", async () => {
    fetchMock.mockResolvedValueOnce(
      invoiceResponse({
        payment_status: "check",
        url: "https://pay.test/inv-uuid-1",
        expired_at: 3600,
      })
    );

    const before = Date.now();
    const result = await provider.createPayment({
      amount: { value: 29900, currency: "RUB" },
      description: "Test payment",
      orderId: "order-1",
      returnUrl: "https://front.test/return",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://crypto.test/v1/payment");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.merchant).toBe("test-merchant");
    // STABLE KEY ORDER: the signed JSON string IS the wire body — pin both.
    const expectedBody = {
      amount: "299.00",
      currency: "RUB",
      order_id: "order-1",
      additional_data: "Test payment",
      url_callback: CALLBACK_URL,
      url_return: "https://front.test/return",
      lifetime_sec: 3600,
    };
    expect(String(init.body)).toBe(JSON.stringify(expectedBody));
    expect(headers.sign).toBe(PINNED_CREATE_SIGN);

    expect(result.providerPaymentId).toBe("inv-uuid-1");
    expect(result.state).toBe("PENDING");
    expect(result.redirectUrl).toBe("https://pay.test/inv-uuid-1");
    expect(result.confirmation).not.toBeNull();
    expect(result.confirmation!.type).toBe("crypto_invoice");
    expect(result.confirmation!.payUrl).toBe("https://pay.test/inv-uuid-1");
    expect(result.confirmation!.memo).toBe("order-1");
    const expires = Date.parse(result.confirmation!.expiresAt!);
    expect(expires).toBeGreaterThanOrEqual(before + 3600_000 - 1000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 3600_000 + 1000);
  });

  it("createPayment throws when the API reports an application error (state != 0)", async () => {
    fetchMock.mockResolvedValueOnce(respondJson({ state: 5, message: "amount.invalid" }));
    await expect(
      provider.createPayment({
        amount: { value: 29900, currency: "RUB" },
        description: "x",
        orderId: "order-1",
        returnUrl: "https://front.test/return",
      })
    ).rejects.toThrow(/Crypto invoice API error/);
  });

  it("getPayment fetches the invoice with the pinned GET sign and normalizes the amount", async () => {
    fetchMock.mockResolvedValueOnce(
      invoiceResponse({ payment_status: "process", paid_amount: "0.00" })
    );
    const payment = await provider.getPayment("inv-uuid-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://crypto.test/v1/payment/inv-uuid-1");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).sign).toBe(PINNED_GET_SIGN);
    expect(payment.providerPaymentId).toBe("inv-uuid-1");
    expect(payment.amount).toEqual({ value: 29900, currency: "RUB" });
    expect(payment.metadata).toEqual({ order_id: "order-1" });
    expect(typeof payment.createdAt).toBe("string");
  });

  it("getPayment mapping: overpay accepted, exact pay accepted, underpay FAILED (never partial-complete)", async () => {
    const scenarios: Array<{
      name: string;
      result: Record<string, unknown>;
      state: string;
      paid: boolean;
    }> = [
      { name: "exact paid", result: { payment_status: "paid", paid_amount: "299.00" }, state: "SUCCEEDED", paid: true },
      { name: "overpay accepted (paid_over)", result: { payment_status: "paid_over", paid_amount: "350.00" }, state: "SUCCEEDED", paid: true },
      { name: "confirming with full amount", result: { payment_status: "confirming", paid_amount: "299.00" }, state: "SUCCEEDED", paid: true },
      { name: "paid without paid_amount is trusted", result: { payment_status: "paid" }, state: "SUCCEEDED", paid: true },
      { name: "underpaid (wrong_amount) is quarantined", result: { payment_status: "wrong_amount", paid_amount: "100.00" }, state: "FAILED", paid: false },
      { name: "wrong_amount without paid_amount stands", result: { payment_status: "wrong_amount" }, state: "FAILED", paid: false },
      { name: "underpaid status", result: { payment_status: "underpaid", paid_amount: "100.00" }, state: "FAILED", paid: false },
      { name: "open invoice", result: { payment_status: "process", paid_amount: "0.00" }, state: "PENDING", paid: false },
      { name: "pre-confirmation check", result: { payment_status: "confirm_check" }, state: "PENDING", paid: false },
      { name: "canceled", result: { payment_status: "cancel" }, state: "CANCELED", paid: false },
      { name: "expired", result: { payment_status: "expire" }, state: "CANCELED", paid: false },
      { name: "failed", result: { payment_status: "fail" }, state: "FAILED", paid: false },
      { name: "unknown status is conservative", result: { payment_status: "something_new" }, state: "PENDING", paid: false },
    ];

    for (const scenario of scenarios) {
      fetchMock.mockResolvedValueOnce(invoiceResponse(scenario.result));
      const payment = await provider.getPayment("inv-uuid-1");
      expect(payment.state).toBe(scenario.state);
      expect(payment.paid).toBe(scenario.paid);
    }
  });

  it("fromCryptoStatus covers the amount-gate table directly", () => {
    const inv = (payment_status: string, paid_amount?: string) => ({
      payment_status,
      amount: "299.00",
      ...(paid_amount !== undefined ? { paid_amount } : {}),
    });
    expect(fromCryptoStatus(inv("check"))).toEqual({ state: "PENDING", paid: false });
    expect(fromCryptoStatus(inv("paid", "299.00"))).toEqual({ state: "SUCCEEDED", paid: true });
    // Overpay is accepted — entitlement granted, surplus is an operator matter.
    expect(fromCryptoStatus(inv("paid_over", "350.00"))).toEqual({ state: "SUCCEEDED", paid: true });
    // Underpay never partial-completes: FAILED / quarantine.
    expect(fromCryptoStatus(inv("wrong_amount", "100.00"))).toEqual({ state: "FAILED", paid: false });
    expect(fromCryptoStatus(inv("cancel"))).toEqual({ state: "CANCELED", paid: false });
  });

  it("cancelPayment and createRefund are rejected (out of API scope)", async () => {
    await expect(provider.cancelPayment("inv-uuid-1")).rejects.toThrow(/cannot be canceled via API/);
    await expect(
      provider.createRefund({
        providerPaymentId: "inv-uuid-1",
        amount: { value: 100, currency: "RUB" },
        idempotenceKey: "idem-1",
      })
    ).rejects.toThrow(/refund/i);
    // No provider API call is ever made for either capability.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifyWebhook accepts the valid callback sign (parsed and raw-body paths) and rejects tampering", () => {
    const payload = {
      uuid: "inv-uuid-1",
      order_id: "order-1",
      status: "paid",
      amount: "299.00",
      paid_amount: "299.00",
    };
    const body = { ...payload, sign: PINNED_CALLBACK_SIGN };

    // Direct transport check + through the provider (parsed-body path).
    expect(verifyCryptoCallback(body)).toBe(true);
    expect(provider.verifyWebhook(ctx(body))).toEqual({ ok: true });

    // Raw-bytes path: body parsed from the exact wire bytes.
    const raw = Buffer.from(JSON.stringify(body), "utf8");
    expect(provider.verifyWebhook(ctx(JSON.parse(raw.toString("utf8")), raw))).toEqual({ ok: true });

    // Tampered payload → signature failure.
    const tampered = { ...body, amount: "100.00" };
    expect(verifyCryptoCallback(tampered)).toBe(false);
    expect(provider.verifyWebhook(ctx(tampered))).toEqual({ ok: false, reason: "signature" });

    // Missing sign → signature failure.
    expect(provider.verifyWebhook(ctx(payload))).toEqual({ ok: false, reason: "signature" });
    expect(provider.verifyWebhook(ctx("not-an-object"))).toEqual({ ok: false, reason: "signature" });
  });

  it("parseWebhook routes succeeded/canceled/failed events and nulls unknown payloads", () => {
    const succeeded = provider.parseWebhook(
      ctx({ uuid: "inv-uuid-1", order_id: "order-1", status: "paid", amount: "299.00", paid_amount: "299.00" })
    );
    expect(succeeded).toEqual({
      providerEventId: "inv-uuid-1",
      eventType: "payment.succeeded",
      providerPaymentId: "inv-uuid-1",
      orderRef: "order-1",
      metadata: { order_id: "order-1" },
    });

    expect(provider.parseWebhook(ctx({ uuid: "u1", status: "expire" }))!.eventType).toBe(
      "payment.canceled"
    );
    expect(provider.parseWebhook(ctx({ uuid: "u2", status: "wrong_amount" }))!.eventType).toBe(
      "payment.failed"
    );
    // In-flight statuses stay provider-prefixed (business truth is re-fetched).
    expect(provider.parseWebhook(ctx({ uuid: "u3", status: "confirming" }))!.eventType).toBe(
      "crypto.confirming"
    );

    // Unrecognizable payloads → null (route answers 400).
    expect(provider.parseWebhook(ctx({ status: "paid" }))).toBeNull();
    expect(provider.parseWebhook(ctx({ uuid: "u4" }))).toBeNull();
    expect(provider.parseWebhook(ctx({}))).toBeNull();
  });
});
