// Admin moderation endpoints
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { validateCuid } from "../middleware/validateCuid.js";
import { db } from "../prisma/db.js";
import { sendResourcePublishedEmail } from "../lib/email.js";
import { isResourceStatus, isTransitionAllowed, type ResourceStatus } from "../lib/moderation.js";
import { hasValidSignature } from "../lib/artifact/signing.js";
import { getSandboxRun } from "../lib/sandbox/service.js";
import { bustActivityCache } from "../lib/activity.js";
// PLAN-019 H-002: domain events ride the outbox; the worker consumes them
// (price alerts, future integrations). PLAN-020 E-001: transition writes and
// their outbox events are committed in the SAME transaction (awaited emit,
// tx handle) so a crash can no longer silently lose an event.
import { emitOutbox } from "../lib/events.js";
import {
  creatorFollowerIds,
  resourceFollowerIds,
  buyerIds,
  deliverFollowNotifications,
} from "../lib/follows.js";
import { reqLog } from "../middleware/requestId.js";
import { validateResourceDependencies } from "../lib/artifact/dependencies.js";
import { recordAudit } from "../lib/audit.js";

const router: Router = Router();

// Middleware: Admin only
function adminOnly(req: AuthRequest, res: Response, next: () => void) {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "MODERATOR") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// GET /admin/resources - List all resources (pending moderation)
router.get(
  "/resources",
  authenticate,
  adminOnly,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { status = "DRAFT", page = "1", limit = "20" } = req.query;

      const pageNum = parseInt(page as string, 10);
      const limitNum = Math.min(parseInt(limit as string, 10), 100);
      const skip = (pageNum - 1) * limitNum;

      const resources = await db.orm.public.Resource.where({ status: status as any })
        .orderBy((m) => m.createdAt.desc())
        .limit(limitNum)
        .offset(skip)
        .all();

      // PLAN B-004: honest total via COUNT aggregate.
      const countResult = await db.orm.public.Resource.where({ status: status as any }).aggregate(
        (agg: any) => ({ total: agg.count() })
      );
      const total = Number(countResult.total);

      res.json({
        data: resources,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum),
        },
      });
    } catch (error) {
      reqLog(req).error("admin_resources_fetch_failed", { error });
      res.status(500).json({ error: "Failed to fetch resources" });
    }
  }
);

