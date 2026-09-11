// Reviews API routes
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { userRateLimit } from "../lib/rateLimit";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

// GET /resources/:slug/reviews - Get reviews for a resource
router.get("/:slug/reviews", standardRateLimit, async (req, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const { page = "1", limit = "10" } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = Math.min(parseInt(limit as string, 10), 50);
    const skip = (pageNum - 1) * limitNum;

    const resource = await db.orm.public.Resource.where({ slug }).first();

    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    if (resource.status !== "PUBLISHED") {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    // PLAN B-004: honest pagination — COUNT aggregate for the total, SQL
    // limit/offset for the page. Average rating is computed over ALL reviews
    // via an aggregate, not over the current page.
    const reviews = await db.orm.public.Review.where({ resourceId: resource.id })
      .orderBy((m) => m.createdAt.desc())
      .limit(limitNum)
      .offset(skip)
      .all();

    const countResult = await db.orm.public.Review.where({ resourceId: resource.id }).aggregate(
      (agg: any) => ({ total: agg.count(), averageRating: agg.avg("rating") })
    );
    const total = Number(countResult.total);
    const avgRating = Number(countResult.averageRating ?? 0);

    res.json({
      data: reviews,
      stats: {
        total,
        averageRating: Math.round(avgRating * 10) / 10,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    reqLog(req).error("reviews_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

// POST /resources/:slug/reviews - Create review (authenticated, purchased only)
router.post(
  "/:slug/reviews",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 20, action: "review_create" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const slug = req.params.slug as string;
      const { rating, comment } = req.body;

      if (!rating || rating < 1 || rating > 5) {
        res.status(400).json({ error: "Rating must be between 1 and 5" });
        return;
      }

      const resource = await db.orm.public.Resource.where({ slug }).first();

      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      if (resource.status !== "PUBLISHED") {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      // Check if user purchased this resource
      const purchase = await db.orm.public.Purchase.where({
        buyerId: req.user!.userId,
        resourceId: resource.id,
        status: "COMPLETED",
      }).first();

      if (!purchase) {
        res.status(403).json({ error: "You must purchase this resource to review it" });
        return;
      }

      // PLAN K-001: self-purchase reviews are review fraud — the resource
      // seller can never review their own listing.
      if (resource.sellerId === req.user!.userId) {
        res.status(403).json({ error: "You cannot review your own resource" });
        return;
      }

      // Check if review already exists
      const existing = await db.orm.public.Review.where({
        resourceId: resource.id,
        buyerId: req.user!.userId,
      }).first();

      if (existing) {
        res.status(409).json({ error: "You have already reviewed this resource" });
        return;
      }

      const review = await db.orm.public.Review.create({
        resourceId: resource.id,
        buyerId: req.user!.userId,
        rating: Math.round(rating),
        comment: comment || null,
      });

      res.status(201).json(review);
    } catch (error) {
      reqLog(req).error("review_create_failed", { error });
      res.status(500).json({ error: "Failed to create review" });
    }
  }
);

// PATCH /resources/:slug/reviews - Update own review (authenticated)
router.patch(
  "/:slug/reviews",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const slug = req.params.slug as string;
      const { rating, comment } = req.body;

      const resource = await db.orm.public.Resource.where({ slug }).first();

      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      const review = await db.orm.public.Review.where({
        resourceId: resource.id,
        buyerId: req.user!.userId,
      }).first();

      if (!review) {
        res.status(404).json({ error: "Review not found" });
        return;
      }

      const updateData: any = {};
      if (rating !== undefined && rating >= 1 && rating <= 5) {
        updateData.rating = Math.round(rating);
      }
      if (comment !== undefined) {
        updateData.comment = comment || null;
      }

      const updated = await db.orm.public.Review.where({ id: review.id }).update(updateData);

      res.json(updated);
    } catch (error) {
      reqLog(req).error("review_update_failed", { error });
      res.status(500).json({ error: "Failed to update review" });
    }
  }
);

// DELETE /resources/:slug/reviews - Delete own review (authenticated)
router.delete(
  "/:slug/reviews",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const slug = req.params.slug as string;

      const resource = await db.orm.public.Resource.where({ slug }).first();

      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      const review = await db.orm.public.Review.where({
        resourceId: resource.id,
        buyerId: req.user!.userId,
      }).first();

      if (!review) {
        res.status(404).json({ error: "Review not found" });
        return;
      }

      await db.orm.public.Review.where({ id: review.id }).delete();

      res.json({ message: "Review deleted successfully" });
    } catch (error) {
      reqLog(req).error("review_delete_failed", { error });
      res.status(500).json({ error: "Failed to delete review" });
    }
  }
);

export default router;
