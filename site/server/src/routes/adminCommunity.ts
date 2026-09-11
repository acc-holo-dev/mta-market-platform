// PLAN-005 Workstreams Q/R (+AA): admin moderation for the Server/Community
// domains. Every critical action is audited and — where a user is affected —
// produces a MODERATION notification. Mounted under /admin alongside the
// existing resource moderation router.
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";
import { recordAudit } from "../lib/audit";
import { createNotifications } from "../lib/notify";

const router: Router = Router();

function adminOnly(req: AuthRequest, res: Response, next: () => void) {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "MODERATOR") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// Servers (Q): inspect, approve/reject verification, suspend
// ---------------------------------------------------------------------------

// GET /admin/servers — full server list for inspection (private fields shown
// to admins only inside this endpoint).
router.get("/servers", authenticate, adminOnly, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const lifecycle = req.query.lifecycle as string | undefined;
    const page = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "20", 10) || 20, 1), 100);

    const where = lifecycle ? { lifecycle } : {};
    const servers = await db.orm.public.Server
      .where(where as any)
      .orderBy((s: any) => s.createdAt.desc())
      .limit(limit)
      .offset((page - 1) * limit)
      .all();
    const agg = await db.orm.public.Server.where(where as any).aggregate((a: any) => ({ total: a.count() }));

    const ownerIds = Array.from(new Set(servers.map((s: any) => s.ownerId as string)));
    const owners = ownerIds.length
      ? await db.orm.public.User
          .where((u: any) => u.id.in(ownerIds))
          .select("id", "username", "displayName")
          .all()
      : [];
    const ownerById = new Map(owners.map((u: any) => [u.id, u]));

    res.json({
      data: servers.map((s: any) => ({
        ...s,
        owner: ownerById.get(s.ownerId)
          ? {
              id: s.ownerId,
              username: ownerById.get(s.ownerId).username,
              displayName: ownerById.get(s.ownerId).displayName,
            }
          : null,
      })),
      pagination: {
        page,
        limit,
        total: Number(agg.total ?? 0),
        pages: Math.ceil(Number(agg.total ?? 0) / limit),
      },
    });
  } catch (error) {
    reqLog(req).error("admin_servers_failed", { error });
    res.status(500).json({ error: "Failed to fetch servers" });
  }
});

// GET /admin/servers/:id — inspect a single server with private data.
router.get("/servers/:id", authenticate, adminOnly, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ id: req.params.id as string }).first();
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const owner = await db.orm.public.User
      .where({ id: server.ownerId })
      .select("id", "username", "email", "displayName")
      .first();
    const [follows, reviews, news, resources] = await Promise.all([
      db.orm.public.ServerFollow.where({ serverId: server.id }).aggregate((a: any) => ({ total: a.count() })),
      db.orm.public.ServerReview.where({ serverId: server.id }).aggregate((a: any) => ({ total: a.count() })),
      db.orm.public.ServerNews.where({ serverId: server.id }).orderBy((n: any) => n.createdAt.desc()).limit(10).all(),
      db.orm.public.ServerResource.where({ serverId: server.id }).all(),
    ]);
    res.json({
      server,
      owner,
      counts: {
        followers: Number(follows.total ?? 0),
        reviews: Number(reviews.total ?? 0),
        resources: resources.length,
      },
      recentNews: news,
    });
  } catch (error) {
    reqLog(req).error("admin_server_detail_failed", { error });
    res.status(500).json({ error: "Failed to fetch server" });
  }
});

