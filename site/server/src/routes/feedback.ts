// Controlled beta feedback (PLAN-018 S-005). Root-mounted (absolute paths):
//   POST /feedback          вЂ” user submits a report (NEW)
//   GET  /feedback/mine     вЂ” own submissions with status
//   GET  /admin/feedback?status=  вЂ” bounded admin queue
//   POST /admin/feedback/:id/transition вЂ” triage|resolve|dismiss (audited)
import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { recordAudit } from "../lib/audit.js";
import { isAdminOrModerator, type Actor } from "../lib/permissions.js";

const router: Router = Router();

const submitSchema = z.object({
  category: z.enum(["BUG", "UX", "BILLING", "CONTENT", "OTHER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  description: z.string().min(10).max(4000),
  route: z.string().max(300).optional(),
  screenshotUrl: z.string().max(500).optional(),
});

const transitionSchema = z.object({
  action: z.enum(["triage", "resolve", "dismiss"]),
  resolutionNote: z.string().max(1000).optional(),
});

const STATUS_BY_ACTION: Record<string, string> = {
  triage: "TRIAGED",
  resolve: "RESOLVED",
  dismiss: "DISMISSED",
};

// POST /feedback вЂ” authenticated submit в†’ NEW row.
router.post(
  "/feedback",
  authenticate,
  standardRateLimit,
  validate(submitSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body as z.infer<typeof submitSchema>;
      const report = await db.orm.public.FeedbackReport.create({
        userId: req.user!.userId,
        category: body.category,
        severity: body.severity,
        description: body.description,
        route: body.route ?? null,
        screenshotUrl: body.screenshotUrl ?? null,
        status: "NEW",
      });
      res.status(201).json({
        id: report.id,
        status: report.status,
        category: report.category,
        severity: report.severity,
      });
    } catch (error) {
      reqLog(req).error("feedback_submit_failed", { error });
      res.status(500).json({ error: "Failed to submit feedback" });
    }
  }
);

// GET /feedback/mine вЂ” own submissions (bounded 50, newest first).
router.get("/feedback/mine", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const reports = await db.orm.public.FeedbackReport
      .where({ userId: req.user!.userId })
      .all();
    const sorted = reports
      .sort((a: { createdAt: string }, b: { createdAt: string }) =>
        a.createdAt < b.createdAt ? 1 : -1
      )
      .slice(0, 50);
    res.json({ data: sorted });
  } catch (error) {
    reqLog(req).error("feedback_mine_failed", { error });
    res.status(500).json({ error: "Failed to fetch feedback" });
  }
});

// GET /admin/feedback?status= вЂ” queue (bounded 100, newest first).
router.get(
  "/admin/feedback",
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
      const reports = await db.orm.public.FeedbackReport.where(where).all();
      const sorted = reports
        .sort((a: { createdAt: string }, b: { createdAt: string }) =>
          a.createdAt < b.createdAt ? 1 : -1
        )
        .slice(0, 100);
      res.json({ data: sorted });
    } catch (error) {
      reqLog(req).error("feedback_admin_queue_failed", { error });
      res.status(500).json({ error: "Failed to fetch feedback queue" });
    }
  }
);

// POST /admin/feedback/:id/transition вЂ” triage|resolve|dismiss (audited).
router.post(
  "/admin/feedback/:id/transition",
  authenticate,
  (req: AuthRequest, res: Response, next: () => void) => {
    if (!isAdminOrModerator({ role: req.user!.role } as Pick<Actor, "role">)) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  },
  validate(transitionSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body as z.infer<typeof transitionSchema>;
      const report = await db.orm.public.FeedbackReport
        .where({ id: req.params.id as string })
        .first();
      if (!report) {
        res.status(404).json({ error: "Feedback not found" });
        return;
      }
      const nextStatus = STATUS_BY_ACTION[body.action];
      const updated = await db.orm.public.FeedbackReport.where({ id: report.id }).update({
        status: nextStatus as never,
        handledById: req.user!.userId,
        resolutionNote: body.resolutionNote ?? null,
      });
      await recordAudit({
        actorId: req.user!.userId,
        action: "feedback_transitioned",
        targetType: "feedback_report",
        targetId: report.id,
        before: { status: report.status },
        after: { status: nextStatus, action: body.action },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("feedback_transition_failed", { error });
      res.status(500).json({ error: "Failed to transition feedback" });
    }
  }
);

export const feedbackRoutes: Router = router;
export default feedbackRoutes;
