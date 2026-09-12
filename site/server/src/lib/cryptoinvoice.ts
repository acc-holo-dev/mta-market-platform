// Cryptomus-class crypto invoice transport (PLAN-016 C3).
// HTTP-only wrapper around the /v1/payment invoice API. Mirrors
// lib/yookassa.ts: env-gated, fetch-based, typed responses, no business
// logic (that lives in lib/providers/payment-crypto.ts).
//
// Auth: `merchant` + `sign` headers. sign = md5(base64(json_body) + api_key)
// for calls with a body, and md5(base64("{}") + api_key) for the bodyless
// GET status call. The exact formula exists ONLY in cryptoApiSign /
// cryptoGetSign below and is pinned by
// tests/integration/api/payments-crypto.test.ts — keep it that way.
//
// The create-invoice body is built with a STABLE key order and serialized
// exactly once: the sign hashes the same JSON string that goes on the wire.
import crypto from "crypto";

const CRYPTO_MERCHANT_ID = process.env.CRYPTO_MERCHANT_ID || "";
const CRYPTO_API_KEY = process.env.CRYPTO_API_KEY || "";
const CRYPTO_ENABLED = process.env.CRYPTO_ENABLED === "true";
const CRYPTO_API_URL = process.env.CRYPTO_API_URL || "https://api.cryptomus.com";
/** Invoice lifetime in seconds (env CRYPTO_INVOICE_TTL_SEC, default 1h). */
const CRYPTO_INVOICE_TTL_SEC = Number(process.env.CRYPTO_INVOICE_TTL_SEC || "3600");
/**
 * Underpay tolerance in percent (env CRYPTO_UNDERPAY_TOLERANCE_PCT,
 * default 0). Non-negative: with 0 a payment must cover the invoice in
 * full; with 1 a payment of >= 99% is accepted (rounding dust). See the
 * underpay/overpay contract in lib/providers/payment-crypto.ts.
 */
const CRYPTO_UNDERPAY_TOLERANCE_PCT = Math.max(
  0,
  Number(process.env.CRYPTO_UNDERPAY_TOLERANCE_PCT || "0")
);

if (CRYPTO_ENABLED && (!CRYPTO_MERCHANT_ID || !CRYPTO_API_KEY)) {
  throw new Error(
    "FATAL: CRYPTO_ENABLED=true but CRYPTO_MERCHANT_ID or CRYPTO_API_KEY is missing"
  );
}

export interface CreateInvoiceOptions {
  /** Decimal rubles string with 2 fraction digits, e.g. "299.00". */
  amountRub: string;
  currency: string;
  orderId: string;
  description?: string;
  callbackUrl: string;
  returnUrl?: string;
}

/** Invoice surface as returned by the provider (POST create / GET status). */
export interface CryptoInvoiceResult {
  uuid: string;
  order_id?: string;
  /** Required amount, decimal string in the invoice currency. */
  amount?: string;
  /** Cryptomus payment_status (check/process/paid/cancel/…). */
  payment_status?: string;
  /** Payment page URL the buyer must be sent to. */
  url?: string;
  status?: string;
  /** Amount actually received so far (string or number when present). */
  paid_amount?: string | number;
  /** Unix seconds — when the invoice expires. */
  expired_at?: number;
  [key: string]: unknown;
}

export interface CryptoInvoiceResponse {
  state: number;
  message?: string;
  result?: CryptoInvoiceResult;
}

/** md5(base64(json) + api_key) — the single source of the POST sign. */
export function cryptoApiSign(json: string): string {
  return crypto
    .createHash("md5")
    .update(Buffer.from(json, "utf8").toString("base64") + CRYPTO_API_KEY)
    .digest("hex");
}

/** md5(base64("{}") + api_key) — the single source of the bodyless GET sign. */
export function cryptoGetSign(): string {
  return crypto
    .createHash("md5")
    .update(Buffer.from("{}", "utf8").toString("base64") + CRYPTO_API_KEY)
    .digest("hex");
}