// PATCH /admin/resources/:id/status - Update resource status (moderation)
router.patch(
  "/resources/:id/status",
  authenticate,
  adminOnly,
  validateCuid('id'),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const resourceId = req.params.id as string;
      const { status, reason } = req.body;

      if (!status) {
        res.status(400).json({ error: "Status is required" });
        return;
      }

      // TASK A-008: status must be a valid enum value and the transition
      // must be allowed by the moderation state machine (J-001).
      if (!isResourceStatus(status)) {
        res.status(400).json({ error: `Invalid status. Allowed: DRAFT, PENDING_REVIEW, PUBLISHED, SUSPENDED` });
        return;
      }

      const resource = await db.orm.public.Resource.where({ id: resourceId }).first();

      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      const from = resource.status as ResourceStatus;
      if (!isTransitionAllowed(from, status, "admin")) {
        res.status(400).json({
          error: "Invalid status transition",
          message: `Transition ${from} -> ${status} is not allowed for moderators.`,
        });
        return;
      }

      // PLAN B-001 publication gate: a version may only go PUBLISHED when
      // every version of the resource is signed and passed validation
      // (sandbox execution may be PENDING when Docker is unavailable —
      // manual review path — but FAILED validation blocks publication).
      if (status === "PUBLISHED") {
        // PLAN I-002: the declared dependency graph must resolve against the
        // published catalog (missing/circular/unsupported).
        const versions = await db.orm.public.ResourceVersion.where({ resourceId }).all();
        for (const version of versions) {
          const dependencyCheck = await validateResourceDependencies(resource.slug);
          if (!dependencyCheck.ok) {
            res.status(409).json({
              error: "Dependency graph invalid",
              message: dependencyCheck.errors.join("; "),
            });
            return;
          }
          const signed = await hasValidSignature(version.id);
          if (!signed) {
            res.status(409).json({
              error: "Version is not signed",
              message: `Version ${version.version} has no valid artifact signature. Re-upload the artifact to sign it.`,
              version: version.version,
            });
            return;
          }

          const run = await getSandboxRun(version.id);
          if (run && run.status === "FAILED") {
            res.status(409).json({
              error: "Version failed validation",
              message: `Version ${version.version} failed sandbox/static validation and cannot be published.`,
              version: version.version,
            });
            return;
          }
        }
      }

      // PLAN-020 E-001: every domain write of a moderation transition
      // (resource status, moderation event, version publication) commits in
      // ONE transaction together with its outbox events (awaited emit, tx
      // handle) — a crash can no longer silently lose an event after the
      // status update committed.
      const publishedVersions: Array<{
        versionId: string;
        version: string;
        changelog: string | null;
      }> = [];
      let resourceJustPublished = false;

      await db.transaction(
        async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
          await tx.orm.public.Resource.where({ id: resourceId }).update({ status });

          // PLAN J-002: append-only moderation event log.
          await tx.orm.public.ModerationEvent.create({
            resourceId: resource.id,
            actorId: req.user!.userId,
            fromStatus: from,
            toStatus: status,
            reason: req.body?.reason ?? null,
          });

          // PLAN I-005: publishing the resource marks its versions PUBLISHED in
          // the release lifecycle.
          if (status === "PUBLISHED") {
            const versions = await tx.orm.public.ResourceVersion
              .where({ resourceId: resource.id })
              .all();
            for (const version of versions) {
              const fresh = await tx.orm.public.ResourceVersion
                .where({ id: version.id })
                .first();
              if (fresh && ["CANDIDATE", "VERIFIED"].includes(fresh.releaseStatus)) {
                await tx.orm.public.ResourceVersion
                  .where({ id: version.id })
                  .update({ releaseStatus: "PUBLISHED" });
                // PLAN-019 H-002: version publish event → worker (price alerts:
                // VERSION_RELEASED watchers). Payload contract matches the
                // worker's RESOURCE_VERSION_PUBLISHED handler.
                await emitOutbox(tx, "RESOURCE_VERSION_PUBLISHED", {
                  resourceId: resource.id,
                  versionId: version.id,
                  version: version.version,
                  changelog: version.changelog ?? undefined,
                });
                publishedVersions.push({
                  versionId: version.id,
                  version: version.version,
                  changelog: version.changelog ?? null,
                });
              }
            }
          }

          // PLAN-006: RESOURCE_RELEASE is a high-value activity item.
          if (status === "PUBLISHED" && resource.status !== "PUBLISHED") {
            // PLAN-019 H-002: resource-level release event → outbox (worker
            // consumers; future email/digest channels).
            await emitOutbox(tx, "RESOURCE_PUBLISHED", {
              resourceId: resource.id,
              slug: resource.slug,
              sellerId: resource.sellerId,
            });
            resourceJustPublished = true;
          }
        }
      );

      // PLAN Q-004: audit trail (best-effort by design — recordAudit never
      // throws; audit rows are observability, not event state).
      await recordAudit({
        actorId: req.user!.userId,
        action: "moderation.transition",
        targetType: "resource",
        targetId: resource.id,
        before: { status: from },
        after: { status },
        ip: req.ip,
        requestId: req.id,
      });

      // Post-commit follow-ups: cache bust + notifications (durable state —
      // the outbox events — is already committed above).
      if (status === "PUBLISHED") {
        // PLAN-006: RESOURCE_UPDATE activity item (idempotent bust).
        await bustActivityCache();
        // PLAN-008 D-002: buyers (§26 — purchase already creates the
        // relationship), resource followers and creator followers, with
        // recipient dedup (one notification per user).
        // PLAN-020 E-002b: the inline path now uses the SAME notification
        // identity as the worker paths (resourceVersion entity + dedupKey),
        // so a user who is both a buyer and a price-alert watcher gets ONE
        // notification per version — the unique index arbitrates across the
        // concurrent paths.
        for (const published of publishedVersions) {
          const recipients = Array.from(
            new Set([
              ...(await buyerIds(resource.id)),
              ...(await resourceFollowerIds(resource.id)),
              ...(await creatorFollowerIds(resource.sellerId)),
            ])
          );
          await deliverFollowNotifications(
            recipients,
            (recipientId) => ({
              recipientId,
              type: "RESOURCE_UPDATE" as const,
              title: `${resource.title} — новая версия ${published.version}`,
              body: published.changelog ? published.changelog.slice(0, 200) : undefined,
              entityType: "resourceVersion",
              entityId: published.versionId,
              dedupKey: `RESOURCE_UPDATE:resourceVersion:${published.versionId}:${recipientId}`,
            }),
            { excludeActorId: req.user!.userId }
          );
        }
      }

      const creatorName =
        (await db.orm.public.User.where({ id: resource.sellerId }).select("displayName", "username").first()) ??
        ({ displayName: null, username: null } as any);
      const creatorLabel = creatorName.displayName || creatorName.username || "Создатель";

      if (resourceJustPublished) {
        // PLAN-008 D-001: notify the creator's followers about the release.
        const followerIds = await creatorFollowerIds(resource.sellerId);
        await deliverFollowNotifications(
          followerIds,
          (recipientId) => ({
            recipientId,
            type: "CREATOR_RESOURCE" as const,
            title: `Новинка от ${creatorLabel}: ${resource.title}`,
            body: resource.description.slice(0, 200),
            entityType: "resource",
            entityId: resource.id,
          }),
          { excludeActorId: req.user!.userId }
        );
      }
      // Send notification if published
      if (status === "PUBLISHED" && resource.status !== "PUBLISHED") {
        const seller = await db.orm.public.User.where({ id: resource.sellerId }).first();

        if (seller && seller.email) {
          sendResourcePublishedEmail(seller.email, resource.title, resource.slug).catch((err) =>
            reqLog(req).error("published_email_send_failed", {
              resource_id: resource.id,
              slug: resource.slug,
              error: err,
            })
          );
        }
      }

      res.json({
        message: "Resource status updated",
        from,
        status,
        reason,
      });
    } catch (error) {
      reqLog(req).error("admin_resource_status_update_failed", { error });
      res.status(500).json({ error: "Failed to update resource status" });
    }
  }
);

