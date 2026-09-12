// T-Bank (Tinkoff) EACQ payment transport (PLAN-016 C3).
// HTTP-only wrapper around the /v2 Init / GetState / Cancel / Refund API.
// Mirrors lib/yookassa.ts: env-gated, fetch-based, typed responses, no
// business logic (that lives in lib/providers/payment-tbank.ts).
//
// Webhook authenticity: T-Bank notification payloads carry a `Token` field —
// SHA-256 over the notification's own fields (keys sorted alphabetically,
// each pair concatenated as `${key}${value}`, terminal Password appended).
// Unlike YooKassa there is no IP allowlist / Basic auth for notifications:
// the token IS the transport check (E-006). The token is computed over
// parsed values, not raw bytes, so notifications are accepted as JSON
// (configure the terminal's notification endpoint to send
// application/json).
import crypto from "crypto";

const TBANK_TERMINAL_KEY = process.env.TBANK_TERMINAL_KEY || "";
const TBANK_PASSWORD = process.env.TBANK_PASSWORD || "";
const TBANK_ENABLED = process.env.TBANK_ENABLED === "true";
const TBANK_API_URL = process.env.TBANK_API_URL || "https://securepay.tinkoff.ru";

if (TBANK_ENABLED && (!TBANK_TERMINAL_KEY || !TBANK_PASSWORD)) {
  throw new Error(
    "FATAL: TBANK_ENABLED=true but TBANK_TERMINAL_KEY or TBANK_PASSWORD is missing"
  );
}

export interface TBankInitOptions {
  /** Decimal rubles string with 2 fraction digits, e.g. "299.00". */
  amountRubles: string;
  orderId: string;
  description: string;
  returnUrl: string;
  /** Optional — the notifications URL is normally configured on the terminal. */
  notificationUrl?: string;
}

export interface TBankInitResponse {
  Success: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  PaymentId?: number | string;
  Status?: string;
  PaymentURL?: string;
}

export interface TBankStateResponse {
  Success: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  TerminalKey?: string;
  OrderId?: string;
  PaymentId?: number | string;
  Status?: string;
  /** Kopecks. */
  Amount?: number;
  /** Present on some terminals only; the provider falls back to poll time. */
  CreatedAt?: string;
}

export interface TBankCancelResponse {
  Success: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  PaymentId?: number | string;
  Status?: string;
}

export interface TBankRefundResponse {
  Success: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  PaymentId?: number | string;
  RefundId?: number | string;
  Status?: string;
}

/** Arbitrary notification body — every field except Token feeds the token. */
export type TBankNotification = Record<string, unknown>;

/**
 * Request token (T-Bank Init/GetState/Cancel/Refund): request parameters
 * sorted alphabetically by key, VALUES concatenated as strings, terminal
 * Password appended at the end, SHA-256 hex. Null/undefined params are
 * skipped. (Notifications use a different algorithm — key+value pairs —
 * see verifyTBankNotification.)
 */
export function tbankRequestToken(
  params: Record<string, string | number | boolean | null | undefined>
): string {
  const concatenated = Object.entries(params)
    .filter(([, value]) => value !== null && value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, value]) => String(value))
    .join("");
  return crypto
    .createHash("sha256")
    .update(concatenated + TBANK_PASSWORD)
    .digest("hex");
}

async function post<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${TBANK_API_URL}${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.text();
    // HTTP status in the message: callers can distinguish definitive errors
    // from transient ones (same convention as lib/yookassa.ts).
    throw new Error(`TBank API error (HTTP ${response.status}): ${error}`);
  }
  return (await response.json()) as T;
}

