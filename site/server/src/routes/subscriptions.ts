// Premium subscriptions (PLAN-018 J): lifecycle over real entitlements; user + admin surfaces.
//
// Root-mounted router (app.ts mounts it at "/") with ABSOLUTE paths:
//   /subscriptions/*        — user surface
//   /admin/subscriptions/*  — admin surface
// Honesty rule (§9): with the "premium" feature flag off every endpoint here
// answers 404 {error:"Not found"} — the surface simply does not exist.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { validate } from "../middleware/validate.js";
import { validateCuid } from "../middleware/validateCuid.js";
import { isFeatureEnabled } from "../lib/featureFlags.js";
import {
  SUBSCRIPTION_PLANS,
  FUTURE_PLAN_KINDS,
  resolvePlan,
  createSubscriptionCheckout,
  activateSubscriptionPayment,
  listForUser,
  listForAdmin,
  cancelSubscription,
  resumeSubscription,
  setSubscriptionAutoRenew,
  adminTransitionSubscription,
  getSubscription,
  expireSweep,
  SubscriptionError,
  type AdminSubscriptionAction,
} from "../lib/subscriptions.js";

const router: Router = Router();

function premiumDisabled(res: Response): boolean {
  if (isFeatureEnabled("premium")) return false;
  res.status(404).json({ error: "Not found" });
  return true;
}

function mapError(req: Request, res: Response, error: unknown): void {
  if (error instanceof SubscriptionError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  reqLog(req).error("subscription_route_failed", { error });
  res.status(500).json({ error: "Internal server error" });
}

const ADMIN_ROLES = ["ADMIN", "SUPERADMIN"];

function requireAdmin(req: AuthRequest, res: Response): boolean {
  if (!req.user) {
    res.status(401).json({ error: "No token provided" });
    return false;
  }
  if (!ADMIN_ROLES.includes(req.user.role)) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// GET /subscriptions/plans — public catalog. 404 when the premium flag is
// off; available:true only for the two real (entitlement-backed) plans.
// ---------------------------------------------------------------------------
router.get("/subscriptions/plans", (req: Request, res: Response) => {
  try {
    if (premiumDisabled(res)) return;
    const purchasable = Object.values(SUBSCRIPTION_PLANS).map((p) => ({
      kind: p.kind,
      label: p.label,
      description: p.description,
      priceMinor: p.priceMinor,
      periodDays: p.periodDays,
      features: p.features,
      available: true,
      note: null,
    }));
    const future = FUTURE_PLAN_KINDS.map((kind) => ({
      kind,
      label: kind,
      description: null,
      priceMinor: null,
      periodDays: null,
      features: [] as string[],
      available: false,
      note: "Планируемые функции ещё не реализованы — план появится вместе с реальной функциональностью.",
    }));
    res.json({ plans: [...purchasable, ...future], featureEnabled: true });
  } catch (error) {
    mapError(req, res, error);
  }
});

// ---------------------------------------------------------------------------
// POST /subscriptions {plan} — authenticated purchase: creates the PENDING
// checkout (Order + priced line + provider payment when configured) and
// returns the payment info per the commerce path. With no provider configured
// the checkout answers in simulate mode (explicit paid activation below).
// ---------------------------------------------------------------------------
router.post("/subscriptions", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (premiumDisabled(res)) return;
    const plan = resolvePlan((req.body ?? {}).plan);
    const { checkout } = await createSubscriptionCheckout(req.user!.userId, plan.kind);
    res.status(201).json({
      plan: {
        kind: plan.kind,
        label: plan.label,
        priceMinor: plan.priceMinor,
        periodDays: plan.periodDays,
      },
      checkout,
    });
  } catch (error) {
    mapError(req, res, error);
  }
});

