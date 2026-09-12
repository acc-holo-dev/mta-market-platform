// PLAN-019 H-001/H-002: canonical domain events + transactional outbox.
//
// The outbox pattern in one sentence: an event is an INSERT into outboxEvent
// performed in the SAME database transaction as the domain action it
// describes, so nothing can ever publish before the primary action commits
// (and a rolled-back action leaves no event). The worker runtime
// (src/worker/index.ts) claims PENDING rows and dispatches them to handlers.
//
// Semantics implemented here (H-005):
//   - claimBatch claims PENDING -> PROCESSING with attempts+1 via CAS
//     (updateAndCount applies the FULL where predicate — see the identical
//     lesson in lib/discount.ts / lib/commerce.ts; plain update() ignores
//     non-key where fields in this ORM). Honest scale note: with one worker
//     instance the CAS loop is safe enough; two racing workers still cannot
//     double-claim a row, they only duplicate a candidate read.
//   - completeEvent: PROCESSING -> PROCESSED (acknowledged).
//   - failEvent: PROCESSING -> PENDING with availableAt = now + backoff
//     while attempts < maxAttempts; at maxAttempts the row stays FAILED —
//     a dead-letter. claimBatch never touches FAILED/PENDING-beyond-cap
//     rows, so retries are finite by construction (no infinite loop).
//
// The backoff curve is 2^attempts * 30s (30s, 60s, 120s, 240s, 480s for
// attempts 1..4 with the default cap of 5).
import { db } from "../prisma/db.js";
import { logger } from "./logger.js";

/** Canonical event types (H-001). Handlers land with their owning domains. */
export const OUTBOX_EVENT_TYPES = [
  "USER_REGISTERED",
  "RESOURCE_PUBLISHED",
  "RESOURCE_VERSION_PUBLISHED",
  "PAYMENT_SUCCEEDED",
  "PAYMENT_FAILED",
  "REFUND_COMPLETED",
  "PAYOUT_COMPLETED",
  "DISPUTE_OPENED",
  "DISPUTE_UPDATED",
  "LICENSE_EXPIRING",
  "SECURITY_ALERT",
] as const;

export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set<string>(OUTBOX_EVENT_TYPES);

/** Default retry cap (H-005): attempt 5 that fails stays FAILED forever. */
export const DEFAULT_MAX_ATTEMPTS = 5;

/** Backoff base: availableAt = now + 2^attempts * 30s. */
const BACKOFF_BASE_MS = 30_000;

/**
 * Retry backoff for a failed attempt (attempts is the post-claim count:
 * 1 after the first claim). Clamped to [1, 20] so a misconfigured maxAttempts
 * can never produce a NaN/negative/overflow delay.
 */
export function outboxBackoffMs(attempts: number): number {
  const exponent = Math.min(Math.max(attempts, 1), 20);
  return 2 ** exponent * BACKOFF_BASE_MS;
}

export function isKnownOutboxEventType(eventType: string): boolean {
  return KNOWN_EVENT_TYPES.has(eventType);
}

/** Event-name validation against the canonical union — unknown names throw. */
export function assertKnownOutboxEventType(eventType: string): void {
  if (!KNOWN_EVENT_TYPES.has(eventType)) {
    throw new Error(
      `emitOutbox: unknown event type "${eventType}" (allowed: ${OUTBOX_EVENT_TYPES.join(", ")})`
    );
  }
}

/**
 * Minimal transaction handle type (db or a db.transaction() callback) —
 * mirrors lib/ledger.ts DbOrTx so emitOutbox can ride the caller's
 * transaction.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbOrTx = any;

/** Normalize the affected-row result of updateAndCount()-style returns
 * (mirrors lib/ledger.ts affectedCount; kept local so this module's
 * dependency surface stays db+logger only). */
function affectedCount(result: unknown): number {
  if (typeof result === "number") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    for (const key of ["affectedCount", "count", "updated", "affected"]) {
      if (typeof r[key] === "number") return r[key];
    }
  }
  return 0;
}

/**
 * H-002: emit a canonical domain event by inserting an OutboxEvent row
 * (status PENDING) in the SAME transaction as the domain action.
 *
 * Pass the transaction handle (`tx`) from a db.transaction() callback to get
 * the atomic all-or-nothing behavior; passing the root `db` inserts
 * autonomously (only for actions that have no transaction of their own).
 * Publishing-before-commit is structurally impossible here: the event row is
 * just part of the caller's transaction and commits (or rolls back) with it.
 */
export async function emitOutbox(
  dbOrTx: DbOrTx = db,
  eventType: OutboxEventType,
  payload: Record<string, unknown>
): Promise<{ id: string }> {
  assertKnownOutboxEventType(eventType);
  const created = await dbOrTx.orm.public.OutboxEvent.create({
    eventType,
    payload: payload as never,
    status: "PENDING",
  });
  return { id: created.id };
}

