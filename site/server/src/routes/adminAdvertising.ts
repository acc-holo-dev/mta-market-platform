// Admin advertising control center (PLAN-017 G §46–§49): campaign CRUD,
// review/lifecycle state machine with CAS transitions, bounded analytics.
// Every mutation is audited (lib/audit.ts) and mirrored into SystemLog.
// Auth: router-level authenticate + ADMIN/SUPERADMIN — matches the
// ROLE_PERMISSIONS intent for advertising.manage (ADMIN + SUPERADMIN only).
import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { validate } from "../middleware/validate.js";
import { validateCuid } from "../middleware/validateCuid.js";
import { recordAudit } from "../lib/audit.js";
import { isFeatureEnabled } from "../lib/featureFlags.js";
import { affectedCount } from "../lib/ledger.js";
import {
  getAnalytics,
  logSystemEvent,
  metricTotalsByCampaign,
  AD_PLACEMENTS,
  AD_CAMPAIGN_STATUSES,
  AD_REVIEW_STATUSES,
} from "../lib/advertising.js";

const router: Router = Router();

// ---------------------------------------------------------------------------
// Router guard: authenticate + ADMIN/SUPERADMIN only.
// TODO(permission-engine): replace the inline role check with
// requirePermission("advertising.manage") when the permission-engine wave
// lands (PLAN-017 F owns lib/permissions.ts — deliberately not imported yet).
// ---------------------------------------------------------------------------
router.use(authenticate, (req: AuthRequest, res: Response, next: () => void) => {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "SUPERADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
});

function featureDisabled(res: Response): boolean {
  if (isFeatureEnabled("advertising")) return false;
  res.status(404).json({ error: "Not found" });
  return true;
}

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be an ISO date-time");

const advertiserIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a valid domain ID (UUID)");

const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  placement: z.enum(AD_PLACEMENTS),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  imageUrl: z.string().max(500).optional(),
  ctaLabel: z.string().max(60).optional(),
  ctaUrl: z.string().max(500).optional(),
  priority: z.number().int().min(-10_000).max(10_000).optional(),
  startsAt: isoDateTime.optional(),
  endsAt: isoDateTime.optional(),
  advertiserId: advertiserIdSchema.optional(),
});

const campaignPatchSchema = campaignCreateSchema
  .omit({ advertiserId: true })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const transitionSchema = z.object({
  action: z.enum(["approve", "reject", "activate", "pause", "resume", "cancel"]),
  reason: z.string().max(500).optional(),
});

