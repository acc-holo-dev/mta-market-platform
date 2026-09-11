// PLAN-005 Workstream R: user reports. Minimal honest flow:
// Report -> moderation queue -> human action -> audit. No automatic bans.
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit, userRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

const TARGET_TYPES = ["THREAD", "POST", "REVIEW", "NEWS", "SERVER", "PROFILE", "ARTICLE"] as const;

// POST /reports — file a report against any reportable surface.
router.post(
  "/",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 10, action: "report_create" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const { targetType, targetId, reason } = req.body ?? {};
      if (!TARGET_TYPES.includes(targetType)) {
        res.status(400).json({ error: "Invalid targetType" });
        return;
      }
      if (typeof targetId !== "string" || targetId.length < 1 || targetId.length > 80) {
        res.status(400).json({ error: "targetId is required" });
        return;
      }
      if (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 2000) {
        res.status(400).json({ error: "Опишите причину жалобы (3-2000 символов)" });
        return;
      }

      const exists = await targetExists(targetType, targetId);
      if (!exists) {
        res.status(404).json({ error: "Target not found" });
        return;
      }

      const report = await db.orm.public.Report.create({
        reporterId: req.user!.userId,
        targetType,
        targetId,
        reason,
        status: "OPEN",
      });
      res.status(201).json(report);
    } catch (error) {
      reqLog(req).error("report_create_failed", { error });
      res.status(500).json({ error: "Failed to create report" });
    }
  }
);

// GET /reports/my — the reporter's own submissions.
router.get("/my", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const reports = await db.orm.public.Report.where({ reporterId: req.user!.userId })
      .orderBy((r: any) => r.createdAt.desc())
      .limit(50)
      .all();
    res.json({ data: reports });
  } catch (error) {
    reqLog(req).error("reports_my_failed", { error });
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

async function targetExists(targetType: string, targetId: string): Promise<boolean> {
  switch (targetType) {
    case "THREAD":
      return !!(await db.orm.public.ForumThread.where({ id: targetId }).first());
    case "POST":
      return !!(await db.orm.public.ForumPost.where({ id: targetId }).first());
    case "REVIEW":
      return !!(await db.orm.public.ServerReview.where({ id: targetId }).first());
    case "NEWS":
      return !!(await db.orm.public.ServerNews.where({ id: targetId }).first());
    case "SERVER":
      return !!(await db.orm.public.Server.where({ id: targetId }).first());
    case "PROFILE":
      return !!(await db.orm.public.User.where({ username: targetId }).first());
    case "ARTICLE":
      return !!(await db.orm.public.Article.where({ id: targetId }).first());
    default:
      return false;
  }
}

export default router;