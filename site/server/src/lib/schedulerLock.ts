// PLAN-020 F-004: cross-instance scheduler lock.
//
// The worker schedulers (reconciliation, monitoring, sweeps, retention) are
// single-flight per process (startIntervalJob) but not across instances: two
// replicas would duplicate reconciliation reports and sweeps. This primitive
// serializes a job across instances with a transaction-scoped Postgres
// advisory lock:
//   - `pg_try_advisory_xact_lock(hashtext(key))` is acquired inside a
//     transaction (same raw-lane pattern as lib/refunds.ts);
//   - the transaction is held OPEN for the duration of the job body, so the
//     lock lives exactly as long as the work: auto-released on commit and by
//     the server if the process dies — no stale-lock recovery needed;
//   - a replica that loses the race SKIPS the tick. Schedulers are periodic,
//     so skipping a tick is always safe; nothing is queued or lost.
//
// The lock only decides WHO runs the tick; the job body keeps using the root
// client (pooled connections) exactly as before.
import { db } from "../prisma/db.js";
import { logger } from "./logger.js";

export type SchedulerLockOutcome = "acquired" | "skipped";

export async function runUnderSchedulerLock(
  key: string,
  run: () => Promise<unknown>
): Promise<SchedulerLockOutcome> {
  let outcome: SchedulerLockOutcome = "skipped";
  try {
    await db.transaction(async (tx) => {
      // A transaction context carries execute() directly (lib/ledger.ts):
      // the plan rides the tx connection, which is what owns the lock.
      // execute() reports {affectedRows}: the SELECT yields exactly one row
      // when the try-lock succeeded and zero rows when another replica
      // holds the lock — that count is the acquisition signal.
      const plan = db.raw.sql
        `SELECT 1 AS locked WHERE pg_try_advisory_xact_lock(hashtext(${key}))`
        .returnsRow({ locked: "pg/int4@1" })
        .build();
      const result = (await (tx as unknown as { execute: (p: unknown) => Promise<unknown> }).execute(
        plan
      )) as { affectedRows?: number };
      if (!result || result.affectedRows !== 1) {
        logger.info("scheduler_lock_busy", { key });
        return;
      }
      outcome = "acquired";
      await run();
    });
  } catch (error) {
    // Surface to the caller (startIntervalJob logs and keeps the interval
    // alive). The rolled-back transaction already released the lock.
    logger.error("scheduler_lock_job_failed", { key, error });
    throw error;
  }
  return outcome;
}
