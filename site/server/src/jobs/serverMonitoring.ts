// PLAN-005 E/AC: background monitoring sweep. Mirrors the reconciliation
// scheduler pattern (plain timers, single-flight, disabled in tests).
import { runMonitoringSweep } from "../lib/serverMonitoring";
import { logger } from "../lib/logger";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startServerMonitoringScheduler(): void {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.SERVER_MONITORING_ENABLED === "false") return;
  const intervalMs = parseInt(process.env.SERVER_MONITORING_INTERVAL_MS || "60000", 10);
  // First sweep shortly after boot, then on the interval.
  setTimeout(() => {
    void runSweep();
    timer = setInterval(() => void runSweep(), intervalMs);
    logger.info("server_monitoring_scheduler_started", { interval_ms: intervalMs });
  }, 15_000);
}

export function stopServerMonitoringScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

async function runSweep(): Promise<void> {
  if (running) return; // single-flight guard
  running = true;
  try {
    const result = await runMonitoringSweep();
    if (result.servers > 0 || result.tokens > 0) {
      logger.info("server_monitoring_sweep", { ...result });
    }
  } catch (error) {
    logger.error("server_monitoring_sweep_failed", { error });
  } finally {
    running = false;
  }
}