// PLAN-003 M-001/M-002: полноценный product presentation для модерации —
// администратор видит ровно то, что увидит покупатель: cover, screenshots,
// описание, продавца, цену, тип, версии с artifact-информацией и статусом
// валидации. State machine не меняется (M-003).
router.get(
  "/resources/:id",
  authenticate,
  adminOnly,
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const resourceId = req.params.id as string;

      const resource = await db.orm.public.Resource.where({ id: resourceId }).first();
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      const [seller, profile, versions, media, reviewAgg] = await Promise.all([
        db.orm.public.User.where({ id: resource.sellerId })
          .select("username", "displayName", "avatar")
          .first(),
        db.orm.public.SellerProfile.where({ userId: resource.sellerId })
          .select("displayName", "supportInfo")
          .first(),
        db.orm.public.ResourceVersion.where({ resourceId: resource.id })
          .orderBy((v: any) => v.publishedAt.desc())
          .all(),
        db.orm.public.ResourceMedia
          .where({ resourceId: resource.id })
          .orderBy((m: any) => m.position.asc())
          .all(),
        db.orm.public.Review.where({ resourceId: resource.id }).aggregate((a: any) => ({
          total: a.count(),
          averageRating: a.avg("rating"),
        })),
      ]);

      // Artifact + validation status per version (M-002: что именно публикуем).
      const versionDetails = await Promise.all(
        (versions as any[]).map(async (v) => {
          const [signature, run] = await Promise.all([
            db.orm.public.ArtifactSignature.where({ versionId: v.id })
              .select("artifactHash", "manifestHash", "signedAt")
              .first(),
            getSandboxRun(v.id),
          ]);
          const { fileChecksum: _c, ...rest } = v;
          return {
            ...rest,
            artifactHash: v.fileChecksum ? v.fileChecksum.slice(0, 16) + "…" : null,
            signed: Boolean(signature),
            signedAt: signature?.signedAt ?? null,
            validationStatus: run?.status ?? "PENDING",
          };
        })
      );

      res.json({
        resource: {
          ...resource,
          seller: seller
            ? {
                username: seller.username,
                displayName: profile?.displayName || seller.displayName || seller.username,
                avatar: seller.avatar,
              }
            : null,
          rating:
            reviewAgg && Number(reviewAgg.total) > 0
              ? Math.round(Number(reviewAgg.averageRating) * 10) / 10
              : null,
          reviewCount: reviewAgg ? Number(reviewAgg.total) : 0,
        },
        cover: resource.coverUrl,
        screenshots: media
          .filter((m: any) => m.kind === "SCREENSHOT")
          .map((m: any) => ({ id: m.id, url: m.url, position: Number(m.position ?? 0) })),
        versions: versionDetails,
      });
    } catch (error) {
      reqLog(req).error("admin_resource_detail_failed", { error });
      res.status(500).json({ error: "Failed to fetch resource detail" });
    }
  }
);