// Create a payment session (POST /v2/Init). Returns Success/PaymentId/Status
// and, on the happy path, the PaymentURL the buyer must be redirected to.
export async function initPayment(options: TBankInitOptions): Promise<TBankInitResponse> {
  if (!TBANK_ENABLED) {
    throw new Error("T-Bank is not enabled");
  }
  const amountKopecks = Math.round(parseFloat(options.amountRubles) * 100);
  const body = {
    TerminalKey: TBANK_TERMINAL_KEY,
    Amount: amountKopecks,
    OrderId: options.orderId,
    ...(options.description ? { Description: options.description } : {}),
    ReturnUrl: options.returnUrl,
    ...(options.notificationUrl ? { NotificationURL: options.notificationUrl } : {}),
    // Token covers the request parameters (TerminalKey/Amount/OrderId/
    // Description when present); Password is appended inside the helper.
    Token: tbankRequestToken({
      TerminalKey: TBANK_TERMINAL_KEY,
      Amount: amountKopecks,
      OrderId: options.orderId,
      ...(options.description ? { Description: options.description } : {}),
    }),
  };
  return post<TBankInitResponse>("/v2/Init", body);
}

// Poll the current payment state (POST /v2/GetState). Used both by
// getPayment (reconciliation/poll capability) and to verify webhooks.
export async function getState(paymentId: string): Promise<TBankStateResponse> {
  if (!TBANK_ENABLED) {
    throw new Error("T-Bank is not enabled");
  }
  return post<TBankStateResponse>("/v2/GetState", {
    TerminalKey: TBANK_TERMINAL_KEY,
    PaymentId: paymentId,
    Token: tbankRequestToken({
      TerminalKey: TBANK_TERMINAL_KEY,
      PaymentId: paymentId,
    }),
  });
}

// Cancel a pending payment (POST /v2/Cancel).
export async function cancelPayment(paymentId: string): Promise<TBankCancelResponse> {
  if (!TBANK_ENABLED) {
    throw new Error("T-Bank is not enabled");
  }
  return post<TBankCancelResponse>("/v2/Cancel", {
    TerminalKey: TBANK_TERMINAL_KEY,
    PaymentId: paymentId,
    Token: tbankRequestToken({
      TerminalKey: TBANK_TERMINAL_KEY,
      PaymentId: paymentId,
    }),
  });
}

// Refund a captured payment (POST /v2/Refund). Amount in kopecks.
// T-Bank has no Idempotence-Key header — the parameter is accepted for
// parity with the neutral layer and deliberately not sent.
export async function refund(
  paymentId: string,
  amountKopecks: number,
  _idempotenceKey?: string
): Promise<TBankRefundResponse> {
  if (!TBANK_ENABLED) {
    throw new Error("T-Bank is not enabled");
  }
  void _idempotenceKey;
  return post<TBankRefundResponse>("/v2/Refund", {
    TerminalKey: TBANK_TERMINAL_KEY,
    PaymentId: paymentId,
    Amount: amountKopecks,
    Token: tbankRequestToken({
      TerminalKey: TBANK_TERMINAL_KEY,
      PaymentId: paymentId,
      Amount: amountKopecks,
    }),
  });
}

/**
 * Verify a notification body's `Token` (T-Bank notification algorithm):
 * every field except `Token` and null/undefined values, keys sorted
 * alphabetically, each pair concatenated as `${key}${String(value)}`,
 * terminal Password appended, SHA-256 hex, timing-safe comparison.
 * The raw request bytes are NOT required — T-Bank hashes parsed values.
 */
export function verifyTBankNotification(
  body: unknown,
  password: string = TBANK_PASSWORD
): boolean {
  if (!body || typeof body !== "object") return false;
  const { Token, ...rest } = body as Record<string, unknown>;
  if (typeof Token !== "string" || Token.length === 0) return false;
  const concatenated = Object.entries(rest)
    .filter(([, value]) => value !== null && value !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}${String(value)}`)
    .join("");
  const expected = crypto
    .createHash("sha256")
    .update(concatenated + password)
    .digest("hex");
  const got = Buffer.from(Token.toLowerCase(), "hex");
  const want = Buffer.from(expected, "hex");
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(got, want);
}

export { TBANK_ENABLED, TBANK_TERMINAL_KEY, TBANK_API_URL };
