// Purchase API routes (buying resources)
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { validate } from "../middleware/validate";
import { createResourceCheckout, CommerceError } from "../lib/commerce";
import { userRateLimit } from "../lib/rateLimit";
import { validateCuid } from "../middleware/validateCuid";
import { createPurchaseSchema } from "../lib/validation";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

// POST /purchases - Create purchase (authenticated)
// PLAN C-003/C-012: the checkout creates the Order + OrderItem aggregate and
// a Purchase line. Free/fully-discounted resources complete immediately via
// the same atomic path as paid completions (no payment provider call).
// Discount usage is consumed at completion (C-007), not at checkout.
router.post(
  "/",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60_000, max: 30, action: "checkout" }),
  validate(createPurchaseSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const { resourceSlug, discountCode } = req.body;

      const checkout = await createResourceCheckout({
        userId: req.user!.userId,
        resourceSlug,
        discountCode,
      });

      if (checkout.status === "completed") {
        res.status(201).json({
          orderId: checkout.orderId,
          orderItemId: checkout.orderItemId,
          purchaseId: checkout.purchaseId,
          licenseId: checkout.licenseId,
          status: "completed",
          message: checkout.discountAmount > 0 ? "100% discount applied - free acquisition" : "Free resource acquired",
          discount:
            checkout.discountAmount > 0
              ? {
                  applied: true,
                  amount: checkout.discountAmount,
                  originalPrice: checkout.basePrice,
                  finalPrice: 0,
                }
              : undefined,
        });
        return;
      }

      res.status(201).json({
        orderId: checkout.orderId,
        orderItemId: checkout.orderItemId,
        purchaseId: checkout.purchaseId,
        amount: checkout.finalPrice,
        originalAmount: checkout.basePrice,
        currency: "RUB",
        status: "pending",
        discount:
          checkout.discountAmount > 0
            ? {
                applied: true,
                amount: checkout.discountAmount,
                percentage: Math.round((checkout.discountAmount / checkout.basePrice) * 100),
              }
            : undefined,
        message: "Checkout created - create the payment via /payments/create",
      });
    } catch (error) {
      if (error instanceof CommerceError) {
        reqLog(req).warn("purchase_checkout_rejected", { code: error.code, status: error.status });
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      reqLog(req).error("purchase_create_failed", { error });
      res.status(500).json({ error: "Failed to create purchase" });
    }
  }
);

// GET /purchases/my - Get user's purchases (authenticated)
router.get("/my", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const purchases = await db.orm.public.Purchase.where({ buyerId: req.user!.userId })
      .orderBy((m) => m.createdAt.desc())
      .all();

    // Enrich with resource info
    const enriched = [];
    for (const purchase of purchases) {
      const resource = await db.orm.public.Resource.where({ id: purchase.resourceId }).first();

      const version = await db.orm.public.ResourceVersion.where({ id: purchase.versionId }).first();

      // H-004: the buyer's license state travels with the purchase list
      // (the account page renders it; without it a COMPLETED purchase
      // wrongly shows "license not issued").
      const license =
        purchase.status === "COMPLETED"
          ? await db.orm.public.License.where({ purchaseId: purchase.id }).first()
          : null;

      enriched.push({
        id: purchase.id,
        status: purchase.status,
        priceSnapshot: purchase.priceSnapshot,
        createdAt: purchase.createdAt,
        completedAt: purchase.completedAt,
        resource: resource
          ? {
              slug: resource.slug,
              title: resource.title,
              type: resource.type,
            }
          : null,
        version: version
          ? {
              version: version.version,
            }
          : null,
        license: license
          ? {
              id: license.id,
              status: license.status,
            }
          : null,
      });
    }

    res.json(enriched);
  } catch (error) {
    reqLog(req).error("purchases_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch purchases" });
  }
});

// GET /purchases/:id - Get purchase details (authenticated, owner only)
router.get(
  "/:id",
  authenticate,
  standardRateLimit,
  validateCuid("id"),
  async (req: AuthRequest, res: Response) => {
    try {
      const purchaseId = req.params.id as string;

      const purchase = await db.orm.public.Purchase.where({ id: purchaseId }).first();

      if (!purchase) {
        res.status(404).json({ error: "Purchase not found" });
        return;
      }

      if (purchase.buyerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }

      // Get resource and version info
      const resource = await db.orm.public.Resource.where({ id: purchase.resourceId }).first();

      const version = await db.orm.public.ResourceVersion.where({ id: purchase.versionId }).first();

      // Get license if purchase is completed
      let license = null;
      if (purchase.status === "COMPLETED") {
        license = await db.orm.public.License.where({ purchaseId: purchase.id }).first();
      }

      res.json({
        ...purchase,
        resource,
        version,
        license: license
          ? {
              id: license.id,
              status: license.status,
              serverSerial: license.serverSerial,
              activatedAt: license.activatedAt,
            }
          : null,
      });
    } catch (error) {
      reqLog(req).error("purchase_fetch_failed", { error });
      res.status(500).json({ error: "Failed to fetch purchase" });
    }
  }
);

// POST /purchases/:id/complete - REMOVED for security
// Payment completion MUST only happen via authenticated YooKassa webhook
// See /payments/webhook endpoint in payments.ts

export default router;