/** An event as handed to the worker dispatch loop after a successful claim. */
export interface ClaimedEvent {
  id: string;
  eventType: string;
  payload: Record<string, unknown>;
  /** Attempt counter AFTER the claim increment (1 for the first delivery). */
  attempts: number;
}

export interface ClaimBatchOptions {
  /** Maximum events claimed per call (default 10). */
  limit?: number;
  /**
   * Retry cap (default 5): PENDING rows whose attempts already reached the
   * cap are never claimed again — they can only be dead-lettered by a final
   * delivery pass, which keeps H-005 (finite retries) honest even if a row
   * was requeued manually.
   */
  maxAttempts?: number;
}

/**
 * Claim up to `limit` due PENDING events: each row is transitioned
 * PENDING -> PROCESSING with attempts+1 by a CAS update (full where
 * predicate), so a row concurrently claimed elsewhere is skipped, never
 * double-processed. Events whose availableAt is still in the future (retry
 * backoff) are not visible to the claim.
 *
 * Honest note (single-worker topology, PLAN-019 H): candidates are read then
 * claimed row-by-row; with several workers this only wastes a candidate
 * read on a lost race, it cannot double-claim or double-increment.
 */
export async function claimBatch(
  dbOrTx: DbOrTx = db,
  options: ClaimBatchOptions = {}
): Promise<ClaimedEvent[]> {
  const limit = Math.max(1, options.limit ?? 10);
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const now = new Date();

  const candidates = await dbOrTx.orm.public.OutboxEvent
    .where({ status: "PENDING" })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where((e: any) => e.availableAt.lte(now.toISOString()))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .where((e: any) => e.attempts.lt(maxAttempts))
    .orderBy((e: { createdAt: { asc(): unknown } }) => e.createdAt.asc())
    .limit(limit)
    .all();

  const claimed: ClaimedEvent[] = [];
  for (const candidate of candidates) {
    const currentAttempts = Number(candidate.attempts ?? 0);
    const cas = await dbOrTx.orm.public.OutboxEvent
      .where({ id: candidate.id, status: "PENDING", attempts: currentAttempts })
      .updateAndCount({
        status: "PROCESSING",
        attempts: currentAttempts + 1,
      });
    if (affectedCount(cas) !== 1) {
      continue; // lost the claim race — another worker owns the row now
    }
    claimed.push({
      id: candidate.id,
      eventType: candidate.eventType,
      payload: (candidate.payload ?? {}) as Record<string, unknown>,
      attempts: currentAttempts + 1,
    });
  }
  return claimed;
}

/**
 * Acknowledge a claimed event: PROCESSING -> PROCESSED with processedAt.
 * CAS-guarded (a row already requeued/completed by someone else updates 0
 * rows). Returns true when this call performed the transition.
 */
export async function completeEvent(id: string): Promise<boolean> {
  const result = await db.orm.public.OutboxEvent
    .where({ id, status: "PROCESSING" })
    .updateAndCount({ status: "PROCESSED", processedAt: new Date().toISOString() });
  return affectedCount(result) === 1;
}

/** What failEvent decided for a claimed event. */
export type FailOutcome =
  | "RETRY" // requeued PENDING with a future availableAt (backoff)
  | "DEAD_LETTER" // attempts reached the cap — row stays FAILED (H-005)
  | "NOT_CLAIMED"; // row was not in PROCESSING state (already handled elsewhere)

/**
 * Record a handler failure for a claimed event. With attempts < maxAttempts
 * the row goes back to PENDING with availableAt = now + backoff(attempts);
 * at maxAttempts it stays FAILED — the dead-letter. A FAILED row is never
 * claimed again by claimBatch, so delivery attempts are finite (H-005).
 */
export async function failEvent(
  id: string,
  error: unknown,
  options: { retryBackoffMs?: number; maxAttempts?: number } = {}
): Promise<FailOutcome> {
  const event = await db.orm.public.OutboxEvent.where({ id }).first();
  if (!event || event.status !== "PROCESSING") {
    return "NOT_CLAIMED";
  }
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1024);

  if (Number(event.attempts ?? 0) >= maxAttempts) {
    await db.orm.public.OutboxEvent
      .where({ id, status: "PROCESSING" })
      .updateAndCount({ status: "FAILED", lastError });
    logger.error("outbox_event_dead_letter", { event_id: id, attempts: event.attempts });
    return "DEAD_LETTER";
  }

  const delayMs = Math.max(0, options.retryBackoffMs ?? outboxBackoffMs(Number(event.attempts)));
  const availableAt = new Date(Date.now() + delayMs);
  await db.orm.public.OutboxEvent
    .where({ id, status: "PROCESSING" })
    .updateAndCount({
      status: "PENDING",
      lastError,
      availableAt: availableAt.toISOString(),
    });
  logger.warn("outbox_event_retry_scheduled", {
    event_id: id,
    attempts: event.attempts,
    retry_in_ms: delayMs,
  });
  return "RETRY";
}