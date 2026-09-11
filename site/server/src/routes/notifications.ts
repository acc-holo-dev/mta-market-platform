// PLAN-005 Workstream M: notification center.
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";
import { unreadNotificationCount } from "../lib/notify";

const router: Router = Router();

// GET /notifications?filter=unread|all — the notification center (M-003).
router.get("/", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const filter = (req.query.filter as string | undefined) || "all";
    const page = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1), 50);

    const base =
      filter === "unread"
        ? db.orm.public.Notification.where({ recipientId: req.user!.userId, readAt: null })
        : db.orm.public.Notification.where({ recipientId: req.user!.userId });

    const notifications = await base
      .orderBy((n: any) => n.createdAt.desc())
      .limit(limit)
      .offset((page - 1) * limit)
      .all();

    const countWhere =
      filter === "unread"
        ? { recipientId: req.user!.userId, readAt: null }
        : { recipientId: req.user!.userId };
    const agg = await db.orm.public.Notification.where(countWhere).aggregate(
      (a: any) => ({ total: a.count() })
    );
    const unreadCount = await unreadNotificationCount(req.user!.userId);

    res.json({
      data: notifications,
      unreadCount,
      pagination: {
        page,
        limit,
        total: Number(agg.total ?? 0),
        pages: Math.ceil(Number(agg.total ?? 0) / limit),
      },
    });
  } catch (error) {
    reqLog(req).error("notifications_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

// POST /notifications/:id/read — mark one as read (M-004).
router.post("/:id/read", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const notification = await db.orm.public.Notification.where({
      id: req.params.id as string,
      recipientId: req.user!.userId,
    }).first();
    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    if (!notification.readAt) {
      await db.orm.public.Notification.where({ id: notification.id }).update({ readAt: new Date().toISOString() });
    }
    res.json({ read: true });
  } catch (error) {
    reqLog(req).error("notification_read_failed", { error });
    res.status(500).json({ error: "Failed to mark notification read" });
  }
});

// POST /notifications/read-all — mark all as read (M-004).
router.post("/read-all", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const unread = await db.orm.public.Notification.where({
      recipientId: req.user!.userId,
      readAt: null,
    }).all();
    let updated = 0;
    for (const n of unread as any[]) {
      await db.orm.public.Notification.where({ id: n.id }).update({ readAt: new Date().toISOString() });
      updated += 1;
    }
    res.json({ updated });
  } catch (error) {
    reqLog(req).error("notification_read_all_failed", { error });
    res.status(500).json({ error: "Failed to mark notifications read" });
  }
});

export default router;