// Resource Versions API routes
import { Router, Response } from "express";
import path from "path";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { db } from "../prisma/db.js";
import { S3_ENABLED, getS3DownloadUrl, SIGNED_URL_TTL } from "../lib/s3.js";
import { resolveLocalUploadPath } from "../lib/upload.js";
import { loadArtifactBuffer } from "../lib/storage.js";
import { validateArtifact } from "../lib/sandbox/service.js";
import { signVersionArtifact } from "../lib/artifact/signing.js";
import { recordAudit } from "../lib/audit.js";
import { isCuid } from "../middleware/validateCuid.js";
import { reqLog } from "../middleware/requestId.js";
import { incDownloadFailure } from "../lib/metrics.js";

const router: Router = Router();

/** Body-field UUID guard (route params use the validateCuid middleware). */
const validateCuidSync = isCuid;

// PLAN-018 D-004: release channels on ResourceVersion.channel (schema field
// already migrated). The channel is request-selectable metadata — the update
// center reads STABLE by default (routes/updates.ts).
const RELEASE_CHANNELS = ["STABLE", "BETA", "LEGACY"] as const;
type ReleaseChannelName = (typeof RELEASE_CHANNELS)[number];

function parseChannel(raw: unknown): ReleaseChannelName | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined; // not provided
  return (RELEASE_CHANNELS as readonly string[]).includes(String(raw))
    ? (String(raw) as ReleaseChannelName)
    : null; // provided but invalid
}

// GET /resources/:slug/versions - List versions of a resource
// PLAN-018 D-004: optional ?channel=STABLE|BETA|LEGACY filter (default: all).
router.get("/:slug/versions", standardRateLimit, async (req, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const channel = parseChannel(req.query.channel);
    if (channel === null) {
      res.status(400).json({ error: "Invalid channel. Allowed: STABLE, BETA, LEGACY" });
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

    let query = db.orm.public.ResourceVersion.where({ resourceId: resource.id });
    if (channel) {
      query = query.where({ channel });
    }
    const versions = await query
      .orderBy((m) => m.publishedAt.desc())
      .all();

    res.json(versions);
  } catch (error) {
    reqLog(req).error("versions_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch versions" });
  }
});

