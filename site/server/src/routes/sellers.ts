// PLAN-003 E-001..E-004: public seller storefront.
//
// GET /sellers/:username — product-oriented public identity of a seller:
// avatar, name, member-since, resource count and the published resources.
// Непубличные ресурсы не отдаются (только PUBLISHED).
import { Router, Response } from "express";
import { db } from "../prisma/db";
import { standardRateLimit } from "../lib/rateLimit";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

router.get("/:username", standardRateLimit, async (req, res: Response) => {
  try {
    const username = req.params.username as string;

    const user = await db.orm.public.User
      .where({ username, status: "ACTIVE" })
      .select("id", "username", "displayName", "avatar", "createdAt")
      .first();

    if (!user) {
      res.status(404).json({ error: "Seller not found" });
      return;
    }

    const profile = await db.orm.public.SellerProfile.where({ userId: user.id }).first();

    // Публичная витрина существует, только если у продавца есть опубликованные
    // ресурсы (или одобренный профиль — тогда шапка магазина без ресурсов).
    const hasApprovedProfile = profile?.status === "APPROVED";

    const cards = await db.orm.public.Resource
      .where({ sellerId: user.id, status: "PUBLISHED" })
      .include("reviews", (r: any) => r.combine({ total: r.count(), avg: r.avg("rating") }))
      .orderBy((m: any) => m.createdAt.desc())
      .all();

    if (!hasApprovedProfile && cards.length === 0) {
      res.status(404).json({ error: "Seller not found" });
      return;
    }

    const resources = cards.map((r: any) => {
      const agg = r.reviews as { total?: number; avg?: number | null } | undefined;
      const total = Number(agg?.total ?? 0);
      const average = agg?.avg != null ? Number(agg.avg) : null;
      const { reviews: _reviews, ...rest } = r;
      return {
        ...rest,
        rating: total > 0 && average != null ? Math.round(average * 10) / 10 : null,
        reviewCount: total,
      };
    });

    // PLAN-008: aggregate follower count only — the follower list is never
    // exposed (DAILY-EXPERIENCE §42).
    const followersAgg = await db.orm.public.SellerFollow
      .where({ sellerUserId: user.id })
      .aggregate((a: any) => ({ total: a.count() }));

    res.json({
      seller: {
        username: user.username,
        displayName: profile?.displayName || user.displayName || user.username,
        avatar: user.avatar,
        supportInfo: hasApprovedProfile ? profile?.supportInfo ?? null : null,
        memberSince: user.createdAt,
        resourceCount: resources.length,
        creatorFollowers: Number(followersAgg.total ?? 0),
      },
      resources,
    });
  } catch (error) {
    reqLog(req).error("seller_store_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch seller store" });
  }
});

export default router;