async function unwrap(response: Response): Promise<CryptoInvoiceResult> {
  if (!response.ok) {
    const error = await response.text();
    // HTTP status in the message: callers can distinguish definitive errors
    // from transient ones (same convention as lib/yookassa.ts).
    throw new Error(`Crypto invoice API error (HTTP ${response.status}): ${error}`);
  }
  const parsed = (await response.json()) as CryptoInvoiceResponse;
  if (parsed.state !== 0 || !parsed.result) {
    // Cryptomus signals application errors with state != 0 + message.
    throw new Error(
      `Crypto invoice API error: ${parsed.message ?? `state=${parsed.state}`}`
    );
  }
  return parsed.result;
}

// Create an invoice (POST /v1/payment). The body object is constructed with
// a stable key order, serialized once and reused for the sign and the wire
// body so the two can never diverge.
export async function createInvoice(options: CreateInvoiceOptions): Promise<CryptoInvoiceResult> {
  if (!CRYPTO_ENABLED) {
    throw new Error("Crypto invoice provider is not enabled");
  }
  const payload: Record<string, string | number> = {
    amount: options.amountRub,
    currency: options.currency,
    order_id: options.orderId,
  };
  if (options.description) payload.additional_data = options.description;
  payload.url_callback = options.callbackUrl;
  if (options.returnUrl) payload.url_return = options.returnUrl;
  payload.lifetime_sec = CRYPTO_INVOICE_TTL_SEC;

  const json = JSON.stringify(payload);
  const response = await fetch(`${CRYPTO_API_URL}/v1/payment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      merchant: CRYPTO_MERCHANT_ID,
      sign: cryptoApiSign(json),
    },
    body: json,
  });
  return unwrap(response);
}

// Fetch the current invoice status (GET /v1/payment/{uuid}) — used by
// payment.poll re-fetch and business verification after webhooks.
export async function getInvoiceStatus(uuid: string): Promise<CryptoInvoiceResult> {
  if (!CRYPTO_ENABLED) {
    throw new Error("Crypto invoice provider is not enabled");
  }
  const response = await fetch(`${CRYPTO_API_URL}/v1/payment/${encodeURIComponent(uuid)}`, {
    method: "GET",
    headers: {
      merchant: CRYPTO_MERCHANT_ID,
      sign: cryptoGetSign(),
    },
  });
  return unwrap(response);
}

/**
 * Verify a callback body's `sign` (Cryptomus algorithm: the callback JSON
 * without the sign field, base64-encoded, api_key appended, MD5 hex,
 * compared timing-safe). When the raw request bytes are available they are
 * re-parsed (exact original key order); otherwise the parsed body is
 * re-serialized minus `sign` — insertion order is preserved for string
 * keys, so this reproduces the signed payload for callback objects.
 */
export function verifyCryptoCallback(
  body: unknown,
  rawBody?: Buffer,
  apiKey: string = CRYPTO_API_KEY
): boolean {
  if (!body || typeof body !== "object") return false;
  const { sign, ...rest } = body as Record<string, unknown>;
  if (typeof sign !== "string" || sign.length === 0) return false;
  let source: unknown = rest;
  if (rawBody) {
    try {
      const parsedRaw: unknown = JSON.parse(rawBody.toString("utf8"));
      if (parsedRaw && typeof parsedRaw === "object") {
        // Copy then drop `sign`: the HMAC source excludes the sign field.
        const restRaw = { ...(parsedRaw as Record<string, unknown>) };
        delete restRaw.sign;
        source = restRaw;
      }
    } catch {
      // Unparseable raw bytes — fall back to the parsed body.
    }
  }
  const expected = crypto
    .createHash("md5")
    .update(Buffer.from(JSON.stringify(source), "utf8").toString("base64") + apiKey)
    .digest("hex");
  const got = Buffer.from(sign.toLowerCase(), "hex");
  const want = Buffer.from(expected, "hex");
  if (got.length !== want.length) return false;
  return crypto.timingSafeEqual(got, want);
}

export { CRYPTO_ENABLED, CRYPTO_MERCHANT_ID, CRYPTO_INVOICE_TTL_SEC, CRYPTO_UNDERPAY_TOLERANCE_PCT };
