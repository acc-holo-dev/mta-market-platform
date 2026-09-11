// Disputes API (PLAN K-002/K-003).
// State machine: OPEN -> WAITING_BUYER -> WAITING_SELLER -> UNDER_REVIEW ->
// RESOLVED_BUYER | RESOLVED_SELLER | PARTIAL_REFUND -> CLOSED.
// Buyers/sellers communicate through messages; every transition is recorded
// as an append-only DisputeEvent (K-003). Money effects: RESOLVED_* /
// PARTIAL_REFUND route to the refund service (Block 5, INV-013) for
// purchases; service orders flip to their lifecycle counterparts.
import { Router, Response } from "express";
import { authenticate, AuthRequest, requireRole } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { validateCuid } from "../middleware/validateCuid";
import { db } from "../prisma/db";
import { recordAudit } from "../lib/audit";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** K-002 legal transitions. Admin drives the machine; parties open/close. */
const DISPUTE_TRANSITIONS: Record<string, readonly string[]> = {
  OPEN: ["WAITING_BUYER", "WAITING_SELLER", "UNDER_REVIEW", "CLOSED"],
  WAITING_BUYER: ["WAITING_SELLER", "UNDER_REVIEW", "CLOSED"],
  WAITING_SELLER: ["WAITING_BUYER", "UNDER_REVIEW", "CLOSED"],
  UNDER_REVIEW: ["RESOLVED_BUYER", "RESOLVED_SELLER", "PARTIAL_REFUND", "CLOSED"],
  PARTIAL_REFUND: ["CLOSED"],
  RESOLVED_BUYER: [],
  RESOLVED_SELLER: [],
  CLOSED: [],
};

async function disputeParties(dispute: {
  targetType: string;
  purchaseId: string | null;
  servicePurchaseId: string | null;
}): Promise<{ buyerId: string | null; sellerId: string | null }> {
  if (dispute.targetType === "PURCHASE" && dispute.purchaseId) {
    const purchase = await db.orm.public.Purchase.where({ id: dispute.purchaseId }).first();
    if (!purchase) return { buyerId: null, sellerId: null };
    const resource = await db.orm.public.Resource
      .where({ id: purchase.resourceId })
      .first();
    return { buyerId: purchase.buyerId, sellerId: resource?.sellerId ?? null };
  }
  if (dispute.targetType === "SERVICE_PURCHASE" && dispute.servicePurchaseId) {
    const sp = await db.orm.public.ServicePurchase
      .where({ id: dispute.servicePurchaseId })
      .first();
    if (!sp) return { buyerId: null, sellerId: null };
    const service = await db.orm.public.Service.where({ id: sp.serviceId }).first();
    return { buyerId: sp.buyerId, sellerId: service?.sellerId ?? null };
  }
  return { buyerId: null, sellerId: null };
}