// POST /resources/:slug/versions - Create new version (authenticated, owner only)
router.post(
  "/:slug/versions",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const slug = req.params.slug as string;
      const { version, changelog, fileUrl, fileSize, fileChecksum } = req.body;

      // PLAN-018 D-004: optional channel on create (defaults to STABLE).
      const channelParsed = parseChannel(req.body?.channel);
      if (channelParsed === null) {
        res.status(400).json({ error: "Invalid channel. Allowed: STABLE, BETA, LEGACY" });
        return;
      }
      const channel: ReleaseChannelName = channelParsed ?? "STABLE";

      if (!version || !fileUrl || !fileSize || !fileChecksum) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const resource = await db.orm.public.Resource.where({ slug }).first();

      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      if (resource.sellerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }

      // Check if version already exists
      const existing = await db.orm.public.ResourceVersion.where({
        resourceId: resource.id,
        version,
      }).first();

      if (existing) {
        res.status(409).json({ error: "Version already exists" });
        return;
      }

      // PLAN B-001/B-002 pipeline: the artifact must live in OUR storage so it
      // can be validated, signed and later served through authorized downloads.
      // External URLs cannot be validated or signed — reject them here.
      const artifactBuffer = await loadArtifactBuffer(fileUrl);
      if (!artifactBuffer) {
        res.status(400).json({
          error: "Artifact not found in storage",
          message:
            "fileUrl must reference an artifact uploaded via POST /upload/resource (external URLs are not supported).",
        });
        return;
      }

      const newVersion = await db.orm.public.ResourceVersion.create({
        resourceId: resource.id,
        version,
        changelog: changelog || null,
        fileUrl,
        fileSize,
        fileChecksum,
        channel,
      });

      // PLAN I-002: persist declared dependencies for the publication gate.
      // Track the rows created by THIS request so a pipeline failure can roll
      // the half-created publication state back completely (D-002 cleanup).
      const declaredDependencies = Array.isArray(req.body?.dependencies)
        ? (req.body.dependencies as Array<{ slug?: string; resourceName?: string; minVersion?: string; type?: string }>)
        : [];
      const createdDependencyIds: string[] = [];
      for (const dep of declaredDependencies) {
        const slug = dep.slug ?? dep.resourceName;
        if (!slug) continue;
        const created = await db.orm.public.ResourceDependency.create({
          resourceId: resource.id,
          dependsOnSlug: slug,
          minVersion: dep.minVersion ?? null,
          type: dep.type ?? null,
        });
        createdDependencyIds.push(created.id);
      }

      /** Rolls back everything this request created (version + declared deps). */
      const cleanupHalfCreated = async (): Promise<void> => {
        await db.orm.public.ResourceVersion.where({ id: newVersion.id }).delete().catch(() => undefined);
        for (const depId of createdDependencyIds) {
          await db.orm.public.ResourceDependency.where({ id: depId }).delete().catch(() => undefined);
        }
      };

      // PLAN-018 D-002: explicit pipeline state surfaced in the CREATE
      // RESPONSE only (no schema change). The version row itself keeps its
      // CANDIDATE releaseStatus until moderation publishes it.
      let pipeline: "UPLOADED" | "VALIDATED" | "SIGNED" = "UPLOADED";

      try {
        // PLAN B-001: static validation (+ sandbox execution when Docker is
        // available). A failed validation rolls the version back — a version
        // that cannot be validated must never enter the publication pipeline.
        const validation = await validateArtifact(newVersion.id, artifactBuffer);
        if (!validation.passed) {
          await cleanupHalfCreated();
          res.status(422).json({
            error: "Artifact validation failed",
            validation: validation.staticValidation,
          });
          return;
        }
        pipeline = "VALIDATED";

        // PLAN B-002: canonical manifest + SHA-256 + Ed25519 signature.
        const signed = await signVersionArtifact(newVersion.id, artifactBuffer);
        pipeline = "SIGNED";

        // PLAN-008 D-002 (Update delivery path): a new version of a PUBLISHED
        // resource re-enters moderation — PUBLISHED → PENDING_REVIEW as a
        // system-initiated transition recorded for audit. Moderation approval
        // then releases the version and notifies buyers (§26) and followers.
        let reenteredReview = false;
        if (resource.status === "PUBLISHED") {
          await db.orm.public.Resource
            .where({ id: resource.id })
            .update({ status: "PENDING_REVIEW" });
          await db.orm.public.ModerationEvent.create({
            resourceId: resource.id,
            actorId: req.user!.userId,
            fromStatus: "PUBLISHED",
            toStatus: "PENDING_REVIEW",
            reason: `New version ${version} uploaded (update review)`,
          });
          reenteredReview = true;
        }

        res.status(201).json({
          ...newVersion,
          signed: true,
          pipeline,
          reenteredReview,
          artifactHash: signed.artifactHash,
          manifestHash: signed.manifestHash,
        });
      } catch (pipelineError) {
        // Roll back the version: an unvalidated/unsigned version must not linger.
        await cleanupHalfCreated();
        throw pipelineError;
      }
    } catch (error) {
      reqLog(req).error("version_create_failed", { error });
      res.status(500).json({ error: "Failed to create version" });
    }
  }
);

