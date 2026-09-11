// Services API routes (PLAN C-009/C-010/C-011).
// Lifecycle: DRAFT -> PENDING_REVIEW -> PUBLISHED (seller cannot publish own
// service — same policy as resource moderation, A-008) and order lifecycle
// PENDING -> IN_PROGRESS -> DELIVERED -> ACCEPTED -> CLOSED (alt: CANCELLED,
// DISPUTED). Service orders never create DRM licenses (INV-015).
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { createServiceCheckout, CommerceError } from "../lib/commerce";
import { affectedCount } from "../lib/discount";
import { canCreateListings, sellerGateMessage } from "../lib/permissions";
import { settleServiceRevenue } from "../lib/ledger";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

/** Moderation/publish permission: admins and moderators only. */
function isModerator(role: string): boolean {
  return role === "ADMIN" || role === "MODERATOR";
}

/** Revision policy (C-011): a buyer may request at most this many revisions. */
const MAX_REVISIONS_PER_ORDER = 3;

function makeSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
  return `${base || "service"}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

// ---------------------------------------------------------------------------
// Catalog + seller CRUD
// ---------------------------------------------------------------------------

// GET /services - Published catalog
router.get("/", standardRateLimit, async (_req, res: Response) => {
  try {
    const services = await db.orm.public.Service.where({ status: "PUBLISHED" })
      .orderBy((m) => m.createdAt.desc())
      .all();
    res.json({ data: services, total: services.length });
  } catch (error) {
    reqLog(_req).error("services_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

// GET /services/my - Seller's own services (must be before :slug)
router.get("/my", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const services = await db.orm.public.Service.where({ sellerId: req.user!.userId })
      .orderBy((m) => m.createdAt.desc())
      .all();
    res.json({ data: services, total: services.length });
  } catch (error) {
    reqLog(req).error("services_my_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

// POST /services - Create service (authenticated seller)
router.post("/", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, type, price, deliveryDays, requirements } = req.body;

    if (!title || !description || !type || price == null || !deliveryDays) {
      res.status(400).json({ error: "title, description, type, price, deliveryDays are required" });
      return;
    }
    if (price < 0 || deliveryDays < 1) {
      res.status(400).json({ error: "price must be >= 0 and deliveryDays >= 1" });
      return;
    }

    // PLAN L-002: service creation requires an APPROVED seller profile.
    if (!(await canCreateListings({ userId: req.user!.userId, role: req.user!.role as "USER" | "ADMIN" | "MODERATOR" }))) {
      res.status(403).json({ error: sellerGateMessage(), code: "seller_approval_required" });
      return;
    }

    const service = await db.orm.public.Service.create({
      sellerId: req.user!.userId,
      slug: makeSlug(title),
      title,
      description,
      type,
      status: "DRAFT",
      price,
      deliveryDays,
      requirements: requirements ?? null,
    });

    reqLog(req).info("service_created", { service_id: service.id, seller_id: req.user!.userId });
    res.status(201).json(service);
  } catch (error) {
    reqLog(req).error("service_create_failed", { error });
    res.status(500).json({ error: "Failed to create service" });
  }
});

// PATCH /services/:id - Edit own service (draft/pending only)
router.patch("/:id", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const service = await db.orm.public.Service.where({ id: req.params.id as string }).first();
    if (!service) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    if (service.sellerId !== req.user!.userId) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    if (!["DRAFT", "PENDING_REVIEW", "SUSPENDED"].includes(service.status)) {
      res.status(409).json({ error: "Service cannot be edited in its current status" });
      return;
    }

    const allowed = ["title", "description", "type", "price", "deliveryDays", "requirements"] as const;
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No editable fields provided" });
      return;
    }

    // Edits made while under review re-queue the service as a draft.
    const status = service.status === "PENDING_REVIEW" ? "DRAFT" : service.status;
    const updated = await db.orm.public.Service.where({ id: service.id }).update({
      ...updates,
      status,
    });
    res.json(updated);
  } catch (error) {
    reqLog(req).error("service_update_failed", { error });
    res.status(500).json({ error: "Failed to update service" });
  }
});

// POST /services/:id/submit - DRAFT -> PENDING_REVIEW (owner)
router.post("/:id/submit", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const service = await db.orm.public.Service.where({ id: req.params.id as string }).first();
    if (!service) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    if (service.sellerId !== req.user!.userId) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    const transitioned = await db.orm.public.Service
      .where({ id: service.id, status: "DRAFT" })
      .update({ status: "PENDING_REVIEW" });
    if (!transitioned) {
      res.status(409).json({ error: "Only draft services can be submitted" });
      return;
    }
    reqLog(req).info("service_submitted", { service_id: service.id });
    res.json(transitioned);
  } catch (error) {
    reqLog(req).error("service_submit_failed", { error });
    res.status(500).json({ error: "Failed to submit service" });
  }
});

// POST /services/:id/publish - PENDING_REVIEW -> PUBLISHED (moderators only)
router.post("/:id/publish", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    if (!isModerator(req.user!.role)) {
      res.status(403).json({ error: "Only moderators can publish services" });
      return;
    }
    const service = await db.orm.public.Service.where({ id: req.params.id as string }).first();
    if (!service) {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    const transitioned = await db.orm.public.Service
      .where({ id: service.id, status: "PENDING_REVIEW" })
      .updateAndCount({ status: "PUBLISHED" });
    if (affectedCount(transitioned) !== 1) {
      res.status(409).json({ error: "Only services under review can be published" });
      return;
    }
    reqLog(req).info("service_published", { service_id: service.id, moderator_id: req.user!.userId });
    res.json(transitioned);
  } catch (error) {
    reqLog(req).error("service_publish_failed", { error });
    res.status(500).json({ error: "Failed to publish service" });
  }
});

// POST /services/:id/suspend - PUBLISHED -> SUSPENDED (moderators only)
router.post("/:id/suspend", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    if (!isModerator(req.user!.role)) {
      res.status(403).json({ error: "Only moderators can suspend services" });
      return;
    }
    const transitioned = await db.orm.public.Service
      .where({ id: req.params.id as string, status: "PUBLISHED" })
      .updateAndCount({ status: "SUSPENDED" });
    if (affectedCount(transitioned) !== 1) {
      res.status(409).json({ error: "Only published services can be suspended" });
      return;
    }
    reqLog(req).warn("service_suspended", { service_id: req.params.id, moderator_id: req.user!.userId });
    res.json(transitioned);
  } catch (error) {
    reqLog(req).error("service_suspend_failed", { error });
    res.status(500).json({ error: "Failed to suspend service" });
  }
});

// ---------------------------------------------------------------------------
// Buyer order flow
// ---------------------------------------------------------------------------

// POST /services/:slug/order - Order a service (authenticated buyer)
router.post("/:slug/order", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { buyerNotes, discountCode } = req.body ?? {};
    const checkout = await createServiceCheckout({
      userId: req.user!.userId,
      serviceSlug: req.params.slug as string,
      buyerNotes,
      discountCode,
    });
    res.status(201).json(checkout);
  } catch (error) {
    if (error instanceof CommerceError) {
      reqLog(req).warn("service_order_rejected", { code: error.code, status: error.status });
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    reqLog(req).error("service_order_failed", { error });
    res.status(500).json({ error: "Failed to order service" });
  }
});

// GET /services/orders/my - Buyer's service orders
router.get("/orders/my", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const purchases = await db.orm.public.ServicePurchase.where({ buyerId: req.user!.userId })
      .orderBy((m) => m.createdAt.desc())
      .all();
    const enriched = [];
    for (const sp of purchases) {
      const service = await db.orm.public.Service.where({ id: sp.serviceId }).first();
      enriched.push({ ...sp, service: service ? { slug: service.slug, title: service.title } : null });
    }
    res.json({ data: enriched, total: enriched.length });
  } catch (error) {
    reqLog(req).error("service_orders_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch service orders" });
  }
});

/** Load an order and verify the caller participates in it. */
async function loadParticipantOrder(req: AuthRequest, res: Response): Promise<{
  sp: Record<string, unknown> & { id: string; status: string; buyerId: string; serviceId: string; sellerRevenue: number; platformFee: number; finalPrice: number };
  sellerId: string;
} | null> {
  const sp = await db.orm.public.ServicePurchase.where({ id: req.params.id as string }).first();
  if (!sp) {
    res.status(404).json({ error: "Service order not found" });
    return null;
  }
  const service = await db.orm.public.Service.where({ id: sp.serviceId }).first();
  const sellerId = service?.sellerId ?? "";
  if (sp.buyerId !== req.user!.userId && sellerId !== req.user!.userId && !isModerator(req.user!.role)) {
    res.status(403).json({ error: "Not authorized" });
    return null;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sp: sp as any, sellerId };
}

// POST /services/orders/:id/deliver - seller submits a delivery
router.post("/orders/:id/deliver", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await loadParticipantOrder(req, res);
    if (!ctx) return;
    if (ctx.sellerId !== req.user!.userId) {
      res.status(403).json({ error: "Only the seller can deliver" });
      return;
    }
    const { notes, deliverableRef } = req.body ?? {};
    if (!notes) {
      res.status(400).json({ error: "notes are required" });
      return;
    }

    const outcome = await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      const transitioned = await tx.orm.public.ServicePurchase
        .where({ id: ctx.sp.id, status: "IN_PROGRESS" })
        .updateAndCount({ status: "DELIVERED" });
      if (affectedCount(transitioned) !== 1) return null;
      return await tx.orm.public.ServiceDelivery.create({
        servicePurchaseId: ctx.sp.id,
        sellerId: ctx.sellerId,
        notes,
        deliverableRef: deliverableRef ?? null,
      });
    });

    if (!outcome) {
      res.status(409).json({ error: "Only in-progress orders can be delivered" });
      return;
    }
    reqLog(req).info("service_delivery_submitted", { service_purchase_id: ctx.sp.id });
    res.status(201).json(outcome);
  } catch (error) {
    reqLog(req).error("service_deliver_failed", { error });
    res.status(500).json({ error: "Failed to submit delivery" });
  }
});

// POST /services/orders/:id/revision - buyer requests a revision
router.post("/orders/:id/revision", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await loadParticipantOrder(req, res);
    if (!ctx) return;
    if (ctx.sp.buyerId !== req.user!.userId) {
      res.status(403).json({ error: "Only the buyer can request a revision" });
      return;
    }
    const { reason, deliveryId } = req.body ?? {};
    if (!reason) {
      res.status(400).json({ error: "reason is required" });
      return;
    }

    const outcome = await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      const priorRevisions = await tx.orm.public.ServiceRevision
        .where({ servicePurchaseId: ctx.sp.id })
        .all();
      if (priorRevisions.length >= MAX_REVISIONS_PER_ORDER) {
        return { limitReached: true as const };
      }
      const transitioned = await tx.orm.public.ServicePurchase
        .where({ id: ctx.sp.id, status: "DELIVERED" })
        .updateAndCount({ status: "IN_PROGRESS" });
      if (affectedCount(transitioned) !== 1)
        return { limitReached: false as const, revision: null };

      const delivery = deliveryId
        ? await tx.orm.public.ServiceDelivery.where({ id: deliveryId }).first()
        : (await tx.orm.public.ServiceDelivery.where({ servicePurchaseId: ctx.sp.id })
            .orderBy((m) => m.createdAt.desc())
            .limit(1)
            .all())[0];
      if (!delivery) {
        // Roll the status back: no delivery to revise against.
        await tx.orm.public.ServicePurchase
          .where({ id: ctx.sp.id, status: "IN_PROGRESS" })
          .update({ status: "DELIVERED" });
        return { limitReached: false as const, revision: null };
      }

      const revision = await tx.orm.public.ServiceRevision.create({
        servicePurchaseId: ctx.sp.id,
        deliveryId: delivery.id,
        requestedBy: req.user!.userId,
        reason,
        status: "OPEN",
      });
      return { limitReached: false as const, revision };
    });

    if (outcome.limitReached) {
      res.status(409).json({ error: `Revision limit (${MAX_REVISIONS_PER_ORDER}) reached` });
      return;
    }
    if (!outcome.revision) {
      res.status(409).json({ error: "Only delivered orders can be revised" });
      return;
    }
    reqLog(req).info("service_revision_requested", { service_purchase_id: ctx.sp.id });
    res.status(201).json(outcome.revision);
  } catch (error) {
    reqLog(req).error("service_revision_failed", { error });
    res.status(500).json({ error: "Failed to request revision" });
  }
});

// POST /services/orders/:id/accept - buyer accepts the delivery
router.post("/orders/:id/accept", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await loadParticipantOrder(req, res);
    if (!ctx) return;
    if (ctx.sp.buyerId !== req.user!.userId) {
      res.status(403).json({ error: "Only the buyer can accept" });
      return;
    }

    const transitioned = await db.orm.public.ServicePurchase
      .where({ id: ctx.sp.id, status: "DELIVERED" })
      .updateAndCount({ status: "ACCEPTED", completedAt: new Date().toISOString() });
    if (affectedCount(transitioned) !== 1) {
      res.status(409).json({ error: "Only delivered orders can be accepted" });
      return;
    }

    // Revenue settles on acceptance (C-009: ACCEPTED -> CLOSED terminal path).
    await settleServiceRevenue(ctx.sp);
    reqLog(req).info("service_order_accepted", { service_purchase_id: ctx.sp.id });
    res.json(transitioned);
  } catch (error) {
    reqLog(req).error("service_accept_failed", { error });
    res.status(500).json({ error: "Failed to accept service order" });
  }
});

// POST /services/orders/:id/close - ACCEPTED -> CLOSED (either party)
router.post("/orders/:id/close", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await loadParticipantOrder(req, res);
    if (!ctx) return;
    const transitioned = await db.orm.public.ServicePurchase
      .where({ id: ctx.sp.id, status: "ACCEPTED" })
      .updateAndCount({ status: "CLOSED" });
    if (affectedCount(transitioned) !== 1) {
      res.status(409).json({ error: "Only accepted orders can be closed" });
      return;
    }
    reqLog(req).info("service_order_closed", { service_purchase_id: ctx.sp.id });
    res.json(transitioned);
  } catch (error) {
    reqLog(req).error("service_close_failed", { error });
    res.status(500).json({ error: "Failed to close service order" });
  }
});

// POST /services/orders/:id/cancel - PENDING/IN_PROGRESS -> CANCELLED
router.post("/orders/:id/cancel", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await loadParticipantOrder(req, res);
    if (!ctx) return;
    const transitioned = await db.orm.public.ServicePurchase
      .where({ id: ctx.sp.id, status: "PENDING" })
      .updateAndCount({ status: "CANCELLED", cancelledAt: new Date().toISOString() });
    if (affectedCount(transitioned) !== 1) {
      const fallback = await db.orm.public.ServicePurchase
        .where({ id: ctx.sp.id, status: "IN_PROGRESS" })
        .updateAndCount({ status: "CANCELLED", cancelledAt: new Date().toISOString() });
      if (affectedCount(fallback) !== 1) {
        res.status(409).json({ error: "Order can no longer be cancelled" });
        return;
      }
    }
    // NOTE: refunds for paid cancellations are Phase E (E-008).
    reqLog(req).warn("service_order_cancelled", { service_purchase_id: ctx.sp.id });
    res.json({ ok: true });
  } catch (error) {
    reqLog(req).error("service_cancel_failed", { error });
    res.status(500).json({ error: "Failed to cancel service order" });
  }
});

// POST /services/orders/:id/dispute - freeze the order (either party)
router.post("/orders/:id/dispute", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await loadParticipantOrder(req, res);
    if (!ctx) return;
    const current = await db.orm.public.ServicePurchase.where({ id: ctx.sp.id }).first();
    if (!current || !["PENDING", "IN_PROGRESS", "DELIVERED"].includes(current.status)) {
      res.status(409).json({ error: "Order is not in a disputable state" });
      return;
    }
    // Conditional re-check via updateAndCount (plain update() ignores
    // non-key where fields): guard against a concurrent transition between
    // the read above and this write.
    const updated = await db.orm.public.ServicePurchase
      .where({ id: ctx.sp.id, status: current.status })
      .updateAndCount({ status: "DISPUTED" });
    if (affectedCount(updated) !== 1) {
      res.status(409).json({ error: "Order is not in a disputable state" });
      return;
    }
    // Formal dispute routing/evidence arrives with Phase K; the order is
    // frozen here so neither party can move it.
    reqLog(req).warn("service_order_disputed", { service_purchase_id: ctx.sp.id });
    res.json(updated);
  } catch (error) {
    reqLog(req).error("service_dispute_failed", { error });
    res.status(500).json({ error: "Failed to open dispute" });
  }
});

// ---------------------------------------------------------------------------
// Messages (C-011)
// ---------------------------------------------------------------------------

// GET /services/orders/:id/messages
router.get("/orders/:id/messages", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await loadParticipantOrder(req, res);
    if (!ctx) return;
    const messages = await db.orm.public.ServiceOrderMessage
      .where({ servicePurchaseId: ctx.sp.id })
      .orderBy((m) => m.createdAt.asc())
      .all();
    res.json({ data: messages, total: messages.length });
  } catch (error) {
    reqLog(req).error("service_messages_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// POST /services/orders/:id/messages
router.post("/orders/:id/messages", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const ctx = await loadParticipantOrder(req, res);
    if (!ctx) return;
    const { body } = req.body ?? {};
    if (!body || typeof body !== "string" || body.trim().length === 0) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const role =
      ctx.sp.buyerId === req.user!.userId
        ? "BUYER"
        : ctx.sellerId === req.user!.userId
          ? "SELLER"
          : "ADMIN";
    const message = await db.orm.public.ServiceOrderMessage.create({
      servicePurchaseId: ctx.sp.id,
      senderId: req.user!.userId,
      senderRole: role,
      body: body.trim(),
    });
    res.status(201).json(message);
  } catch (error) {
    reqLog(req).error("service_message_create_failed", { error });
    res.status(500).json({ error: "Failed to send message" });
  }
});

// GET /services/:slug - public service detail (kept after fixed routes)
router.get("/:slug", standardRateLimit, async (req, res: Response) => {
  try {
    const service = await db.orm.public.Service.where({ slug: req.params.slug as string }).first();
    if (!service || service.status !== "PUBLISHED") {
      res.status(404).json({ error: "Service not found" });
      return;
    }
    res.json(service);
  } catch (error) {
    reqLog(req).error("service_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch service" });
  }
});

export default router;
