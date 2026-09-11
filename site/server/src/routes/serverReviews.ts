// PLAN-005 Workstream J (+K discipline): Server reviews with token-based
// eligibility. A plain registered user CANNOT rate a server: a review is
// allowed only after claiming a valid one-time interaction token issued by
// the server integration (mta-market-module). "✓ Verified Interaction"
// means "the system confirmed an interaction" — nothing about the content.
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit, userRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";
import { bustActivityCache } from "../lib/activity";
import { recordAudit } from "../lib/audit";
import { findActiveReviewToken } from "../lib/serverIntegration";
import { loadStaffRole, isPubliclyVisible } from "../lib/serverAccess";
import { createNotifications } from "../lib/notify";

const router: Router = Router();

// GET /servers/:slug/reviews — public reviews (VISIBLE only) + rating stats.
router.get("/:slug/reviews", standardRateLimit, async (req, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
    if (!server || !isPubliclyVisible(server)) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const page = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "10", 10) || 10, 1), 50);

    const reviews = await db.orm.public.ServerReview
      .where({ serverId: server.id, status: "VISIBLE" })
      .orderBy((m) => m.createdAt.desc())
      .limit(limit)
      .offset((page - 1) * limit)
      .all();

    const agg = await db.orm.public.ServerReview.where({ serverId: server.id, status: "VISIBLE" }).aggregate(
      (a: any) => ({ total: a.count(), avg: a.avg("rating") })
    );
    const total = Number(agg.total ?? 0);
    const avg = agg.avg == null ? null : Number(agg.avg);

    const userIds = Array.from(new Set(reviews.map((r: any) => r.userId as string)));
    const users = userIds.length
      ? await db.orm.public.User
          .where((u: any) => u.id.in(userIds))
          .select("id", "username", "displayName", "avatar")
          .all()
      : [];
    const byId = new Map(users.map((u: any) => [u.id, u]));

    res.json({
      data: reviews.map((r: any) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        verifiedInteraction: r.verifiedInteraction,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        author: {
          id: r.userId,
          username: byId.get(r.userId)?.username ?? null,
          displayName: byId.get(r.userId)?.displayName ?? null,
          avatar: byId.get(r.userId)?.avatar ?? null,
        },
      })),
      stats: {
        total,
        averageRating: avg != null ? Math.round(avg * 10) / 10 : null,
        verifiedCount: (
          await db.orm.public.ServerReview
            .where({ serverId: server.id, status: "VISIBLE", verifiedInteraction: true })
            .aggregate((a: any) => ({ total: a.count() }))
        ).total,
      },
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    reqLog(req).error("server_reviews_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// GET /servers/:slug/reviews/eligibility — the form shows ONLY for eligible
// users (SURFACE §12); everyone else gets an explanation, not a dead form.
router.get(
  "/:slug/reviews/eligibility",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server || !isPubliclyVisible(server)) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const eligibility = await db.orm.public.ServerReviewEligibility
        .where({ serverId: server.id, userId: req.user!.userId })
        .first();
      const existing = await db.orm.public.ServerReview.where({
        serverId: server.id,
        userId: req.user!.userId,
      }).first();
      const isStaff = !!(await loadStaffRole(server, req.user!.userId));
      res.json({
        eligible: !!eligibility,
        reason: isStaff
          ? "Владельцы и персонал сервера не могут оставлять отзывы о своём сервере"
          : eligibility
            ? null
            : "Для отзыва нужно подтвердить взаимодействие с сервером: получите токен в игре и введите его здесь",
        alreadyReviewed: !!existing,
        verifiedInteraction: !!eligibility,
      });
    } catch (error) {
      reqLog(req).error("server_review_eligibility_failed", { error });
      res.status(500).json({ error: "Failed to check review eligibility" });
    }
  }
);

