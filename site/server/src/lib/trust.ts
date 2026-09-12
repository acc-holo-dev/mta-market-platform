// PLAN-018 Workstream C: trust read models (C-001..C-004).
//
// EXPLAINABLE BY CONSTRUCTION — every score is the sum of per-factor
// contributions, and every factor is returned alongside the score with its
// own {name, value, weight, contribution}. There is no hidden model state:
// given the same rows in the database, the same score is produced.
//
// All read paths are bounded aggregates (count/avg over fixed-size candidate
// id sets) — no N+1, no unbounded scans.
import { db } from "../prisma/db.js";

// ---------------------------------------------------------------------------
// Documented constants (the whole formula lives here).
// ---------------------------------------------------------------------------

/** Resource-level factor weights; sum = 100. */
export const RESOURCE_TRUST_WEIGHTS = {
  installation: 25,
  refunds: 25,
  compatibility: 25,
  cadence: 25,
} as const;

/** Seller-level factor weights; sum = 100. */
export const SELLER_TRUST_WEIGHTS = {
  installation: 25,
  refunds: 25,
  cadence: 25,
  compatibility: 15,
  support: 10,
} as const;

/** Verification-state weights (resourceVerification factors); sum = 100. */
export const VERIFICATION_WEIGHTS = {
  moderation: 50,
  compatibility: 50,
} as const;

/** Update-cadence scoring window (days) and the release count that earns a full score. */
export const CADENCE_WINDOW_DAYS = 90;
export const CADENCE_TARGET_PER_90D = 4;
/** Seller-level cadence target per actively maintained resource (capped). */
export const SELLER_CADENCE_TARGET_PER_RESOURCE = 2;
/** Sandbox outcomes that count as a failed run. */
export const FAILED_SANDBOX_STATUSES = ["FAILED", "TIMEOUT", "SECURITY_VIOLATION"] as const;

/** CompatibilityStatus → factor value (0..1). Absent/UNKNOWN → null (no evidence). */
const COMPAT_VALUE: Record<string, number | null> = {
  VERIFIED: 1,
  PARTIALLY_VERIFIED: 0.5,
  FAILED: 0,
  UNKNOWN: null,
};

export interface TrustFactor {
  name: string;
  /** Normalized factor value 0..1; null = "the system has no evidence". */
  value: number | null;
  weight: number;
  /** contribution = round(value * weight, 2); 0 when value is null. */
  contribution: number;
  note?: string;
}

export interface HealthScore {
  score: number;
  factors: TrustFactor[];
}

function contributionOf(value: number | null, weight: number): number {
  if (value === null) return 0;
  return Math.round(value * weight * 100) / 100;
}

function factor(name: string, value: number | null, weight: number, note?: string): TrustFactor {
  const f: TrustFactor = { name, value, weight, contribution: contributionOf(value, weight) };
  if (note) f.note = note;
  return f;
}

