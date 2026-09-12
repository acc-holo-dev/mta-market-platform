// PLAN-017 G §46–§49: advertising domain logic.
// Placement serving (bounded, review-gated), event metric upserts and the
// expiry sweep. Campaign lifecycle state machine + admin API live in
// routes/adminAdvertising.ts; this module is the shared data layer.
//
// ORM notes (contract ORM, prisma-next): chained .where() calls AND together;
// .where(fn) lambdas are single expressions on this codebase's typed surface
// (no OR combinator is used anywhere in src/), so the time-window filter of
// servePlacements is applied in JS over a bounded, ordered candidate query.
// Candidates are admin-curated campaigns per placement (dozens at platform
// scale), the query is ordered and hard-capped, so this stays honest and
// cheap while exactly honoring the (startsAt, endsAt) window semantics.
import { db } from "../prisma/db.js";
import { logger } from "./logger.js";
import { isUniqueViolation } from "./dbErrors.js";
import { affectedCount } from "./ledger.js";

export type AdKind = "impression" | "click";

// §46 enums (contract.prisma AdPlacement / AdCampaignStatus / AdReviewStatus).
export const AD_PLACEMENTS = [
  "HOME_HERO",
  "HOME_RAIL_SECONDARY",
  "MARKET_FEATURED",
  "SERVER_FEATURED",
  "COMMUNITY_FEATURED",
] as const;
export type AdPlacement = (typeof AD_PLACEMENTS)[number];

export const AD_CAMPAIGN_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "PAUSED",
  "EXPIRED",
  "CANCELLED",
] as const;
export type AdCampaignStatus = (typeof AD_CAMPAIGN_STATUSES)[number];

export const AD_REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type AdReviewStatus = (typeof AD_REVIEW_STATUSES)[number];

export interface PublicAdItem {
  id: string;
  title: string;
  body: string;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
}

export interface AdAnalyticsDay {
  date: string;
  impressions: number;
  clicks: number;
}

export interface AdAnalytics {
  totals: { impressions: number; clicks: number; ctr: number };
  byDay: AdAnalyticsDay[];
}

/** UTC date key (YYYY-MM-DD) for the daily metric bucket. */
export function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Expiry sweep (§46): campaigns whose endsAt has passed stop being ACTIVE.
// CAS bounded update, safe to run per request at most once per 30s.
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL_MS = 30_000;
let lastSweepAt = 0;

/** Test hook: clears the module-level sweep guard so a test can force a run. */
export function resetExpirySweepGuardForTests(): void {
  lastSweepAt = 0;
}

/**
 * Marks campaigns EXPIRED when status IN (ACTIVE, SCHEDULED) and
 * endsAt <= now. Never throws — a failed sweep must not take serving down.
 * Returns the number of campaigns transitioned (0 when the guard skipped).
 */
