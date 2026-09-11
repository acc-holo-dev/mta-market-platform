// Resource Versions API routes
import { Router, Response } from "express";
import path from "path";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { S3_ENABLED, getS3DownloadUrl, SIGNED_URL_TTL } from "../lib/s3";
import { resolveLocalUploadPath } from "../lib/upload";
import { loadArtifactBuffer } from "../lib/storage";
import { validateArtifact } from "../lib/sandbox/service";
import { signVersionArtifact } from "../lib/artifact/signing";
import { reqLog } from "../middleware/requestId";
import { incDownloadFailure } from "../lib/metrics";

const router: Router = Router();

// GET /resources/:slug/versions - List versions of a resource
router.get("/:slug/versions", standardRateLimit, async (req, res: Response) => {
  try {
    const slug = req.params.slug as string;

    const resource = await db.orm.public.Resource.where({ slug }).first();

    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    if (resource.status !== "PUBLISHED") {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    const versions = await db.orm.public.ResourceVersion.where({ resourceId: resource.id })
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
      });

      // PLAN I-002: persist declared dependencies for the publication gate.
      const declaredDependencies = Array.isArray(req.body?.dependencies)
        ? (req.body.dependencies as Array<{ slug?: string; resourceName?: string; minVersion?: string; type?: string }>)
        : [];
      for (const dep of declaredDependencies) {
        const slug = dep.slug ?? dep.resourceName;
        if (!slug) continue;
        await db.orm.public.ResourceDependency.create({
          resourceId: resource.id,
          dependsOnSlug: slug,
          minVersion: dep.minVersion ?? null,
          type: dep.type ?? null,
        });
      }

      try {
        // PLAN B-001: static validation (+ sandbox execution when Docker is
        // available). A failed validation rolls the version back — a version
        // that cannot be validated must never enter the publication pipeline.
        const validation = await validateArtifact(newVersion.id, artifactBuffer);
        if (!validation.passed) {
          await db.orm.public.ResourceVersion.where({ id: newVersion.id }).delete();
          res.status(422).json({
            error: "Artifact validation failed",
            validation: validation.staticValidation,
          });
          return;
        }

        // PLAN B-002: canonical manifest + SHA-256 + Ed25519 signature.
        const signed = await signVersionArtifact(newVersion.id, artifactBuffer);

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
          reenteredReview,
          artifactHash: signed.artifactHash,
          manifestHash: signed.manifestHash,
        });
      } catch (pipelineError) {
        // Roll back the version: an unvalidated/unsigned version must not linger.
        await db.orm.public.ResourceVersion.where({ id: newVersion.id }).delete().catch(() => undefined);
        throw pipelineError;
      }
    } catch (error) {
      reqLog(req).error("version_create_failed", { error });
      res.status(500).json({ error: "Failed to create version" });
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