function scoreOf(factors: TrustFactor[]): HealthScore {
  const score = Math.round(factors.reduce((sum, f) => sum + f.contribution, 0) * 100) / 100;
  return { score: Math.max(0, Math.min(100, score)), factors };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** count rows where `field` is in `values` on `model`, bounded by the caller's id set. */
async function countIn(model: any, field: string, values: string[], extra?: (m: any) => any): Promise<number> {
  if (values.length === 0) return 0;
  let q = model.where((m: any) => (m as any)[field].in(values));
  if (extra) q = extra(q);
  const agg = await q.aggregate((a: any) => ({ total: a.count() }));
  return Number(agg.total ?? 0);
}

// ---------------------------------------------------------------------------
// C-001: verification state (moderation + compatibility evidence)
// ---------------------------------------------------------------------------

export interface ResourceVerification {
  state: "VERIFIED" | "UNVERIFIED" | "FAILED";
  moderated: boolean;
  compatibilityStatus: string | null;
  factors: TrustFactor[];
}

/**
 * C-001 semantics (lib/moderation.ts): PUBLISHED is reachable only through
 * moderation (ADMIN_TRANSITIONS), so status PUBLISHED = the artifact passed
 * human review. VERIFIED additionally requires a VERIFIED compatibility
 * report on the latest version; a FAILED report is surfaced as FAILED.
 */
export async function resourceVerification(
  resourceId: string,
  resource?: { status: string } | null
): Promise<ResourceVerification> {
  const row =
    resource ??
    (await db.orm.public.Resource.where({ id: resourceId }).select("status").first());
  const moderated = row?.status === "PUBLISHED";

  const latestVersion = await db.orm.public.ResourceVersion
    .where({ resourceId })
    .orderBy((v: any) => v.publishedAt.desc())
    .select("id")
    .first();
  const report = latestVersion
    ? await db.orm.public.CompatibilityReport
        .where({ versionId: latestVersion.id })
        .orderBy((r: any) => r.createdAt.desc())
        .select("status")
        .first()
    : null;
  const compatStatus = report?.status ?? null;
  const compatValue = compatStatus ? COMPAT_VALUE[compatStatus] ?? null : null;

  const state: ResourceVerification["state"] =
    compatStatus === "FAILED"
      ? "FAILED"
      : moderated && compatStatus === "VERIFIED"
        ? "VERIFIED"
        : "UNVERIFIED";

  const factors: TrustFactor[] = [
    factor(
      "moderation",
      moderated ? 1 : 0,
      VERIFICATION_WEIGHTS.moderation,
      moderated ? "PUBLISHED — approved by moderation" : "not approved by moderation"
    ),
    factor(
      "compatibility",
      compatValue,
      VERIFICATION_WEIGHTS.compatibility,
      compatStatus ? `latest report: ${compatStatus}` : "no compatibility report"
    ),
  ];

  return { state, moderated, compatibilityStatus: compatStatus, factors };
}

// ---------------------------------------------------------------------------
// C-002/C-003: resource health (deterministic, bounded)
// ---------------------------------------------------------------------------

/**
 * Deterministic formula (constants above):
 *   installation = licenses / (licenses + failed_sandbox_runs)      [no data → null]
 *   refunds      = 1 - refunded/live_purchases                      [no purchases → null]
 *   compatibility= VERIFIED 1 / PARTIAL 0.5 / FAILED 0 / none null
 *   cadence      = min(1, versions_in_90d / CADENCE_TARGET_PER_90D)
 *   score        = Σ round(value × weight) over the four 25-weight factors.
 */
export async function resourceHealth(resourceId: string): Promise<HealthScore> {
  const bulk = await resourceHealthBulk([resourceId]);
  return (
    bulk.get(resourceId) ?? {
      score: 0,
      factors: [
        factor("installation", null, RESOURCE_TRUST_WEIGHTS.installation, "resource not found"),
        factor("refunds", null, RESOURCE_TRUST_WEIGHTS.refunds, "resource not found"),
        factor("compatibility", null, RESOURCE_TRUST_WEIGHTS.compatibility, "resource not found"),
        factor("cadence", 0, RESOURCE_TRUST_WEIGHTS.cadence, "resource not found"),
      ],
    }
  );
}

/**
 * Batch variant used by list endpoints (Update Center) — a constant number of
 * aggregate queries regardless of how many resources are scored.
 */
export async function resourceHealthBulk(
  resourceIds: string[]
): Promise<Map<string, HealthScore>> {
  const result = new Map<string, HealthScore>();
  if (resourceIds.length === 0) return result;

  const versionRows = await db.orm.public.ResourceVersion
    .where((v: any) => v.resourceId.in(resourceIds))
    .select("id", "resourceId", "publishedAt")
    .limit(1000)
    .all();
  const versionIds = versionRows.map((v: any) => v.id as string);

  const [licenseCount, failedRuns, purchaseRows, refundCount, cadenceRows] = await Promise.all([
    countIn(db.orm.public.License, "versionId", versionIds),
    countIn(db.orm.public.SandboxRun, "versionId", versionIds, (q: any) =>
      q.where((r: any) => r.status.in([...FAILED_SANDBOX_STATUSES]))
    ),
    db.orm.public.Purchase
      .where((p: any) => p.resourceId.in(resourceIds))
      .where((p: any) => p.status.in(["COMPLETED", "REFUNDED"]))
      .groupBy("resourceId")
      .aggregate((a: any) => ({ total: a.count() })),
    db.orm.public.Purchase
      .where((p: any) => p.resourceId.in(resourceIds))
      .where({ status: "REFUNDED" })
      .groupBy("resourceId")
      .aggregate((a: any) => ({ total: a.count() })),
    db.orm.public.ResourceVersion
      .where((v: any) => v.resourceId.in(resourceIds))
      .where((v: any) => v.publishedAt.gte(isoDaysAgo(CADENCE_WINDOW_DAYS)))
      .groupBy("resourceId")
      .aggregate((a: any) => ({ total: a.count() })),
  ]);

  const purchasesByResource = new Map<string, number>();
  for (const row of purchaseRows as any[]) purchasesByResource.set(row.resourceId, Number(row.total ?? 0));
  const refundsByResource = new Map<string, number>();
  for (const row of refundCount as any[]) refundsByResource.set(row.resourceId, Number(row.total ?? 0));
  const cadenceByResource = new Map<string, number>();
  for (const row of cadenceRows as any[]) cadenceByResource.set(row.resourceId, Number(row.total ?? 0));

  // Latest compatibility report per resource: latest version → latest report.
  const latestVersionByResource = new Map<string, { id: string; publishedAt: string }>();
  for (const v of versionRows) {
    const prev = latestVersionByResource.get(v.resourceId as string);
    if (!prev || new Date(v.publishedAt as string) > new Date(prev.publishedAt)) {
      latestVersionByResource.set(v.resourceId as string, {
        id: v.id as string,
        publishedAt: v.publishedAt as string,
      });
    }
  }
  const latestVersionIds = [...latestVersionByResource.values()].map((v) => v.id);
  const reports = latestVersionIds.length
    ? await db.orm.public.CompatibilityReport
        .where((r: any) => r.versionId.in(latestVersionIds))
        .orderBy((r: any) => r.createdAt.desc())
        .select("versionId", "status")
        .limit(latestVersionIds.length * 5)
        .all()
    : [];
  const reportByVersion = new Map<string, string>();
  for (const r of reports as any[]) {
    if (!reportByVersion.has(r.versionId)) reportByVersion.set(r.versionId, r.status);
  }

  // License counts per resource (licenses hang off versions).
  const versionsByResource = new Map<string, string[]>();
  for (const v of versionRows) {
    const list = versionsByResource.get(v.resourceId as string) ?? [];
    list.push(v.id as string);
    versionsByResource.set(v.resourceId as string, list);
  }
  const licenseCounts = new Map<string, number>();
  if (versionIds.length) {
    const rows = await db.orm.public.License
      .where((l: any) => l.versionId.in(versionIds))
      .groupBy("versionId")
      .aggregate((a: any) => ({ total: a.count() }));
    const byVersion = new Map<string, number>();
    for (const row of rows as any[]) byVersion.set(row.versionId, Number(row.total ?? 0));
    for (const [resourceId, vids] of versionsByResource) {
      licenseCounts.set(resourceId, vids.reduce((sum, vid) => sum + (byVersion.get(vid) ?? 0), 0));
    }
  }
  // Sandbox failures per resource (latest runs dominate the signal; bounded set).
  const failedRunsByResource = new Map<string, number>();
  if (versionIds.length) {
    const rows = await db.orm.public.SandboxRun
      .where((r: any) => r.versionId.in(versionIds))
      .where((r: any) => r.status.in([...FAILED_SANDBOX_STATUSES]))
      .groupBy("versionId")
      .aggregate((a: any) => ({ total: a.count() }));
    const byVersion = new Map<string, number>();
    for (const row of rows as any[]) byVersion.set(row.versionId, Number(row.total ?? 0));
    for (const [resourceId, vids] of versionsByResource) {
      failedRunsByResource.set(resourceId, vids.reduce((sum, vid) => sum + (byVersion.get(vid) ?? 0), 0));
    }
  }

  for (const resourceId of resourceIds) {
    const installed = licenseCounts.get(resourceId) ?? 0;
    const failed = failedRunsByResource.get(resourceId) ?? 0;
    const live = purchasesByResource.get(resourceId) ?? 0;
    const refunded = refundsByResource.get(resourceId) ?? 0;
    const cadence = cadenceByResource.get(resourceId) ?? 0;
    const compatStatus = latestVersionByResource.has(resourceId)
      ? reportByVersion.get(latestVersionByResource.get(resourceId)!.id) ?? null
      : null;
    const compatValue = compatStatus ? COMPAT_VALUE[compatStatus] ?? null : null;

    const factors: TrustFactor[] = [
      installed + failed > 0
        ? factor("installation", installed / (installed + failed), RESOURCE_TRUST_WEIGHTS.installation)
        : factor("installation", null, RESOURCE_TRUST_WEIGHTS.installation, "no installation data yet"),
      live > 0
        ? factor("refunds", Math.max(0, 1 - refunded / live), RESOURCE_TRUST_WEIGHTS.refunds)
        : factor("refunds", null, RESOURCE_TRUST_WEIGHTS.refunds, "no purchases yet"),
      factor(
        "compatibility",
        compatValue,
        RESOURCE_TRUST_WEIGHTS.compatibility,
        compatStatus ? `latest report: ${compatStatus}` : "no compatibility report"
      ),
      factor(
        "cadence",
        Math.min(1, cadence / CADENCE_TARGET_PER_90D),
        RESOURCE_TRUST_WEIGHTS.cadence,
        `${cadence} release(s) in the last ${CADENCE_WINDOW_DAYS} days`
      ),
    ];
    result.set(resourceId, scoreOf(factors));
  }
  return result;
}

// ---------------------------------------------------------------------------
// C-004: seller health (explainable, honest nulls)
// ---------------------------------------------------------------------------

/**
 * Seller formula (C-004; constants above):
 *   installation  = licenses / (licenses + failed_sandbox_runs) across the seller's resources [null without evidence]
 *   refunds       = 1 - refunded/live_purchases across the seller's resources [null without purchases]
 *   cadence       = min(1, versions_90d / (SELLER_CADENCE_TARGET_PER_RESOURCE × resources))
 *   compatibility = share of resources whose latest version report is VERIFIED (PARTIAL = 0.5) [null without reports]
 *   support       = null when the seller has no dispute data (honest null —
 *                   absence of evidence is not evidence of quality)
 *   score         = Σ round(value × weight); a null factor contributes 0, so
 *                   an unproven seller's ceiling is visibly below 100.
 */
export async function sellerHealth(sellerId: string): Promise<HealthScore> {
  const resourceRows = await db.orm.public.Resource
    .where({ sellerId })
    .select("id")
    .limit(100)
    .all();
  const resourceIds = resourceRows.map((r: any) => r.id as string);

  if (resourceIds.length === 0) {
    return scoreOf([
      factor("installation", null, SELLER_TRUST_WEIGHTS.installation, "no resources yet"),
      factor("refunds", null, SELLER_TRUST_WEIGHTS.refunds, "no resources yet"),
      factor("cadence", 0, SELLER_TRUST_WEIGHTS.cadence, "no resources yet"),
      factor("compatibility", null, SELLER_TRUST_WEIGHTS.compatibility, "no resources yet"),
      factor("support", null, SELLER_TRUST_WEIGHTS.support, "no dispute data"),
    ]);
  }

  const versionRows = await db.orm.public.ResourceVersion
    .where((v: any) => v.resourceId.in(resourceIds))
    .select("id", "resourceId", "publishedAt")
    .limit(1000)
    .all();
  const versionIds = versionRows.map((v: any) => v.id as string);

  const [licenseCount, failedRuns, purchaseRows, refundRows, cadenceRows] = await Promise.all([
    countIn(db.orm.public.License, "versionId", versionIds),
    countIn(db.orm.public.SandboxRun, "versionId", versionIds, (q: any) =>
      q.where((r: any) => r.status.in([...FAILED_SANDBOX_STATUSES]))
    ),
    db.orm.public.Purchase
      .where((p: any) => p.resourceId.in(resourceIds))
      .where((p: any) => p.status.in(["COMPLETED", "REFUNDED"]))
      .aggregate((a: any) => ({ total: a.count() })),
    db.orm.public.Purchase
      .where((p: any) => p.resourceId.in(resourceIds))
      .where({ status: "REFUNDED" })
      .aggregate((a: any) => ({ total: a.count() })),
    db.orm.public.ResourceVersion
      .where((v: any) => v.resourceId.in(resourceIds))
      .where((v: any) => v.publishedAt.gte(isoDaysAgo(CADENCE_WINDOW_DAYS)))
      .aggregate((a: any) => ({ total: a.count() })),
  ]);
  const live = Number((purchaseRows as any).total ?? 0);
  const refunded = Number((refundRows as any).total ?? 0);
  const cadence90d = Number((cadenceRows as any).total ?? 0);

  // Compatibility: latest version per resource → latest report per version.
  const latestVersionByResource = new Map<string, { id: string; publishedAt: string }>();
  for (const v of versionRows) {
    const prev = latestVersionByResource.get(v.resourceId as string);
    if (!prev || new Date(v.publishedAt as string) > new Date(prev.publishedAt)) {
      latestVersionByResource.set(v.resourceId as string, {
        id: v.id as string,
        publishedAt: v.publishedAt as string,
      });
    }
  }
  const latestVersionIds = [...latestVersionByResource.values()].map((v) => v.id);
  const reports = latestVersionIds.length
    ? await db.orm.public.CompatibilityReport
        .where((r: any) => r.versionId.in(latestVersionIds))
        .orderBy((r: any) => r.createdAt.desc())
        .select("versionId", "status")
        .limit(latestVersionIds.length * 5)
        .all()
    : [];
  const reportByVersion = new Map<string, string>();
  for (const r of reports as any[]) {
    if (!reportByVersion.has(r.versionId)) reportByVersion.set(r.versionId, r.status);
  }
  let compatScored = 0;
  let compatSum = 0;
  for (const vid of latestVersionIds) {
    const status = reportByVersion.get(vid);
    if (!status) continue;
    compatScored += 1;
    compatSum += COMPAT_VALUE[status] ?? 0;
  }

  // Support responsiveness: average seller/admin first-response time on the
  // seller's purchase disputes, in hours. Bounded to the 50 latest disputes.
  let supportHours: number | null = null;
  const purchaseIdRows = await db.orm.public.Purchase
    .where((p: any) => p.resourceId.in(resourceIds))
    .select("id")
    .limit(500)
    .all();
  const purchaseIds = purchaseIdRows.map((p: any) => p.id as string);
  if (purchaseIds.length > 0) {
    const disputes = await db.orm.public.Dispute
      .where((d: any) => d.purchaseId.in(purchaseIds))
      .orderBy((d: any) => d.createdAt.desc())
      .select("id", "createdAt")
      .limit(50)
      .all();
    if (disputes.length > 0) {
      const disputeIds = disputes.map((d: any) => d.id as string);
      const messages = await db.orm.public.DisputeMessage
        .where((m: any) => m.disputeId.in(disputeIds))
        .where((m: any) => m.senderRole.in(["SELLER", "ADMIN"]))
        .orderBy((m: any) => m.createdAt.asc())
        .select("disputeId", "createdAt")
        .limit(500)
        .all();
      const firstResponse = new Map<string, string>();
      for (const m of messages as any[]) {
        if (!firstResponse.has(m.disputeId)) firstResponse.set(m.disputeId, m.createdAt);
      }
      const hours: number[] = [];
      for (const d of disputes as any[]) {
        const first = firstResponse.get(d.id as string);
        if (!first) continue;
        const delta = (new Date(first).getTime() - new Date(d.createdAt as string).getTime()) / 3_600_000;
        if (delta >= 0) hours.push(delta);
      }
      if (hours.length > 0) {
        supportHours = hours.reduce((a, b) => a + b, 0) / hours.length;
      }
    }
  }
  // Responsive within 24h = full score; every extra day costs 1/3.
  const supportValue =
    supportHours === null ? null : Math.max(0, Math.min(1, 1 - supportHours / 72));

  const cadenceTarget = Math.max(
    1,
    SELLER_CADENCE_TARGET_PER_RESOURCE * Math.min(resourceIds.length, 10)
  );

  const factors: TrustFactor[] = [
    licenseCount + failedRuns > 0
      ? factor("installation", licenseCount / (licenseCount + failedRuns), SELLER_TRUST_WEIGHTS.installation)
      : factor("installation", null, SELLER_TRUST_WEIGHTS.installation, "no installation data yet"),
    live > 0
      ? factor("refunds", Math.max(0, 1 - refunded / live), SELLER_TRUST_WEIGHTS.refunds)
      : factor("refunds", null, SELLER_TRUST_WEIGHTS.refunds, "no purchases yet"),
    factor("cadence", Math.min(1, cadence90d / cadenceTarget), SELLER_TRUST_WEIGHTS.cadence,
      `${cadence90d} release(s) in the last ${CADENCE_WINDOW_DAYS} days`),
    compatScored > 0
      ? factor("compatibility", compatSum / compatScored, SELLER_TRUST_WEIGHTS.compatibility)
      : factor("compatibility", null, SELLER_TRUST_WEIGHTS.compatibility, "no compatibility reports"),
    supportValue === null
      ? factor("support", null, SELLER_TRUST_WEIGHTS.support, "no dispute data")
      : factor("support", supportValue, SELLER_TRUST_WEIGHTS.support,
          `avg first response ${Math.round(supportHours! * 10) / 10}h`),
  ];
  return scoreOf(factors);
}
