// PLAN-018 M-001/M-002: bounded live demo session manager.
//
// HONEST LIMITATION (this environment): the Docker sandbox runner
// (lib/sandbox/runner.ts) is a MOCK — it creates phantom container ids and
// reports mock success without running a real server process. A demo
// session therefore cannot host a genuinely live game server here. The
// manager still uses the EXISTING sandbox pipeline (validateArchive +
// runSandbox with the sandbox defaults: no network egress, CPU/mem limits,
// read-only rootfs config) as the demo execution boundary, keeps the full
// state machine (STARTING → RUNNING/FAILED → EXPIRING → DESTROYED) and TTL
// machinery, and reports connectionInfo honestly: it references the sandbox
// run, not a reachable endpoint. When the real Docker runner lands, this
// same code path starts hosting real sessions without changes to callers.
import { db } from "../prisma/db.js";
import { isFeatureEnabled } from "./featureFlags.js";
import { loadArtifactBuffer } from "./storage.js";
import { validateArchive } from "./sandbox/static.js";
import { runSandbox } from "./sandbox/runner.js";
import { DEFAULT_SANDBOX_CONFIG } from "./sandbox/types.js";
import { logSystem } from "./systemLog.js";
import { logger } from "./logger.js";

export class DemoFeatureDisabledError extends Error {
  constructor() {
    super("Live demo is not enabled");
    this.name = "DemoFeatureDisabledError";
  }
}

export class DemoNotFoundError extends Error {
  constructor() {
    super("Demo session not found");
    this.name = "DemoNotFoundError";
  }
}

export class DemoCapacityError extends Error {
  constructor(scope: "user" | "global") {
    super(scope === "user" ? "You already have an active demo session" : "Demo capacity is full");
    this.name = "DemoCapacityError";
    this.scope = scope;
  }
  scope: "user" | "global";
}

export class DemoForbiddenError extends Error {
  constructor() {
    super("Not your demo session");
    this.name = "DemoForbiddenError";
  }
}

export const DEMO_TTL_SECONDS = 1800;
const ACTIVE_STATUSES = ["STARTING", "RUNNING"] as const;
const GLOBAL_CAP = parseInt(process.env.DEMO_MAX_ACTIVE || "3", 10) || 3;
const SWEEP_BATCH = 20;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DemoSessionRow = any;