// ---------------------------------------------------------------------------
// POST /subscriptions/:id/activate-payment {paymentId?} — explicit paid
// activation. :id is the checkout Order id returned by POST /subscriptions
// (the Subscription row is born at activation — the frozen SubscriptionStatus
// enum has no PENDING value). Provider-verified when a battle provider is
// enabled; dev-simulate otherwise. The webhook integration point is
// documented in lib/subscriptions.ts.
// ---------------------------------------------------------------------------
router.post(
  "/subscriptions/:id/activate-payment",
  authenticate,
  validateCuid("id"),
  async (req: AuthRequest, res: Response) => {
    try {
      if (premiumDisabled(res)) return;
      // Ownership gate: only the checkout buyer (or an admin) can activate.
      const order = (await db.orm.public.Order.where({ id: req.params.id as string }).first()) as
        | { id: string; buyerId: string }
        | null;
      if (!order) {
        res.status(404).json({ error: "Checkout order not found", code: "order_not_found" });
        return;
      }
      const isOwner = order.buyerId === req.user!.userId || ADMIN_ROLES.includes(req.user!.role);
      const raw = (req.body ?? {}).paymentId;
      const paymentId = typeof raw === "string" && raw.length > 0 ? raw : null;
      const result = await activateSubscriptionPayment({
        orderId: req.params.id as string,
        paymentId,
        actorId: req.user!.userId,
        isOrderOwner: isOwner,
      });
      res.json(result);
    } catch (error) {
      mapError(req, res, error);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /subscriptions/mine — own subscriptions + linked entitlements.
// Opportunistically runs the bounded expiry sweep (30s guard) so lifecycle
// states stay honest without a dedicated cron in dev/test.
// ---------------------------------------------------------------------------
router.get("/subscriptions/mine", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (premiumDisabled(res)) return;
    await expireSweep();
    const data = await listForUser(req.user!.userId);
    res.json({ data });
  } catch (error) {
    mapError(req, res, error);
  }
});

// POST /subscriptions/:id/cancel {reason?} — takes effect at period end.
router.post("/subscriptions/:id/cancel", authenticate, validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    if (premiumDisabled(res)) return;
    const sub = await getSubscription(req.params.id as string);
    if (!sub || sub.userId !== req.user!.userId) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }
    const reason = typeof (req.body ?? {}).reason === "string" ? (req.body as { reason: string }).reason : null;
    res.json({ subscription: await cancelSubscription(sub.id, req.user!.userId, reason) });
  } catch (error) {
    mapError(req, res, error);
  }
});

// POST /subscriptions/:id/resume — undo a period-end cancellation.
router.post("/subscriptions/:id/resume", authenticate, validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    if (premiumDisabled(res)) return;
    const sub = await getSubscription(req.params.id as string);
    if (!sub || sub.userId !== req.user!.userId) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }
    res.json({ subscription: await resumeSubscription(sub.id, req.user!.userId) });
  } catch (error) {
    mapError(req, res, error);
  }
});

// PATCH /subscriptions/:id/auto-renew {autoRenew: boolean}
router.patch("/subscriptions/:id/auto-renew", authenticate, validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    if (premiumDisabled(res)) return;
    const autoRenew = (req.body ?? {}).autoRenew;
    if (typeof autoRenew !== "boolean") {
      res.status(400).json({ error: "autoRenew must be a boolean" });
      return;
    }
    const sub = await getSubscription(req.params.id as string);
    if (!sub || sub.userId !== req.user!.userId) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }
    res.json({ subscription: await setSubscriptionAutoRenew(sub.id, autoRenew, req.user!.userId) });
  } catch (error) {
    mapError(req, res, error);
  }
});

// ---------------------------------------------------------------------------
// Admin surface — ADMIN/SUPERADMIN only, premium flag gated (404 when off).
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({
  status: z.enum(["ACTIVE", "PAST_DUE", "GRACE_PERIOD", "CANCELLED", "EXPIRED"]).optional(),
  plan: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get("/admin/subscriptions", authenticate, validate(listQuerySchema, "query"), async (req: AuthRequest, res: Response) => {
  try {
    if (premiumDisabled(res)) return;
    if (!requireAdmin(req, res)) return;
    await expireSweep();
    const q = req.query as unknown as { status?: string; plan?: string; page?: number; limit?: number };
    const result = await listForAdmin({ status: q.status, plan: q.plan }, q.page ?? 1, q.limit ?? 20);
    res.json(result);
  } catch (error) {
    mapError(req, res, error);
  }
});

const transitionSchema = z.object({
  action: z.enum(["activate", "grant_grace", "expire", "cancel"]),
  graceDays: z.coerce.number().int().min(1).max(30).optional(),
  reason: z.string().max(500).optional(),
});

router.post(
  "/admin/subscriptions/:id/transition",
  authenticate,
  validateCuid("id"),
  validate(transitionSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      if (premiumDisabled(res)) return;
      if (!requireAdmin(req, res)) return;
      const body = req.body as { action: AdminSubscriptionAction; graceDays?: number; reason?: string };
      const sub = await getSubscription(req.params.id as string);
      if (!sub) {
        res.status(404).json({ error: "Subscription not found" });
        return;
      }
      const updated = await adminTransitionSubscription(sub.id, body.action, req.user!.userId, {
        graceDays: body.graceDays,
        reason: body.reason ?? null,
      });
      res.json({ subscription: updated });
    } catch (error) {
      mapError(req, res, error);
    }
  }
);

export const subscriptionRoutes: Router = router;

export default router;
