// Public advertising surface (PLAN-017 G §46/§48): placement serving +
// bounded impression/click tracking. Honest absence (§9): when the
// "advertising" feature flag is off every endpoint here answers 404
// {error:"Not found"} — the surface simply does not exist.
// standardRateLimit already applies globally (app.ts) — no per-route limiter.
//
// PLAN-018 K-004/K-005 (seller purchase path, this wave): an authenticated
// advertiser creates a DRAFT + PENDING campaign owned by THEMSELVES together
// with the commerce checkout for the placement price (lib/adsBilling.ts — the
// same Order/Payment path as subscriptions, no second payment system), lists
// own campaigns with billing status + analytics, and captures the payment
// through the explicit paid-activation endpoint. Admin review/lifecycle
// transitions (K-006) remain in routes/adminAdvertising.ts.
import { Router, Response } from "express";
import { z } from "zod";
import { AuthRequest, authenticate } from "../lib/auth.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { validate } from "../middleware/validate.js";
import { isCuid, validateCuid } from "../middleware/validateCuid.js";
import { isFeatureEnabled } from "../lib/featureFlags.js";
import {
  servePlacements,
  recordEvent,
  getAnalytics,
  metricTotalsByCampaign,
  AD_PLACEMENTS,
  logSystemEvent,
  type AdKind,
} from "../lib/advertising.js";
import {
  createCampaignCheckout,
  linkCampaignToOrder,
  campaignBillingStatus,
  completeCampaignPayment,
  AdsBillingError,
  type AdCampaignRow,
} from "../lib/adsBilling.js";

const router: Router = Router();

const placementParamsSchema = z.object({
  placement: z.enum(AD_PLACEMENTS),
});

const eventBodySchema = z.object({
  campaignId: z.string().min(1),
});

function featureDisabled(res: Response): boolean {
  if (isFeatureEnabled("advertising")) return false;
  res.status(404).json({ error: "Not found" });
  return true;
}

// GET /advertising/placements/:placement — active, approved campaigns for a
// slot. Public projection only: id/title/body/imageUrl/ctaLabel/ctaUrl. No
// advertiserId, review state, priority or scheduling internals.
router.get("/placements/:placement", validate(placementParamsSchema, "params"), async (req: AuthRequest, res: Response) => {
  try {
    if (featureDisabled(res)) return;
    const placement = req.params.placement as string;
    const items = await servePlacements(placement, new Date());
    res.json({ placement, items });
  } catch (error) {
    reqLog(req).error("advertising_placements_failed", { error });
    res.status(500).json({ error: "Failed to load placements" });
  }
});

/**
 * POST /advertising/events/impression|click — body {campaignId}.
 * Bounded: the campaign id must be a UUID (validateCuid pattern) and must
 * reference an ACTIVE + APPROVED campaign; anything else is honestly
 * absent (404) — no events are recorded for non-served campaigns.
 */
async function handleAdEvent(req: AuthRequest, res: Response, kind: AdKind): Promise<void> {
  try {
    if (featureDisabled(res)) return;
    const campaignId = (req.body ?? {}).campaignId;
    if (typeof campaignId !== "string" || !isCuid(campaignId)) {
      res.status(400).json({ error: "Validation failed", details: [{ path: "campaignId", message: "must be a valid domain ID (UUID)" }] });
      return;
    }
    const campaign = (await db.orm.public.AdCampaign
      .where({ id: campaignId, status: "ACTIVE", reviewStatus: "APPROVED" } as any)
      .first()) as { id: string } | null;
    if (!campaign) {
      // The event target is not a servable campaign — honest absence.
      res.status(404).json({ error: "Not found" });
      return;
    }
    await recordEvent(campaign.id, kind, new Date());
    res.status(204).end();
  } catch (error) {
    reqLog(req).error("advertising_event_failed", { kind, error });
    res.status(500).json({ error: "Failed to record ad event" });
  }
}

router.post("/events/impression", validate(eventBodySchema), (req: AuthRequest, res: Response) => {
  void handleAdEvent(req, res, "impression");
});

router.post("/events/click", validate(eventBodySchema), (req: AuthRequest, res: Response) => {
  void handleAdEvent(req, res, "click");
});

// ---------------------------------------------------------------------------
// PLAN-018 K-004: seller-facing campaign purchase path.
// ---------------------------------------------------------------------------

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be an ISO date-time");

const sellerCampaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  placement: z.enum(AD_PLACEMENTS),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  imageUrl: z.string().max(500).optional(),
  ctaLabel: z.string().max(60).optional(),
  ctaUrl: z.string().max(500).optional(),
  startsAt: isoDateTime.optional(),
  endsAt: isoDateTime.optional(),
  priority: z.number().int().min(-10_000).max(10_000).optional(),
});