// POST /servers/:slug/review-token/claim — exchange a one-time token for
// eligibility (J-002). Replay/expiry/wrong-server protection lives in
// findActiveReviewToken + the atomic consumption update below.
router.post(
  "/:slug/review-token/claim",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 10, action: "review_token_claim" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server || !isPubliclyVisible(server)) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const token = req.body?.token;
      if (typeof token !== "string") {
        res.status(400).json({ error: "Введите токен из игры" });
        return;
      }
      const lookup = await findActiveReviewToken(token, server.id);
      if (lookup.kind === "unknown") {
        // Do not leak which failure mode occurred (wrong server / forged):
        // one user-facing state for unknown tokens (C-003 discipline).
        res.status(400).json({ error: "Токен недействителен или привязан к другому серверу" });
        return;
      }
      if (lookup.kind === "replayed") {
        // Consumed/expired: an honest replay answer (J-002 replay protection).
        res.status(409).json({ error: "Токен уже использован или истёк" });
        return;
      }
      // Self-review prevention: server staff never gain review eligibility.
      const staffRole = await loadStaffRole(server, req.user!.userId);
      if (staffRole) {
        res.status(403).json({ error: "Владельцы и персонал сервера не могут получать токены своего сервера" });
        return;
      }

      // Replay protection: the conditional update flips ACTIVE -> CONSUMED at
      // most once; a concurrent duplicate claim sees the row already CONSUMED.
      const consumed = await db.orm.public.ServerReviewToken
        .where({ id: lookup.id, status: "ACTIVE" })
        .update({ status: "CONSUMED", consumedAt: new Date().toISOString(), consumedBy: req.user!.userId });
      if (!consumed || (consumed as any).status !== "CONSUMED") {
        res.status(409).json({ error: "Токен уже использован" });
        return;
      }

      const existingEligibility = await db.orm.public.ServerReviewEligibility
        .where({ serverId: server.id, userId: req.user!.userId })
        .first();
      if (!existingEligibility) {
        await db.orm.public.ServerReviewEligibility.create({
          serverId: server.id,
          userId: req.user!.userId,
          tokenId: lookup.id,
        });
      }

      res.status(201).json({ eligible: true, verifiedInteraction: true });
    } catch (error) {
      reqLog(req).error("review_token_claim_failed", { error });
      res.status(500).json({ error: "Failed to claim review token" });
    }
  }
);

// POST /servers/:slug/reviews — create a review; requires eligibility (J-001).
router.post(
  "/:slug/reviews",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 5, action: "server_review_create" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server || !isPubliclyVisible(server)) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const { rating, comment } = req.body ?? {};
      const ratingNum = Math.round(Number(rating));
      if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        res.status(400).json({ error: "Rating must be between 1 and 5" });
        return;
      }
      if (comment !== undefined && comment !== null && typeof comment !== "string") {
        res.status(400).json({ error: "Invalid comment" });
        return;
      }
      const commentText =
        typeof comment === "string" && comment.trim() ? comment.trim().slice(0, 5000) : null;

      const eligibility = await db.orm.public.ServerReviewEligibility
        .where({ serverId: server.id, userId: req.user!.userId })
        .first();
      if (!eligibility) {
        res.status(403).json({
          error: "Отзыв доступен только после подтверждённого взаимодействия с сервером",
        });
        return;
      }

      const existing = await db.orm.public.ServerReview.where({
        serverId: server.id,
        userId: req.user!.userId,
      }).first();
      if (existing) {
        res.status(409).json({ error: "Вы уже оставили отзыв об этом сервере" });
        return;
      }

      const review = await db.orm.public.ServerReview.create({
        serverId: server.id,
        userId: req.user!.userId,
        rating: ratingNum,
        comment: commentText,
        verifiedInteraction: true,
        status: "VISIBLE",
      });

      // REVIEW_EVENT → server owner learns about the new review (M-002).
      await createNotifications([
        {
          recipientId: server.ownerId,
          type: "REVIEW_EVENT",
          title: `Новый отзыв (${ratingNum}/5) о сервере «${server.name}»`,
          entityType: "serverReview",
          entityId: review.id,
        },
      ]);

      // PLAN-006: NEW_REVIEW is a high-value activity item.
      await bustActivityCache();
      res.status(201).json(review);
    } catch (error) {
      reqLog(req).error("server_review_create_failed", { error });
      res.status(500).json({ error: "Failed to create review" });
    }
  }
);

// PATCH /servers/:slug/reviews — update own review (rating/comment only).
router.patch(
  "/:slug/reviews",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const review = await db.orm.public.ServerReview.where({
        serverId: server.id,
        userId: req.user!.userId,
      }).first();
      if (!review) {
        res.status(404).json({ error: "Review not found" });
        return;
      }
      const { rating, comment } = req.body ?? {};
      const update: Record<string, unknown> = {};
      if (rating !== undefined) {
        const ratingNum = Math.round(Number(rating));
        if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
          res.status(400).json({ error: "Rating must be between 1 and 5" });
          return;
        }
        update.rating = ratingNum;
      }
      if (comment !== undefined) {
        update.comment =
          comment === null || (typeof comment === "string" && !comment.trim())
            ? null
            : String(comment).trim().slice(0, 5000);
      }
      const updated = await db.orm.public.ServerReview.where({ id: review.id }).update(update);
      res.json(updated);
    } catch (error) {
      reqLog(req).error("server_review_update_failed", { error });
      res.status(500).json({ error: "Failed to update review" });
    }
  }
);

// DELETE /servers/:slug/reviews — the author may withdraw their review.
// Eligibility survives (anti-abuse): a withdrawn voice is not a fresh vote.
router.delete(
  "/:slug/reviews",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      await db.orm.public.ServerReview.where({
        serverId: server.id,
        userId: req.user!.userId,
      }).delete();
      res.json({ message: "Review deleted" });
    } catch (error) {
      reqLog(req).error("server_review_delete_failed", { error });
      res.status(500).json({ error: "Failed to delete review" });
    }
  }
);

export default router;