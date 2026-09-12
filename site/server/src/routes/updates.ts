// Update Center (PLAN-018 D-005): installed licenses + latest + compatibility
// + actions. Mounted at /me (app.ts): GET /me/updates and
// GET /me/updates/changelog/:resourceId.
//
// Bounded by design: purchases page ≤ 50, candidate version rows capped,
// health scored through the batch read model (lib/trust.ts resourceHealthBulk).
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { db } from "../prisma/db.js";
import { validateCuid, isCuid } from "../middleware/validateCuid.js";
import { reqLog } from "../middleware/requestId.js";
import { resourceHealthBulk } from "../lib/trust.js";

const router: Router = Router();

const MAX_PAGE_LIMIT = 50;
const MAX_VERSION_CANDIDATES = 500;

/**
 * Simple semver comparison (inline helper, D-005): numeric dot components,
 * then prerelease identifiers (a missing prerelease sorts AFTER one —
 * "1.2.3" > "1.2.3-rollback.1"). Returns > 0 when a > b.
 */
export function compareVersion(a: string, b: string): number {
  const parse = (v: string) => {
    const [core, pre = ""] = v.split("-", 2);
    return {
      nums: core.split(".").map((n) => parseInt(n, 10) || 0),
      pre: pre ? pre.split(".") : [],
    };
  };
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i += 1) {
    const na = pa.nums[i] ?? 0;
    const nb = pb.nums[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  // Same numeric core: release > prerelease; otherwise lexicographic ids.
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
  if (pa.pre.length === 0) return 1;
  if (pb.pre.length === 0) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i += 1) {
    const ia = pa.pre[i];
    const ib = pb.pre[i];
    if (ia === ib) continue;
    if (ia === undefined) return 1;
    if (ib === undefined) return -1;
    const na = parseInt(ia, 10);
    const nb = parseInt(ib, 10);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return ia < ib ? -1 : 1;
  }
  return 0;
}