// PLAN-020 J-003-c/A-004.01: the legacy user-management handlers were
// removed. GET /admin/users and PATCH /admin/users/:id/role were dead code
// (adminPlatformRoutes is mounted first and owns both); the live legacy
// PATCH /admin/users/:id/status had no consumers and was unsafe (a
// MODERATOR could ban a SUPERADMIN — its ADMIN-only guard missed the role,
// no audit entry, no session revocation). Parity lives in adminPlatform
// with the permission model: users.view, roles.manage, users.suspend /
// users.restore.

// DELETE /admin/reviews/:id - Delete review
router.delete(
  "/reviews/:id",
  authenticate,
  adminOnly,
  validateCuid('id'),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const reviewId = req.params.id as string;

      const review = await db.orm.public.Review.where({ id: reviewId }).first();

      if (!review) {
        res.status(404).json({ error: "Review not found" });
        return;
      }

      await db.orm.public.Review.where({ id: reviewId }).delete();

      res.json({ message: "Review deleted successfully" });
    } catch (error) {
      reqLog(req).error("admin_review_delete_failed", { error });
      res.status(500).json({ error: "Failed to delete review" });
    }
  }
);

// GET /admin/stats - Get platform statistics
router.get(
  "/stats",
  authenticate,
  adminOnly,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      // PLAN B-005: aggregates in the database (COUNT/GROUP BY) instead of
      // full table loads. The endpoint is rate-limited (standardRateLimit).
      // Runtime groupBy returns [{ <groupKeys>, n }], but the static ORM
      // typing models groupBy rows as full table rows, so the chain is
      // intentionally loosened here (verified against a live DB in
      // scripts/db-check.ts).
      const groupCounts = async (model: unknown, column: string): Promise<Record<string, number>> => {
        const rows = await (model as {
          groupBy: (cols: string[]) => {
            aggregate: (
              fn: (agg: Record<string, (...args: unknown[]) => unknown>) => Record<string, unknown>
            ) => Promise<Array<Record<string, unknown>>>;
          };
        }).groupBy([column]).aggregate((agg) => ({ n: agg.count() }));
        const map: Record<string, number> = {};
        for (const row of rows) map[String(row.status)] = Number(row.n);
        return map;
      };

      const userCounts = await groupCounts(db.orm.public.User, "status");
      const resourceCounts = await groupCounts(db.orm.public.Resource, "status");
      const purchaseCounts = await groupCounts(db.orm.public.Purchase, "status");
      const reviewAgg = await db.orm.public.Review.aggregate((agg: any) => ({
        total: agg.count(),
        averageRating: agg.avg("rating"),
      }));

      const stats = {
        users: {
          total: Number(userCounts.ACTIVE ?? 0) + Number(userCounts.SUSPENDED ?? 0) + Number(userCounts.BANNED ?? 0),
          active: Number(userCounts.ACTIVE ?? 0),
          banned: Number(userCounts.BANNED ?? 0),
        },
        resources: {
          total:
            Number(resourceCounts.DRAFT ?? 0) +
            Number(resourceCounts.PENDING_REVIEW ?? 0) +
            Number(resourceCounts.PUBLISHED ?? 0) +
            Number(resourceCounts.SUSPENDED ?? 0),
          published: Number(resourceCounts.PUBLISHED ?? 0),
          draft: Number(resourceCounts.DRAFT ?? 0),
          pendingReview: Number(resourceCounts.PENDING_REVIEW ?? 0),
          suspended: Number(resourceCounts.SUSPENDED ?? 0),
        },
        purchases: {
          total:
            Number(purchaseCounts.PENDING ?? 0) +
            Number(purchaseCounts.COMPLETED ?? 0) +
            Number(purchaseCounts.REFUNDED ?? 0) +
            Number(purchaseCounts.DISPUTED ?? 0) +
            Number(purchaseCounts.FAILED ?? 0),
          completed: Number(purchaseCounts.COMPLETED ?? 0),
          pending: Number(purchaseCounts.PENDING ?? 0),
        },
        reviews: {
          total: Number(reviewAgg.total ?? 0),
          averageRating: Math.round(Number(reviewAgg.averageRating ?? 0) * 10) / 10,
        },
      };

      res.json(stats);
    } catch (error) {
      reqLog(req).error("admin_stats_fetch_failed", { error });
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  }
);


