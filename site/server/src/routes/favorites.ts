// PLAN-018 I-002: favorites across the four supported surfaces
// (resources / servers / creators / forum discussions).
//
// Root-mounted router (app.ts: app.use("/", favoritesRoutes)) — every path
// inside this file is ABSOLUTE. Favorites are private bookmarks: only the
// owner's own list is exposed (/me/favorites), grouped with subject cards.
// Toggles are idempotent (repeat PUT/DELETE keeps the same state and never
// 409s — unlike follows, favoriting is a bookmark, not a relationship).
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit, userRateLimit } from "../lib/rateLimit.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { isPubliclyVisible } from "../lib/serverAccess.js";

const router: Router = Router();

type FavoriteTargetType = "RESOURCE" | "SERVER" | "CREATOR" | "DISCUSSION";
const FAVORITE_TYPES: readonly FavoriteTargetType[] = ["RESOURCE", "SERVER", "CREATOR", "DISCUSSION"];
const FAVORITES_LIST_MAX = 100;

interface ResolvedTarget {
  id: string;
  kind: FavoriteTargetType;
}

/**
 * Resolves the favoritable target for one surface. Returns null when the
 * target does not exist (or is not publicly visible yet) — the caller maps
 * that to 404 so unknown targets never leak their existence.
 */
async function resolveTarget(kind: FavoriteTargetType, identifier: string): Promise<ResolvedTarget | null> {
  if (kind === "RESOURCE") {
    // Only PUBLISHED resources are favoritable (same gate as follows).
    const resource = await db.orm.public.Resource
      .where({ slug: identifier })
      .select("id", "status")
      .first();
    if (!resource || resource.status !== "PUBLISHED") return null;
    return { id: resource.id as string, kind };
  }
  if (kind === "SERVER") {
    const server = await db.orm.public.Server
      .where({ slug: identifier })
      .select("id", "lifecycle")
      .first();
    if (!server || !isPubliclyVisible(server as any)) return null;
    return { id: server.id as string, kind };
  }
  if (kind === "CREATOR") {
    // A creator is a User with an APPROVED SellerProfile (follows.ts precedent);
    // the favorite's targetId is the seller's userId.
    const user = await db.orm.public.User
      .where({ username: identifier, status: "ACTIVE" })
      .select("id")
      .first();
    if (!user) return null;
    const profile = await db.orm.public.SellerProfile
      .where({ userId: user.id as string, status: "APPROVED" })
      .select("id")
      .first();
    if (!profile) return null;
    return { id: user.id as string, kind };
  }
  // DISCUSSION: any forum thread by id (state does not block bookmarking).
  const thread = await db.orm.public.ForumThread
    .where({ id: identifier })
    .select("id")
    .first();
  if (!thread) return null;
  return { id: thread.id as string, kind };
}

/** Idempotent PUT: creates the favorite or keeps the existing one. */
async function putFavorite(req: AuthRequest, res: Response, kind: FavoriteTargetType, identifier: string) {
  try {
    const target = await resolveTarget(kind, identifier);
    if (!target) {
      res.status(404).json({ error: "Target not found" });
      return;
    }
    const existing = await db.orm.public.Favorite
      .where({ userId: req.user!.userId, targetType: kind, targetId: target.id })
      .select("id")
      .first();
    if (!existing) {
      await db.orm.public.Favorite.create({
        userId: req.user!.userId,
        targetType: kind,
        targetId: target.id,
      });
    }
    res.json({ favorited: true, targetType: kind, targetId: target.id });
  } catch (error) {
    reqLog(req).error("favorite_put_failed", { error, kind });
    res.status(500).json({ error: "Failed to favorite" });
  }
}

/** Idempotent DELETE: removes the favorite or reports the unchanged state. */
async function deleteFavorite(req: AuthRequest, res: Response, kind: FavoriteTargetType, identifier: string) {
  try {
    const target = await resolveTarget(kind, identifier);
    if (!target) {
      res.status(404).json({ error: "Target not found" });
      return;
    }
    await db.orm.public.Favorite
      .where({ userId: req.user!.userId, targetType: kind, targetId: target.id })
      .delete();
    res.json({ favorited: false, targetType: kind, targetId: target.id });
  } catch (error) {
    reqLog(req).error("favorite_delete_failed", { error, kind });
    res.status(500).json({ error: "Failed to unfavorite" });
  }
}

// ---------------------------------------------------------------------------
// Toggle endpoints — one pair per surface
// ---------------------------------------------------------------------------

// RESOURCE: /resources/:slug/favorite
router.put(
  "/resources/:slug/favorite",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 120, action: "favorite_toggle" }),
  (req: AuthRequest, res: Response) => putFavorite(req, res, "RESOURCE", req.params.slug as string)
);
router.delete(
  "/resources/:slug/favorite",
  authenticate,
  standardRateLimit,
  (req: AuthRequest, res: Response) => deleteFavorite(req, res, "RESOURCE", req.params.slug as string)
);

// SERVER: /servers/:slug/favorite
router.put(
  "/servers/:slug/favorite",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 120, action: "favorite_toggle" }),
  (req: AuthRequest, res: Response) => putFavorite(req, res, "SERVER", req.params.slug as string)
);
router.delete(
  "/servers/:slug/favorite",
  authenticate,
  standardRateLimit,
  (req: AuthRequest, res: Response) => deleteFavorite(req, res, "SERVER", req.params.slug as string)
);

// CREATOR: /sellers/:username/favorite (storefront path is /sellers/:username)
router.put(
  "/sellers/:username/favorite",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 120, action: "favorite_toggle" }),
  (req: AuthRequest, res: Response) => putFavorite(req, res, "CREATOR", req.params.username as string)
);
router.delete(
  "/sellers/:username/favorite",
  authenticate,
  standardRateLimit,
  (req: AuthRequest, res: Response) => deleteFavorite(req, res, "CREATOR", req.params.username as string)
);

