import dotenv from "dotenv";
import { enforceEnvironmentValidation } from "./lib/startupValidation";
import { createApp } from "./app";
import { logger } from "./lib/logger";
import { startReconciliationScheduler } from "./jobs/reconciliation";
import {
  startServerMonitoringScheduler,
  stopServerMonitoringScheduler,
} from "./jobs/serverMonitoring";
import { redis } from "./lib/redis";
import { db } from "./prisma/db";

dotenv.config();

// SECURITY: Validate environment before starting server
enforceEnvironmentValidation();

// PLAN-004 J-003 (audit): a pending rejection must not kill the process
// silently mid-request — log it with context (kept non-fatal: an in-flight
// request should still try to finish during the graceful window).
process.on("unhandledRejection", (reason) => {
  logger.error("unhandled_rejection", { error: reason });
});

const app = createApp();
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  logger.info("server_started", {
    port: PORT,
    node_env: process.env.NODE_ENV ?? "development",
  });

  // PLAN B-003: periodic financial reconciliation (payments/refunds/payouts/
  // provider events/internal ledger). No-op in test env; stop() handle kept
  // for graceful shutdown.
  const stopReconciliation = startReconciliationScheduler();
  // PLAN-005 E: server monitoring sweep (stale heartbeats -> UNKNOWN,
  // expired review tokens). No-op in test env.
  startServerMonitoringScheduler();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("server_shutdown", { signal });
    stopReconciliation.stop();
    stopServerMonitoringScheduler();

    // J-003: close dependency handles so connections drain cleanly instead
    // of being dropped by process exit (avoids orphaned PG/Redis sockets and
    // lets orchestrators see a clean exit).
    server.close(() => {
      void (async () => {
        try {
          redis.disconnect();
        } catch {
          // best-effort
        }
        try {
          // The ORM client exposes a driver-level close for its pool.
          const client = db as unknown as { close?: () => Promise<void> };
          if (typeof client.close === "function") {
            await client.close();
          }
        } catch {
          // best-effort
        }
        process.exit(0);
      })();
    });
    // Fallback exit if connections keep the process alive.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
});