// POST /disputes - open a dispute (buyer of the target order)
router.post("/", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { targetType, purchaseId, servicePurchaseId, reason } = req.body ?? {};
    if (!reason || !targetType) {
      res.status(400).json({ error: "targetType and reason are required" });
      return;
    }
    if (targetType !== "PURCHASE" && targetType !== "SERVICE_PURCHASE") {
      res.status(400).json({ error: "targetType must be PURCHASE or SERVICE_PURCHASE" });
      return;
    }

    let purchaseRow: { id: string; buyerId: string; status: string } | null = null;
    let servicePurchaseRow: { id: string; buyerId: string; status: string } | null = null;
    if (targetType === "PURCHASE") {
      if (!purchaseId || !UUID_REGEX.test(purchaseId)) {
        res.status(400).json({ error: "purchaseId is required" });
        return;
      }
      purchaseRow = await db.orm.public.Purchase.where({ id: purchaseId }).first();
      if (!purchaseRow || purchaseRow.buyerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
      // Only money-bearing states are disputable.
      if (!["PENDING", "COMPLETED", "DISPUTED"].includes(purchaseRow.status)) {
        res.status(409).json({ error: `Purchase in state ${purchaseRow.status} cannot be disputed` });
        return;
      }
    } else {
      if (!servicePurchaseId || !UUID_REGEX.test(servicePurchaseId)) {
        res.status(400).json({ error: "servicePurchaseId is required" });
        return;
      }
      servicePurchaseRow = await db.orm.public.ServicePurchase
        .where({ id: servicePurchaseId })
        .first();
      if (!servicePurchaseRow || servicePurchaseRow.buyerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
      if (!["PENDING", "IN_PROGRESS", "DELIVERED", "DISPUTED"].includes(servicePurchaseRow.status)) {
        res.status(409).json({
          error: `Service order in state ${servicePurchaseRow.status} cannot be disputed`,
        });
        return;
      }
    }

    // One open dispute per order.
    const existing = await db.orm.public.Dispute
      .where(
        targetType === "PURCHASE"
          ? { purchaseId: purchaseId! }
          : { servicePurchaseId: servicePurchaseId! }
      )
      .all();
    if (existing.some((d: { status: string }) => d.status !== "CLOSED")) {
      res.status(409).json({ error: "An open dispute already exists for this order" });
      return;
    }

    const dispute = await db.orm.public.Dispute.create({
      targetType,
      purchaseId: purchaseRow?.id ?? null,
      servicePurchaseId: servicePurchaseRow?.id ?? null,
      openedById: req.user!.userId,
      status: "OPEN",
      reason,
    });
    await db.orm.public.DisputeEvent.create({
      disputeId: dispute.id,
      actorId: req.user!.userId,
      event: "DISPUTE_OPENED",
      toStatus: "OPEN",
    });

    // Freeze the target order while disputed (resource purchases get DISPUTED,
    // service orders already carry DISPUTED in their lifecycle).
    if (purchaseRow && purchaseRow.status === "COMPLETED") {
      await db.orm.public.Purchase.where({ id: purchaseRow.id }).update({ status: "DISPUTED" });
    }
    if (
      servicePurchaseRow &&
      ["PENDING", "IN_PROGRESS", "DELIVERED"].includes(servicePurchaseRow.status)
    ) {
      const freeze_from = servicePurchaseRow.status as "PENDING" | "IN_PROGRESS" | "DELIVERED";
      await db.orm.public.ServicePurchase
        .where({ id: servicePurchaseRow.id, status: freeze_from })
        .updateAndCount({ status: "DISPUTED" });
    }

    reqLog(req).info("dispute_opened", { dispute_id: dispute.id, actor_id: req.user!.userId });
    res.status(201).json(dispute);
  } catch (error) {
    reqLog(req).error("dispute_open_failed", { error });
    res.status(500).json({ error: "Failed to open dispute" });
  }
});

// GET /disputes/my - disputes where the caller is buyer or seller
router.get("/my", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const all = await db.orm.public.Dispute.where({}).all();
    const mine = [];
    for (const dispute of all) {
      const { buyerId, sellerId } = await disputeParties(dispute);
      if (buyerId === req.user!.userId || sellerId === req.user!.userId) {
        mine.push(dispute);
      }
    }
    res.json({ data: mine, total: mine.length });
  } catch (error) {
    reqLog(req).error("disputes_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch disputes" });
  }
});

// GET /disputes/:id - dispute + messages (participants and admins)
router.get("/:id", authenticate, validateCuid("id"), standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const dispute = await db.orm.public.Dispute.where({ id: req.params.id as string }).first();
    if (!dispute) {
      res.status(404).json({ error: "Dispute not found" });
      return;
    }
    const { buyerId, sellerId } = await disputeParties(dispute);
    const isParty = buyerId === req.user!.userId || sellerId === req.user!.userId;
    const isModerator = req.user!.role === "ADMIN" || req.user!.role === "MODERATOR";
    if (!isParty && !isModerator) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    const messages = await db.orm.public.DisputeMessage
      .where({ disputeId: dispute.id })
      .orderBy((m) => m.createdAt.asc())
      .all();
    const events = await db.orm.public.DisputeEvent
      .where({ disputeId: dispute.id })
      .orderBy((m) => m.createdAt.asc())
      .all();
    res.json({ dispute, messages, events });
  } catch (error) {
    reqLog(req).error("dispute_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch dispute" });
  }
});

