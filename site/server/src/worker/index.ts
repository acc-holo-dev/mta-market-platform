// PLAN-019 H-003/H-004/H-005: worker runtime.
//
// The API server (src/index.ts) no longer starts background jobs — the
// schedulers moved here so a single-container deployment can scale the
// HTTP surface and the background work independently:
//
//   - outbox consumer (H-003): poll outboxEvent on WORKER_POLL_INTERVAL_MS,
//     claim a batch (lib/events.claimBatch, CAS PENDING -> PROCESSING),
//     dispatch each event to its handler, then completeEvent/failEvent per
//     outcome. Retry/backoff/dead-letter semantics live in lib/events.ts;
//     failures are logged via the structured logger AND SystemLog.
//   - reconciliation cycle (moved from src/index.ts; the run-once function
//     in jobs/reconciliation.ts is reused, not rewritten).
//   - server monitoring sweep (moved from src/index.ts; lib/serverMonitoring
//     .runMonitoringSweep).
//   - demo sweep + price-alert sweep: their domain libs (lib/demo.ts,
//     lib/priceAlerts.ts) land with later waves. They are wired through
//     dynamic imports with try/catch, so a missing lib degrades to an
//     honest "handler_missing" log instead of crashing the worker.
//
// Graceful shutdown (H-004): SIGTERM/SIGINT stop polling and the schedulers,
// finish the current event, hand not-yet-dispatched claimed rows back to
// PENDING, then close db/redis. A hard kill (no signal) can still orphan
// PROCESSING rows; the boot-time reclaim pass requeues them (safe under the
// single-worker topology this runtime assumes — see lib/events.ts).
//
// Env:
//   WORKER_POLL_INTERVAL_MS      outbox idle poll interval (default 5000)
//   WORKER_CLAIM_LIMIT           max events claimed per poll (default 10)
//   WORKER_MAX_ATTEMPTS          dead-letter cap (default 5, H-005)
//   RECONCILIATION_INTERVAL_MS / RECONCILIATION_INITIAL_DELAY_MS /
//     RECONCILIATION_ENABLED     reconciliation scheduler (defaults as in
//                                jobs/reconciliation.ts)
//   SERVER_MONITORING_ENABLED=false / SERVER_MONITORING_INTERVAL_MS (60000)
//   DEMO_SWEEP_ENABLED=false     / DEMO_SWEEP_INTERVAL_MS (60000)
//   PRICE_ALERT_SWEEP_ENABLED=false / PRICE_ALERT_SWEEP_INTERVAL_MS (300000)
//   RETENTION_ENABLED=false      / RETENTION_INTERVAL_MS (daily) — PLAN-020
//     E-005 retention sweep; window knobs: OUTBOX_RETENTION_DAYS (14),
//     OUTBOX_FAILED_RETENTION_DAYS (30), RECONCILIATION_RETENTION_DAYS (90),
//     PROVIDER_EVENT_RETENTION_DAYS (90), SANDBOX_RUN_RETENTION_DAYS (30).
//
// Contract for the optional domain libs (dynamic, crash-safe):
//   lib/demo.ts         -> export async function sweepDemos(): Promise<unknown>
//   lib/priceAlerts.ts  -> export async function notifyVersionReleases(
//                            resourceId: string,
//                            version: { id, version, changelog? }): Promise<unknown>
//                          (plus its own CRON sweeps notifyPriceDrops /
//                           notifyDiscountStarts / sweepRecentVersionReleases)
import dotenv from "dotenv";

dotenv.config();

import { enforceEnvironmentValidation } from "../lib/startupValidation.js";
import { db } from "../prisma/db.js";
import { logger } from "../lib/logger.js";
import { logSystem } from "../lib/systemLog.js";
import {
  claimBatch,
  completeEvent,
  failEvent,
  pruneFinishedOutboxEvents,
  type ClaimedEvent,
} from "../lib/events.js";
import { runReconciliationCycle } from "../jobs/reconciliation.js";
import { runMonitoringSweep } from "../lib/serverMonitoring.js";
import { runUnderSchedulerLock } from "../lib/schedulerLock.js";

const SERVICE = "worker";

// Dynamic import targets are non-literal specifiers on purpose: the modules
// are owned by other waves and may not exist yet, and a static import would
// fail the type-check before they land.
const PRICE_ALERTS_PATH = "../lib/priceAlerts.js";
const DEMO_PATH = "../lib/demo.js";

