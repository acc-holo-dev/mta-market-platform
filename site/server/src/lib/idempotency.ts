// PLAN-012 В§5: durable, database-backed idempotency for financially
// significant mutations (checkout, payment creation, payment simulation,
// refunds).
//
// Contract (documents/api/COMMERCE.md, PLAN-012 В§5):
//   same key + same operation + same payload  -> replay the stored outcome;
//   same key + same operation + other payload -> deterministic rejection
//                                                (idempotency_key_conflict);
//   a repeated HTTP request never creates a second financial entity.
//
// The unique [operation, key] pair on IdempotencyRecord is the database
// invariant: two backend instances racing the same retried request cannot
// both claim the key. Records carry the captured HTTP response so a retry
// (after timeout, process restart, or provider retry) returns the ORIGINAL
// outcome instead of re-executing the mutation.
//
// The mechanism is optional per request: clients that do not send an
// Idempotency-Key keep the historical behaviour; the server-side invariants
// (partial unique indexes, CAS transitions) remain the hard guarantees.
import crypto from "crypto";
import { Request, Response } from "express";
import { db } from "../prisma/db.js";
import { isUniqueViolation } from "./dbErrors.js";
import { reqLog } from "../middleware/requestId.js";

const DEFAULT_TTL_HOURS = 24;
const MAX_KEY_LENGTH = 128;

export class IdempotencyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "IdempotencyError";
  }
}

type JsonRecord = Record<string, unknown>;

/** Minimal request shape (AuthRequest carries `user`; both work). */
type IdempotencyRequest = Request & { user?: { userId?: string } | undefined };

/** Extract and normalize the Idempotency-Key header (null when absent). */
export function idempotencyKeyOf(req: IdempotencyRequest): string | null {
  const raw = req.headers["idempotency-key"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!key || key.length > MAX_KEY_LENGTH) return null;
  return key;
}

function requestHashOf(req: IdempotencyRequest): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(req.body ?? {}))
    .digest("hex");
}

function isExpired(record: { expiresAt: string | null }): boolean {
  return record.expiresAt != null && new Date(record.expiresAt) < new Date();
}

async function deleteRecord(id: string): Promise<void> {
  await db.orm.public.IdempotencyRecord.where({ id }).delete().catch(() => undefined);
}

/**
 * Wrap a mutating route handler with DB-backed idempotency.
 *
 * - No Idempotency-Key header -> the handler runs as before.
 * - COMPLETED record + same hash -> replay the stored response.
 * - PROCESSING record (parallel/retrying instance) -> 409 idempotency_in_progress.
 * - Same key + different payload -> 409 idempotency_key_conflict.
 * - FAILED record -> the handler re-executes (the caller may retry).
 */
export function withIdempotency<T extends IdempotencyRequest>(
  operation: string,
  handler: (req: T, res: Response) => Promise<void>
): (req: T, res: Response) => Promise<void> {
  return async (req: T, res: Response) => {
    const key = idempotencyKeyOf(req);
    if (!key) {
      return handler(req, res);
    }
    const requestHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(req.body ?? {}))
      .digest("hex");
    const userId = req.user?.userId ?? null;

    const existing = await db.orm.public.IdempotencyRecord
      .where({ operation, key })
      .first();
    if (existing) {
      if (isExpired(existing)) {
        await deleteRecord(existing.id); // lazy GC of stale records
      } else if (existing.requestHash !== requestHash) {
        // Express 4 cannot catch async-wrapper rejections: every wrapper
        // outcome answers the response itself instead of throwing.
        res.status(409).json({
          error: "This Idempotency-Key was already used with a different payload",
          code: "idempotency_key_conflict",
        });
        return;
      } else if (existing.status === "COMPLETED" && existing.responseStatus != null) {
        res.status(existing.responseStatus).json(
          (existing.responseBody as JsonRecord | null) ?? {}
        );
        return;
      } else if (existing.status === "PROCESSING") {
        res.status(409).json({
          error: "A request with this Idempotency-Key is currently in progress",
          code: "idempotency_in_progress",
        });
        return;
      }
      // FAILED records fall through: the handler re-executes.
    }

    let recordId: string;
    try {
      const created = await db.orm.public.IdempotencyRecord.create({
        operation,
        key,
        userId,
        requestHash,
        status: "PROCESSING",
        expiresAt: new Date(Date.now() + DEFAULT_TTL_HOURS * 60 * 60 * 1000).toISOString(),
      });
      recordId = created.id;
    } catch (error) {
      if (isUniqueViolation(error, "idempotencyRecord_operation_key_key")) {
        // A parallel request (possibly on another instance) claimed the key
        // between our read and our insert: deterministically refuse instead
        // of double-executing.
        res.status(409).json({
          error: "A request with this Idempotency-Key is currently in progress",
          code: "idempotency_in_progress",
        });
        return;
      }
      throw error;
    }

    // Capture the handler's response so a same-key retry replays it.
    const responseCapture: { responded: boolean; status: number; body: unknown } = {
      responded: false,
      status: 200,
      body: null,
    };
    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);
    res.status = ((code: number) => {
      responseCapture.status = code;
      return originalStatus(code);
    }) as typeof res.status;
    res.json = ((body: unknown) => {
      responseCapture.responded = true;
      responseCapture.body = body;
      return originalJson(body);
    }) as typeof res.json;

    try {
      await handler(req, res);
    } catch (error) {
      await db.orm.public.IdempotencyRecord
        .where({ id: recordId })
        .update({ status: "FAILED" })
        .catch(() => undefined);
      // Handler errors keep flowing to the route's own error handling when
      // it exists; when the error escaped the handler (headers not sent),
      // the wrapper answers 500 itself — express 4 leaves async rejections
      // unanswered, which would hang the client.
      if (isIdempotencyError(error)) {
        if (!res.headersSent) {
          res.status(error.status).json({ error: error.message, code: error.code });
        }
        return;
      }
      if (!res.headersSent) {
        reqLog(req).error("idempotency_handler_failed", { error, operation });
        res.status(500).json({ error: "Internal server error" });
      }
      return;
    }

    if (responseCapture.responded) {
      // Responses are stored as plain JSON so a replay is byte-stable;
      // JSON round-trip normalizes non-JSON values (Date, undefined...).
      // The codec input type is the contract's recursive JsonValue; any
      // JSON.parse result satisfies it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const storedBody: any = responseCapture.body == null
        ? {}
        : JSON.parse(JSON.stringify(responseCapture.body));
      await db.orm.public.IdempotencyRecord
        .where({ id: recordId })
        .update({
          status: "COMPLETED",
          responseStatus: responseCapture.status,
          responseBody: storedBody,
        })
        .catch((error) => {
          reqLog(req).error("idempotency_response_store_failed", { error, operation });
        });
    } else {
      // The handler answered without res.json (e.g. ended the response
      // directly) — the record cannot be replayed; drop it so a retry
      // re-executes instead of hanging on PROCESSING.
      await deleteRecord(recordId);
    }
  };
}

/** Error-type guard for route-level error handlers. */
export function isIdempotencyError(error: unknown): error is IdempotencyError {
  return error instanceof IdempotencyError;
}