export async function runExpirySweep(now: Date = new Date()): Promise<number> {
  const nowMs = now.getTime();
  if (nowMs - lastSweepAt < SWEEP_INTERVAL_MS) return 0;
  lastSweepAt = nowMs;
  try {
    const cas = await db.orm.public.AdCampaign
      .where((c: any) => c.status.in(["ACTIVE", "SCHEDULED"]))
      .where((c: any) => c.endsAt.lte(now.toISOString()))
      .updateAndCount({ status: "EXPIRED" } as any);
    const count = affectedCount(cas);
    if (count > 0) logger.info("ad_campaign_expiry_sweep", { expired: count });
    return count;
  } catch (error) {
    logger.error("ad_campaign_expiry_sweep_failed", { error });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Serving (§46): ACTIVE + APPROVED, inside its window, priority DESC first.
// ---------------------------------------------------------------------------

/**
 * Active campaigns for a placement, ordered priority DESC then createdAt ASC,
 * at most 5. Only public fields are projected — callers (routes/advertising.ts)
 * receive objects safe to expose.
 */
export async function servePlacements(placement: string, now: Date = new Date()): Promise<PublicAdItem[]> {
  await runExpirySweep(now);
  // Ordered + hard-capped candidate fetch: the curated set per placement is
  // small; the SQL ordering carries (priority DESC, createdAt ASC) so the JS
  // window filter below preserves the serving order.
  const candidates = (await db.orm.public.AdCampaign
    .where({ placement, status: "ACTIVE", reviewStatus: "APPROVED" } as any)
    .orderBy([(c: any) => c.priority.desc(), (c: any) => c.createdAt.asc()])
    .limit(200)
    .all()) as any[];
  const nowMs = now.getTime();
  const eligible = candidates.filter((c) => {
    const startsOk = !c.startsAt || new Date(c.startsAt).getTime() <= nowMs;
    const endsOk = !c.endsAt || new Date(c.endsAt).getTime() > nowMs;
    return startsOk && endsOk;
  });
  return eligible.slice(0, 5).map((c) => ({
    id: c.id as string,
    title: c.title as string,
    body: c.body as string,
    imageUrl: (c.imageUrl as string | null) ?? null,
    ctaLabel: (c.ctaLabel as string | null) ?? null,
    ctaUrl: (c.ctaUrl as string | null) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// Events (§48): daily aggregated counters, concurrent-safe upsert.
// ---------------------------------------------------------------------------

/**
 * Upsert today's AdMetric row for the campaign (date = UTC YYYY-MM-DD).
 * Bounded CAS loop: read current value -> conditional update (old value in
 * the WHERE); a lost race re-reads. When no row exists the create is
 * attempted; the UNIQUE(campaignId, date) constraint is the backstop — a
 * unique violation (a concurrent first event won the row) falls back to the
 * read-CAS-update path. A persistent race gives up with a warning instead of
 * failing the public fire-and-forget event: counters stay approximate under
 * sustained contention, never double-counted.
 */
export async function recordEvent(campaignId: string, kind: AdKind, now: Date = new Date()): Promise<void> {
  const date = utcDayKey(now);
  const field = kind === "impression" ? "impressions" : "clicks";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = (await db.orm.public.AdMetric.where({ campaignId, date } as any).first()) as any;
    if (row) {
      const current = Number(row[field] ?? 0);
      const cas = await db.orm.public.AdMetric
        .where({ campaignId, date, [field]: current } as any)
        .updateAndCount({ [field]: current + 1 } as any);
      if (affectedCount(cas) === 1) return;
      continue; // lost the race — re-read and retry
    }
    try {
      await db.orm.public.AdMetric.create({
        campaignId,
        date,
        impressions: kind === "impression" ? 1 : 0,
        clicks: kind === "click" ? 1 : 0,
      });
      return;
    } catch (error) {
      if (isUniqueViolation(error)) continue; // concurrent first event won — retry as update
      throw error;
    }
  }
  logger.warn("ad_metric_upsert_contended", { campaign_id: campaignId, date, kind });
}

// ---------------------------------------------------------------------------
// Analytics (§49): bounded daily series + totals + CTR.
// ---------------------------------------------------------------------------

/** Round to 4 decimals (ctr 0.1234), 0 when there are no impressions. */
function ctr4(clicks: number, impressions: number): number {
  if (impressions <= 0) return 0;
  return Math.round((clicks / impressions) * 10_000) / 10_000;
}

/** Daily series (date DESC), bounded to the last `days` UTC days (max 30). */
export async function getAnalytics(campaignId: string, days = 30): Promise<AdAnalytics> {
  const bounded = Math.min(Math.max(Math.trunc(Number(days)) || 30, 1), 30);
  const cutoff = utcDayKey(new Date(Date.now() - (bounded - 1) * 24 * 60 * 60 * 1000));
  const rows = (await db.orm.public.AdMetric
    .where({ campaignId } as any)
    .where((m: any) => m.date.gte(cutoff))
    .orderBy((m: any) => m.date.desc())
    .all()) as any[];
  const byDay: AdAnalyticsDay[] = rows.map((r) => ({
    date: r.date as string,
    impressions: Number(r.impressions ?? 0),
    clicks: Number(r.clicks ?? 0),
  }));
  const impressions = byDay.reduce((sum, d) => sum + d.impressions, 0);
  const clicks = byDay.reduce((sum, d) => sum + d.clicks, 0);
  return {
    totals: { impressions, clicks, ctr: ctr4(clicks, impressions) },
    byDay,
  };
}

/**
 * §47: per-campaign metric totals for a whole page of campaigns in ONE
 * grouped query (no N+1). Missing rows mean zero traffic.
 */
export async function metricTotalsByCampaign(
  campaignIds: string[]
): Promise<Map<string, { impressions: number; clicks: number }>> {
  const map = new Map<string, { impressions: number; clicks: number }>();
  if (campaignIds.length === 0) return map;
  // Runtime groupBy returns [{ <groupKeys>, ...aggregates }]; the static ORM
  // typing models groupBy rows as full table rows, so the chain is loosened
  // here (same approach as routes/admin.ts, verified against a live DB).
  const rows = (await (db.orm.public.AdMetric as any)
    .where((m: any) => m.campaignId.in(campaignIds))
    .groupBy(["campaignId"])
    .aggregate((a: any) => ({ impressions: a.sum("impressions"), clicks: a.sum("clicks") }))) as Array<
    Record<string, unknown>
  >;
  for (const row of rows) {
    map.set(String(row.campaignId), {
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// SystemLog helper (§44). Shared by the advertising + premium routers
// (PLAN-017 G/H) until the platform logging wave extracts a shared module.
// ---------------------------------------------------------------------------

export interface SystemLogInput {
  level?: "DEBUG" | "INFO" | "WARN" | "ERROR";
  message: string;
  route?: string | null;
  requestId?: string | null;
  errorCode?: string | null;
  meta?: Record<string, unknown> | null;
}

/** Append a SystemLog row; failures never break the caller's flow. */
export async function logSystemEvent(input: SystemLogInput): Promise<void> {
  try {
    await db.orm.public.SystemLog.create({
      level: input.level ?? "INFO",
      service: "api",
      requestId: input.requestId ?? null,
      route: input.route ?? null,
      errorCode: input.errorCode ?? null,
      message: input.message,
      meta: (input.meta ?? null) as any,
    });
  } catch (error) {
    logger.error("system_log_write_failed", { message: input.message, error });
  }
}