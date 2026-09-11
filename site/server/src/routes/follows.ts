// PLAN-008 Workstreams B/C: Follow Expansion (Creator + Resource).
// Follows are PRIVATE relationships (DAILY-EXPERIENCE §42): only aggregate
// counts are public; follower lists are never exposed. /me/follows/* returns
// the user's OWN follows only. Delivery hooks live in the mutation sites
// (admin.ts: resource publish + version release; adminContent.ts: article
// publish) — see lib/follows.ts helpers.
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

// ---------- creator follow (B-001) ----------

// POST /creators/:username/follow — target must be a User with an APPROVED
// SellerProfile; self-follow is forbidden; duplicates → 409.
router.post("/creators/:username/follow", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const target = await db.orm.public.User
      .where({ username: req.params.username as string })
      .select("id", "username")
      .first();
    if (!target) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }
    if (target.id === req.user!.userId) {
      res.status(400).json({ error: "Нельзя подписаться на себя" });
      return;
    }
    const profile = await db.orm.public.SellerProfile
      .where({ userId: target.id, status: "APPROVED" })
      .first();
    if (!profile) {
      res.status(404).json({ error: "Это не создатель (нет одобренного профиля продавца)" });
      return;
    }
    const existing = await db.orm.public.SellerFollow
      .where({ followerId: req.user!.userId, sellerUserId: target.id })
      .first();
    if (existing) {
      res.status(409).json({ error: "Вы уже подписаны" });
      return;
    }
    await db.orm.public.SellerFollow.create({
      followerId: req.user!.userId,
      sellerUserId: target.id as string,
    });
    const count = await db.orm.public.SellerFollow
      .where({ sellerUserId: target.id })
      .aggregate((a: any) => ({ total: a.count() }));
    res.status(201).json({ following: true, creatorFollowers: Number(count.total ?? 0) });
  } catch (error) {
    reqLog(req).error("creator_follow_failed", { error });
    res.status(500).json({ error: "Failed to follow creator" });
  }
});

// DELETE /creators/:username/follow — unfollow; not following → 404.
router.delete("/creators/:username/follow", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const target = await db.orm.public.User
      .where({ username: req.params.username as string })
      .select("id")
      .first();
    if (!target) {
      res.status(404).json({ error: "Creator not found" });
      return;
    }
    const existing = await db.orm.public.SellerFollow
      .where({ followerId: req.user!.userId, sellerUserId: target.id })
      .first();
    if (!existing) {
      res.status(404).json({ error: "Вы не подписаны" });
      return;
    }
    await db.orm.public.SellerFollow.where({ id: existing.id }).delete();
    const count = await db.orm.public.SellerFollow
      .where({ sellerUserId: target.id })
      .aggregate((a: any) => ({ total: a.count() }));
    res.json({ following: false, creatorFollowers: Number(count.total ?? 0) });
  } catch (error) {
    reqLog(req).error("creator_unfollow_failed", { error });
    res.status(500).json({ error: "Failed to unfollow creator" });
  }
});

// ---------- resource follow (B-002) ----------

// POST /resources/:slug/follow — target must be PUBLISHED; sellers cannot
// follow their own resource (self-follow forbidden); duplicates → 409.
router.post("/resources/:slug/follow", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const resource = await db.orm.public.Resource
      .where({ slug: req.params.slug as string })
      .select("id", "slug", "sellerId", "status")
      .first();
    if (!resource || resource.status !== "PUBLISHED") {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    if (resource.sellerId === req.user!.userId) {
      res.status(400).json({ error: "Нельзя следить за своим ресурсом" });
      return;
    }
    const existing = await db.orm.public.ResourceFollow
      .where({ userId: req.user!.userId, resourceId: resource.id })
      .first();
    if (existing) {
      res.status(409).json({ error: "Вы уже следите за этим ресурсом" });
      return;
    }
    await db.orm.public.ResourceFollow.create({
      userId: req.user!.userId,
      resourceId: resource.id as string,
    });
    const count = await db.orm.public.ResourceFollow
      .where({ resourceId: resource.id })
      .aggregate((a: any) => ({ total: a.count() }));
    res.status(201).json({ following: true, resourceFollowers: Number(count.total ?? 0) });
  } catch (error) {
    reqLog(req).error("resource_follow_failed", { error });
    res.status(500).json({ error: "Failed to follow resource" });
  }
});

// DELETE /resources/:slug/follow — unfollow; not following → 404.
router.delete("/resources/:slug/follow", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const resource = await db.orm.public.Resource
      .where({ slug: req.params.slug as string })
      .select("id")
      .first();
    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    const existing = await db.orm.public.ResourceFollow
      .where({ userId: req.user!.userId, resourceId: resource.id })
      .first();
    if (!existing) {
      res.status(404).json({ error: "Вы не следите за этим ресурсом" });
      return;
    }
    await db.orm.public.ResourceFollow.where({ id: existing.id }).delete();
    const count = await db.orm.public.ResourceFollow
      .where({ resourceId: resource.id })
      .aggregate((a: any) => ({ total: a.count() }));
    res.json({ following: false, resourceFollowers: Number(count.total ?? 0) });
  } catch (error) {
    reqLog(req).error("resource_unfollow_failed", { error });
    res.status(500).json({ error: "Failed to unfollow resource" });
  }
});

// ---------- own follow state (§ privacy: only own lists) ----------

router.get("/me/follows/creators", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db.orm.public.SellerFollow
      .where({ followerId: req.user!.userId })
      .limit(200)
      .all();
    const sellerIds = rows.map((r: any) => r.sellerUserId as string);
    const sellers = sellerIds.length
      ? await db.orm.public.User
          .where((u: any) => u.id.in(sellerIds))
          .select("id", "username", "displayName", "avatar")
          .all()
      : [];
    res.json({ data: sellers });
  } catch (error) {
    reqLog(req).error("me_follows_creators_failed", { error });
    res.status(500).json({ error: "Failed to fetch creator follows" });
  }
});

// PLAN-009: own thread follows (private list, §42).
router.get("/me/follows/threads", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db.orm.public.ForumThreadFollow
      .where({ userId: req.user!.userId })
      .limit(200)
      .all();
    const threadIds = rows.map((r: any) => r.threadId as string);
    const threads = threadIds.length
      ? await db.orm.public.ForumThread
          .where((t: any) => t.id.in(threadIds))
          .select("id", "title", "state", "replyCount", "lastPostAt")
          .all()
      : [];
    res.json({ data: threads });
  } catch (error) {
    reqLog(req).error("me_follows_threads_failed", { error });
    res.status(500).json({ error: "Failed to fetch thread follows" });
  }
});

router.get("/me/follows/resources", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db.orm.public.ResourceFollow
      .where({ userId: req.user!.userId })
      .limit(200)
      .all();
    const resourceIds = rows.map((r: any) => r.resourceId as string);
    const resources = resourceIds.length
      ? await db.orm.public.Resource
          .where((r: any) => r.id.in(resourceIds))
          .select("id", "slug", "title", "coverUrl")
          .all()
      : [];
    res.json({ data: resources });
  } catch (error) {
    reqLog(req).error("me_follows_resources_failed", { error });
    res.status(500).json({ error: "Failed to fetch resource follows" });
  }
});

export default router;
