// PLAN-018 I-003: price alerts — price drop / discount start / version
// release watchers with a CRON dispatch surface.
//
// Root-mounted router (app.ts: app.use("/", alertsRoutes)) — every path in
// this file is ABSOLUTE. Sweep mechanics live in lib/priceAlerts.ts so the
// version-publish path can reuse them.
//
// POST /alerts/dispatch guard (worker contract, used by the worker wave):
//   - an ADMIN bearer token always works (manual/admin triggering), OR
//   - header X-Worker-Key matching the WORKER_KEY env when that env is set
//     (server-to-server CRON). When WORKER_KEY is unset the worker-key path
//     is disabled — only ADMIN works. Comparison is constant-time.
import { timingSafeEqual } from "node:crypto";
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { verifyAccessToken } from "../lib/jwt.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import {
  PRICE_ALERT_EVENTS,
  parseAlertEvents,
  serializeAlertEvents,
  notifyPriceDrops,
  notifyDiscountStarts,
  sweepRecentVersionReleases,
  type PriceAlertEvent,
} from "../lib/priceAlerts.js";

const router: Router = Router();

const ALERTS_LIST_MAX = 100;
const TARGET_PRICE_MAX = 1_000_000_000; // sanity cap, kopecks

/** Admin JWT or worker key (X-Worker-Key === WORKER_KEY env when set). */
function workerOrAdmin(req: AuthRequest, res: Response, next: () => void): void {
  const workerKey = process.env.WORKER_KEY ?? "";
  const provided = (req.headers["x-worker-key"] as string | undefined) ?? "";
  if (workerKey && provided) {
    const a = Buffer.from(workerKey, "utf8");
    const b = Buffer.from(provided, "utf8");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      next();
      return;
    }
  }
  // No valid worker key: fall through to the ADMIN bearer-token check.
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token provided" });
    return;
  }
  const payload = verifyAccessToken(header.substring(7));
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  if (payload.role !== "ADMIN") {
    res.status(403).json({ error: "Admin or worker key required" });
    return;
  }
  req.user = payload;
  next();
}

// ---------------------------------------------------------------------------
// Alert management (own alerts only)
// ---------------------------------------------------------------------------

// PUT /resources/:slug/alert — create or update the caller's alert on a
// PUBLISHED resource (UNIQUE userId+resourceId → upsert; re-PUT reactivates).
router.put(
  "/resources/:slug/alert",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const resource = await db.orm.public.Resource
        .where({ slug: req.params.slug as string })
        .select("id", "status")
        .first();
      if (!resource || resource.status !== "PUBLISHED") {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      const rawEvents: unknown = req.body?.events;
      if (
        !Array.isArray(rawEvents) ||
        rawEvents.length === 0 ||
        !rawEvents.every(
          (e: unknown) => typeof e === "string" && (PRICE_ALERT_EVENTS as readonly string[]).includes(e)
        )
      ) {
        res.status(400).json({
          error: `events must be a non-empty subset of: ${PRICE_ALERT_EVENTS.join(", ")}`,
        });
        return;
      }
      const events = parseAlertEvents(rawEvents);
      let targetPriceMinor: number | null = null;
      if (req.body?.targetPriceMinor !== undefined && req.body?.targetPriceMinor !== null) {
        const value = Number(req.body.targetPriceMinor);
        if (!Number.isInteger(value) || value < 0 || value > TARGET_PRICE_MAX) {
          res.status(400).json({ error: "targetPriceMinor must be an integer between 0 and 1000000000" });
          return;
        }
        targetPriceMinor = value;
      }
      const eventsStr = serializeAlertEvents(events);
      const existing = await db.orm.public.PriceAlert
        .where({ userId: req.user!.userId, resourceId: resource.id as string })
        .first();
      let alert: any;
      if (existing) {
        alert = await db.orm.public.PriceAlert.where({ id: (existing as any).id }).update({
          events: eventsStr,
          targetPriceMinor,
          active: true,
        });
      } else {
        alert = await db.orm.public.PriceAlert.create({
          userId: req.user!.userId,
          resourceId: resource.id as string,
          events: eventsStr,
          targetPriceMinor,
          active: true,
        });
      }
      res.status(existing ? 200 : 201).json(shapeAlert(alert, events));
    } catch (error) {
      reqLog(req).error("price_alert_put_failed", { error });
      res.status(500).json({ error: "Failed to save price alert" });
    }
  }
);

// DELETE /resources/:slug/alert — deactivate (rows are kept so re-PUT does
// not reset createdAt); idempotent for users without an alert.
router.delete(
  "/resources/:slug/alert",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const resource = await db.orm.public.Resource
        .where({ slug: req.params.slug as string })
        .select("id")
        .first();
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      await db.orm.public.PriceAlert
        .where({ userId: req.user!.userId, resourceId: resource.id as string })
        .update({ active: false });
      res.json({ active: false });
    } catch (error) {
      reqLog(req).error("price_alert_delete_failed", { error });
      res.status(500).json({ error: "Failed to deactivate price alert" });
    }
  }
);

// GET /me/alerts — the caller's own alerts with resource labels (bounded).
router.get("/me/alerts", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const alerts = (await db.orm.public.PriceAlert
      .where({ userId: req.user!.userId })
      .orderBy((a: any) => a.createdAt.desc())
      .limit(ALERTS_LIST_MAX)
      .all()) as any[];
    const resourceIds = alerts.map((a) => a.resourceId as string);
    const resources = resourceIds.length
      ? await db.orm.public.Resource
          .where((r: any) => r.id.in(resourceIds))
          .select("id", "slug", "title", "price", "status")
          .all()
      : [];
    const resourceById = new Map(resources.map((r: any) => [r.id as string, r]));
    res.json({
      data: alerts.map((a) => ({
        id: a.id,
        resourceId: a.resourceId,
        events: parseAlertEvents(String(a.events ?? "").split(",")),
        targetPriceMinor: a.targetPriceMinor,
        active: a.active,
        createdAt: a.createdAt,
        resource: resourceById.get(a.resourceId as string) ?? null,
      })),
    });
  } catch (error) {
    reqLog(req).error("me_alerts_failed", { error });
    res.status(500).json({ error: "Failed to fetch price alerts" });
  }
});

// ---------------------------------------------------------------------------
// POST /alerts/dispatch — CRON/worker sweep trigger (see guard docs above).
// Runs all three sweeps and reports per-event notification counts.
// ---------------------------------------------------------------------------

router.post("/alerts/dispatch", standardRateLimit, (req: AuthRequest, res: Response) => {
  workerOrAdmin(req, res, async () => {
    try {
      const priceDrops = await notifyPriceDrops();
      const discountStarts = await notifyDiscountStarts();
      const versionReleases = await sweepRecentVersionReleases();
      res.json({ dispatched: { priceDrops, discountStarts, versionReleases } });
    } catch (error) {
      reqLog(req).error("alerts_dispatch_failed", { error });
      res.status(500).json({ error: "Failed to dispatch alerts" });
    }
  });
});

/** API shape for an alert row: events as an array in canonical order. */
function shapeAlert(alert: any, events: PriceAlertEvent[]) {
  return {
    id: alert.id,
    userId: alert.userId,
    resourceId: alert.resourceId,
    events,
    targetPriceMinor: alert.targetPriceMinor,
    active: alert.active,
    createdAt: alert.createdAt,
  };
}

export default router;