// PATCH /admin/servers/:id/status — lifecycle moderation (suspend/restore).
router.patch(
  "/servers/:id/status",
  authenticate,
  adminOnly,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { lifecycle, reason } = req.body ?? {};
      if (!["ACTIVE", "SUSPENDED", "ARCHIVED", "VERIFIED"].includes(lifecycle)) {
        res.status(400).json({ error: "Invalid lifecycle state" });
        return;
      }
      const server = await db.orm.public.Server.where({ id: req.params.id as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const updated = await db.orm.public.Server.where({ id: server.id }).update({
        lifecycle,
        monitoring: lifecycle === "ACTIVE" || lifecycle === "VERIFIED" ? server.monitoring : "UNKNOWN",
      });
      await recordAudit({
        actorId: req.user!.userId,
        action: "server.moderation.lifecycle",
        targetType: "server",
        targetId: server.id,
        before: { lifecycle: server.lifecycle },
        after: { lifecycle, reason: reason ?? null },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      if (lifecycle === "SUSPENDED") {
        await createNotifications([
          {
            recipientId: server.ownerId,
            type: "MODERATION",
            title: `Сервер «${server.name}» приостановлен модерацией`,
            body: reason ? String(reason).slice(0, 300) : null,
            entityType: "server",
            entityId: server.id,
          },
        ]);
      } else if (server.lifecycle === "SUSPENDED") {
        await createNotifications([
          {
            recipientId: server.ownerId,
            type: "MODERATION",
            title: `Сервер «${server.name}» восстановлен`,
            entityType: "server",
            entityId: server.id,
          },
        ]);
      }
      res.json(updated);
    } catch (error) {
      reqLog(req).error("admin_server_status_failed", { error });
      res.status(500).json({ error: "Failed to update server status" });
    }
  }
);

// PATCH /admin/servers/:id/verification — approve/reject (Q) with a reason.
router.patch(
  "/servers/:id/verification",
  authenticate,
  adminOnly,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { verification, note } = req.body ?? {};
      if (!["VERIFIED", "FAILED", "PENDING"].includes(verification)) {
        res.status(400).json({ error: "Invalid verification state" });
        return;
      }
      const server = await db.orm.public.Server.where({ id: req.params.id as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const updated = await db.orm.public.Server.where({ id: server.id }).update({
        verification,
        verificationNote: typeof note === "string" && note ? note.slice(0, 500) : null,
        verifiedAt: verification === "VERIFIED" ? new Date().toISOString() : server.verifiedAt,
        lifecycle:
          verification === "VERIFIED" && ["CREATED", "PENDING_VERIFICATION"].includes(server.lifecycle)
            ? "VERIFIED"
            : server.lifecycle,
      });
      await recordAudit({
        actorId: req.user!.userId,
        action: "server.moderation.verification",
        targetType: "server",
        targetId: server.id,
        before: { verification: server.verification },
        after: { verification, note: note ?? null },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      await createNotifications([
        {
          recipientId: server.ownerId,
          type: "MODERATION",
          title:
            verification === "VERIFIED"
              ? `Сервер «${server.name}» верифицирован`
              : `Верификация сервера «${server.name}» отклонена`,
          body: typeof note === "string" ? note.slice(0, 200) : null,
          entityType: "server",
          entityId: server.id,
        },
      ]);
      res.json(updated);
    } catch (error) {
      reqLog(req).error("admin_server_verification_failed", { error });
      res.status(500).json({ error: "Failed to update verification" });
    }
  }
);

// ---------------------------------------------------------------------------
// Reports queue (R)
// ---------------------------------------------------------------------------

// GET /admin/reports — moderation queue.
router.get("/reports", authenticate, adminOnly, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const status = (req.query.status as string | undefined) || "OPEN";
    const where = status === "ALL" ? {} : { status };
    const reports = await db.orm.public.Report
      .where(where as any)
      .orderBy((r: any) => r.createdAt.desc())
      .limit(100)
      .all();
    const reporterIds = Array.from(new Set(reports.map((r: any) => r.reporterId as string)));
    const reporters = reporterIds.length
      ? await db.orm.public.User
          .where((u: any) => u.id.in(reporterIds))
          .select("id", "username", "displayName")
          .all()
      : [];
    const reporterById = new Map(reporters.map((u: any) => [u.id, u]));
    res.json({
      data: reports.map((r: any) => ({
        ...r,
        reporter: reporterById.get(r.reporterId) ?? null,
      })),
    });
  } catch (error) {
    reqLog(req).error("admin_reports_failed", { error });
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// POST /admin/reports/:id/resolve — human decision; no automatic bans (R).
router.post(
  "/reports/:id/resolve",
  authenticate,
  adminOnly,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const report = await db.orm.public.Report.where({ id: req.params.id as string }).first();
      if (!report) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      const { status, resolution } = req.body ?? {};
      if (!["RESOLVED", "DISMISSED"].includes(status)) {
        res.status(400).json({ error: "status must be RESOLVED|DISMISSED" });
        return;
      }
      const updated = await db.orm.public.Report.where({ id: report.id }).update({
        status,
        resolution:
          typeof resolution === "string" && resolution.trim() ? resolution.slice(0, 2000) : null,
        resolvedById: req.user!.userId,
        resolvedAt: new Date().toISOString(),
      });
      await recordAudit({
        actorId: req.user!.userId,
        action: "moderation.report.resolve",
        targetType: "report",
        targetId: report.id,
        before: { status: report.status },
        after: { status, resolution: resolution ?? null },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      await createNotifications([
        {
          recipientId: report.reporterId,
          type: "MODERATION",
          title: `Ваша жалоба (${report.targetType.toLowerCase()}) обработана: ${status === "RESOLVED" ? "меры приняты" : "нарушение не подтверждено"}`,
          entityType: "report",
          entityId: report.id,
        },
      ]);
      res.json(updated);
    } catch (error) {
      reqLog(req).error("admin_report_resolve_failed", { error });
      res.status(500).json({ error: "Failed to resolve report" });
    }
  }
);

// ---------------------------------------------------------------------------
// Content moderation: news, reviews, forum
// ---------------------------------------------------------------------------

// PATCH /admin/server-news/:id — unpublish or restore a news item.
router.patch(
  "/server-news/:id",
  authenticate,
  adminOnly,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const news = await db.orm.public.ServerNews.where({ id: req.params.id as string }).first();
      if (!news) {
        res.status(404).json({ error: "News not found" });
        return;
      }
      const { status, reason } = req.body ?? {};
      if (!["DRAFT", "PUBLISHED"].includes(status)) {
        res.status(400).json({ error: "Invalid news status" });
        return;
      }
      const updated = await db.orm.public.ServerNews.where({ id: news.id }).update({
        status,
        ...(status === "PUBLISHED" ? { publishedAt: news.publishedAt ?? new Date().toISOString() } : {}),
      });
      await recordAudit({
        actorId: req.user!.userId,
        action: "moderation.serverNews.status",
        targetType: "serverNews",
        targetId: news.id,
        before: { status: news.status },
        after: { status, reason: reason ?? null },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      if (status === "DRAFT") {
        await createNotifications([
          {
            recipientId: news.authorId,
            type: "MODERATION",
            title: `Новость «${news.title}» снята с публикации модератором`,
            entityType: "serverNews",
            entityId: news.id,
          },
        ]);
      }
      res.json(updated);
    } catch (error) {
      reqLog(req).error("admin_news_moderate_failed", { error });
      res.status(500).json({ error: "Failed to moderate news" });
    }
  }
);

// PATCH /admin/server-reviews/:id — hide/restore a review (moderation).
router.patch(
  "/server-reviews/:id",
  authenticate,
  adminOnly,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const review = await db.orm.public.ServerReview.where({ id: req.params.id as string }).first();
      if (!review) {
        res.status(404).json({ error: "Review not found" });
        return;
      }
      const { status, reason } = req.body ?? {};
      if (!["VISIBLE", "HIDDEN"].includes(status)) {
        res.status(400).json({ error: "Invalid review status" });
        return;
      }
      const updated = await db.orm.public.ServerReview.where({ id: review.id }).update({
        status,
      });
      await recordAudit({
        actorId: req.user!.userId,
        action: "moderation.serverReview.status",
        targetType: "serverReview",
        targetId: review.id,
        before: { status: review.status },
        after: { status, reason: reason ?? null },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      if (status === "HIDDEN") {
        await createNotifications([
          {
            recipientId: review.userId,
            type: "MODERATION",
            title: "Ваш отзыв скрыт модерацией",
            body: typeof reason === "string" ? reason.slice(0, 200) : null,
            entityType: "serverReview",
            entityId: review.id,
          },
        ]);
      }
      res.json(updated);
    } catch (error) {
      reqLog(req).error("admin_review_moderate_failed", { error });
      res.status(500).json({ error: "Failed to moderate review" });
    }
  }
);

// PATCH /admin/forum-threads/:id — lock/pin/restore (Q).
router.patch(
  "/forum-threads/:id",
  authenticate,
  adminOnly,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const thread = await db.orm.public.ForumThread.where({ id: req.params.id as string }).first();
      if (!thread) {
        res.status(404).json({ error: "Thread not found" });
        return;
      }
      const { state, pinned } = req.body ?? {};
      const update: Record<string, unknown> = {};
      if (state !== undefined) {
        if (!["OPEN", "LOCKED", "ARCHIVED"].includes(state)) {
          res.status(400).json({ error: "Invalid thread state" });
          return;
        }
        update.state = state;
      }
      if (pinned !== undefined) update.pinned = !!pinned;
      if (Object.keys(update).length === 0) {
        res.status(400).json({ error: "Nothing to update" });
        return;
      }
      const updated = await db.orm.public.ForumThread.where({ id: thread.id }).update(update);
      await recordAudit({
        actorId: req.user!.userId,
        action: "moderation.forumThread.update",
        targetType: "forumThread",
        targetId: thread.id,
        before: { state: thread.state, pinned: thread.pinned },
        after: update,
        ip: req.ip,
        requestId: req.id ?? null,
      });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("admin_thread_moderate_failed", { error });
      res.status(500).json({ error: "Failed to moderate thread" });
    }
  }
);

export default router;