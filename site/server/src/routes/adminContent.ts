// PLAN-007 Workstream D: article moderation queue. Every action is a human
// moderation decision: audit + MODERATION notification to the author. Hiding
// a published article removes it from every public surface immediately —
// including the PLAN-006 activity read layer (cache bust).
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";
import { recordAudit } from "../lib/audit";
import { createNotifications } from "../lib/notify";
import { bustActivityCache } from "../lib/activity";
import { creatorFollowerIds, isCreator, deliverFollowNotifications } from "../lib/follows";

const router: Router = Router();

// Same gate as the other admin community routes (see adminCommunity.ts).
function adminOnly(req: AuthRequest, res: Response, next: () => void) {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "MODERATOR") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// GET /admin/content?status=PENDING_REVIEW|ALL — moderation queue/list.
router.get("/content", authenticate, adminOnly, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const status = (req.query.status as string | undefined) || "PENDING_REVIEW";
    const where = status === "ALL" ? {} : { status };
    const rows = await db.orm.public.Article
      .where(where as any)
      .orderBy((a: any) => a.createdAt.desc())
      .limit(100)
      .all();
    const authorIds = Array.from(new Set(rows.map((a: any) => a.authorId as string)));
    const authors = authorIds.length
      ? await db.orm.public.User
          .where((u: any) => u.id.in(authorIds))
          .select("id", "username", "displayName", "avatar")
          .all()
      : [];
    const authorById = new Map(authors.map((u: any) => [u.id, u]));
    res.json({
      data: rows.map((a: any) => ({
        ...a,
        author: authorById.get(a.authorId) ?? null,
      })),
    });
  } catch (error) {
    reqLog(req).error("admin_content_list_failed", { error });
    res.status(500).json({ error: "Failed to fetch articles" });
  }
});

// POST /admin/content/:id/approve — PENDING_REVIEW → PUBLISHED (D-001).
router.post("/content/:id/approve", authenticate, adminOnly, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const article = await db.orm.public.Article.where({ id: req.params.id as string }).first();
    if (!article) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    if (article.status !== "PENDING_REVIEW") {
      res.status(409).json({ error: "Статья не в очереди модерации" });
      return;
    }
    const published = await db.orm.public.Article
      .where({ id: article.id })
      .update({ status: "PUBLISHED" as const, publishedAt: new Date().toISOString(), reviewNote: null });
    await recordAudit({
      actorId: req.user!.userId,
      action: "article.approve",
      targetType: "article",
      targetId: article.id,
      after: { status: "PUBLISHED" },
      ip: req.ip,
      requestId: req.id ?? null,
    });
    await createNotifications(
      [
        {
          recipientId: article.authorId,
          type: "MODERATION" as const,
          title: `Статья «${article.title}» опубликована`,
          body: "Ваша статья прошла модерацию и доступна в /content.",
          entityType: "article",
          entityId: article.id,
        },
      ],
      { excludeActorId: req.user!.userId }
    );
    // PLAN-006 F-001: NEW_ARTICLE is a high-value activity item.
    await bustActivityCache();
    // PLAN-008 D-003: if the author is a creator (APPROVED seller), notify
    // their followers (CREATOR_ARTICLE).
    if (await isCreator(article.authorId)) {
      const followerIds = await creatorFollowerIds(article.authorId);
      await deliverFollowNotifications(
        followerIds,
        (recipientId) => ({
          recipientId,
          type: "CREATOR_ARTICLE" as const,
          title: `Новая статья от автора: ${article.title}`,
          body: article.excerpt.slice(0, 200),
          entityType: "article",
          entityId: article.id,
        }),
        { excludeActorId: req.user!.userId }
      );
    }
    res.json(published);
  } catch (error) {
    reqLog(req).error("admin_content_approve_failed", { error });
    res.status(500).json({ error: "Failed to approve article" });
  }
});

// POST /admin/content/:id/reject — PENDING_REVIEW → DRAFT with reason (D-001).
router.post(
  "/content/:id/reject",
  authenticate,
  adminOnly,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { reason } = req.body ?? {};
      if (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 500) {
        res.status(400).json({ error: "Укажите причину отказа (3–500 символов)" });
        return;
      }
      const article = await db.orm.public.Article.where({ id: req.params.id as string }).first();
      if (!article) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      if (article.status !== "PENDING_REVIEW") {
        res.status(409).json({ error: "Статья не в очереди модерации" });
        return;
      }
      const updated = await db.orm.public.Article
        .where({ id: article.id })
        .update({ status: "DRAFT" as const, reviewNote: reason.trim() });
      await recordAudit({
        actorId: req.user!.userId,
        action: "article.reject",
        targetType: "article",
        targetId: article.id,
        after: { status: "DRAFT", reason: reason.trim() },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      await createNotifications(
        [
          {
            recipientId: article.authorId,
            type: "MODERATION" as const,
            title: `Статья «${article.title}» возвращена автору`,
            body: `Причина: ${reason.trim()}`,
            entityType: "article",
            entityId: article.id,
          },
        ],
        { excludeActorId: req.user!.userId }
      );
      res.json(updated);
    } catch (error) {
      reqLog(req).error("admin_content_reject_failed", { error });
      res.status(500).json({ error: "Failed to reject article" });
    }
  }
);

// POST /admin/content/:id/hide — PUBLISHED → ARCHIVED with reason (D-002).
router.post(
  "/content/:id/hide",
  authenticate,
  adminOnly,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { reason } = req.body ?? {};
      if (typeof reason !== "string" || reason.trim().length < 3 || reason.length > 500) {
        res.status(400).json({ error: "Укажите причину скрытия (3–500 символов)" });
        return;
      }
      const article = await db.orm.public.Article.where({ id: req.params.id as string }).first();
      if (!article) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      if (article.status !== "PUBLISHED") {
        res.status(409).json({ error: "Скрывать можно только опубликованные статьи" });
        return;
      }
      const updated = await db.orm.public.Article
        .where({ id: article.id })
        .update({ status: "ARCHIVED" as const, reviewNote: reason.trim() });
      await recordAudit({
        actorId: req.user!.userId,
        action: "article.hide",
        targetType: "article",
        targetId: article.id,
        after: { status: "ARCHIVED", reason: reason.trim() },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      await createNotifications(
        [
          {
            recipientId: article.authorId,
            type: "MODERATION" as const,
            title: `Статья «${article.title}» скрыта модерацией`,
            body: `Причина: ${reason.trim()}`,
            entityType: "article",
            entityId: article.id,
          },
        ],
        { excludeActorId: req.user!.userId }
      );
      // Remove from every public surface — including the activity snapshot.
      await bustActivityCache();
      res.json(updated);
    } catch (error) {
      reqLog(req).error("admin_content_hide_failed", { error });
      res.status(500).json({ error: "Failed to hide article" });
    }
  }
);

export default router;
