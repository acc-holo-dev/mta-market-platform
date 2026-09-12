// Telegram Login Widget Identity Provider (PLAN-016 A-005)
// Direct-login mode: the widget posts a signed payload straight to the
// backend — no authorization-code redirect, no provider tokens. Transport
// authenticity is verified with the Telegram data-check-string HMAC
// (secret = SHA256(bot_token)), plus freshness and replay protection.
import crypto from "crypto";
import {
  IIdentityProviderWithDirectLogin,
  ProviderUser,
  ProviderTokens,
  AuthorizationRequest,
  AuthorizationResponse,
  CallbackRequest,
  DirectLoginRequest,
} from "../identityProvider.js";

/** auth_date must be within 24 h of the server clock. */
const FRESHNESS_WINDOW_SECONDS = 24 * 60 * 60;
/** How long a seen (user, auth_date) pair stays in the replay cache. */
const REPLAY_TTL_MS = 24 * 60 * 60 * 1000;
/** Hard cap on replay-cache entries (bounded memory). */
const REPLAY_MAX_ENTRIES = 10_000;

// Replay guard: "providerId:auth_date" -> first-seen timestamp (module-level).
const seenTelegramLogins = new Map<string, number>();

/** Drop entries older than the TTL and keep the cache under its size cap. */
function replaySweep(nowMs: number): void {
  for (const [key, seenAt] of seenTelegramLogins) {
    if (nowMs - seenAt > REPLAY_TTL_MS) {
      seenTelegramLogins.delete(key);
    }
  }
  if (seenTelegramLogins.size >= REPLAY_MAX_ENTRIES) {
    // Map preserves insertion order: drop the oldest entry before inserting.
    const oldest = seenTelegramLogins.keys().next();
    if (!oldest.done) {
      seenTelegramLogins.delete(oldest.value);
    }
  }
}

/**
 * Pure verification of a Telegram Login Widget payload against a bot token.
 * Throws on any invalid input (bad signature, stale auth_date, missing
 * fields); on success returns the mapped ProviderUser. Stateless — the
 * replay guard lives in TelegramProvider.verifyDirectLogin.
 */
export function verifyTelegramLoginPayload(
  payload: Record<string, unknown>,
  botToken: string,
  nowMs: number
): ProviderUser {
  if (!botToken) {
    throw new Error("Telegram bot token is not configured");
  }

  const id = payload.id;
  if (
    (typeof id !== "number" && typeof id !== "string") ||
    typeof id === "number" && !Number.isFinite(id) ||
    String(id).trim() === ""
  ) {
    throw new Error("Telegram login payload is missing user id");
  }

  const authDate =
    typeof payload.auth_date === "number"
      ? payload.auth_date
      : Number(payload.auth_date);
  if (!Number.isFinite(authDate)) {
    throw new Error("Telegram login payload is missing auth_date");
  }

  const hash = payload.hash;
  if (typeof hash !== "string" || hash.length === 0) {
    throw new Error("Telegram login payload is missing hash");
  }

  // data-check-string: every field except hash, sorted alphabetically,
  // "key=value" pairs joined with "\n" (Telegram Login Widget spec).
  const dataCheckString = Object.keys(payload)
    .filter((key) => key !== "hash" && payload[key] !== undefined && payload[key] !== null)
    .sort()
    .map((key) => `${key}=${String(payload[key])}`)
    .join("\n");

  // secret_key = SHA256(bot_token) digest bytes; HMAC-SHA256 over the
  // data-check-string, hex-encoded.
  const secretKey = crypto.createHash("sha256").update(botToken, "utf8").digest();
  const expected = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString, "utf8")
    .digest("hex");

  // Constant-time comparison (length-guarded so timingSafeEqual never throws).
  const provided = hash.toLowerCase();
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, providedBuf)
  ) {
    throw new Error("Telegram login signature mismatch");
  }

  // Freshness: reject payloads older (or further ahead) than 24 h.
  const nowSeconds = Math.floor(nowMs / 1000);
  if (Math.abs(nowSeconds - authDate) > FRESHNESS_WINDOW_SECONDS) {
    throw new Error("Telegram login expired");
  }

  const firstName = typeof payload.first_name === "string" ? payload.first_name : undefined;
  const lastName = typeof payload.last_name === "string" ? payload.last_name : undefined;
  const username = typeof payload.username === "string" ? payload.username : undefined;
  const photoUrl = typeof payload.photo_url === "string" ? payload.photo_url : undefined;
  const displayName = [firstName, lastName].filter(Boolean).join(" ") || undefined;

  return {
    providerId: String(id).trim(),
    // Telegram never exposes the user's email to the bot.
    email: undefined,
    username,
    displayName,
    avatar: photoUrl,
    verified: false,
    metadata: { raw: payload },
  };
}

export class TelegramProvider implements IIdentityProviderWithDirectLogin {
  readonly name = "telegram";
  readonly displayName = "Telegram";
  readonly mode = "direct" as const;

  /** Bot token read lazily so env can be set after module load (tests). */
  private get botToken() {
    return process.env.TELEGRAM_BOT_TOKEN || "";
  }

  /** Public bot username for the Login Widget (env-driven, may be empty). */
  get botName(): string {
    return process.env.TELEGRAM_BOT_NAME || "";
  }

  isEnabled(): boolean {
    return !!this.botToken;
  }

  /** Direct-login provider: the redirect URI is unused. */
  getRedirectUri(): string {
    return "";
  }

  getAuthorizationUrl(_request: AuthorizationRequest): AuthorizationResponse {
    throw new Error("Telegram uses direct login (Login Widget)");
  }

  async handleCallback(
    _request: CallbackRequest
  ): Promise<{ tokens: ProviderTokens; user: ProviderUser }> {
    throw new Error("Telegram Login Widget does not use code exchange");
  }

  async getUserInfo(_accessToken: string): Promise<ProviderUser> {
    throw new Error("Telegram does not expose an API token for user info");
  }

  async verifyDirectLogin(request: DirectLoginRequest): Promise<ProviderUser> {
    const nowMs = Date.now();
    const user = verifyTelegramLoginPayload(request.payload, this.botToken, nowMs);

    // Replay guard keyed by (user id, auth_date): the same widget payload
    // must never authenticate twice.
    const key = `${user.providerId}:${String(request.payload.auth_date)}`;
    if (seenTelegramLogins.has(key)) {
      throw new Error("Telegram login replay detected");
    }
    replaySweep(nowMs);
    seenTelegramLogins.set(key, nowMs);

    return user;
  }
}

import { identityProviders } from "../identityProvider.js";
identityProviders.register(new TelegramProvider());
