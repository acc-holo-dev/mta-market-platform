// PLAN-005 C-001/J-002: integration secrets. The server integration (the
// mta-market-module) proves control by possessing a secret issued by MTA
// Market; only the sha256 hash is stored. Review tokens are one-time,
// expiring, server-bound credentials shown to players once.
import crypto from "crypto";
import { db } from "../prisma/db";

export const INTEGRATION_TOKEN_PREFIX = "smk_"; // server integration key
export const REVIEW_TOKEN_PREFIX = "rtk_";

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function generateIntegrationToken(): string {
  return INTEGRATION_TOKEN_PREFIX + crypto.randomBytes(32).toString("hex");
}

export function generateReviewToken(): string {
  return REVIEW_TOKEN_PREFIX + crypto.randomBytes(24).toString("hex");
}

/**
 * Issues a review token bound to a server. Expiry defaults to 24h (J-002).
 * Returns the plaintext token (shown once) and the DB row id.
 */
export async function issueReviewToken(
  serverId: string,
  opts: { ttlMinutes?: number; note?: string | null } = {}
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const ttl = Math.min(Math.max(opts.ttlMinutes ?? 60 * 24, 5), 60 * 24 * 7);
  const token = generateReviewToken();
  const expiresAt = new Date(Date.now() + ttl * 60_000);
  const row = await db.orm.public.ServerReviewToken.create({
    serverId,
    tokenHash: sha256Hex(token),
    status: "ACTIVE",
    expiresAt: expiresAt.toISOString(),
    note: opts.note ?? null,
  });
  return { id: row.id, token, expiresAt };
}

/**
 * Resolves a claimed review token to its row. Enforces server binding,
 * expiry (re-checked here — the sweep is a background nicety) and one-time
 * consumption (replay protection) at the claim site.
 */
export type ReviewTokenLookup =
  | { kind: "active"; id: string; expiresAt: Date }
  | { kind: "replayed"; id: string; expiresAt: Date } // exists + bound, but consumed/expired
  | { kind: "unknown" }; // unknown hash or wrong-server binding

/**
 * Resolves a claimed review token. Enforces server binding, expiry
 * (re-checked here — the sweep is a background nicety) and one-time
 * consumption state so the claim site can answer 409 for replays vs 400
 * for unknown/wrong-server tokens.
 */
export async function findActiveReviewToken(
  token: string,
  serverId: string
): Promise<ReviewTokenLookup> {
  if (typeof token !== "string" || token.length < 16 || token.length > 80) {
    return { kind: "unknown" };
  }
  const row = await db.orm.public.ServerReviewToken.where({ tokenHash: sha256Hex(token) }).first();
  if (!row) return { kind: "unknown" };
  if (row.serverId !== serverId) return { kind: "unknown" }; // wrong-server binding
  if (row.status !== "ACTIVE") return { kind: "replayed", id: row.id, expiresAt: new Date(row.expiresAt) };
  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    return { kind: "replayed", id: row.id, expiresAt: new Date(row.expiresAt) };
  }
  return { kind: "active", id: row.id, expiresAt: new Date(row.expiresAt) };
}