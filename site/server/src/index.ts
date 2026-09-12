import dotenv from "dotenv";
import { enforceEnvironmentValidation } from "./lib/startupValidation.js";
import { createApp } from "./app.js";
import { logger } from "./lib/logger.js";
import { redis } from "./lib/redis.js";
import { db } from "./prisma/db.js";
import { sweepLegacyStoredTokens } from "./lib/tokenCrypto.js";

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
  // PLAN B-003 / PLAN-005 E: the reconciliation and server-monitoring
  // schedulers moved to the dedicated worker runtime (PLAN-019 H-003) so
  // background work scales independently from the HTTP server.
  logger.info("schedulers_moved_to_worker_runtime", {
    started_by: "python startup.py dev | compose worker service",
  });

  // PLAN-016 A-009: one-time idempotent re-encryption of legacy plaintext
  // provider tokens (converges to a no-op; failure must not block startup).
  void sweepLegacyStoredTokens()
    .then(({ encrypted }) => {
      if (encrypted > 0) {
        logger.info("oauth_tokens_reencrypted", { accounts: encrypted });
      }
    })
    .catch((error) => {
      logger.error("oauth_token_sweep_failed", { error });
    });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("server_shutdown", { signal });

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

// PLAN-020 N-004: listen failures (port already in use, permission denied)
// must surface as a clear fatal error instead of an unhandled 'error' event
// that dumps a raw stack while the process lingers "starting".
server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error("server_start_failed", {
      message: `Port ${PORT} is already in use — stop the process holding it or set PORT.`,
      port: PORT,
    });
  } else {
    logger.error("server_start_failed", { port: PORT, error });
  }
  process.exit(1);
});
