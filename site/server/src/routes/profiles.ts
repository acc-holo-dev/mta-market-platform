// PLAN-005 Workstreams O/P: public profile + creator identity.
// One user, one identity: Server Owner / Verified Seller badges coexist on a
// single profile. Private data never leaves the backend: email, purchases,
// balance and private deals are not returned here.
import { Router, Response } from "express";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

// GET /profiles/:username — public identity surface.
router.get("/:username", standardRateLimit, async (req, res: Response) => {
  try {
    const username = req.params.username as string;
    const user = await db.orm.public.User
      .where({ username, status: "ACTIVE" })
      .select("id", "username", "displayName", "avatar", "createdAt")
      .first();
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Public servers: only VERIFIED/ACTIVE ones the user owns.
    const ownedMemberships = await db.orm.public.ServerMember
      .where({ userId: user.id, role: "OWNER" })
      .all();
    const ownedIds = ownedMemberships.map((m: any) => m.serverId as string);
    const ownedServers = ownedIds.length
      ? await db.orm.public.Server
          .where((s: any) => s.id.in(ownedIds))
          .where((s: any) => s.lifecycle.in(["VERIFIED", "ACTIVE"]))
          .all()
      : [];

    // Public marketplace resources.
    const resources = await db.orm.public.Resource
      .where({ sellerId: user.id, status: "PUBLISHED" })
      .select("id", "slug", "title", "description", "coverUrl", "type", "price", "createdAt")
      .limit(24)
      .all();

    const sellerProfile = await db.orm.public.SellerProfile.where({ userId: user.id }).first();

    // Badges reflect real, verifiable conditions (MODEL: no badge inflation).
    const badges: string[] = [];
    if (ownedServers.length > 0) badges.push("SERVER_OWNER");
    if (ownedServers.some((s: any) => s.verification === "VERIFIED")) badges.push("VERIFIED_SERVER");
    if (sellerProfile?.status === "APPROVED") badges.push("VERIFIED_SELLER");

    const followerCounts = await Promise.all(
      ownedServers.map(async (s: any) => {
        const agg = await db.orm.public.ServerFollow.where({ serverId: s.id }).aggregate(
          (a: any) => ({ total: a.count() })
        );
        return Number(agg.total ?? 0);
      })
    );

    // Public forum identity: participation counts only.
    const [threadAgg, postAgg] = await Promise.all([
      db.orm.public.ForumThread.where({ authorId: user.id }).aggregate((a: any) => ({ total: a.count() })),
      db.orm.public.ForumPost.where({ authorId: user.id, deletedAt: null }).aggregate(
        (a: any) => ({ total: a.count() })
      ),
    ]);

    res.json({
      profile: {
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar,
        memberSince: user.createdAt,
      },
      badges,
      servers: ownedServers.map((s: any, i: number) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        logoUrl: s.logoUrl,
        bannerUrl: s.bannerUrl,
        monitoring: s.monitoring,
        playerCount: s.showStats ? s.playerCount : null,
        maxPlayers: s.showStats ? s.maxPlayers : null,
        verification: s.verification,
        followerCount: followerCounts[i],
      })),
      resources,
      forumActivity: {
        threadCount: Number(threadAgg.total ?? 0),
        postCount: Number(postAgg.total ?? 0),
      },
      // PLAN-007 E-003: published articles of the author (public only).
      articles: (
        await db.orm.public.Article
          .where({ authorId: user.id, status: "PUBLISHED" })
          .orderBy((a: any) => (a.publishedAt ?? a.createdAt).desc())
          .limit(6)
          .all()
      ).map((a: any) => ({
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        coverUrl: a.coverUrl,
        category: a.category,
        publishedAt: a.publishedAt ?? a.createdAt,
      })),
    });
  } catch (error) {
    reqLog(req).error("profile_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

export default router;