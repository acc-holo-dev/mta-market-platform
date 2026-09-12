// Trust read models (PLAN-018 C-001..C-004): resource verification/compat/health,
// explainable seller score. Both endpoints are public (no auth), bounded and
// N+1-free — all scoring logic lives in lib/trust.ts (documented constants).
import { Router, Response } from "express";
import { standardRateLimit } from "../lib/rateLimit.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { resourceHealth, resourceVerification, sellerHealth } from "../lib/trust.js";

const router: Router = Router();

// GET /trust/resource/:slug — C-001 verification + C-002 compatibility +
// C-003 health for a published resource. Public (trust data is read-only
// and derived from already-public moderation/compatibility facts).
router.get("/resource/:slug", standardRateLimit, async (req, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const resource = await db.orm.public.Resource
      .where({ slug })
      .select("id", "status")
      .first();

    if (!resource || resource.status !== "PUBLISHED") {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    const [verification, health, latestVersion, dependencies] = await Promise.all([
      resourceVerification(resource.id, resource),
      resourceHealth(resource.id),
      db.orm.public.ResourceVersion
        .where({ resourceId: resource.id })
        .orderBy((v: any) => v.publishedAt.desc())
        .select("id")
        .first(),
      db.orm.public.ResourceDependency
        .where({ resourceId: resource.id })
        .select("dependsOnSlug", "minVersion", "type")
        .limit(20)
        .all(),
    ]);

    const report = latestVersion
      ? await db.orm.public.CompatibilityReport
          .where({ versionId: latestVersion.id })
          .orderBy((r: any) => r.createdAt.desc())
          .first()
      : null;

    res.json({
      verification: {
        state: verification.state,
        factors: verification.factors,
      },
      compatibility: {
        result: report?.status ?? null,
        // The CompatibilityReport contract carries a single tested mtaVersion
        // (no min/max range fields) and has no native-module inventory —
        // those stay null until the schema grows them (documented deviation).
        mtaVersion: report?.mtaVersion ?? null,
        mtaMin: null,
        mtaMax: null,
        os: report?.os ?? null,
        arch: report?.architecture ?? null,
        nativeModules: null,
        dependencies: dependencies.map((d: any) => ({
          slug: d.dependsOnSlug,
          minVersion: d.minVersion ?? null,
          type: d.type ?? null,
        })),
        notes: report?.notes ?? null,
        verifiedAt: report?.verifiedAt ?? null,
      },
      health: {
        score: health.score,
        factors: health.factors,
      },
    });
  } catch (error) {
    reqLog(req).error("trust_resource_failed", { error });
    res.status(500).json({ error: "Failed to fetch resource trust data" });
  }
});

// GET /trust/seller/:username — C-004 explainable seller score. Public.
router.get("/seller/:username", standardRateLimit, async (req, res: Response) => {
  try {
    const username = req.params.username as string;
    const user = await db.orm.public.User
      .where({ username, status: "ACTIVE" })
      .select("id", "username", "displayName", "createdAt")
      .first();

    if (!user) {
      res.status(404).json({ error: "Seller not found" });
      return;
    }

    const health = await sellerHealth(user.id);

    res.json({
      seller: {
        username: user.username,
        displayName: user.displayName ?? user.username,
        memberSince: user.createdAt,
      },
      score: health.score,
      factors: health.factors,
    });
  } catch (error) {
    reqLog(req).error("trust_seller_failed", { error });
    res.status(500).json({ error: "Failed to fetch seller trust data" });
  }
});

export default router;
