// PLAN-017 §44: SystemLog — what the application technically did.
// Separate from AuditLog (who changed what). Write path is fire-and-forget:
// a logging failure must never break or slow the request that produced it.
//
// Bounded retention (§44): entries are pruned opportunistically on ERROR
// writes — rows older than 14 days that fall outside the newest 5000 are
// removed with ONE bounded DELETE (subquery keeps the retention cap). The
// prune is best-effort: any failure is swallowed with a warning, never
// propagated into the request path.
import { db } from "../prisma/db.js";
import { logger } from "./logger.js";

export type SystemLogLevelValue = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface SystemLogEntry {
  level: SystemLogLevelValue;
  /** Producing surface: "api" | "worker" | <job-name>. */
  service: string;
  requestId?: string | null;
  route?: string | null;
  errorCode?: string | null;
  message: string;
  meta?: Record<string, unknown> | null;
}

/** Minimal request-ish shape (avoids a hard dependency on middleware types). */
export interface RequestLogContext {
  id?: string;
  originalUrl?: string;
  method?: string;
  user?: { userId?: string } | null;
}

const RETENTION_DAYS = 14;
const RETENTION_KEEP_LATEST = 5000;
/** One prune at a time — a burst of ERROR writes must not stack DELETEs. */
let pruneInFlight = false;

/**
 * Executes a raw plan on the root client. Mirrors the raw lane proven in
 * lib/ledger.ts (applySellerBalanceDelta): db.execute when present,
 * db.runtime().execute otherwise.
 */
async function executeRaw(plan: unknown): Promise<unknown[]> {
  const client = db as unknown as {
    execute?: (p: unknown) => Promise<unknown[]>;
    runtime?: () => { execute: (p: unknown) => Promise<unknown[]> };
  };
  if (typeof client.execute === "function") {
    return client.execute(plan);
  }
  if (typeof client.runtime === "function") {
    return client.runtime().execute(plan);
  }
  throw new Error("SystemLog: no raw executor available on db client");
}

/**
 * Retention: delete rows older than 14 days that are NOT among the newest
 * 5000. One statement, no parameters (threshold computed in-database), so a
 * burst of writes produces at most one bounded DELETE.
 */
async function pruneRetention(): Promise<void> {
  const plan = db.raw.sql`
    DELETE FROM "systemLog"
    WHERE "createdAt" < now() - (${RETENTION_DAYS} * interval '1 day')
      AND "id" NOT IN (
        SELECT "id" FROM "systemLog"
        ORDER BY "createdAt" DESC
        LIMIT ${RETENTION_KEEP_LATEST}
      )
    RETURNING "id"`
    .returnsRow({ id: "pg/text@1" })
    .build();
  await executeRaw(plan);
}

/**
 * Fire-and-forget system log write. Resolves when the insert is committed
 * (callers may await it in tests), but NEVER throws — a logging failure is
 * logged and dropped. ERROR-level writes opportunistically trigger the
 * bounded retention prune.
 */
export async function logSystem(entry: SystemLogEntry): Promise<void> {
  try {
    await db.orm.public.SystemLog.create({
      level: entry.level,
      service: entry.service,
      requestId: entry.requestId ?? null,
      route: entry.route ?? null,
      errorCode: entry.errorCode ?? null,
      message: entry.message,
      meta: (entry.meta ?? null) as never,
    });
  } catch (error) {
    logger.error("system_log_write_failed", { error, message: entry.message });
    return;
  }

  if (entry.level !== "ERROR" || pruneInFlight) return;
  pruneInFlight = true;
  try {
    await pruneRetention();
  } catch (error) {
    // Retention is opportunistic — degraded pruning is not an API failure.
    logger.warn("system_log_prune_failed", { error });
  } finally {
    pruneInFlight = false;
  }
}

/**
 * §37: error-path helper for admin platform routes. Express 4 does NOT catch
 * async handler rejections, and the global error handler wiring belongs to a
 * later wave — route catch blocks call this to mirror the failure into
 * SystemLog (ERROR) with request context. Never throws.
 */
export function logUnhandled(
  error: unknown,
  context: { req?: RequestLogContext; route?: string; service?: string; errorCode?: string } = {}
): void {
  const req = context.req;
  const errorName = error instanceof Error ? error.name : typeof error;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack.slice(0, 1024) : null;
  const message = errorMessage
    ? `Unhandled error: ${errorName}: ${errorMessage}`.slice(0, 512)
    : `Unhandled error: ${errorName}`.slice(0, 512);
  void logSystem({
    level: "ERROR",
    service: context.service ?? "api",
    requestId: req?.id ?? null,
    route: context.route ?? req?.originalUrl?.split("?")[0] ?? null,
    errorCode: context.errorCode ?? "UNHANDLED_ERROR",
    message,
    meta: {
      method: req?.method ?? null,
      userId: req?.user?.userId ?? null,
      errorName,
      stack,
    },
  });
}