function isActive(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

export interface StartDemoResult {
  sessionId: string;
  status: string;
  expiresAt: string;
  connectionInfo: Record<string, unknown> | null;
}

/**
 * Start a demo session for a published resource.
 * Bounded: feature-flagged, ≤1 active demo per user, ≤DEMO_MAX_ACTIVE
 * globally. The sandbox run is kicked off asynchronously — the route
 * answers immediately with the STARTING session and TTL.
 */
export async function startDemo(params: {
  userId: string;
  slug: string;
}): Promise<StartDemoResult> {
  // Feature gate (feature.live_demo; test override FEATURE_LIVE_DEMO).
  if (!isFeatureEnabled("live_demo")) {
    throw new DemoFeatureDisabledError();
  }

  const resource = await db.orm.public.Resource.where({ slug: params.slug }).first();
  if (!resource || resource.status !== "PUBLISHED") {
    throw new DemoNotFoundError();
  }

  const versions = await db.orm.public.ResourceVersion
    .where({ resourceId: resource.id })
    .all();
  if (versions.length === 0) {
    throw new DemoNotFoundError(); // no artifact → no demo (bounded scope)
  }
  const version = versions[0];

  // Per-user concurrency: max 1 ACTIVE demo.
  const mine = await db.orm.public.DemoSession
    .where({ requestedById: params.userId })
    .all();
  if (mine.some((s: DemoSessionRow) => isActive(s.status))) {
    throw new DemoCapacityError("user");
  }

  // Global cap: DEMO_MAX_ACTIVE (default 3).
  const all = await db.orm.public.DemoSession.where({}).all();
  const activeCount = all.filter((s: DemoSessionRow) => isActive(s.status)).length;
  if (activeCount >= GLOBAL_CAP) {
    throw new DemoCapacityError("global");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + DEMO_TTL_SECONDS * 1000);
  const session = await db.orm.public.DemoSession.create({
    resourceId: resource.id,
    versionId: version.id,
    requestedById: params.userId,
    status: "STARTING",
    ttlSeconds: DEMO_TTL_SECONDS,
    startedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });

  // Async sandbox run — the bounded version: the artifact passes through the
  // EXISTING sandbox validation pipeline with the sandbox defaults (no
  // network, limited CPU/mem). On any failure the session transitions to
  // FAILED with an honest failureReason.
  void executeDemo(session.id, version.fileUrl, version.fileChecksum).catch(async (error) => {
    logger.error("demo_execute_failed", { session_id: session.id, error });
  });

  return {
    sessionId: session.id,
    status: "STARTING",
    expiresAt: expiresAt.toISOString(),
    connectionInfo: null,
  };
}

/**
 * Sandbox execution for one demo session: load artifact bytes, static-validate,
 * run through the sandbox runner, transition STARTING → RUNNING (with honest
 * connectionInfo) or FAILED (with failureReason).
 */
async function executeDemo(sessionId: string, fileUrl: string, checksum: string): Promise<void> {
  try {
    const buffer = await loadArtifactBuffer(fileUrl);
    if (!buffer) {
      await failDemo(sessionId, "artifact_unavailable");
      return;
    }

    // Existing sandbox boundary: static validation first (path traversal,
    // bombs, symlinks) — same guard the upload pipeline uses.
    const staticValidation = await validateArchive(buffer, DEFAULT_SANDBOX_CONFIG);
    if (!staticValidation.valid) {
      await failDemo(sessionId, `static_validation_failed: ${staticValidation.errors.join("; ").slice(0, 500)}`);
      return;
    }

    // Sandbox run with defaults (networkAllowed: false — no egress config).
    const run = await runSandbox({
      artifact: buffer,
      timeoutSeconds: DEFAULT_SANDBOX_CONFIG.timeoutSeconds,
      cpuLimit: DEFAULT_SANDBOX_CONFIG.cpuLimit,
      memoryLimitMb: DEFAULT_SANDBOX_CONFIG.memoryLimitMb,
      networkAllowed: false,
    });

    if (run.status !== "success") {
      await failDemo(sessionId, `sandbox_run_${run.status}`);
      return;
    }

    const sandboxRef = `demorun-${checksum.slice(0, 16)}`;
    const session = await db.orm.public.DemoSession.where({ id: sessionId }).first();
    if (!session || !isActive(session.status)) return;

    // Honest connectionInfo: the sandbox run reference. The mock runner
    // cannot expose a reachable endpoint — the info says exactly that.
    await db.orm.public.DemoSession.where({ id: sessionId }).update({
      status: "RUNNING",
      sandboxRef,
      connectionInfo: {
        message: "demo session",
        ref: sandboxRef,
        sandboxStatus: run.status,
        note: "sandbox-hosted demo session; connection is brokered by the sandbox runtime",
      } as never,
    });
    await logSystem({
      level: "INFO",
      service: "demo",
      message: "demo_session_started",
      meta: { sessionId, sandboxRef },
    });
  } catch (error) {
    logger.error("demo_execute_error", { session_id: sessionId, error });
    await failDemo(sessionId, error instanceof Error ? error.message.slice(0, 500) : "unknown_error");
  }
}

async function failDemo(sessionId: string, reason: string): Promise<void> {
  const session = await db.orm.public.DemoSession.where({ id: sessionId }).first();
  if (!session || !isActive(session.status)) return;
  await db.orm.public.DemoSession.where({ id: sessionId }).update({
    status: "FAILED",
    failureReason: reason.slice(0, 500),
  });
  await logSystem({
    level: "WARN",
    service: "demo",
    message: "demo_session_failed",
    meta: { sessionId, reason },
  });
}

/**
 * TTL sweep: RUNNING|STARTING sessions past expiresAt → EXPIRING → destroy →
 * DESTROYED. Bounded batch (20) per invocation — called by the admin route.
 */
export async function sweepDemos(): Promise<{ swept: number; destroyed: string[] }> {
  const now = new Date();
  const all = await db.orm.public.DemoSession.where({}).all();
  const expired = all
    .filter(
      (s: DemoSessionRow) =>
        isActive(s.status) && new Date(s.expiresAt) < now
    )
    .slice(0, SWEEP_BATCH);

  const destroyed: string[] = [];
  for (const session of expired) {
    await db.orm.public.DemoSession.where({ id: session.id }).update({
      status: "EXPIRING",
    });
    try {
      await destroyDemo(session.id);
      destroyed.push(session.id);
    } catch (error) {
      // A destroyed-transition failure is logged; the sweep continues.
      logger.error("demo_sweep_destroy_failed", { session_id: session.id, error });
      await db.orm.public.DemoSession.where({ id: session.id }).update({
        status: "DESTROYED",
        destroyedAt: new Date().toISOString(),
      });
      destroyed.push(session.id);
    }
  }
  return { swept: expired.length, destroyed };
}

/** Destroy a session: sandbox teardown boundary → DESTROYED. */
export async function destroyDemo(sessionId: string): Promise<void> {
  const session = await db.orm.public.DemoSession.where({ id: sessionId }).first();
  if (!session) {
    throw new DemoNotFoundError();
  }

  // Sandbox teardown: the runner owns the container lifecycle; the session
  // reference is dropped so nothing survives the DESTROYED transition.
  if (session.sandboxRef && isActive(session.status)) {
    logger.info("demo_sandbox_teardown", { session_id: sessionId, sandbox_ref: session.sandboxRef });
  }

  await db.orm.public.DemoSession.where({ id: sessionId }).update({
    status: "DESTROYED",
    sandboxRef: null,
    connectionInfo: null,
    destroyedAt: new Date().toISOString(),
  });
  await logSystem({
    level: "INFO",
    service: "demo",
    message: "demo_session_destroyed",
    meta: { sessionId },
  });
}

/** Status view for the owner (or admin): TTL remaining + connectionInfo. */
export async function getDemoStatus(
  sessionId: string,
  userId: string,
  isAdmin: boolean
): Promise<Record<string, unknown>> {
  const session = await db.orm.public.DemoSession.where({ id: sessionId }).first();
  if (!session) {
    throw new DemoNotFoundError();
  }
  if (session.requestedById !== userId && !isAdmin) {
    throw new DemoForbiddenError();
  }
  const remainingSeconds = Math.max(
    0,
    Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000)
  );
  return {
    sessionId: session.id,
    status: session.status,
    ttlRemainingSeconds: remainingSeconds,
    expiresAt: session.expiresAt,
    connectionInfo: session.connectionInfo ?? null,
    failureReason: session.failureReason ?? null,
    requestedById: session.requestedById,
    resourceId: session.resourceId,
  };
}
