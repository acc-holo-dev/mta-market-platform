// PLAN-005 Workstreams H/I: Server news and updates.
//
// One News object feeds every surface (server page, global feed, follower
// dashboard) — content is never duplicated across surfaces. Updates are a
// separate entity from news (I-001): a versioned changelog entry.
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit, userRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";
import { recordAudit } from "../lib/audit";
import { isOwnMediaUrl } from "../lib/media";
import { loadStaffRole, isPubliclyVisible } from "../lib/serverAccess";
import { createNotifications } from "../lib/notify";
import { bustActivityCache } from "../lib/activity";

const router: Router = Router();

async function loadServer(slug: string) {
  return db.orm.public.Server.where({ slug }).first();
}

/**
 * Creates the discussion thread for a news item (H-004, optional). The thread
 * is explicitly linked to the server AND to the news object; the "Servers"
 * category is used when present, otherwise the first category by position.
 */
async function createNewsDiscussionThread(
  server: any,
  title: string,
  authorId: string,
  newsId: string
): Promise<{ id: string } | null> {
  const category =
    (await db.orm.public.ForumCategory.where({ slug: "servers" }).first()) ??
    (await db.orm.public.ForumCategory.where({}).orderBy((c: any) => c.position.asc()).first());
  if (!category) return null;
  const thread = await db.orm.public.ForumThread.create({
    categoryId: category.id,
    authorId,
    serverId: server.id,
    newsId,
    title: `Обсуждение новости: ${title}`,
    state: "OPEN",
    replyCount: 0,
  });
  return thread;
}

/**
 * Update discussions (I-003) link only to the server — updates carry no
 * dedicated thread FK; the title keeps the connection readable.
 */
async function createUpdateDiscussionThread(
  server: any,
  title: string,
  authorId: string
): Promise<{ id: string } | null> {
  const category =
    (await db.orm.public.ForumCategory.where({ slug: "servers" }).first()) ??
    (await db.orm.public.ForumCategory.where({}).orderBy((c: any) => c.position.asc()).first());
  if (!category) return null;
  const thread = await db.orm.public.ForumThread.create({
    categoryId: category.id,
    authorId,
    serverId: server.id,
    title: `Обсуждение обновления: ${title}`,
    state: "OPEN",
    replyCount: 0,
  });
  return thread;
}

// ---------------------------------------------------------------------------
// News (H)
// ---------------------------------------------------------------------------

// GET /servers/:slug/news — public list of PUBLISHED news (staff also sees drafts).
router.get("/:slug/news", standardRateLimit, async (req, res: Response) => {
  try {
    const server = await loadServer(req.params.slug as string);
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    if (!isPubliclyVisible(server)) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const page = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "10", 10) || 10, 1), 50);

    const auth = req.headers.authorization;
    let includeDrafts = false;
    if (auth?.startsWith("Bearer ")) {
      const { verifyAccessToken } = await import("../lib/jwt");
      const payload = verifyAccessToken(auth.substring(7));
      if (payload) {
        const role = await loadStaffRole(server, payload.userId);
        includeDrafts = role === "OWNER" || role === "ADMIN";
      }
    }

    const where = includeDrafts ? { serverId: server.id } : { serverId: server.id, status: "PUBLISHED" };
    const news = await db.orm.public.ServerNews
      .where(where as any)
      .orderBy((n: any) => (n.publishedAt ?? n.createdAt).desc())
      .limit(limit)
      .offset((page - 1) * limit)
      .all();
    const countResult = await db.orm.public.ServerNews.where(where as any).aggregate(
      (a: any) => ({ total: a.count() })
    );
    const total = Number(countResult.total);
    const items = await withThreads(news);
    res.json({
      data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    reqLog(req).error("server_news_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

// POST /servers/:slug/news — create a DRAFT news item (owner/admins, H-002).
router.post(
  "/:slug/news",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 30, action: "server_news_create" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await loadServer(req.params.slug as string);
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const role = await loadStaffRole(server, req.user!.userId);
      if (!canManage(role)) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      const { title, content, coverUrl } = req.body ?? {};
      if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 120) {
        res.status(400).json({ error: "Заголовок новости: от 3 до 120 символов" });
        return;
      }
      if (typeof content !== "string" || content.trim().length < 3 || content.length > 50000) {
        res.status(400).json({ error: "Текст новости обязателен (до 50000 символов)" });
        return;
      }
      if (coverUrl !== undefined && coverUrl !== null && coverUrl !== "" &&
          !(typeof coverUrl === "string" && isOwnMediaUrl(coverUrl))) {
        res.status(400).json({ error: "coverUrl must be an uploaded /media/ image" });
        return;
      }
      const news = await db.orm.public.ServerNews.create({
        serverId: server.id,
        authorId: req.user!.userId,
        title: title.trim(),
        content,
        coverUrl: coverUrl || null,
        status: "DRAFT",
      });
      res.status(201).json(news);
    } catch (error) {
      reqLog(req).error("server_news_create_failed", { error });
      res.status(500).json({ error: "Failed to create news" });
    }
  }
);