interface PriceAlertsModule {
  notifyVersionReleases?: (
    resourceId: string,
    version: { id: string; version: string; changelog?: string | null }
  ) => Promise<unknown>;
  notifyPriceDrops?: () => Promise<unknown>;
  notifyDiscountStarts?: () => Promise<unknown>;
  sweepRecentVersionReleases?: () => Promise<unknown>;
}

interface DemoModule {
  sweepDemos?: () => Promise<unknown>;
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const POLL_INTERVAL_MS = positiveIntEnv("WORKER_POLL_INTERVAL_MS", 5_000);
const CLAIM_LIMIT = positiveIntEnv("WORKER_CLAIM_LIMIT", 10);
const MAX_ATTEMPTS = positiveIntEnv("WORKER_MAX_ATTEMPTS", 5);

/** Loaded once at boot; null = absent (another agent's wave owns it). */
let priceAlertsModule: PriceAlertsModule | null = null;
let demoModule: DemoModule | null = null;

/** Crash-safe dynamic import for optional domain modules. */
async function loadOptionalModule<T>(
  specifier: string,
  label: string
): Promise<T | null> {
  try {
    return (await import(/* @vite-ignore */ specifier)) as T;
  } catch (error) {
    logger.warn("worker_handler_missing", {
      module: label,
      expected: "module will be wired when its wave lands",
      error,
    });
    return null;
  }
}

/** Single-flight interval job (mirrors the scheduler pattern in jobs/*). */
interface JobHandle {
  name: string;
  stop: () => void;
}

function startIntervalJob(options: {
  name: string;
  enabled: boolean;
  intervalMs: number;
  initialDelayMs: number;
  run: () => Promise<unknown>;
}): JobHandle {
  if (!options.enabled) {
    logger.info("worker_job_disabled", { job: options.name });
    return { name: options.name, stop: () => undefined };
  }
  let stopped = false;
  let running = false;
  const tick = (): void => {
    if (stopped || running) return;
    running = true;
    void (async () => {
      try {
        await options.run();
      } catch (error) {
        logger.error("worker_job_failed", { job: options.name, error });
      } finally {
        running = false;
      }
    })();
  };
  const initialTimer = setTimeout(tick, options.initialDelayMs);
  const intervalTimer = setInterval(tick, options.intervalMs);
  logger.info("worker_job_started", {
    job: options.name,
    interval_ms: options.intervalMs,
    initial_delay_ms: options.initialDelayMs,
  });
  return {
    name: options.name,
    stop: () => {
      stopped = true;
      clearTimeout(initialTimer);
      clearInterval(intervalTimer);
    },
  };
}

// --- shutdown coordination -------------------------------------------------

let stopping = false;
let wake: (() => void) | null = null;

/** Interruptible sleep: shutdown wakes the idle poll immediately. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = null;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
  });
}

/**
 * A hard kill between claim and complete would leave rows stuck in
 * PROCESSING forever (claimBatch only picks PENDING). Under the documented
 * single-worker topology, any PROCESSING row found at boot was orphaned by
 * the previous process — hand it back to PENDING. Graceful shutdown never
 * needs this (it requeues in-process).
 */
async function reclaimOrphanedProcessing(): Promise<number> {
  const orphans = await db.orm.public.OutboxEvent.where({ status: "PROCESSING" }).all();
  let reclaimed = 0;
  for (const row of orphans) {
    const cas = await db.orm.public.OutboxEvent
      .where({ id: row.id, status: "PROCESSING" })
      .updateAndCount({ status: "PENDING" })
      .catch(() => null);
    if (cas !== null) reclaimed += 1;
  }
  if (reclaimed > 0) {
    logger.warn("worker_outbox_reclaimed_orphans", { count: reclaimed });
    void logSystem({
      level: "WARN",
      service: SERVICE,
      errorCode: "OUTBOX_ORPHAN_RECLAIM",
      message: `reclaimed ${reclaimed} orphaned PROCESSING outbox event(s) at boot`,
      meta: { reclaimed },
    });
  }
  return reclaimed;
}

/** Hand one claimed-but-not-dispatched row back to PENDING. */
async function requeueClaimed(event: ClaimedEvent): Promise<void> {
  try {
    await db.orm.public.OutboxEvent
      .where({ id: event.id, status: "PROCESSING" })
      .updateAndCount({ status: "PENDING" });
  } catch (error) {
    // The row stays PROCESSING; the next boot's reclaim pass retries it.
    logger.error("worker_requeue_failed", { event_id: event.id, error });
  }
}

// --- event dispatch ---------------------------------------------------------

async function dispatchEvent(event: ClaimedEvent): Promise<void> {
  try {
    switch (event.eventType) {
      case "RESOURCE_VERSION_PUBLISHED": {
        const notify = priceAlertsModule?.notifyVersionReleases;
        if (typeof notify !== "function") {
          // Honest absence (H-004): lib/priceAlerts.ts has not landed yet.
          // The transport is the deliverable — record the miss loudly and
          // acknowledge the event rather than retry-spinning a handler that
          // does not exist.
          logger.warn("worker_handler_missing", {
            event_id: event.id,
            event_type: event.eventType,
            module: "lib/priceAlerts.ts",
            expected_export: "notifyVersionReleases",
          });
          void logSystem({
            level: "WARN",
            service: SERVICE,
            errorCode: "HANDLER_MISSING",
            message: `no handler wired for ${event.eventType}; event acknowledged without delivery`,
            meta: { eventId: event.id, eventType: event.eventType },
          });
          await completeEvent(event.id);
          return;
        }
        // Producer contract: { resourceId, versionId, version, changelog? }.
        // A malformed payload is a producer bug — throw so the event goes
        // through retry/backoff and dead-letters for inspection (H-005)
        // instead of being silently acknowledged.
        const resourceId =
          typeof event.payload.resourceId === "string" ? event.payload.resourceId : null;
        const versionId =
          typeof event.payload.versionId === "string" ? event.payload.versionId : null;
        const version =
          typeof event.payload.version === "string" ? event.payload.version : null;
        if (!resourceId || !versionId || !version) {
          throw new Error(
            `RESOURCE_VERSION_PUBLISHED payload missing resourceId/versionId/version (keys: ${Object.keys(event.payload).join(", ")})`
          );
        }
        const notified = await notify(resourceId, {
          id: versionId,
          version,
          changelog:
            typeof event.payload.changelog === "string" ? event.payload.changelog : null,
        });
        logger.info("worker_event_handled", {
          event_id: event.id,
          event_type: event.eventType,
          attempts: event.attempts,
          notified,
        });
        await completeEvent(event.id);
        return;
      }
      default: {
        // Handlers land with their owning domains (H-002 adoption is
        // progressive). The transport is the deliverable: observe + ACK.
        logger.info("worker_event_acknowledged", {
          event_id: event.id,
          event_type: event.eventType,
          attempts: event.attempts,
        });
        void logSystem({
          level: "INFO",
          service: SERVICE,
          message: `outbox event ${event.eventType} observed (no handler wired yet)`,
          meta: { eventId: event.id, eventType: event.eventType },
        });
        await completeEvent(event.id);
      }
    }
  } catch (error) {
    logger.error("worker_event_failed", {
      event_id: event.id,
      event_type: event.eventType,
      error,
    });
    const outcome = await failEvent(event.id, error, { maxAttempts: MAX_ATTEMPTS })
      .catch(() => "NOT_CLAIMED" as const);
    if (outcome === "DEAD_LETTER") {
      void logSystem({
        level: "ERROR",
        service: SERVICE,
        errorCode: "OUTBOX_DEAD_LETTER",
        message: `outbox event ${event.eventType} dead-lettered after ${event.attempts} attempts`,
        meta: { eventId: event.id, eventType: event.eventType, attempts: event.attempts },
      });
    }
  }
}

/**
 * Outbox consumer loop: claim -> dispatch -> ack/fail. Drains back-to-back
 * while events are available, then idles on WORKER_POLL_INTERVAL_MS.
 */
async function runOutboxLoop(): Promise<void> {
  while (!stopping) {
    let claimed: ClaimedEvent[] = [];
    try {
      claimed = await claimBatch(db, { limit: CLAIM_LIMIT, maxAttempts: MAX_ATTEMPTS });
      for (const event of claimed) {
        if (stopping) {
          // Graceful shutdown mid-batch: finish the current event, hand the
          // remaining claimed rows back so nothing is stranded PROCESSING.
          await requeueClaimed(event);
          continue;
        }
        await dispatchEvent(event);
      }
    } catch (error) {
      logger.error("worker_outbox_poll_failed", { error });
    }
    if (stopping) break;
    if (claimed.length === 0) {
      await sleep(POLL_INTERVAL_MS);
    }
    // Events were processed: loop immediately to drain the backlog.
  }
}

/**
 * PLAN-020 E-005: the retention sweep body (run under the F-004
 * cross-instance scheduler lock). One failing prune logs and lets the rest
 * run; observability failures never break the sweep.
 */
async function retentionSweep(): Promise<void> {
  const outbox = await pruneFinishedOutboxEvents({
    processedDays: positiveIntEnv("OUTBOX_RETENTION_DAYS", 14),
    failedDays: positiveIntEnv("OUTBOX_FAILED_RETENTION_DAYS", 30),
  });
  const { pruneReconciliationHistory, prunePaymentProviderEvents } = await import(
    "../lib/reconciliation/service.js"
  );
  const reconciliation = await pruneReconciliationHistory({
    daysOld: positiveIntEnv("RECONCILIATION_RETENTION_DAYS", 90),
  });
  const providerEvents = await prunePaymentProviderEvents({
    daysOld: positiveIntEnv("PROVIDER_EVENT_RETENTION_DAYS", 90),
  });
  let sandboxRuns = 0;
  try {
    const { cleanupOldSandboxRuns } = await import("../lib/sandbox/service.js");
    sandboxRuns = await cleanupOldSandboxRuns(positiveIntEnv("SANDBOX_RUN_RETENTION_DAYS", 30));
  } catch (error) {
    logger.warn("worker_retention_sandbox_prune_failed", { error });
  }
  if (outbox.processed || outbox.failed || reconciliation.reports || providerEvents || sandboxRuns) {
    logger.info("worker_retention_sweep", {
      outbox_processed: outbox.processed,
      outbox_failed: outbox.failed,
      reconciliation_reports: reconciliation.reports,
      provider_events: providerEvents,
      sandbox_runs: sandboxRuns,
    });
  }
}

// --- boot -------------------------------------------------------------------

async function main(): Promise<void> {
  // SECURITY: same environment contract as the API server (parity with
  // src/index.ts — fail fast in production when secrets are missing).
  enforceEnvironmentValidation();

  if (process.env.NODE_ENV === "test") {
    // Consistent with jobs/*: background runtime is disabled under vitest.
    logger.info("worker_disabled_test_env", { service: SERVICE });
    return;
  }

  process.on("unhandledRejection", (reason) => {
    // A pending rejection must not kill the worker silently mid-event.
    logger.error("worker_unhandled_rejection", { error: reason });
  });

  logger.info("worker_started", {
    service: SERVICE,
    poll_interval_ms: POLL_INTERVAL_MS,
    claim_limit: CLAIM_LIMIT,
    max_attempts: MAX_ATTEMPTS,
  });
  void logSystem({
    level: "INFO",
    service: SERVICE,
    message: "worker runtime started (outbox consumer + schedulers)",
    meta: { pollIntervalMs: POLL_INTERVAL_MS, claimLimit: CLAIM_LIMIT, maxAttempts: MAX_ATTEMPTS },
  });

  await reclaimOrphanedProcessing().catch((error) => {
    // DB unreachable at boot is not fatal: the poll loop retries forever.
    logger.error("worker_reclaim_failed", { error });
    return -1;
  });

  const jobs: Array<{ name: string; stop: () => void }> = [];

  // Schedulers moved here from src/index.ts (PLAN-019 H-003).
  jobs.push(
    startIntervalJob({
      name: "reconciliation",
      enabled: process.env.RECONCILIATION_ENABLED !== "false",
      intervalMs: positiveIntEnv("RECONCILIATION_INTERVAL_MS", 24 * 60 * 60 * 1000),
      initialDelayMs: positiveIntEnv("RECONCILIATION_INITIAL_DELAY_MS", 60 * 1000),
      // PLAN-020 F-004: cross-instance lock — a second replica skips the tick.
      run: () => runUnderSchedulerLock("worker:scheduler:reconciliation", () => runReconciliationCycle()),
    })
  );
  jobs.push(
    startIntervalJob({
      name: "server_monitoring",
      enabled: process.env.SERVER_MONITORING_ENABLED !== "false",
      intervalMs: positiveIntEnv("SERVER_MONITORING_INTERVAL_MS", 60_000),
      initialDelayMs: 15_000,
      run: () =>
        runUnderSchedulerLock("worker:scheduler:server_monitoring", async () => {
          const result = await runMonitoringSweep();
          if (result.servers > 0 || result.tokens > 0) {
            logger.info("server_monitoring_sweep", { ...result });
          }
        }),
    })
  );

  // Optional sweeps — domain libs land with later waves (dynamic + crash-safe).
  demoModule = await loadOptionalModule<DemoModule>(DEMO_PATH, "lib/demo.ts");
  if (typeof demoModule?.sweepDemos === "function") {
    jobs.push(
      startIntervalJob({
        name: "demo_sweep",
        enabled: process.env.DEMO_SWEEP_ENABLED !== "false",
        intervalMs: positiveIntEnv("DEMO_SWEEP_INTERVAL_MS", 60_000),
        initialDelayMs: 30_000,
        run: () => runUnderSchedulerLock("worker:scheduler:demo_sweep", () => demoModule!.sweepDemos!()),
      })
    );
  }
  priceAlertsModule = await loadOptionalModule<PriceAlertsModule>(PRICE_ALERTS_PATH, "lib/priceAlerts");
  if (
    priceAlertsModule &&
    (typeof priceAlertsModule.notifyPriceDrops === "function" ||
      typeof priceAlertsModule.notifyDiscountStarts === "function" ||
      typeof priceAlertsModule.sweepRecentVersionReleases === "function")
  ) {
    jobs.push(
      startIntervalJob({
        name: "price_alert_sweep",
        enabled: process.env.PRICE_ALERT_SWEEP_ENABLED !== "false",
        intervalMs: positiveIntEnv("PRICE_ALERT_SWEEP_INTERVAL_MS", 300_000),
        initialDelayMs: 30_000,
        // lib/priceAlerts owns all three alert sweeps; each is idempotent
        // (notification dedup keys), so running the trio together is safe.
        // PLAN-020 F-004: cross-instance lock.
        run: () =>
          runUnderSchedulerLock("worker:scheduler:price_alert_sweep", async () => {
            const mod = priceAlertsModule!;
            const drops =
              typeof mod.notifyPriceDrops === "function" ? Number(await mod.notifyPriceDrops()) : 0;
            const discountStarts =
              typeof mod.notifyDiscountStarts === "function" ? Number(await mod.notifyDiscountStarts()) : 0;
            const versionReleases =
              typeof mod.sweepRecentVersionReleases === "function"
                ? Number(await mod.sweepRecentVersionReleases())
                : 0;
            if (drops || discountStarts || versionReleases) {
              logger.info("price_alert_sweep", {
                price_drops: drops,
                discount_starts: discountStarts,
                version_releases: versionReleases,
              });
            }
          }),
      })
    );
  }

  // PLAN-020 E-005: retention — outbox (PROCESSED/FAILED), reconciliation
  // history, raw provider webhook events and old sandbox runs must not grow
  // forever. Daily, best-effort: one failing prune logs and lets the rest
  // run. PLAN-020 F-004: cross-instance lock.
  jobs.push(
    startIntervalJob({
      name: "retention",
      enabled: process.env.RETENTION_ENABLED !== "false",
      intervalMs: positiveIntEnv("RETENTION_INTERVAL_MS", 24 * 60 * 60 * 1000),
      initialDelayMs: positiveIntEnv("RETENTION_INITIAL_DELAY_MS", 5 * 60 * 1000),
      run: () => runUnderSchedulerLock("worker:scheduler:retention", retentionSweep),
    })
  );

  const loopPromise = runOutboxLoop();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("worker_shutdown", { signal });
    stopping = true;
    wake?.(); // wake the idle poll so the loop observes `stopping` at once
    for (const job of jobs) job.stop();

    // H-003: finish the current event, then exit. Hard cap so a wedged
    // handler cannot hang the container forever (orchestrators kill at 10s).
    await Promise.race([
      loopPromise.catch(() => undefined),
      sleep(10_000),
    ]);

    // J-003-style dependency close: db pool; redis is only held if a handler
    // pulled it in transitively — closed best-effort (never held by this
    // module directly).
    try {
      const { redis } = await import("../lib/redis.js");
      redis.disconnect();
    } catch {
      // best-effort
    }
    try {
      const client = db as unknown as { close?: () => Promise<void> };
      if (typeof client.close === "function") {
        await client.close();
      }
    } catch {
      // best-effort
    }
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();