async function loadOwnedCampaign(req: AuthRequest, res: Response): Promise<AdCampaignRow | null> {
  const campaign = (await db.orm.public.AdCampaign.where({ id: req.params.id as string }).first()) as AdCampaignRow | null;
  if (!campaign || campaign.advertiserId !== req.user!.userId) {
    // Existence hiding for non-owners (same rule as the deal rooms).
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return campaign;
}

/**
 * POST /advertising/campaigns — seller purchase path (K-004). Creates the
 * DRAFT + PENDING-review campaign owned by the caller AND the commerce order
 * for the placement price; the campaign is CAS-linked to its checkout order.
 * Approve/activate transitions stay admin-only (K-006, adminAdvertising.ts).
 */
router.post("/campaigns", authenticate, validate(sellerCampaignCreateSchema), async (req: AuthRequest, res: Response) => {
  try {
    if (featureDisabled(res)) return;
    const b = req.body as {
      name: string;
      placement: string;
      title: string;
      body: string;
      imageUrl?: string;
      ctaLabel?: string;
      ctaUrl?: string;
      priority?: number;
      startsAt?: string;
      endsAt?: string;
    };
    if (b.startsAt && b.endsAt && new Date(b.endsAt).getTime() <= new Date(b.startsAt).getTime()) {
      res.status(400).json({ error: "endsAt must be after startsAt" });
      return;
    }
    const advertiserId = req.user!.userId;
    const created = (await db.orm.public.AdCampaign.create({
      advertiserId,
      name: b.name,
      placement: b.placement,
      title: b.title,
      body: b.body,
      imageUrl: b.imageUrl ?? null,
      ctaLabel: b.ctaLabel ?? null,
      ctaUrl: b.ctaUrl ?? null,
      priority: b.priority ?? 0,
      startsAt: b.startsAt ?? null,
      endsAt: b.endsAt ?? null,
      status: "DRAFT",
      reviewStatus: "PENDING",
    } as any)) as AdCampaignRow;

    const { checkout, amountMinor } = await createCampaignCheckout({
      advertiserId,
      campaignId: created.id,
      campaignName: created.name,
      placement: created.placement,
    });
    await linkCampaignToOrder(created.id, checkout.orderId);

    await logSystemEvent({
      message: "ad_campaign_purchase_created",
      route: "/advertising/campaigns",
      requestId: req.id ?? null,
      meta: {
        campaignId: created.id,
        orderId: checkout.orderId,
        advertiserId,
        placement: created.placement,
        amountMinor,
      },
    });

    const fresh = (await db.orm.public.AdCampaign.where({ id: created.id }).first()) as AdCampaignRow;
    res.status(201).json({
      campaign: fresh,
      checkout,
    });
  } catch (error) {
    if (error instanceof AdsBillingError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    reqLog(req).error("ad_campaign_purchase_failed", { error });
    res.status(500).json({ error: "Failed to create campaign purchase" });
  }
});

/**
 * GET /advertising/campaigns/mine — own campaigns (K-005 for owners) with
 * billing status + bounded 30-day analytics per campaign.
 */
router.get("/campaigns/mine", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (featureDisabled(res)) return;
    const campaigns = (await db.orm.public.AdCampaign
      .where({ advertiserId: req.user!.userId } as any)
      .orderBy((c: any) => c.createdAt.desc())
      .limit(200)
      .all()) as AdCampaignRow[];
    const totals = await metricTotalsByCampaign(campaigns.map((c) => c.id));
    const data = await Promise.all(
      campaigns.map(async (c) => ({
        ...c,
        metrics: totals.get(c.id) ?? { impressions: 0, clicks: 0 },
        billing: await campaignBillingStatus(c),
        analytics: await getAnalytics(c.id, 30),
      }))
    );
    res.json({ data });
  } catch (error) {
    reqLog(req).error("ad_campaigns_mine_failed", { error });
    res.status(500).json({ error: "Failed to load own campaigns" });
  }
});

/**
 * POST /advertising/campaigns/:id/activate-payment {paymentId?} — explicit
 * paid activation of the campaign's checkout order (owner only; existence
 * hidden from others). Provider-verified when a battle provider is enabled,
 * dev-simulate otherwise; the payments webhook integration point is documented
 * in lib/adsBilling.ts.
 */
router.post("/campaigns/:id/activate-payment", authenticate, validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    if (featureDisabled(res)) return;
    const campaign = await loadOwnedCampaign(req, res);
    if (!campaign) return;
    if (!campaign.orderId) {
      res.status(409).json({ error: "Campaign has no checkout order" });
      return;
    }
    const raw = (req.body ?? {}).paymentId;
    const paymentId = typeof raw === "string" && raw.length > 0 ? raw : null;
    const result = await completeCampaignPayment({
      orderId: campaign.orderId,
      paymentId,
      actorId: req.user!.userId,
      isOwner: true,
    });
    res.json(result);
  } catch (error) {
    if (error instanceof AdsBillingError) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    reqLog(req).error("ad_campaign_payment_activation_failed", { error });
    res.status(500).json({ error: "Failed to activate campaign payment" });
  }
});

export default router;