// PATCH /servers/:slug/news/:id — edit (owner/admins or the author).
router.patch("/:slug/news/:id", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const server = await loadServer(req.params.slug as string);
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const news = await db.orm.public.ServerNews.where({ id: req.params.id as string, serverId: server.id }).first();
    if (!news) {
      res.status(404).json({ error: "News not found" });
      return;
    }
    const role = await loadStaffRole(server, req.user!.userId);
    if (!canManage(role) && news.authorId !== req.user!.userId) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    const { title, content, coverUrl } = req.body ?? {};
    const update: Record<string, unknown> = {};
    if (title !== undefined) {
      if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 120) {
        res.status(400).json({ error: "Заголовок новости: от 3 до 120 символов" });
        return;
      }
      update.title = title.trim();
    }
    if (content !== undefined) {
      if (typeof content !== "string" || content.trim().length < 3 || content.length > 50000) {
        res.status(400).json({ error: "Текст новости обязателен" });
        return;
      }
      update.content = content;
    }
    if (coverUrl !== undefined) {
      if (coverUrl === null || coverUrl === "") update.coverUrl = null;
      else if (typeof coverUrl === "string" && isOwnMediaUrl(coverUrl)) update.coverUrl = coverUrl;
      else {
        res.status(400).json({ error: "coverUrl must be an uploaded /media/ image" });
        return;
      }
    }
    const updated = await db.orm.public.ServerNews.where({ id: news.id }).update(update);
    res.json(updated);
  } catch (error) {
    reqLog(req).error("server_news_update_failed", { error });
    res.status(500).json({ error: "Failed to update news" });
  }
});

// POST /servers/:slug/news/:id/publish — DRAFT -> PUBLISHED (H-002), notifies
// followers (L-003) and optionally opens the discussion thread (H-004).
router.post(
  "/:slug/news/:id/publish",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await loadServer(req.params.slug as string);
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const news = await db.orm.public.ServerNews.where({ id: req.params.id as string, serverId: server.id }).first();
      if (!news) {
        res.status(404).json({ error: "News not found" });
        return;
      }
      const role = await loadStaffRole(server, req.user!.userId);
      if (!canManage(role)) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      if (news.status !== "DRAFT") {
        res.status(409).json({ error: "News is already published" });
        return;
      }
      const published = await db.orm.public.ServerNews.where({ id: news.id }).update({
        status: "PUBLISHED",
        publishedAt: new Date().toISOString(),
      });

      // Optional discussion thread (H-004) — linked to the news object at creation.
      let thread = null;
      if (req.body?.createDiscussion === true) {
        thread = await createNewsDiscussionThread(server, news.title, req.user!.userId, news.id);
      }

      // L-003/M-002: follower notifications (bounded by the follower list).
      const follows = await db.orm.public.ServerFollow.where({ serverId: server.id }).all();
      await createNotifications(
        follows.map((f: any) => ({
          recipientId: f.userId as string,
          type: "SERVER_NEWS" as const,
          title: `Новость сервера «${server.name}»: ${news.title}`,
          body: news.content.slice(0, 200),
          entityType: "serverNews",
          entityId: news.id,
        })),
        { excludeActorId: req.user!.userId }
      );

      await recordAudit({
        actorId: req.user!.userId,
        action: "server.news.publish",
        targetType: "serverNews",
        targetId: news.id,
        after: { serverId: server.id },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      // PLAN-006: published news is a high-value activity item — bust the
      // snapshot cache so Home reflects it immediately.
      await bustActivityCache();
      res.json({ news: published, thread });
    } catch (error) {
      reqLog(req).error("server_news_publish_failed", { error });
      res.status(500).json({ error: "Failed to publish news" });
    }
  }
);

