// PLAN-016 A-009: OAuth provider tokens at rest — AES-256-GCM.
//
// Stored provider tokens (Account.accessToken/refreshToken/idToken) are
// encrypted at rest with a deployment key (OAUTH_TOKEN_ENCRYPTION_KEY, 32
// bytes base64). Ciphertext format: "v1:<ivB64>:<tagB64>:<ctB64>" so reads
// stay tolerant of legacy plaintext rows (they are re-encrypted on the next
// provider token refresh, idempotently). Plaintext is never logged.
import crypto from "crypto";
import { db } from "../prisma/db.js";

const PREFIX = "v1";

function readKey(): Buffer | null {
  const raw = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const key = Buffer.from(raw, "base64");
    return key.length === 32 ? key : null;
  } catch {
    return null;
  }
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** True when the stored value carries the v1 encryption envelope. */
export function isEncryptedProviderToken(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

/**
 * Encrypt for storage. When the deployment key is absent (local dev without
 * OAUTH_TOKEN_ENCRYPTION_KEY) the plaintext is stored as-is — dev honesty,
 * production startupValidation requires the key when OAuth providers exist.
 * Null passthrough.
 */
export function encryptProviderToken(plain: string | null | undefined): string | null {
  if (!validText(plain)) return null;
  const key = readKey();
  if (!key) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/** Decrypt for reading; legacy plaintext passes through untouched. */
export function decryptProviderToken(stored: string | null | undefined): string | null {
  if (!validText(stored)) return null;
  if (!isEncryptedProviderToken(stored)) return stored; // legacy plaintext
  const parts = stored.split(":");
  if (parts.length !== 4) return null;
  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ct = Buffer.from(parts[3], "base64");
    const key = readKey();
    if (!key) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * PLAN-016 A-009: idempotent startup sweep — re-encrypt legacy plaintext
 * provider tokens still stored from before the encryption rollout. Runs only
 * when the deployment key exists (dev without the key stays plaintext by
 * design); a clean deployment re-reads the same rows and converges to a
 * no-op. Decryption itself stays exclusively in the provider token-reading
 * path (refresh), per AUTH.md.
 */
export async function sweepLegacyStoredTokens(): Promise<{ encrypted: number }> {
  const key = readKey();
  if (!key) return { encrypted: 0 };
  // Account rows ARE OAuth identity rows (local passwords live on User), so
  // the table is bounded by linked identities; tokens for local-only users
  // do not exist.
  const accounts = await db.orm.public.Account.all();
  let encrypted = 0;
  for (const account of accounts) {
    const updates: Record<string, string | null> = {};
    if (validText(account.accessToken) && !isEncryptedProviderToken(account.accessToken)) {
      updates.accessToken = encryptProviderToken(account.accessToken);
    }
    if (validText(account.refreshToken) && !isEncryptedProviderToken(account.refreshToken)) {
      updates.refreshToken = encryptProviderToken(account.refreshToken);
    }
    if (validText(account.idToken) && !isEncryptedProviderToken(account.idToken)) {
      updates.idToken = encryptProviderToken(account.idToken);
    }
    if (Object.keys(updates).length === 0) continue;
    await db.orm.public.Account.where({ id: account.id }).update(updates);
    encrypted += 1;
  }
  return { encrypted };
}