const listQuerySchema = z.object({
  status: z.enum(AD_CAMPAIGN_STATUSES).optional(),
  placement: z.enum(AD_PLACEMENTS).optional(),
  reviewStatus: z.enum(AD_REVIEW_STATUSES).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// GET /admin/advertising/campaigns — paginated control-center list with
// metric totals for the page's campaigns in ONE grouped query (no N+1).
// ---------------------------------------------------------------------------
router.get("/campaigns", validate(listQuerySchema, "query"), async (req: AuthRequest, res: Response) => {
  try {
    if (featureDisabled(res)) return;
    const q = req.query as unknown as {
      status?: string;
      placement?: string;
      reviewStatus?: string;
      page?: number;
      limit?: number;
    };
    const page = q.page ?? 1;
    const limit = q.limit ?? 20;
    const where: Record<string, unknown> = {};
    if (q.status) where.status = q.status;
    if (q.placement) where.placement = q.placement;
    if (q.reviewStatus) where.reviewStatus = q.reviewStatus;

    const campaigns = (await db.orm.public.AdCampaign
      .where(where as any)
      .orderBy((c: any) => c.createdAt.desc())
      .limit(limit)
      .offset((page - 1) * limit)
      .all()) as any[];
    const agg = await db.orm.public.AdCampaign.where(where as any).aggregate((a: any) => ({ total: a.count() }));
    const total = Number(agg.total ?? 0);

    // ONE grouped AdMetric query for the whole page (§47).
    const totals = await metricTotalsByCampaign(campaigns.map((c) => c.id as string));
    const advertiserIds = Array.from(new Set(campaigns.map((c) => c.advertiserId as string)));
    const advertisers = advertiserIds.length
      ? ((await db.orm.public.User
          .where((u: any) => u.id.in(advertiserIds))
          .select("id", "username", "displayName")
          .all()) as any[])
      : [];
    const advertiserById = new Map(advertisers.map((u) => [u.id as string, u]));

    res.json({
      data: campaigns.map((c) => ({
        ...c,
        advertiser: advertiserById.get(c.advertiserId) ?? null,
        metrics: totals.get(c.id) ?? { impressions: 0, clicks: 0 },
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    reqLog(req).error("admin_ad_campaigns_list_failed", { error });
    res.status(500).json({ error: "Failed to fetch campaigns" });
  }
});

// ---------------------------------------------------------------------------
// POST /campaigns — create a DRAFT/PENDING campaign. advertiserId defaults
// to the acting admin.
// ---------------------------------------------------------------------------
router.post("/campaigns", validate(campaignCreateSchema), async (req: AuthRequest, res: Response) => {
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
      advertiserId?: string;
    };
    if (b.startsAt && b.endsAt && new Date(b.endsAt).getTime() <= new Date(b.startsAt).getTime()) {
      res.status(400).json({ error: "endsAt must be after startsAt" });
      return;
    }
    let advertiserId = req.user!.userId;
    if (b.advertiserId) {
      const advertiser = await db.orm.public.User.where({ id: b.advertiserId }).select("id").first();
      if (!advertiser) {
        res.status(404).json({ error: "Advertiser not found" });
        return;
      }
      advertiserId = b.advertiserId;
    }
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
    } as any)) as any;
    await recordAudit({
      actorId: req.user!.userId,
      action: "ad_campaign_created",
      targetType: "adCampaign",
      targetId: created.id,
      before: null,
      after: {
        name: created.name,
        placement: created.placement,
        status: created.status,
        reviewStatus: created.reviewStatus,
        advertiserId,
      },
      ip: req.ip,
      requestId: req.id ?? null,
    });
    res.status(201).json(created);
  } catch (error) {
    reqLog(req).error("admin_ad_campaign_create_failed", { error });
    res.status(500).json({ error: "Failed to create campaign" });
  }
});

// ---------------------------------------------------------------------------
// PATCH /campaigns/:id — content edits only while DRAFT | PAUSED | review
// REJECTED ("REJECTED" lives on reviewStatus; such campaigns carry status
// DRAFT). Editing a review-REJECTED campaign re-opens review (PENDING).
// ---------------------------------------------------------------------------
router.patch("/campaigns/:id", validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    if (featureDisabled(res)) return;
    const campaign = (await db.orm.public.AdCampaign.where({ id: req.params.id as string }).first()) as any;
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const editable =
      ["DRAFT", "PAUSED"].includes(campaign.status) || campaign.reviewStatus === "REJECTED";
    if (!editable) {
      res.status(409).json({ error: `Campaign is not editable in status ${campaign.status}/${campaign.reviewStatus}` });
      return;
    }
    const b = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const key of ["name", "placement", "title", "body", "imageUrl", "ctaLabel", "ctaUrl", "priority", "startsAt", "endsAt"] as const) {
      if (b[key] !== undefined) patch[key] = b[key];
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "Nothing to update" });
      return;
    }
    const startsAt = (patch.startsAt as string | undefined) ?? campaign.startsAt;
    const endsAt = (patch.endsAt as string | undefined) ?? campaign.endsAt;
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      res.status(400).json({ error: "endsAt must be after startsAt" });
      return;
    }
    const reopenReview = campaign.reviewStatus === "REJECTED";
    if (reopenReview) {
      patch.reviewStatus = "PENDING";
      patch.reviewNote = null;
    }
    // CAS on the editable status: a concurrent transition (e.g. activate)
    // wins and the stale edit is rejected instead of silently applied.
    const cas = await db.orm.public.AdCampaign
      .where({ id: campaign.id, status: campaign.status } as any)
      .updateAndCount(patch as any);
    if (affectedCount(cas) !== 1) {
      res.status(409).json({ error: "Campaign state changed concurrently; retry" });
      return;
    }
    const updated = (await db.orm.public.AdCampaign.where({ id: campaign.id }).first()) as any;
    await recordAudit({
      actorId: req.user!.userId,
      action: "ad_campaign_updated",
      targetType: "adCampaign",
      targetId: campaign.id,
      before: { status: campaign.status, reviewStatus: campaign.reviewStatus, fields: Object.keys(patch) },
      after: { status: updated.status, reviewStatus: updated.reviewStatus },
      ip: req.ip,
      requestId: req.id ?? null,
    });
    res.json(updated);
  } catch (error) {
    reqLog(req).error("admin_ad_campaign_patch_failed", { error });
    res.status(500).json({ error: "Failed to update campaign" });
  }
});