// GET /servers/:slug/news/:id — public news page payload (H-004).
router.get("/:slug/news/:id", standardRateLimit, async (req, res: Response) => {
  try {
    const server = await loadServer(req.params.slug as string);
    if (!server || !isPubliclyVisible(server)) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const news = await db.orm.public.ServerNews.where({ id: req.params.id as string, serverId: server.id }).first();
    if (!news) {
      res.status(404).json({ error: "News not found" });
      return;
    }
    if (news.status !== "PUBLISHED") {
      const auth = req.headers.authorization;
      const payload = auth?.startsWith("Bearer ")
        ? await import("../lib/jwt").then((m) => m.verifyAccessToken(auth!.substring(7)))
        : null;
      const role = payload ? await loadStaffRole(server, payload.userId) : null;
      if (!canManage(role) && news.authorId !== payload?.userId) {
        res.status(404).json({ error: "News not found" });
        return;
      }
    }
    const author = await db.orm.public.User
      .where({ id: news.authorId })
      .select("id", "username", "displayName", "avatar")
      .first();
    const thread = await db.orm.public.ForumThread
      .where({ newsId: news.id })
      .select("id", "title", "replyCount", "state")
      .first();
    res.json({
      news: { ...news, threadId: thread?.id ?? null },
      thread,
      author,
      server: { slug: server.slug, name: server.name },
    });
  } catch (error) {
    reqLog(req).error("server_news_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

// DELETE /servers/:slug/news/:id — manage role or author (H flow allows
// archive/removal; the audit trail records who removed it).
router.delete(
  "/:slug/news/:id",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await loadServer(req.params.slug as string);
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const news = await db.orm.public.ServerNews.where({ id: req.params.id as string, serverId: server.id }).first();
      if (!news) {
        res.status(404).json({ error: "News not found" });
        return;
      }
      const role = await loadStaffRole(server, req.user!.userId);
      if (!canManage(role) && news.authorId !== req.user!.userId) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      await db.orm.public.ServerNews.where({ id: news.id }).delete();
      await recordAudit({
        actorId: req.user!.userId,
        action: "server.news.delete",
        targetType: "serverNews",
        targetId: news.id,
        ip: req.ip,
        requestId: req.id ?? null,
      });
      res.json({ message: "News deleted" });
    } catch (error) {
      reqLog(req).error("server_news_delete_failed", { error });
      res.status(500).json({ error: "Failed to delete news" });
    }
  }
);

// ---------------------------------------------------------------------------
// Updates (I)
// ---------------------------------------------------------------------------

// GET /servers/:slug/updates — public update history (I-002).
router.get("/:slug/updates", standardRateLimit, async (req, res: Response) => {
  try {
    const server = await loadServer(req.params.slug as string);
    if (!server || !isPubliclyVisible(server)) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const page = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "10", 10) || 10, 1), 50);
    const updates = await db.orm.public.ServerUpdate
      .where({ serverId: server.id })
      .orderBy((u: any) => u.publishedAt.desc())
      .limit(limit)
      .offset((page - 1) * limit)
      .all();
    const countResult = await db.orm.public.ServerUpdate.where({ serverId: server.id }).aggregate(
      (a: any) => ({ total: a.count() })
    );
    res.json({
      data: updates,
      pagination: { page, limit, total: Number(countResult.total), pages: Math.ceil(Number(countResult.total) / limit) },
    });
  } catch (error) {
    reqLog(req).error("server_updates_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch updates" });
  }
});