// DISCUSSION: /community/forum/thread/:id/favorite — falls through the
// community router (which owns follow/state on the same path prefix).
router.put(
  "/community/forum/thread/:id/favorite",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 120, action: "favorite_toggle" }),
  (req: AuthRequest, res: Response) => putFavorite(req, res, "DISCUSSION", req.params.id as string)
);
router.delete(
  "/community/forum/thread/:id/favorite",
  authenticate,
  standardRateLimit,
  (req: AuthRequest, res: Response) => deleteFavorite(req, res, "DISCUSSION", req.params.id as string)
);

// ---------------------------------------------------------------------------
// GET /me/favorites?type= — the owner's own bookmarks, grouped by target
// type with batched subject cards (bounded 100 newest).
// ---------------------------------------------------------------------------

// DELETE /me/favorites/:favoriteId — owner-scoped removal by favorite row id.
// Needed for stale rows whose target no longer resolves (the per-target
// DELETE returns 404 once the target is hard-deleted — Wave-6 frontend
// deviation #3); this endpoint removes the bookmark regardless of target
// state.
router.delete("/me/favorites/:favoriteId", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const favoriteId = String(req.params.favoriteId ?? "");
    if (!favoriteId || favoriteId.length < 10 || favoriteId.length > 64) {
      res.status(400).json({ error: "Invalid favorite id" });
      return;
    }
    const favorite = await db.orm.public.Favorite
      .where({ id: favoriteId })
      .select("id", "userId")
      .first();
    if (!favorite || favorite.userId !== req.user!.userId) {
      res.status(404).json({ error: "Favorite not found" });
      return;
    }
    const deleted = await db.orm.public.Favorite
      .where({ id: favorite.id })
      .delete();
    if (!deleted) {
      res.status(404).json({ error: "Favorite not found" });
      return;
    }
    res.json({ removed: true, id: favorite.id });
  } catch (error) {
    reqLog(req).error("favorite_remove_failed", { error });
    res.status(500).json({ error: "Failed to remove favorite" });
  }
});

router.get("/me/favorites", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const rawType = req.query.type ? String(req.query.type) : null;
    if (rawType && !(FAVORITE_TYPES as readonly string[]).includes(rawType)) {
      res.status(400).json({ error: `type must be one of: ${FAVORITE_TYPES.join(", ")}` });
      return;
    }
    const where: Record<string, unknown> = { userId: req.user!.userId };
    if (rawType) where.targetType = rawType;
    const favorites = (await db.orm.public.Favorite
      .where(where as any)
      .orderBy((f: any) => f.createdAt.desc())
      .limit(FAVORITES_LIST_MAX)
      .all()) as any[];

    const groups: Record<FavoriteTargetType, any[]> = { RESOURCE: [], SERVER: [], CREATOR: [], DISCUSSION: [] };
    const idsByType = new Map<FavoriteTargetType, string[]>();
    for (const f of favorites) {
      const kind = f.targetType as FavoriteTargetType;
      if (!FAVORITE_TYPES.includes(kind)) continue;
      const list = idsByType.get(kind) ?? [];
      list.push(f.targetId as string);
      idsByType.set(kind, list);
    }

    // Batched subject cards per type (one query per type, never per row).
    const subjectByType = new Map<FavoriteTargetType, Map<string, any>>();
    const resourceIds = idsByType.get("RESOURCE") ?? [];
    if (resourceIds.length) {
      const rows = await db.orm.public.Resource
        .where((r: any) => r.id.in(resourceIds))
        .select("id", "slug", "title", "coverUrl", "price")
        .all();
      subjectByType.set("RESOURCE", new Map(rows.map((r: any) => [r.id as string, r])));
    }
    const serverIds = idsByType.get("SERVER") ?? [];
    if (serverIds.length) {
      const rows = await db.orm.public.Server
        .where((s: any) => s.id.in(serverIds))
        .select("id", "slug", "name", "logoUrl")
        .all();
      subjectByType.set("SERVER", new Map(rows.map((r: any) => [r.id as string, r])));
    }
    const creatorIds = idsByType.get("CREATOR") ?? [];
    if (creatorIds.length) {
      const rows = await db.orm.public.User
        .where((u: any) => u.id.in(creatorIds))
        .select("id", "username", "displayName", "avatar")
        .all();
      subjectByType.set("CREATOR", new Map(rows.map((r: any) => [r.id as string, r])));
    }
    const threadIds = idsByType.get("DISCUSSION") ?? [];
    if (threadIds.length) {
      const rows = await db.orm.public.ForumThread
        .where((t: any) => t.id.in(threadIds))
        .select("id", "title", "state", "replyCount", "lastPostAt")
        .all();
      subjectByType.set("DISCUSSION", new Map(rows.map((r: any) => [r.id as string, r])));
    }

    let total = 0;
    for (const f of favorites) {
      const kind = f.targetType as FavoriteTargetType;
      if (!FAVORITE_TYPES.includes(kind)) continue;
      const subject = subjectByType.get(kind)?.get(f.targetId as string) ?? null;
      // Stale favorites (target deleted) are reported as null subjects rather
      // than dropped — the owner can still unfavorite them.
      groups[kind].push({
        id: f.id,
        targetType: kind,
        targetId: f.targetId,
        createdAt: f.createdAt,
        subject,
      });
      total += 1;
    }

    res.json({ total, data: groups });
  } catch (error) {
    reqLog(req).error("me_favorites_failed", { error });
    res.status(500).json({ error: "Failed to fetch favorites" });
  }
});

export default router;