// POST /resources/:slug/rollback - Roll a published resource back to a
// previously published artifact (seller owner only; PLAN-018 D-003).
//
// Semantics:
// - the artifact is immutable (J-003): the NEW version row REUSES the target's
//   artifact (fileUrl/fileSize/fileChecksum copied verbatim — same bytes,
//   same artifactHash), it never re-uploads or re-writes storage;
// - the target must have been released by moderation before
//   (releaseStatus PUBLISHED on a PUBLISHED resource) — rollback is a
//   maintenance re-publish of an already-approved artifact, never a way to
//   bypass moderation;
// - the new row is signed through the same signing pipeline, so the
//   publication gate (every version signed + validated) stays intact.
router.post(
  "/:slug/rollback",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const slug = req.params.slug as string;
      // toVersionId arrives in the JSON body (validateCuid is for route params).
      const toVersionId = typeof req.body?.toVersionId === "string" ? req.body.toVersionId : "";
      if (!validateCuidSync(toVersionId)) {
        res.status(400).json({
          error: "Invalid ID format",
          message: "Body field 'toVersionId' must be a valid domain ID (UUID)",
        });
        return;
      }

      const resource = await db.orm.public.Resource.where({ slug }).first();
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      if (resource.sellerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }

      // Maintenance re-publish is only meaningful on a live listing.
      if (resource.status !== "PUBLISHED") {
        res.status(409).json({
          error: "Rollback requires a published resource",
          message:
            "The resource is not PUBLISHED — rollback only re-publishes an artifact that moderation already released.",
        });
        return;
      }

      const target = await db.orm.public.ResourceVersion
        .where({ id: toVersionId, resourceId: resource.id })
        .first();
      if (!target) {
        res.status(404).json({ error: "Target version not found" });
        return;
      }

      // Moderation guard: the artifact must have been released before.
      if (target.releaseStatus !== "PUBLISHED") {
        res.status(409).json({
          error: "Target version was never published",
          message: `Version ${target.version} has release status ${target.releaseStatus} — only previously published artifacts can be rolled back to.`,
        });
        return;
      }

      // Artifact immutable (J-003): reuse the exact artifact reference.
      const artifactBuffer = await loadArtifactBuffer(target.fileUrl);
      if (!artifactBuffer) {
        res.status(500).json({ error: "Target artifact is missing from storage" });
        return;
      }

      // Unique version string: "<target>-rollback.<n>", incrementing n.
      let rollbackVersion = "";
      for (let n = 1; n <= 100; n += 1) {
        const candidate = `${target.version}-rollback.${n}`;
        const existing = await db.orm.public.ResourceVersion
          .where({ resourceId: resource.id, version: candidate })
          .select("id")
          .first();
        if (!existing) {
          rollbackVersion = candidate;
          break;
        }
      }
      if (!rollbackVersion) {
        res.status(409).json({ error: "No free rollback version name" });
        return;
      }

      const created = await db.orm.public.ResourceVersion.create({
        resourceId: resource.id,
        version: rollbackVersion,
        changelog: `Rollback to ${target.version}`,
        fileUrl: target.fileUrl,
        fileSize: target.fileSize,
        fileChecksum: target.fileChecksum,
        channel: target.channel,
        releaseStatus: "PUBLISHED",
      });

      try {
        // Re-sign the SAME artifact bytes for the new row (correct manifest,
        // identical artifactHash) so the publication gate stays valid.
        const signed = await signVersionArtifact(created.id, artifactBuffer);

        await recordAudit({
          actorId: req.user!.userId,
          action: "resource_rollback",
          targetType: "resource",
          targetId: resource.id,
          before: { fromVersionId: target.id, fromVersion: target.version },
          after: {
            toVersionId: created.id,
            version: created.version,
            artifactChecksum: created.fileChecksum,
          },
          ip: req.ip,
          requestId: req.id,
        });

        res.status(201).json({
          ...created,
          signed: true,
          pipeline: "PUBLISHED" as const,
          rollbackOf: { id: target.id, version: target.version },
          artifactHash: signed.artifactHash,
          manifestHash: signed.manifestHash,
        });
      } catch (pipelineError) {
        // D-002 cleanup: a half-created (unsigned) rollback row must not linger.
        await db.orm.public.ResourceVersion.where({ id: created.id }).delete().catch(() => undefined);
        throw pipelineError;
      }
    } catch (error) {
      reqLog(req).error("version_rollback_failed", { error });
      res.status(500).json({ error: "Failed to roll back version" });
    }
  }
);

