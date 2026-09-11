// PLAN-005 Workstream N: dashboard community data. Uses the existing
// dashboard (no new dashboard) — this endpoint feeds the new widgets:
// owned servers, followed servers, forum activity, unread notifications.
// PLAN-006 Workstream I: GET /dashboard/now — "Сейчас / За ночь" summary
// measured since the user's previous dashboard visit (User.dashboardSeenAt).
// Only real, personal facts (existing relations) — no algorithmic
// personalization (DAILY-EXPERIENCE §6/§15).
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";
import { unreadNotificationCount } from "../lib/notify";

const router: Router = Router();

// First visit baseline: the last 24 hours ("за ночь" semantics). Later
// visits measure from the previous dashboardSeenAt.
const FIRST_VISIT_WINDOW_MS = 24 * 60 * 60 * 1000;

// GET /dashboard/now — summary since last visit. Reads the baseline, computes
// counts from existing personal relations, then advances the baseline.
router.get("/now", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const nowIso = new Date().toISOString();
    const me = await db.orm.public.User.where({ id: userId }).select("dashboardSeenAt").first();
    const previousSeen = me?.dashboardSeenAt as string | null | undefined;
    const since =
      previousSeen ??
      new Date(Date.now() - FIRST_VISIT_WINDOW_MS).toISOString();
    const sinceMs = Date.parse(since);

    // Followed servers (not owned — the owner authored their updates).
    const follows = await db.orm.public.ServerFollow
      .where({ userId })
      .limit(50)
      .all();
    const followedIds = Array.from(new Set(follows.map((f: any) => f.serverId as string)));

    // Updates on followed servers since the last visit.
    const followedUpdates = followedIds.length
      ? await db.orm.public.ServerUpdate
          .where((u: any) => u.serverId.in(followedIds))
          .where((u: any) => u.publishedAt.gte(since))
          .orderBy((u: any) => u.publishedAt.desc())
          .limit(20)
          .all()
      : [];
    // News on followed servers since the last visit (published only).
    const followedNews = followedIds.length
      ? await db.orm.public.ServerNews
          .where((n: any) => n.serverId.in(followedIds))
          .where({ status: "PUBLISHED" })
          .orderBy((n: any) => (n.publishedAt ?? n.createdAt).desc())
          .limit(20)
          .all()
      : [];

    const newsServerIds = Array.from(
      new Set(
        followedNews
          .filter((n: any) => new Date(n.publishedAt ?? n.createdAt).getTime() >= sinceMs)
          .map((n: any) => n.serverId as string)
      )
    );
    const updateServerIds = Array.from(
      new Set([...followedUpdates.map((u: any) => u.serverId as string), ...newsServerIds])
    );
    const updateServers = updateServerIds.length
      ? await db.orm.public.Server
          .where((s: any) => s.id.in(updateServerIds))
          .select("id", "slug", "name")
          .all()
      : [];
    const updateServerById = new Map(updateServers.map((s: any) => [s.id, s]));

    // New replies in threads I authored (others' posts only).
    const myThreads = await db.orm.public.ForumThread
      .where({ authorId: userId })
      .orderBy((t: any) => (t.lastPostAt ?? t.createdAt).desc())
      .limit(50)
      .all();
    const myThreadIds = myThreads.map((t: any) => t.id as string);
    const myThreadById = new Map(myThreads.map((t: any) => [t.id, t]));
    const newReplies = myThreadIds.length
      ? await db.orm.public.ForumPost
          .where((p: any) => p.threadId.in(myThreadIds))
          .where({ deletedAt: null })
          .where((p: any) => p.createdAt.gte(since))
          .orderBy((p: any) => p.createdAt.desc())
          .limit(20)
          .all()
      : [];
    const foreignReplies = newReplies.filter((p: any) => p.authorId !== userId);

    // Updates on purchased resources since the last visit.
    const purchases = await db.orm.public.Purchase
      .where({ buyerId: userId })
      .limit(200)
      .all();
    const purchasedResourceIds = Array.from(
      new Set(purchases.map((p: any) => p.resourceId as string).filter(Boolean))
    ) as string[];
    const purchasedUpdates = purchasedResourceIds.length
      ? await db.orm.public.ResourceVersion
          .where((v: any) => v.resourceId.in(purchasedResourceIds))
          .where({ releaseStatus: "PUBLISHED" })
          .where((v: any) => v.publishedAt.gte(since))
          .orderBy((v: any) => v.publishedAt.desc())
          .limit(20)
          .all()
      : [];
    const purchasedResourceIdsSet = new Set(purchasedResourceIds);
    const purchasedResources = purchasedUpdates.length
      ? await db.orm.public.Resource
          .where((r: any) => r.id.in(Array.from(purchasedResourceIdsSet)))
          .select("id", "slug", "title")
          .all()
      : [];
    const purchasedResourceById = new Map(purchasedResources.map((r: any) => [r.id, r]));

    // PLAN-008: updates on followed creators' resources and followed
    // resources since the last visit (D-004 rows in the summary).
    const creatorFollows = await db.orm.public.SellerFollow
      .where({ followerId: userId })
      .limit(50)
      .all();
    const followedCreatorIds = Array.from(
      new Set(creatorFollows.map((f: any) => f.sellerUserId as string))
    );
    const followedCreatorResources = followedCreatorIds.length
      ? await db.orm.public.Resource
          .where((r: any) => r.sellerId.in(followedCreatorIds))
          .where({ status: "PUBLISHED" })
          .select("id", "slug", "title")
          .all()
      : [];
    const followedCreatorResourceIds = followedCreatorResources.map((r: any) => r.id as string);
    const creatorUpdates = followedCreatorResourceIds.length
      ? await db.orm.public.ResourceVersion
          .where((v: any) => v.resourceId.in(followedCreatorResourceIds))
          .where({ releaseStatus: "PUBLISHED" })
          .where((v: any) => v.publishedAt.gte(since))
          .orderBy((v: any) => v.publishedAt.desc())
          .limit(20)
          .all()
      : [];
    const creatorResourceById = new Map(followedCreatorResources.map((r: any) => [r.id, r]));

    const resourceFollows = await db.orm.public.ResourceFollow
      .where({ userId })
      .limit(50)
      .all();
    const followedResourceIds = Array.from(
      new Set(resourceFollows.map((f: any) => f.resourceId as string))
    );
    const followedResources = followedResourceIds.length
      ? await db.orm.public.Resource
          .where((r: any) => r.id.in(followedResourceIds))
          .select("id", "slug", "title")
          .all()
      : [];
    const resourceUpdates = followedResourceIds.length
      ? await db.orm.public.ResourceVersion
          .where((v: any) => v.resourceId.in(followedResourceIds))
          .where({ releaseStatus: "PUBLISHED" })
          .where((v: any) => v.publishedAt.gte(since))
          .orderBy((v: any) => v.publishedAt.desc())
          .limit(20)
          .all()
      : [];
    const followedResourceById = new Map(followedResources.map((r: any) => [r.id, r]));

    // PLAN-009 D-002: new replies in threads the user follows (since last
    // visit) — the Follow step of the Community Loop reaches the summary.
    const threadFollows = await db.orm.public.ForumThreadFollow
      .where({ userId })
      .limit(100)
      .all();
    const followedThreadIds = Array.from(
      new Set(threadFollows.map((f: any) => f.threadId as string))
    );
    const followedThreads = followedThreadIds.length
      ? await db.orm.public.ForumThread
          .where((t: any) => t.id.in(followedThreadIds))
          .select("id", "title")
          .all()
      : [];
    const followedThreadById = new Map(followedThreads.map((t: any) => [t.id, t]));
    const followedThreadReplies = followedThreadIds.length
      ? await db.orm.public.ForumPost
          .where((p: any) => p.threadId.in(followedThreadIds))
          .where({ deletedAt: null })
          .where((p: any) => p.createdAt.gte(since))
          .orderBy((p: any) => p.createdAt.desc())
          .limit(20)
          .all()
      : [];

    const unread = await unreadNotificationCount(userId);

    const payload = {
      since,
      firstVisit: !previousSeen,
      unreadNotifications: unread,
      serverUpdates: {
        count: followedUpdates.length,
        items: followedUpdates.slice(0, 5).map((u: any) => ({
          id: u.id,
          version: u.version,
          title: u.title,
          publishedAt: u.publishedAt,
          server: updateServerById.get(u.serverId) ?? null,
        })),
      },
      serverNews: {
        count: followedNews.filter(
          (n: any) => new Date(n.publishedAt ?? n.createdAt).getTime() >= sinceMs
        ).length,
        items: followedNews
          .filter((n: any) => new Date(n.publishedAt ?? n.createdAt).getTime() >= sinceMs)
          .slice(0, 5)
          .map((n: any) => ({
            id: n.id,
            title: n.title,
            publishedAt: n.publishedAt ?? n.createdAt,
            server: updateServerById.get(n.serverId) ?? null,
          })),
      },
      discussionReplies: {
        count: foreignReplies.length,
        items: foreignReplies.slice(0, 5).map((p: any) => ({
          threadId: p.threadId,
          threadTitle: myThreadById.get(p.threadId)?.title ?? null,
          createdAt: p.createdAt,
        })),
      },
      purchasedUpdates: {
        count: purchasedUpdates.length,
        items: purchasedUpdates.slice(0, 5).map((v: any) => ({
          id: v.id,
          version: v.version,
          publishedAt: v.publishedAt,
          resource: purchasedResourceById.get(v.resourceId) ?? null,
        })),
      },
      creatorUpdates: {
        count: creatorUpdates.length,
        items: creatorUpdates.slice(0, 5).map((v: any) => ({
          id: v.id,
          version: v.version,
          publishedAt: v.publishedAt,
          resource: creatorResourceById.get(v.resourceId) ?? null,
        })),
      },
      followedResourceUpdates: {
        count: resourceUpdates.length,
        items: resourceUpdates.slice(0, 5).map((v: any) => ({
          id: v.id,
          version: v.version,
          publishedAt: v.publishedAt,
          resource: followedResourceById.get(v.resourceId) ?? null,
        })),
      },
      followedThreadReplies: {
        count: followedThreadReplies.length,
        items: followedThreadReplies.slice(0, 5).map((p: any) => ({
          threadId: p.threadId,
          threadTitle: followedThreadById.get(p.threadId)?.title ?? null,
          createdAt: p.createdAt,
        })),
      },
    };

    // Advance the baseline after computing (I-002). Fire-and-forget would
    // race with the next request; awaited update keeps semantics exact.
    await db.orm.public.User.where({ id: userId }).update({ dashboardSeenAt: nowIso });

    res.json(payload);
  } catch (error) {
    reqLog(req).error("dashboard_now_failed", { error });
    res.status(500).json({ error: "Failed to build dashboard summary" });
  }
});