// ---------------------------------------------------------------------------
// POST /campaigns/:id/transition — review + lifecycle state machine.
//   approve:  reviewStatus PENDING -> APPROVED (status stays as-is)
//   reject:   reviewStatus PENDING -> REJECTED (reason required -> reviewNote)
//   activate: APPROVED + DRAFT|SCHEDULED|PAUSED -> ACTIVE (SCHEDULED when
//             startsAt is still in the future; 409 when endsAt already passed)
//   pause:    ACTIVE -> PAUSED
//   resume:   PAUSED -> ACTIVE
//   cancel:   anything but CANCELLED|EXPIRED -> CANCELLED
// Every transition is a CAS (affectedCount) and is audited before/after.
// ---------------------------------------------------------------------------
router.post(
  "/campaigns/:id/transition",
  validateCuid("id"),
  validate(transitionSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      if (featureDisabled(res)) return;
      const campaign = (await db.orm.public.AdCampaign.where({ id: req.params.id as string }).first()) as any;
      if (!campaign) {
        res.status(404).json({ error: "Campaign not found" });
        return;
      }
      const { action, reason } = req.body as { action: string; reason?: string };
      const now = new Date();

      let patch: Record<string, unknown> | null = null;
      let casWhere: Record<string, unknown> = { id: campaign.id };
      let rejectReason: string | null = null;

      if (action === "approve" || action === "reject") {
        if (campaign.reviewStatus !== "PENDING") {
          res.status(409).json({ error: `Only PENDING campaigns can be ${action === "approve" ? "approved" : "rejected"} (now ${campaign.reviewStatus})` });
          return;
        }
        if (action === "reject") {
          const trimmed = (reason ?? "").trim();
          if (!trimmed) {
            res.status(400).json({ error: "reason is required to reject a campaign" });
            return;
          }
          rejectReason = trimmed.slice(0, 500);
          patch = { reviewStatus: "REJECTED", reviewNote: rejectReason };
        } else {
          patch = { reviewStatus: "APPROVED" };
        }
        casWhere = { id: campaign.id, reviewStatus: "PENDING" };
      } else if (action === "activate") {
        if (campaign.reviewStatus !== "APPROVED" || !["DRAFT", "SCHEDULED", "PAUSED"].includes(campaign.status)) {
          res.status(409).json({
            error: `Campaign must be APPROVED and DRAFT|SCHEDULED|PAUSED to activate (now ${campaign.reviewStatus}/${campaign.status})`,
          });
          return;
        }
        if (campaign.endsAt && new Date(campaign.endsAt).getTime() <= now.getTime()) {
          res.status(409).json({ error: "Campaign window already ended (endsAt is in the past)" });
          return;
        }
        const target = campaign.startsAt && new Date(campaign.startsAt).getTime() > now.getTime() ? "SCHEDULED" : "ACTIVE";
        patch = { status: target };
        casWhere = { id: campaign.id, status: campaign.status };
      } else if (action === "pause") {
        if (campaign.status !== "ACTIVE") {
          res.status(409).json({ error: `Only ACTIVE campaigns can be paused (now ${campaign.status})` });
          return;
        }
        patch = { status: "PAUSED" };
        casWhere = { id: campaign.id, status: "ACTIVE" };
      } else if (action === "resume") {
        if (campaign.status !== "PAUSED") {
          res.status(409).json({ error: `Only PAUSED campaigns can be resumed (now ${campaign.status})` });
          return;
        }
        patch = { status: "ACTIVE" };
        casWhere = { id: campaign.id, status: "PAUSED" };
      } else if (action === "cancel") {
        if (["CANCELLED", "EXPIRED"].includes(campaign.status)) {
          res.status(409).json({ error: `Campaign is already ${campaign.status}` });
          return;
        }
        patch = { status: "CANCELLED" };
        casWhere = { id: campaign.id, status: campaign.status };
      }

      const cas = await db.orm.public.AdCampaign
        .where(casWhere as any)
        .updateAndCount(patch as any);
      if (affectedCount(cas) !== 1) {
        res.status(409).json({ error: "Campaign state changed concurrently; retry" });
        return;
      }
      const updated = (await db.orm.public.AdCampaign.where({ id: campaign.id }).first()) as any;
      await recordAudit({
        actorId: req.user!.userId,
        action: "ad_campaign_transitioned",
        targetType: "adCampaign",
        targetId: campaign.id,
        before: { status: campaign.status, reviewStatus: campaign.reviewStatus },
        after: { status: updated.status, reviewStatus: updated.reviewStatus, action, reason: rejectReason ?? reason ?? null },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      await logSystemEvent({
        message: "ad_campaign_transitioned",
        route: "/admin/advertising/campaigns/:id/transition",
        requestId: req.id ?? null,
        meta: {
          campaignId: campaign.id,
          action,
          fromStatus: campaign.status,
          toStatus: updated.status,
          fromReviewStatus: campaign.reviewStatus,
          toReviewStatus: updated.reviewStatus,
          actorId: req.user!.userId,
        },
      });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("admin_ad_campaign_transition_failed", { error });
      res.status(500).json({ error: "Failed to transition campaign" });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /campaigns/:id — only DRAFT or REJECTED campaigns are deletable
// (history/lifecycle integrity elsewhere). Metrics cascade via FK.
// ---------------------------------------------------------------------------
router.delete("/campaigns/:id", validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    if (featureDisabled(res)) return;
    const campaign = (await db.orm.public.AdCampaign.where({ id: req.params.id as string }).first()) as any;
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    if (!["DRAFT", "REJECTED"].includes(campaign.status)) {
      res.status(409).json({ error: `Only DRAFT or REJECTED campaigns can be deleted (now ${campaign.status})` });
      return;
    }
    const deleted = await db.orm.public.AdCampaign.where({ id: campaign.id }).delete();
    if (!deleted) {
      res.status(409).json({ error: "Campaign was already removed" });
      return;
    }
    await recordAudit({
      actorId: req.user!.userId,
      action: "ad_campaign_deleted",
      targetType: "adCampaign",
      targetId: campaign.id,
      before: { name: campaign.name, status: campaign.status, reviewStatus: campaign.reviewStatus },
      after: null,
      ip: req.ip,
      requestId: req.id ?? null,
    });
    res.json({ deleted: true, id: campaign.id });
  } catch (error) {
    reqLog(req).error("admin_ad_campaign_delete_failed", { error });
    res.status(500).json({ error: "Failed to delete campaign" });
  }
});

// ---------------------------------------------------------------------------
// GET /campaigns/:id/analytics — {totals: {impressions, clicks, ctr}, byDay}
// bounded to the last 30 UTC days (?days= clamps 1..30).
// ---------------------------------------------------------------------------
router.get("/campaigns/:id/analytics", validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    if (featureDisabled(res)) return;
    const campaign = (await db.orm.public.AdCampaign.where({ id: req.params.id as string }).first()) as any;
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    const days = Math.min(Math.max(Math.trunc(Number(req.query.days)) || 30, 1), 30);
    const analytics = await getAnalytics(campaign.id, days);
    res.json({ campaignId: campaign.id, ...analytics });
  } catch (error) {
    reqLog(req).error("admin_ad_campaign_analytics_failed", { error });
    res.status(500).json({ error: "Failed to load campaign analytics" });
  }
});

export default router;