// POST /servers/:slug/updates — publish an update immediately (I-002), notify
// followers (SERVER_UPDATE).
router.post(
  "/:slug/updates",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 30, action: "server_update_create" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await loadServer(req.params.slug as string);
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const role = await loadStaffRole(server, req.user!.userId);
      if (!canManage(role)) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      const { version, title, changelog } = req.body ?? {};
      if (typeof version !== "string" || version.trim().length < 1 || version.trim().length > 40) {
        res.status(400).json({ error: "Укажите версию (до 40 символов)" });
        return;
      }
      if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 120) {
        res.status(400).json({ error: "Заголовок обновления: от 3 до 120 символов" });
        return;
      }
      if (typeof changelog !== "string" || changelog.trim().length < 3 || changelog.length > 20000) {
        res.status(400).json({ error: "Список изменений обязателен" });
        return;
      }
      const duplicate = await db.orm.public.ServerUpdate.where({
        serverId: server.id,
        version: version.trim(),
      }).first();
      if (duplicate) {
        res.status(409).json({ error: "Обновление с такой версией уже существует" });
        return;
      }
      const update = await db.orm.public.ServerUpdate.create({
        serverId: server.id,
        authorId: req.user!.userId,
        version: version.trim(),
        title: title.trim(),
        changelog,
        publishedAt: new Date().toISOString(),
      });

      let thread = null;
      if (req.body?.createDiscussion === true) {
        thread = await createUpdateDiscussionThread(server, update.title, req.user!.userId);
      }

      const follows = await db.orm.public.ServerFollow.where({ serverId: server.id }).all();
      await createNotifications(
        follows.map((f: any) => ({
          recipientId: f.userId,
          type: "SERVER_UPDATE" as const,
          title: `Сервер «${server.name}» выпустил обновление ${version.trim()}`,
          body: update.title,
          entityType: "serverUpdate",
          entityId: update.id,
        })),
        { excludeActorId: req.user!.userId }
      );

      await recordAudit({
        actorId: req.user!.userId,
        action: "server.update.publish",
        targetType: "serverUpdate",
        targetId: update.id,
        after: { serverId: server.id, version: update.version },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      // PLAN-006: SERVER_UPDATE is the top-priority activity item.
      await bustActivityCache();
      res.status(201).json(update);
    } catch (error) {
      reqLog(req).error("server_update_create_failed", { error });
      res.status(500).json({ error: "Failed to publish update" });
    }
  }
);

// DELETE /servers/:slug/updates/:id — manage role.
router.delete(
  "/:slug/updates/:id",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await loadServer(req.params.slug as string);
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const role = await loadStaffRole(server, req.user!.userId);
      if (!canManage(role)) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      await db.orm.public.ServerUpdate
        .where({ id: req.params.id as string, serverId: server.id })
        .delete();
      await recordAudit({
        actorId: req.user!.userId,
        action: "server.update.delete",
        targetType: "serverUpdate",
        targetId: req.params.id as string,
        ip: req.ip,
        requestId: req.id ?? null,
      });
      res.json({ message: "Update deleted" });
    } catch (error) {
      reqLog(req).error("server_update_delete_failed", { error });
      res.status(500).json({ error: "Failed to delete update" });
    }
  }
);

function canManage(role: string | null): boolean {
  return role === "OWNER" || role === "ADMIN";
}

async function withThreads(items: any[]): Promise<any[]> {
  const newsIds = items.map((n: any) => n.id as string);
  if (newsIds.length === 0) return items;
  const threads = await db.orm.public.ForumThread
    .where((t: any) => t.newsId.in(newsIds))
    .select("id", "newsId", "title", "replyCount")
    .all();
  const byNewsId = new Map(threads.map((t: any) => [t.newsId as string, t]));
  return items.map((n: any) => ({
    ...n,
    thread: byNewsId.get(n.id) ?? null,
  }));
}

export default router;