// GET /dashboard/community — widget payload for My MTA.
router.get("/community", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    // My servers (owner role) with live state.
    const memberships = await db.orm.public.ServerMember
      .where({ userId: req.user!.userId, role: "OWNER" })
      .all();
    const ownedIds = memberships.map((m: any) => m.serverId as string);
    const ownedServers = ownedIds.length
      ? await db.orm.public.Server
          .where((s: any) => s.id.in(ownedIds))
          .orderBy((s: any) => s.updatedAt.desc())
          .limit(6)
          .all()
      : [];

    // Followed servers with their latest activity.
    const follows = await db.orm.public.ServerFollow
      .where({ userId: req.user!.userId })
      .orderBy((f: any) => f.createdAt.desc())
      .limit(20)
      .all();
    const followedIds = follows.map((f: any) => f.serverId as string);
    const followedServers = followedIds.length
      ? await db.orm.public.Server
          .where((s: any) => s.id.in(followedIds))
          .select("id", "slug", "name", "logoUrl", "monitoring", "playerCount")
          .all()
      : [];

    const followedServerIds = followedServers.map((s: any) => s.id as string);
    const latestNews = followedServerIds.length
      ? await db.orm.public.ServerNews
          .where((n: any) => n.serverId.in(followedServerIds))
          .where({ status: "PUBLISHED" })
          .orderBy((n: any) => (n.publishedAt ?? n.createdAt).desc())
          .limit(10)
          .all()
      : [];
    const latestUpdates = followedServerIds.length
      ? await db.orm.public.ServerUpdate
          .where((u: any) => u.serverId.in(followedServerIds))
          .orderBy((u: any) => u.publishedAt.desc())
          .limit(10)
          .all()
      : [];
    const newsServerById = new Map(
      (
        await db.orm.public.Server
          .where((s: any) => s.id.in(Array.from(new Set(latestNews.map((n: any) => n.serverId as string)))))
          .select("id", "slug", "name")
          .all()
      ).map((s: any) => [s.id, s])
    );

    // Forum activity: threads the user authored, with fresh replies.
    const myThreads = await db.orm.public.ForumThread
      .where({ authorId: req.user!.userId })
      .orderBy((t: any) => (t.lastPostAt ?? t.createdAt).desc())
      .limit(6)
      .all();

    const unread = await unreadNotificationCount(req.user!.userId);

    res.json({
      ownedServers: ownedServers.map((s: any) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        monitoring: s.monitoring,
        playerCount: s.showStats ? s.playerCount : null,
        maxPlayers: s.showStats ? s.maxPlayers : null,
        lifecycle: s.lifecycle,
        verification: s.verification,
      })),
      following: followedServers.map((s: any) => ({
        slug: s.slug,
        name: s.name,
        monitoring: s.monitoring,
      })),
      followedNews: latestNews.map((n: any) => ({
        id: n.id,
        title: n.title,
        server: newsServerById.get(n.serverId) ?? null,
        publishedAt: n.publishedAt ?? n.createdAt,
      })),
      updates: latestUpdates.map((u: any) => ({
        id: u.id,
        version: u.version,
        title: u.title,
        serverSlug: followedServers.find((s: any) => s.id === u.serverId)?.slug ?? null,
        publishedAt: u.publishedAt,
      })),
      discussions: myThreads.map((t: any) => ({
        id: t.id,
        title: t.title,
        replyCount: t.replyCount,
        lastPostAt: t.lastPostAt,
        state: t.state,
      })),
      unreadNotifications: unread,
    });
  } catch (error) {
    reqLog(req).error("dashboard_community_failed", { error });
    res.status(500).json({ error: "Failed to fetch community dashboard" });
  }
});

export default router;