// ---- PLAN I-005: version release lifecycle (admin) ----

// POST /admin/versions/:id/verify - record a compatibility verification (I-004)
router.post(
  "/versions/:id/verify",
  authenticate,
  adminOnly,
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { status, mtaVersion, os, architecture, notes } = req.body ?? {};
      const allowed = ["VERIFIED", "PARTIALLY_VERIFIED", "UNKNOWN", "FAILED"];
      if (!allowed.includes(status)) {
        res.status(400).json({ error: `status must be one of: ${allowed.join(", ")}` });
        return;
      }
      const version = await db.orm.public.ResourceVersion
        .where({ id: req.params.id as string })
        .first();
      if (!version) {
        res.status(404).json({ error: "Version not found" });
        return;
      }
      const report = await db.orm.public.CompatibilityReport.create({
        versionId: version.id,
        status,
        mtaVersion: mtaVersion ?? null,
        os: os ?? null,
        architecture: architecture ?? null,
        notes: notes ?? null,
        verifiedBy: req.user!.userId,
      });
      // A VERIFIED report advances the release lifecycle CANDIDATE -> VERIFIED.
      if (status === "VERIFIED" && version.releaseStatus === "CANDIDATE") {
        await db.orm.public.ResourceVersion
          .where({ id: version.id })
          .update({ releaseStatus: "VERIFIED" });
      }
      reqLog(req).info("version_compatibility_recorded", {
        version_id: version.id,
        status,
        admin_id: req.user!.userId,
      });
      res.status(201).json(report);
    } catch (error) {
      reqLog(req).error("version_verify_failed", { error });
      res.status(500).json({ error: "Failed to record compatibility report" });
    }
  }
);

// POST /admin/versions/:id/yank - YANKED blocks new lease issuance (I-005)
router.post(
  "/versions/:id/yank",
  authenticate,
  adminOnly,
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const reason = req.body?.reason;
      if (!reason) {
        res.status(400).json({ error: "reason is required" });
        return;
      }
      const updated = await db.orm.public.ResourceVersion
        .where({ id: req.params.id as string })
        .update({ releaseStatus: "YANKED" });
      reqLog(req).warn("version_yanked", {
        version_id: req.params.id,
        reason,
        admin_id: req.user!.userId,
      });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("version_yank_failed", { error });
      res.status(500).json({ error: "Failed to yank version" });
    }
  }
);

// GET /admin/resources/:id/moderation-events - J-002 audit trail
router.get(
  "/resources/:id/moderation-events",
  authenticate,
  adminOnly,
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const events = await db.orm.public.ModerationEvent
        .where({ resourceId: req.params.id as string })
        .orderBy((m) => m.createdAt.desc())
        .all();
      res.json({ data: events, total: events.length });
    } catch (error) {
      reqLog(req).error("moderation_events_fetch_failed", { error });
      res.status(500).json({ error: "Failed to fetch moderation events" });
    }
  }
);

export default router;
