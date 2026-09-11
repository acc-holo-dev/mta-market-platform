// PLAN-005 Workstream F (+G surfaces): global community forum.
//
// Category -> Thread -> Posts. Threads may carry an explicit Server link
// (G-004: server discussion) or a ServerNews link (news discussion) — links
// are created deliberately, never automatically (MODEL rule).
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit, userRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";
import { recordAudit } from "../lib/audit";
import { verifyAccessToken } from "../lib/jwt";
import { loadStaffRole, isPubliclyVisible } from "../lib/serverAccess";
import { createNotifications } from "../lib/notify";
import { bustActivityCache } from "../lib/activity";

const router: Router = Router();

const PAGE_MAX = 50;

function paging(query: any) {
  const page = Math.max(parseInt(query.page || "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || "20", 10) || 20, 1), PAGE_MAX);
  return { page, limit, skip: (page - 1) * limit };
}

/** Optional auth: guests read everything public; members get personal fields. */
function optionalUserId(req: AuthRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const payload = verifyAccessToken(header.substring(7));
  return payload?.userId ?? null;
}

interface PublicAuthor {
  username: string | null;
  displayName: string | null;
  avatar: string | null;
}

async function publicAuthors(userIds: string[]): Promise<Map<string, PublicAuthor>> {
  const ids = Array.from(new Set(userIds));
  if (ids.length === 0) return new Map();
  const users = await db.orm.public.User
    .where((u: any) => u.id.in(ids))
    .select("id", "username", "displayName", "avatar")
    .all();
  return new Map(
    users.map((u: any) => [
      u.id as string,
      { username: u.username, displayName: u.displayName, avatar: u.avatar },
    ])
  );
}

function authorOf(map: Map<string, PublicAuthor>, userId: string) {
  const a = map.get(userId);
  void map;
  return a
    ? { id: userId, username: a.username, displayName: a.displayName, avatar: a.avatar }
    : { id: userId, username: null, displayName: null, avatar: null };
}

// ---------------------------------------------------------------------------
// Hub + categories (F-001/F-002)
// ---------------------------------------------------------------------------

// GET /community — hub payload: categories, latest, active, pinned, activity.
router.get("/", standardRateLimit, async (req, res: Response) => {
  try {
    const categories = await db.orm.public.ForumCategory.where({}).orderBy((c: any) => c.position.asc()).all();
    const categoriesWithCounts = await Promise.all(
      categories.map(async (c: any) => {
        const agg = await db.orm.public.ForumThread.where({ categoryId: c.id }).aggregate(
          (a: any) => ({ total: a.count() })
        );
        return { id: c.id, slug: c.slug, name: c.name, description: c.description, threadCount: Number(agg.total ?? 0) };
      })
    );

    const [latest, pinned] = await Promise.all([
      db.orm.public.ForumThread.where({}).orderBy((t: any) => t.createdAt.desc()).limit(10).all(),
      db.orm.public.ForumThread.where({ pinned: true }).orderBy((t: any) => t.lastPostAt.desc()).limit(5).all(),
    ]);

    // Active = threads that most recently received a real reply.
    const active = (await db.orm.public.ForumThread.where({ state: "OPEN" })
      .orderBy((t: any) => t.lastPostAt.desc())
      .limit(10)
      .all()).filter((t: any) => t.lastPostAt);

    const threadCards = await threadCardGroup(latest, active, pinned);

    // Recent activity: latest non-deleted posts mapped to their threads.
    const recentPosts = await db.orm.public.ForumPost.where({ deletedAt: null })
      .orderBy((p: any) => p.createdAt.desc())
      .limit(10)
      .all();
    const postAuthors = await publicAuthors(recentPosts.map((p: any) => p.authorId));
    const threadIds = recentPosts.map((p: any) => p.threadId as string);
    const activityThreads = threadIds.length
      ? await db.orm.public.ForumThread.where((t: any) => t.id.in(threadIds)).select("id", "title").all()
      : [];
    const threadTitleById = new Map(activityThreads.map((t: any) => [t.id as string, t.title as string]));

    res.json({
      categories: categoriesWithCounts,
      latest: threadCards.latest,
      active: threadCards.active,
      pinned: threadCards.pinned,
      recentActivity: recentPosts.map((p: any) => ({
        postId: p.id,
        threadId: p.threadId,
        threadTitle: threadTitleById.get(p.threadId as string) ?? null,
        author: postAuthors.get(p.authorId) ?? null,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    reqLog(req).error("community_hub_failed", { error });
    res.status(500).json({ error: "Failed to fetch community hub" });
  }
});

// GET /community/categories — category list with thread counts.
router.get("/categories", standardRateLimit, async (_req, res: Response) => {
  try {
    const categories = await db.orm.public.ForumCategory.where({}).orderBy((c: any) => c.position.asc()).all();
    const withCounts = await Promise.all(
      categories.map(async (c: any) => {
        const agg = await db.orm.public.ForumThread.where({ categoryId: c.id }).aggregate(
          (a: any) => ({ total: a.count() })
        );
        return { ...c, threadCount: Number(agg.total ?? 0) };
      })
    );
    res.json({ data: withCounts });
  } catch (error) {
    reqLog(_req).error("community_categories_failed", { error });
    res.status(500).json({ error: "Failed to fetch categories" });
  }
});

// GET /community/categories/:slug/threads — category listing.
router.get("/categories/:slug/threads", standardRateLimit, async (req, res: Response) => {
  try {
    const category = await db.orm.public.ForumCategory.where({ slug: req.params.slug as string }).first();
    if (!category) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    const { page, limit, skip } = paging(req.query);
    // Pinned threads first, then most recent activity. The ORM has no
    // desc() for booleans, so pinned sorting is applied in JS (categories
    // are small; this matches the "pinned first" contract).
    const categoryThreads = await db.orm.public.ForumThread
      .where({ categoryId: category.id })
      .orderBy((t: any) => (t.lastPostAt ?? t.createdAt).desc())
      .limit(200)
      .offset(0)
      .all();
    const sorted = [...categoryThreads].sort((a: any, b: any) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return (
        new Date(b.lastPostAt ?? b.createdAt).getTime() -
        new Date(a.lastPostAt ?? a.createdAt).getTime()
      );
    });
    const threads = sorted.slice(skip, skip + limit);
    const agg = await db.orm.public.ForumThread.where({ categoryId: category.id }).aggregate(
      (a: any) => ({ total: a.count() })
    );
    const authors = await publicAuthors(threads.map((t: any) => t.authorId));
    const total = Number(agg.total ?? 0);
    res.json({
      category: { id: category.id, slug: category.slug, name: category.name, description: category.description },
      data: threads.map((t: any) => ({
        id: t.id,
        title: t.title,
        state: t.state,
        pinned: t.pinned,
        replyCount: t.replyCount,
        views: t.views,
        lastPostAt: t.lastPostAt,
        createdAt: t.createdAt,
        author: authors.get(t.authorId) ?? null,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    reqLog(req).error("community_threads_failed", { error });
    res.status(500).json({ error: "Failed to fetch threads" });
  }
});

// POST /community/categories/:slug/threads — create thread + first post (F-004).
router.post(
  "/categories/:slug/threads",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 10, action: "thread_create" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const category = await db.orm.public.ForumCategory.where({ slug: req.params.slug as string }).first();
      if (!category) {
        res.status(404).json({ error: "Category not found" });
        return;
      }
      const { title, content } = req.body ?? {};
      if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 150) {
        res.status(400).json({ error: "Заголовок темы обязателен (3-150 символов)" });
        return;
      }
      if (typeof content !== "string" || content.trim().length < 3 || content.length > 20000) {
        res.status(400).json({ error: "Текст первого сообщения обязателен" });
        return;
      }
      // G-004: an explicit server link is allowed only for public servers and
      // only by that server's own staff — the link is a deliberate act.
      let linkedServerId: string | null = null;
      if (req.body?.serverId) {
        const server = await db.orm.public.Server.where({ id: req.body.serverId as string }).first();
        if (!server || !isPubliclyVisible(server)) {
          res.status(404).json({ error: "Server not found" });
          return;
        }
        const role = await loadStaffRole(server, req.user!.userId);
        if (!role) {
          res.status(403).json({ error: "Только персонал сервера может привязать тему к серверу" });
          return;
        }
        linkedServerId = server.id;
      }

      const thread = await db.orm.public.ForumThread.create({
        categoryId: category.id,
        authorId: req.user!.userId,
        serverId: linkedServerId,
        title: title.trim(),
        state: "OPEN",
      });
      await db.orm.public.ForumPost.create({
        threadId: thread.id,
        authorId: req.user!.userId,
        content,
        position: 0,
      });
      await db.orm.public.ForumThread.where({ id: thread.id }).update({ lastPostAt: new Date().toISOString() });
      // PLAN-006: NEW_DISCUSSION is a high-value activity item.
      await bustActivityCache();
      res.status(201).json(thread);
    } catch (error) {
      reqLog(req).error("thread_create_failed", { error });
      res.status(500).json({ error: "Failed to create thread" });
    }
  }
);

// ---------------------------------------------------------------------------
// Thread + posts (F-003/F-004/F-005)
// ---------------------------------------------------------------------------

// GET /community/threads/:id — thread + posts; views increment on real reads.
router.get("/threads/:id", standardRateLimit, async (req, res: Response) => {
  try {
    const thread = await db.orm.public.ForumThread.where({ id: req.params.id as string }).first();
    if (!thread) {
      res.status(404).json({ error: "Thread not found" });
      return;
    }
    const category = await db.orm.public.ForumCategory.where({ id: thread.categoryId }).first();
    const server = thread.serverId
      ? await db.orm.public.Server.where({ id: thread.serverId }).select("id", "slug", "name").first()
      : null;
    // Thread author is part of the surface (F-003: author is shown).
    const threadAuthor = await db.orm.public.User
      .where({ id: thread.authorId })
      .select("id", "username", "displayName", "avatar")
      .first();

    // Caller capability for moderation controls (platform ADMIN/MODERATOR
    // or the linked server's own staff). Resolved from the same optional
    // JWT the reactions use; guests get false.
    let callerIsModerator = false;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      const payload = verifyAccessToken(authHeader.substring(7));
      if (payload) {
        if (payload.role === "ADMIN" || payload.role === "MODERATOR") {
          callerIsModerator = true;
        } else if (thread.serverId) {
          const linkedServer = await db.orm.public.Server
            .where({ id: thread.serverId })
            .select("id", "ownerId")
            .first();
          if (linkedServer) {
            const staffRole = await loadStaffRole(linkedServer, payload.userId);
            if (staffRole) callerIsModerator = true;
          }
        }
      }
    }

    // PLAN-009 B-002: aggregate follower count only — the list is never
    // exposed (DAILY-EXPERIENCE §42).
    const threadFollowersAgg = await db.orm.public.ForumThreadFollow
      .where({ threadId: thread.id })
      .aggregate((a: any) => ({ total: a.count() }));

    // Real view counting (F-003 "views if real") — fire and forget.
    db.orm.public.ForumThread
      .where({ id: thread.id })
      .update({ views: (thread.views ?? 0) + 1 })
      .catch(() => undefined);

    const { page, limit, skip } = paging(req.query);
    const posts = await db.orm.public.ForumPost
      .where({ threadId: thread.id })
      .orderBy((p: any) => p.position.asc())
      .limit(limit)
      .offset(skip)
      .all();
    const agg = await db.orm.public.ForumPost.where({ threadId: thread.id }).aggregate(
      (a: any) => ({ total: a.count() })
    );

    const authors = await publicAuthors(posts.map((p: any) => p.authorId));
    const postIds = posts.map((p: any) => p.id as string);
    const reactions = postIds.length
      ? await db.orm.public.ForumReaction.where((r: any) => r.postId.in(postIds)).all()
      : [];
    const countsByPost = new Map<string, number>();
    const mineByPost = new Map<string, string[]>();
    const callerId = optionalUserId(req);
    for (const r of reactions as any[]) {
      countsByPost.set(r.postId, (countsByPost.get(r.postId as string) ?? 0) + 1);
      if (callerId && r.userId === callerId) {
        const list = mineByPost.get(r.postId as string) ?? [];
        list.push(r.kind as string);
        mineByPost.set(r.postId as string, list);
      }
    }

    const total = Number(agg.total ?? 0);
    res.json({
      followersCount: Number(threadFollowersAgg.total ?? 0),
      thread: { ...thread, author: threadAuthor },
      category: category ? { id: category.id, slug: category.slug, name: category.name } : null,
      server,
      caller: { isModerator: callerIsModerator },
      data: posts.map((p: any) => ({
        id: p.id,
        content: p.deletedAt ? null : p.content,
        deleted: !!p.deletedAt,
        edited: !!p.editedAt,
        position: p.position,
        createdAt: p.createdAt,
        author: authors.get(p.authorId)
          ? { id: p.authorId, ...authors.get(p.authorId)! }
          : { id: p.authorId, username: null, displayName: null, avatar: null },
        reactionCount: countsByPost.get(p.id) ?? 0,
        reactedByMe: mineByPost.get(p.id) ?? [],
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    reqLog(req).error("thread_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch thread" });
  }
});

// POST /community/threads/:id/posts — reply (F-004). Locked/archived threads
// reject replies. Thread author + participants receive FORUM_REPLY (M-002).
router.post(
  "/threads/:id/posts",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 60, action: "forum_post_create" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const thread = await db.orm.public.ForumThread.where({ id: req.params.id as string }).first();
      if (!thread) {
        res.status(404).json({ error: "Thread not found" });
        return;
      }
      if (thread.state !== "OPEN") {
        res.status(409).json({ error: "Тема закрыта для ответов" });
        return;
      }
      const { content } = req.body ?? {};
      if (typeof content !== "string" || content.trim().length < 1 || content.length > 20000) {
        res.status(400).json({ error: "Текст ответа обязателен" });
        return;
      }
      const lastPosts = await db.orm.public.ForumPost
        .where({ threadId: thread.id })
        .orderBy((p: any) => p.position.desc())
        .limit(1)
        .all();
      const nextPos = lastPosts.length ? Number(lastPosts[0].position ?? 0) + 1 : 1;

      const post = await db.orm.public.ForumPost.create({
        threadId: thread.id,
        authorId: req.user!.userId,
        content: content.trim(),
        position: nextPosValue(nextPos),
      });
      await db.orm.public.ForumThread.where({ id: thread.id }).update({
        replyCount: thread.replyCount + 1,
        lastPostAt: new Date().toISOString(),
      });

      // FORUM_REPLY: author of the thread + everyone who already spoke +
      // PLAN-009 C-001: thread followers (the Follow step of the Community
      // Loop, §10). Deduplicated by createNotifications (a user who is both
      // a participant and a follower receives exactly one); the actor never
      // notifies self.
      const participants = await db.orm.public.ForumPost
        .where({ threadId: thread.id, deletedAt: null })
        .select("authorId")
        .all();
      const followers = await db.orm.public.ForumThreadFollow
        .where({ threadId: thread.id })
        .select("userId")
        .limit(500)
        .all();
      const inputs = [
        ...participants.map((p: any) => p.authorId as string),
        ...followers.map((f: any) => f.userId as string),
      ].map((recipientId) => ({
        recipientId,
        type: "FORUM_REPLY" as const,
        title: `Новый ответ в теме «${thread.title}»`,
        body: content.slice(0, 120),
        entityType: "forumThread",
        entityId: thread.id,
      }));
      await createNotifications(inputs, { excludeActorId: req.user!.userId });
      // PLAN-006: fresh replies surface in Home within the cache cycle.
      await bustActivityCache();
      res.status(201).json(post);
    } catch (error) {
      reqLog(req).error("forum_post_create_failed", { error });
      res.status(500).json({ error: "Failed to create reply" });
    }
  }
);

// PATCH /community/posts/:id — author edits own post.
router.patch("/posts/:id", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const post = await db.orm.public.ForumPost.where({ id: req.params.id as string }).first();
    if (!post || post.deletedAt) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    if (post.authorId !== req.user!.userId) {
      res.status(403).json({ error: "Можно редактировать только свои сообщения" });
      return;
    }
    const { content } = req.body ?? {};
    if (typeof content !== "string" || content.trim().length < 1 || content.length > 20000) {
      res.status(400).json({ error: "Текст ответа обязателен" });
      return;
    }
    const updated = await db.orm.public.ForumPost.where({ id: post.id }).update({
      content,
      editedAt: new Date().toISOString(),
    });
    res.json(updated);
  } catch (error) {
    reqLog(req).error("forum_post_update_failed", { error });
    res.status(500).json({ error: "Failed to update post" });
  }
});

// DELETE /community/posts/:id — author or moderation; soft delete keeps
// moderation recoverable and keeps thread counters honest (replyCount--).
router.delete("/posts/:id", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const post = await db.orm.public.ForumPost.where({ id: req.params.id as string }).first();
    if (!post || post.deletedAt) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    const thread = await db.orm.public.ForumThread.where({ id: post.threadId }).first();
    const allowed = post.authorId === req.user!.userId || (await isForumModerator(req, thread));
    if (!allowed) {
      res.status(403).json({ error: "Not allowed" });
      return;
    }
    await db.orm.public.ForumPost.where({ id: post.id }).update({ deletedAt: new Date().toISOString() });
    if (thread && thread.replyCount > 0) {
      await db.orm.public.ForumThread.where({ id: thread.id }).update({
        replyCount: thread.replyCount - 1,
      });
    }
    await recordAudit({
      actorId: req.user!.userId,
      action: "forum.post.delete",
      targetType: "forumPost",
      targetId: post.id,
      after: { threadId: post.threadId, byAuthor: post.authorId === req.user!.userId },
      ip: req.ip,
      requestId: req.id ?? null,
    });
    res.json({ message: "Post deleted" });
  } catch (error) {
    reqLog(req).error("forum_post_delete_failed", { error });
    res.status(500).json({ error: "Failed to delete post" });
  }
});

// PUT /community/posts/:id/reactions/:kind — toggle own reaction (F-004).
router.put(
  "/posts/:id/reactions/:kind",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const post = await db.orm.public.ForumPost.where({ id: req.params.id as string }).first();
      if (!post || post.deletedAt) {
        res.status(404).json({ error: "Post not found" });
        return;
      }
      const kind = String(req.params.kind || "LIKE").slice(0, 24);
      const existing = await db.orm.public.ForumReaction.where({
        postId: post.id,
        userId: req.user!.userId,
        kind,
      }).first();
      if (existing) {
        await db.orm.public.ForumReaction.where({ id: existing.id }).delete();
        res.json({ reacted: false, kind });
        return;
      }
      await db.orm.public.ForumReaction.create({
        postId: post.id,
        userId: req.user!.userId,
        kind,
      });
      res.status(201).json({ reacted: true, kind });
    } catch (error) {
      reqLog(req).error("forum_reaction_toggle_failed", { error });
      res.status(500).json({ error: "Failed to toggle reaction" });
    }
  }
);

// POST /community/threads/:id/state — moderation only (F-005), audited.
router.post(
  "/threads/:id/state",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const thread = await db.orm.public.ForumThread.where({ id: req.params.id as string }).first();
      if (!thread) {
        res.status(404).json({ error: "Thread not found" });
        return;
      }
      if (!(await isForumModerator(req, thread))) {
        res.status(403).json({ error: "Moderation access required" });
        return;
      }
      const { state, pinned } = req.body ?? {};
      const update: Record<string, unknown> = {};
      if (state !== undefined) {
        if (!["OPEN", "LOCKED", "ARCHIVED"].includes(state)) {
          res.status(400).json({ error: "state must be OPEN|LOCKED|ARCHIVED" });
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
      if (state && state !== thread.state) {
        await createNotifications([
          {
            recipientId: thread.authorId,
            type: "MODERATION",
            title: `Тема «${thread.title}» переведена в состояние ${state}`,
            entityType: "forumThread",
            entityId: thread.id,
          },
        ]);
      }
      await recordAudit({
        actorId: req.user!.userId,
        action: "forum.thread.state",
        targetType: "forumThread",
        targetId: thread.id,
        before: { state: thread.state, pinned: thread.pinned },
        after: update,
        ip: req.ip,
        requestId: req.id ?? null,
      });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("thread_state_failed", { error });
      res.status(500).json({ error: "Failed to update thread state" });
    }
  }
);

// ---------------------------------------------------------------------------
// Server community surfaces (G) — privacy-gated here, not in the UI (S)
// ---------------------------------------------------------------------------

// GET /community/servers/:slug/threads — server-linked discussions.
router.get("/servers/:slug/threads", standardRateLimit, async (req, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
    if (!server || !isPubliclyVisible(server)) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    if (!server.showCommunity) {
      res.json({ enabled: false, data: [] });
      return;
    }
    const { page, limit, skip } = paging(req.query);
    const threads = await db.orm.public.ForumThread
      .where({ serverId: server.id })
      .orderBy((t: any) => (t.lastPostAt ?? t.createdAt).desc())
      .limit(limit)
      .offset(skip)
      .all();
    const agg = await db.orm.public.ForumThread.where({ serverId: server.id }).aggregate(
      (a: any) => ({ total: a.count() })
    );
    const authors = await publicAuthors(threads.map((t: any) => t.authorId));
    const total = Number(agg.total ?? 0);
    res.json({
      enabled: true,
      data: threads.map((t: any) => ({
        id: t.id,
        title: t.title,
        state: t.state,
        replyCount: t.replyCount,
        lastPostAt: t.lastPostAt,
        createdAt: t.createdAt,
        author: authors.get(t.authorId) ?? null,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    reqLog(req).error("server_threads_failed", { error });
    res.status(500).json({ error: "Failed to fetch server threads" });
  }
});

// GET /community/servers/:slug/members — aggregate always; list only opt-in.
router.get("/servers/:slug/members", standardRateLimit, async (req, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
    if (!server || !isPubliclyVisible(server)) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const followers = await db.orm.public.ServerFollow.where({ serverId: server.id }).aggregate(
      (a: any) => ({ total: a.count() })
    );
    const followerCount = Number(followers.total ?? 0);
    if (!server.showCommunity) {
      res.json({ enabled: false, followerCount, data: [] });
      return;
    }
    const follows = await db.orm.public.ServerFollow
      .where({ serverId: server.id })
      .orderBy((f: any) => f.createdAt.desc())
      .limit(50)
      .all();
    const authors = await publicAuthors(follows.map((f: any) => f.userId));
    res.json({
      enabled: true,
      followerCount,
      data: follows.map((f: any) => ({
        userId: f.userId,
        joinedAt: f.createdAt,
        username: authors.get(f.userId)?.username ?? null,
        displayName: authors.get(f.userId)?.displayName ?? null,
        avatar: authors.get(f.userId)?.avatar ?? null,
      })),
    });
  } catch (error) {
    reqLog(req).error("server_members_failed", { error });
    res.status(500).json({ error: "Failed to fetch community members" });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Global moderators + the linked server's own staff can moderate a thread. */
async function isForumModerator(req: AuthRequest, thread: any): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.role === "ADMIN" || req.user.role === "MODERATOR") return true;
  if (thread?.serverId) {
    const server = await db.orm.public.Server.where({ id: thread.serverId }).first();
    if (server) {
      const role = await loadStaffRole(server, req.user.userId);
      return role !== null;
    }
  }
  return false;
}

function nextPosValue(value: number): number {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

async function threadCardList(threads: any[]): Promise<any[]> {
  const authors = await publicAuthors(threads.map((t: any) => t.authorId));
  return threads.map((t: any) => ({
    id: t.id,
    title: t.title,
    state: t.state,
    pinned: t.pinned,
    replyCount: t.replyCount,
    views: t.views,
    lastPostAt: t.lastPostAt,
    createdAt: t.createdAt,
    author: authors.get(t.authorId) ?? null,
  }));
}

async function threadCardGroup(...groups: any[][]): Promise<{ latest: any[]; active: any[]; pinned: any[] }> {
  const [latest, active, pinned] = groups;
  return {
    latest: await threadCardList(latest),
    active: await threadCardList(active),
    pinned: await threadCardList(pinned),
  };
}

// ---------------------------------------------------------------------------
// PLAN-009: Thread Follow (Community Loop completion). Private relationship:
// aggregate count on the page, follower lists never exposed (§42).
// ---------------------------------------------------------------------------

router.post(
  "/forum/thread/:id/follow",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 60, action: "thread_follow" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const thread = await db.orm.public.ForumThread
        .where({ id: req.params.id as string })
        .first();
      if (!thread) {
        res.status(404).json({ error: "Thread not found" });
        return;
      }
      const existing = await db.orm.public.ForumThreadFollow
        .where({ userId: req.user!.userId, threadId: thread.id })
        .first();
      if (existing) {
        res.status(409).json({ error: "Вы уже следите за этой темой" });
        return;
      }
      await db.orm.public.ForumThreadFollow.create({
        userId: req.user!.userId,
        threadId: thread.id as string,
      });
      const agg = await db.orm.public.ForumThreadFollow
        .where({ threadId: thread.id })
        .aggregate((a: any) => ({ total: a.count() }));
      res.status(201).json({ following: true, followersCount: Number(agg.total ?? 0) });
    } catch (error) {
      reqLog(req).error("thread_follow_failed", { error });
      res.status(500).json({ error: "Failed to follow thread" });
    }
  }
);

router.delete(
  "/forum/thread/:id/follow",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const existing = await db.orm.public.ForumThreadFollow
        .where({ userId: req.user!.userId, threadId: req.params.id as string })
        .first();
      if (!existing) {
        res.status(404).json({ error: "Вы не следите за этой темой" });
        return;
      }
      await db.orm.public.ForumThreadFollow.where({ id: existing.id }).delete();
      const agg = await db.orm.public.ForumThreadFollow
        .where({ threadId: req.params.id as string })
        .aggregate((a: any) => ({ total: a.count() }));
      res.json({ following: false, followersCount: Number(agg.total ?? 0) });
    } catch (error) {
      reqLog(req).error("thread_unfollow_failed", { error });
      res.status(500).json({ error: "Failed to unfollow thread" });
    }
  }
);

export default router;