// GET /resources/:slug/versions/:version/download - Download version (authenticated, purchased only)
router.get(
  "/:slug/versions/:version/download",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const slug = req.params.slug as string;
      const version = req.params.version as string;

      const resource = await db.orm.public.Resource.where({ slug }).first();

      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      const resourceVersion = await db.orm.public.ResourceVersion.where({
        resourceId: resource.id,
        version,
      }).first();

      if (!resourceVersion) {
        res.status(404).json({ error: "Version not found" });
        return;
      }

      // Check entitlement: user must have purchased this resource
      // and either bought this specific version or has update rights
      const purchase = await db.orm.public.Purchase.where({
        buyerId: req.user!.userId,
        resourceId: resource.id,
        status: "COMPLETED",
      }).first();

      if (!purchase) {
        incDownloadFailure();
        reqLog(req).warn("download_denied_no_purchase", {
          user_id: req.user!.userId,
          resource_id: resource.id,
          slug,
        });
        res.status(403).json({ error: "Purchase required to download" });
        return;
      }

      // Verify user has entitlement to THIS version
      // Case 1: User purchased this exact version
      // Case 2: User purchased an earlier version and this is an update (future: check update policy)
      const purchasedVersion = await db.orm.public.ResourceVersion.where({
        id: purchase.versionId,
      }).first();

      if (!purchasedVersion) {
        res.status(500).json({ error: "Purchased version not found" });
        return;
      }

      // For now: strict version matching (user can only download what they bought)
      // TODO: Implement update entitlement based on resource update policy
      if (purchase.versionId !== resourceVersion.id) {
        reqLog(req).warn("download_denied_version_mismatch", {
          user_id: req.user!.userId,
          resource_id: resource.id,
          slug,
          purchased_version: purchasedVersion.version,
          requested_version: resourceVersion.version,
        });
        res.status(403).json({ 
          error: "Version not entitled", 
          message: `You purchased version ${purchasedVersion.version}, but requested version ${resourceVersion.version}. Upgrade separately or check update policy.`,
          purchasedVersion: purchasedVersion.version,
          requestedVersion: resourceVersion.version,
        });
        return;
      }

      reqLog(req).info("download_authorized", { user_id: req.user!.userId, slug, version });

      // TASK A-009: paid artifacts are never exposed via permanent public URLs.
      // - S3/R2: short-lived signed GetObject URL (TTL-capped in lib/s3).
      // - Local storage: the file is streamed through THIS authenticated,
      //   entitlement-checked endpoint; there is no public static /uploads route.
      if (S3_ENABLED) {
        // Production: fileUrl stores the S3 object key
        const downloadUrl = await getS3DownloadUrl(resourceVersion.fileUrl);

        res.json({
          downloadUrl,
          version: resourceVersion.version,
          fileSize: resourceVersion.fileSize,
          checksum: resourceVersion.fileChecksum,
          expiresIn: SIGNED_URL_TTL,
        });
        return;
      }

      // Local storage mode (development): stream the file after authorization.
      if (process.env.NODE_ENV === "production") {
        res.status(500).json({ error: "S3 must be enabled in production" });
        return;
      }

      const localPath = resolveLocalUploadPath(resourceVersion.fileUrl);
      if (!localPath) {
        res.status(400).json({ error: "Invalid storage reference" });
        return;
      }

      res.download(localPath, `${slug}-${resourceVersion.version}${path.extname(localPath)}`);
    } catch (error) {
      reqLog(req).error("download_url_failed", { error });
      res.status(500).json({ error: "Failed to get download URL" });
    }
  }
);

export default router;