function parsePaging(query: any): { page: number; limit: number; skip: number } {
  const page = Math.max(parseInt(query.page || "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || "20", 10) || 20, 1), MAX_PAGE_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

// GET /me/updates — D-005 Update Center for the authenticated buyer.
router.get("/updates", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip } = parsePaging(req.query);

    const purchasesAgg = await db.orm.public.Purchase
      .where({ buyerId: req.user!.userId, status: "COMPLETED" })
      .aggregate((a: any) => ({ total: a.count() }));
    const total = Number(purchasesAgg.total ?? 0);

    const purchases = await db.orm.public.Purchase
      .where({ buyerId: req.user!.userId, status: "COMPLETED" })
      .orderBy((p: any) => p.createdAt.desc())
      .limit(limit)
      .offset(skip)
      .all();

    // License per completed purchase (unique purchaseId — at most one row).
    const purchaseIds = purchases.map((p: any) => p.id as string);
    const licenses = purchaseIds.length
      ? await db.orm.public.License.where((l: any) => l.purchaseId.in(purchaseIds)).all()
      : [];
    const licenseByPurchase = new Map<string, any>();
    for (const license of licenses) licenseByPurchase.set(license.purchaseId, license);

    const resourceIds = [...new Set(purchases.map((p: any) => p.resourceId as string))];

    // Installed (license) + latest (published STABLE) versions.
    const licenseVersionIds = licenses.map((l: any) => l.versionId as string);
    const installedVersions = licenseVersionIds.length
      ? await db.orm.public.ResourceVersion
          .where((v: any) => v.id.in(licenseVersionIds))
          .all()
      : [];
    const versionById = new Map<string, any>();
    for (const v of installedVersions) versionById.set(v.id, v);

    const publishedVersions = resourceIds.length
      ? await db.orm.public.ResourceVersion
          .where((v: any) => v.resourceId.in(resourceIds))
          .where({ releaseStatus: "PUBLISHED" })
          .orderBy((v: any) => v.publishedAt.desc())
          .limit(MAX_VERSION_CANDIDATES)
          .all()
      : [];
    // Latest STABLE per resource; fall back to the latest published version
    // when the resource never shipped a STABLE release.
    const latestStable = new Map<string, any>();
    const latestAny = new Map<string, any>();
    for (const v of publishedVersions) {
      if (!latestAny.has(v.resourceId)) latestAny.set(v.resourceId, v);
      if (v.channel === "STABLE" && !latestStable.has(v.resourceId)) latestStable.set(v.resourceId, v);
    }

    // Compatibility report on the latest version (report status only — the
    // buyer-facing center does not render the full report evidence).
    const latestVersionIds = resourceIds
      .map((rid) => latestStable.get(rid) ?? latestAny.get(rid))
      .filter(Boolean)
      .map((v: any) => v.id as string);
    const reports = latestVersionIds.length
      ? await db.orm.public.CompatibilityReport
          .where((r: any) => r.versionId.in(latestVersionIds))
          .orderBy((r: any) => r.createdAt.desc())
          .limit(latestVersionIds.length * 5)
          .select("versionId", "status", "verifiedAt")
          .all()
      : [];
    const reportByVersion = new Map<string, any>();
    for (const r of reports) if (!reportByVersion.has(r.versionId)) reportByVersion.set(r.versionId, r);

    const resources = resourceIds.length
      ? await db.orm.public.Resource
          .where((r: any) => r.id.in(resourceIds))
          .select("id", "slug", "title", "sellerId", "status")
          .all()
      : [];
    const resourceById = new Map<string, any>();
    for (const r of resources) resourceById.set(r.id, r);

    // Batch health (C-003 read model) — constant query count.
    const healthByResource = await resourceHealthBulk(resourceIds);

    const items = purchases.map((p: any) => {
      const resource = resourceById.get(p.resourceId);
      const license = licenseByPurchase.get(p.id) ?? null;
      const installed = license ? versionById.get(license.versionId) ?? null : null;
      const latest = resource ? (latestStable.get(resource.id) ?? latestAny.get(resource.id) ?? null) : null;
      const report = latest ? reportByVersion.get(latest.id) ?? null : null;
      const health = resource ? healthByResource.get(resource.id) ?? null : null;
      return {
        purchaseId: p.id,
        licenseId: license?.id ?? null,
        licenseStatus: license?.status ?? null,
        resourceId: resource?.id ?? null,
        slug: resource?.slug ?? null,
        title: resource?.title ?? null,
        installedVersion: installed?.version ?? null,
        latestVersion: latest?.version ?? null,
        latestChannel: latest?.channel ?? null,
        updateAvailable:
          installed != null && latest != null ? compareVersion(latest.version, installed.version) > 0 : false,
        compatibility: report ? { result: report.status, verifiedAt: report.verifiedAt } : null,
        health: health ? { score: health.score, factors: health.factors } : null,
        actions: {
          canUpdate: true,
          // Rollback is a seller maintenance action — never offered to buyers.
          canRollback: resource?.sellerId === req.user!.userId,
          changelogUrl: resource ? `/me/updates/changelog/${resource.id}` : null,
        },
      };
    });

    res.json({
      data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    reqLog(req).error("updates_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch updates" });
  }
});

// GET /me/updates/changelog/:resourceId?from=<versionId> — bounded changelog
// (published versions only, newest first). `from` is a version-id cursor:
// only releases older than that version are returned (cursor pagination).
router.get(
  "/updates/changelog/:resourceId",
  authenticate,
  validateCuid("resourceId"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const resourceId = req.params.resourceId as string;
      const from = typeof req.query.from === "string" ? req.query.from : "";

      const resource = await db.orm.public.Resource
        .where({ id: resourceId })
        .select("id", "slug", "title")
        .first();
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      let cursor: { publishedAt: string } | null = null;
      if (from) {
        if (!isCuid(from)) {
          res.status(400).json({ error: "Invalid ID format", message: "'from' must be a valid version ID (UUID)" });
          return;
        }
        cursor = await db.orm.public.ResourceVersion
          .where({ id: from, resourceId })
          .select("publishedAt")
          .first();
        if (!cursor) {
          res.status(404).json({ error: "Cursor version not found" });
          return;
        }
      }

      let query = db.orm.public.ResourceVersion
        .where({ resourceId, releaseStatus: "PUBLISHED" });
      if (cursor) {
        query = query.where((v: any) => v.publishedAt.lt(cursor!.publishedAt));
      }
      const versions = await query
        .orderBy((v: any) => v.publishedAt.desc())
        .limit(MAX_PAGE_LIMIT)
        .select("id", "version", "changelog", "channel", "releaseStatus", "publishedAt")
        .all();

      res.json({
        resource: { id: resource.id, slug: resource.slug, title: resource.title },
        data: versions,
        // Next cursor for pagination (id of the oldest returned row).
        nextCursor: versions.length === MAX_PAGE_LIMIT ? versions[versions.length - 1].id : null,
      });
    } catch (error) {
      reqLog(req).error("updates_changelog_failed", { error });
      res.status(500).json({ error: "Failed to fetch changelog" });
    }
  }
);

export default router;