// POST /disputes/:id/messages - participants communicate (K-003)
router.post("/:id/messages", authenticate, validateCuid("id"), standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const dispute = await db.orm.public.Dispute.where({ id: req.params.id as string }).first();
    if (!dispute) {
      res.status(404).json({ error: "Dispute not found" });
      return;
    }
    const { buyerId, sellerId } = await disputeParties(dispute);
    const isParty = buyerId === req.user!.userId || sellerId === req.user!.userId;
    if (!isParty && req.user!.role !== "ADMIN") {
      res.status(403).json({ error: "Not authorized" });
      return;
    }
    const { body } = req.body ?? {};
    if (!body || typeof body !== "string" || body.trim().length === 0) {
      res.status(400).json({ error: "body is required" });
      return;
    }
    const role = buyerId === req.user!.userId ? "BUYER" : sellerId === req.user!.userId ? "SELLER" : "ADMIN";
    const message = await db.orm.public.DisputeMessage.create({
      disputeId: dispute.id,
      senderId: req.user!.userId,
      senderRole: role,
      body: body.trim(),
    });
    res.status(201).json(message);
  } catch (error) {
    reqLog(req).error("dispute_message_failed", { error });
    res.status(500).json({ error: "Failed to send message" });
  }
});

// POST /disputes/:id/transition - admin drives the state machine (K-002)
router.post("/:id/transition", authenticate, requireRole("ADMIN"), validateCuid("id"), standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const dispute = await db.orm.public.Dispute.where({ id: req.params.id as string }).first();
    if (!dispute) {
      res.status(404).json({ error: "Dispute not found" });
      return;
    }
    const { status, resolution } = req.body ?? {};
    const allowed = DISPUTE_TRANSITIONS[dispute.status] ?? [];
    if (!allowed.includes(status)) {
      res.status(409).json({
        error: `Illegal transition ${dispute.status} -> ${status}. Allowed: ${allowed.join(", ")}`,
      });
      return;
    }

    const updated = await db.orm.public.Dispute.where({ id: dispute.id }).update({
      status,
      ...(resolution ? { resolution } : {}),
      ...(status === "CLOSED" || status.startsWith("RESOLVED") || status === "PARTIAL_REFUND"
        ? { closedAt: ["CLOSED"].includes(status) ? new Date().toISOString() : null }
        : {}),
      resolvedById: status.startsWith("RESOLVED") || status === "PARTIAL_REFUND" ? req.user!.userId : undefined,
    });
    await db.orm.public.DisputeEvent.create({
      disputeId: dispute.id,
      actorId: req.user!.userId,
      event: "STATUS_CHANGED",
      fromStatus: dispute.status,
      toStatus: status,
    });

    // ---- business effects ----
    if (dispute.targetType === "SERVICE_PURCHASE" && dispute.servicePurchaseId) {
      // Disputed service orders resume per the resolution.
      if (["RESOLVED_BUYER", "RESOLVED_SELLER", "PARTIAL_REFUND", "CLOSED"].includes(status)) {
        await db.orm.public.ServicePurchase
          .where({ id: dispute.servicePurchaseId, status: "DISPUTED" })
          .updateAndCount({ status: status === "RESOLVED_SELLER" ? "IN_PROGRESS" : "CLOSED" });
      }
    }
    if (dispute.targetType === "PURCHASE" && dispute.purchaseId) {
      const purchase = await db.orm.public.Purchase.where({ id: dispute.purchaseId }).first();
      if (purchase && purchase.status === "DISPUTED") {
        if (status === "RESOLVED_SELLER" || status === "CLOSED") {
          // Settled without buyer refund: restore the completed purchase.
          await db.orm.public.Purchase.where({ id: purchase.id }).update({
            status: "COMPLETED",
          });
        }
        // RESOLVED_BUYER / PARTIAL_REFUND: money moves only through the
        // refund service (POST /payments/refunds, Block 5, INV-013); the
        // refund flips the purchase to REFUNDED itself.
      }
    }

    await recordAudit({
      actorId: req.user!.userId,
      action: "dispute.transition",
      targetType: "dispute",
      targetId: dispute.id,
      before: { status: dispute.status },
      after: { status },
      ip: req.ip,
      requestId: req.id,
    });
    reqLog(req).info("dispute_transitioned", {
      dispute_id: dispute.id,
      from: dispute.status,
      to: status,
      admin_id: req.user!.userId,
    });
    res.json(updated);
  } catch (error) {
    reqLog(req).error("dispute_transition_failed", { error });
    res.status(500).json({ error: "Failed to transition dispute" });
  }
});

// GET /disputes/admin/all - list disputes (ADMIN)
router.get("/admin/all", authenticate, requireRole("ADMIN"), standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const disputes = status
      ? await db.orm.public.Dispute.where({ status: status as never }).all()
      : await db.orm.public.Dispute.where({}).all();
    res.json({ data: disputes, total: disputes.length });
  } catch (error) {
    reqLog(req).error("disputes_admin_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch disputes" });
  }
});

export default router;
