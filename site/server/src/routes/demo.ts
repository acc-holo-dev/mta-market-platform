// Live demo routes (PLAN-018 M). Root-mounted (absolute paths):
//   POST   /resources/:slug/demo   вЂ” start a demo session (user)
//   GET    /demo/:sessionId        вЂ” status + TTL + connectionInfo (owner/admin)
//   DELETE /demo/:sessionId        вЂ” destroy (owner)
//   GET    /admin/demo?status=     вЂ” active sessions queue (admin)
//   POST   /admin/demo/sweep       вЂ” manual TTL sweep (admin)
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { reqLog } from "../middleware/requestId.js";
import {
  startDemo,
  getDemoStatus,
  destroyDemo,
  sweepDemos,
  DemoFeatureDisabledError,
  DemoNotFoundError,
  DemoCapacityError,
  DemoForbiddenError,
} from "../lib/demo.js";
import { isAdminOrModerator, type Actor } from "../lib/permissions.js";
import { db } from "../prisma/db.js";

const router: Router = Router();

// POST /resources/:slug/demo вЂ” flag-gated (OFF в†’ 404), caps в†’ 409.
router.post(
  "/resources/:slug/demo",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await startDemo({
        userId: req.user!.userId,
        slug: req.params.slug as string,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof DemoFeatureDisabledError) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (error instanceof DemoNotFoundError) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      if (error instanceof DemoCapacityError) {
        res.status(409).json({
          error: error.scope === "user" ? "Demo already active" : "Demo capacity full",
          scope: error.scope,
        });
        return;
      }
      reqLog(req).error("demo_start_failed", { error });
      res.status(500).json({ error: "Failed to start demo" });
    }
  }
);

// GET /demo/:sessionId вЂ” owner or admin.
router.get("/demo/:sessionId", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const status = await getDemoStatus(
      req.params.sessionId as string,
      req.user!.userId,
      isAdminOrModerator({ role: req.user!.role } as Pick<Actor, "role">)
    );
    res.json(status);
  } catch (error) {
    if (error instanceof DemoNotFoundError) {
      res.status(404).json({ error: "Demo session not found" });
      return;
    }
    if (error instanceof DemoForbiddenError) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    reqLog(req).error("demo_status_failed", { error });
    res.status(500).json({ error: "Failed to fetch demo status" });
  }
});

// DELETE /demo/:sessionId вЂ” owner only (admins use the admin surface).
router.delete("/demo/:sessionId", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const session = await db.orm.public.DemoSession
      .where({ id: req.params.sessionId as string })
      .first();
    if (!session) {
      res.status(404).json({ error: "Demo session not found" });
      return;
    }
    if (session.requestedById !== req.user!.userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    await destroyDemo(session.id);
    res.json({ status: "DESTROYED", sessionId: session.id });
  } catch (error) {
    reqLog(req).error("demo_destroy_failed", { error });
    res.status(500).json({ error: "Failed to destroy demo" });
  }
});

// GET /admin/demo?status= вЂ” active sessions queue (admin/moderator).
router.get(
  "/admin/demo",
  authenticate,
  (req: AuthRequest, res: Response, next: () => void) => {
    if (!isAdminOrModerator({ role: req.user!.role } as Pick<Actor, "role">)) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  },
  async (req: AuthRequest, res: Response) => {
    try {
      const status = req.query.status as string | undefined;
      const where = status ? { status: status as never } : {};
      const sessions = await db.orm.public.DemoSession
        .where(where)
        .all();
      res.json({
        data: sessions.map((s: Record<string, unknown>) => s),
      });
    } catch (error) {
      reqLog(req).error("demo_admin_queue_failed", { error });
      res.status(500).json({ error: "Failed to fetch demo sessions" });
    }
  }
);

// POST /admin/demo/sweep вЂ” manual TTL sweep trigger (admin/moderator).
router.post(
  "/admin/demo/sweep",
  authenticate,
  (req: AuthRequest, res: Response, next: () => void) => {
    if (!isAdminOrModerator({ role: req.user!.role } as Pick<Actor, "role">)) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  },
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await sweepDemos();
      res.json(result);
    } catch (error) {
      reqLog(req).error("demo_sweep_failed", { error });
      res.status(500).json({ error: "Failed to sweep demo sessions" });
    }
  }
);

export const demoRoutes: Router = router;
export default demoRoutes;
