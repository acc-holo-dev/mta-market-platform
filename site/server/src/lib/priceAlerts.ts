// PLAN-018 I-003: price-alert delivery engine (Wave-6 G+I wave).
//
// Owns the three PriceAlert sweeps (PRICE_DROP / DISCOUNT_STARTED /
// VERSION_RELEASED) so the CRON worker (POST /alerts/dispatch) and the
// version-publish path share one implementation. Delivery is synchronous
// with recipient dedup via createNotifications; every sweep is idempotent
// thanks to notification dedup keys (entityType/entityId pairs below).
//
// Notification type vocabulary: there is no PriceAlert-specific
// NotificationType, so all three events reuse the existing "RESOURCE_UPDATE"
// type (M-002 vocabulary) and distinguish themselves by title + the
// entityType/entityId dedup keys ("priceAlert", "discountCampaign",
// "resourceVersion").
//
// ---------------------------------------------------------------------------
// VERSION_RELEASED integration point (do NOT wire here — integration pass):
//   routes/versions.ts POST /:slug/versions only stages artifacts (the
//   resource re-enters moderation). The actual release happens in
//   routes/admin.ts PATCH /admin/resources/:id/status where each version's
//   releaseStatus flips to "PUBLISHED" (the PLAN-008 delivery block).
//   One line there, right after the releaseStatus update succeeds:
//     await notifyVersionReleases(resource.id, { id: version.id, version: version.version, changelog: version.changelog });
//   (the buyer/follower delivery that already lives there is untouched).
// ---------------------------------------------------------------------------
import { db } from "../prisma/db.js";
import { createNotifications } from "./notify.js";
import { logger } from "./logger.js";

export const PRICE_ALERT_EVENTS = ["PRICE_DROP", "DISCOUNT_STARTED", "VERSION_RELEASED"] as const;
export type PriceAlertEvent = (typeof PRICE_ALERT_EVENTS)[number];

/** How far back CRON sweeps look for discount starts / released versions. */
export const ALERT_SWEEP_WINDOW_MS = 24 * 3600_000;

/** Sweep bounds: a dispatch pass never fans out over unbounded sets. */
const MAX_ALERTS_PER_SWEEP = 300;
const MAX_CAMPAIGNS_PER_SWEEP = 100;
const MAX_RESOURCES_PER_CAMPAIGN = 50;
const MAX_VERSIONS_PER_SWEEP = 200;
const MAX_RECIPIENTS_PER_RELEASE = 500;

/** Parses/validates a client-supplied events array into a unique subset. */
export function parseAlertEvents(raw: unknown): PriceAlertEvent[] {
  if (!Array.isArray(raw)) return [];
  const set = new Set<string>();
  for (const item of raw) {
    if (typeof item === "string" && (PRICE_ALERT_EVENTS as readonly string[]).includes(item)) {
      set.add(item);
    }
  }
  // Canonical (schema enum) order so the stored string is stable.
  return PRICE_ALERT_EVENTS.filter((e) => set.has(e));
}

/** Comma-joined events string as stored in PriceAlert.events. */
export function serializeAlertEvents(events: PriceAlertEvent[]): string {
  return PRICE_ALERT_EVENTS.filter((e) => events.includes(e)).join(",");
}

/** Parses the stored comma-separated subset back into typed events. */
export function parseStoredAlertEvents(raw: unknown): PriceAlertEvent[] {
  return typeof raw === "string" ? parseAlertEvents(raw.split(",")) : [];
}

async function resourceMap(ids: string[]): Promise<Map<string, any>> {
  const unique = Array.from(new Set(ids)).filter(Boolean);
  if (!unique.length) return new Map();
  const rows = await db.orm.public.Resource
    .where((r: any) => r.id.in(unique))
    .select("id", "slug", "title", "price", "status", "sellerId", "updatedAt")
    .all();
  return new Map(rows.map((r: any) => [r.id as string, r]));
}

/**
 * PRICE_DROP sweep: for every active alert subscribed to PRICE_DROP with a
 * targetPriceMinor, notify when the resource's current price is below the
 * target AND the price row changed after the alert was created
 * (resource.updatedAt > alert.createdAt — "dropped since alert.createdAt";
 * there is no price history, so the row's updatedAt is the honest proxy).
 *
 * Sweep idempotency: one notification per (alert, targetPriceMinor) pair —
 * the dedup key embeds the target so raising the target re-arms the alert.
 */
export async function notifyPriceDrops(): Promise<number> {
  const alerts = (await db.orm.public.PriceAlert
    .where({ active: true })
    .limit(MAX_ALERTS_PER_SWEEP)
    .all()) as any[];
  const candidates = alerts.filter((a) => {
    return parseStoredAlertEvents(a.events).includes("PRICE_DROP") && Number.isInteger(a.targetPriceMinor);
  });
  if (!candidates.length) return 0;

  const resources = await resourceMap(candidates.map((a) => a.resourceId as string));
  let created = 0;
  for (const alert of candidates) {
    const resource = resources.get(alert.resourceId as string);
    if (!resource || resource.status !== "PUBLISHED") continue;
    const price = Number(resource.price ?? 0);
    const target = Number(alert.targetPriceMinor);
    if (!(price < target)) continue;
    const changedAt = resource.updatedAt ? new Date(resource.updatedAt) : null;
    const since = alert.createdAt ? new Date(alert.createdAt) : null;
    if (changedAt && since && changedAt.getTime() <= since.getTime()) continue;

    const entityId = `${alert.id}:${target}`;
    const seen = await db.orm.public.Notification
      .where({
        recipientId: alert.userId as string,
        entityType: "priceAlert",
        entityId,
      })
      .select("id")
      .first();
    if (seen) continue;
    created += await createNotifications([
      {
        recipientId: alert.userId as string,
        type: "RESOURCE_UPDATE",
        title: `${resource.title}: цена снизилась`,
        body: `Текущая цена ${(price / 100).toFixed(2)} — ниже вашей целевой цены ${(target / 100).toFixed(2)}.`,
        entityType: "priceAlert",
        entityId,
      },
    ]);
  }
  return created;
}

/**
 * DISCOUNT_STARTED sweep: campaigns that went live in the last 24h
 * (isActive, startsAt within [now-24h, now]) whose target resources carry
 * active alerts subscribed to DISCOUNT_STARTED.
 * Scope RESOURCE targets scopeId directly; scope ALL covers the seller's
 * published resources; scope SERVICE is not alertable.
 */
export async function notifyDiscountStarts(): Promise<number> {
  const now = Date.now();
  const windowStart = now - ALERT_SWEEP_WINDOW_MS;
  const campaigns = (await db.orm.public.DiscountCampaign
    .where({ isActive: true })
    .orderBy((c: any) => c.startsAt.desc())
    .limit(MAX_CAMPAIGNS_PER_SWEEP)
    .all()) as any[];

  const live = campaigns.filter((c) => {
    if (!c.startsAt) return false;
    const t = new Date(c.startsAt).getTime();
    return Number.isFinite(t) && t <= now && t >= windowStart;
  });
  if (!live.length) return 0;

  // Resolve every campaign's targeted published resources.
  const resourceIdsByCampaign: Array<{ campaign: any; resourceIds: string[] }> = [];
  for (const campaign of live) {
    if (campaign.scope === "RESOURCE") {
      if (!campaign.scopeId) continue;
      const resource = await db.orm.public.Resource
        .where({ id: campaign.scopeId as string })
        .select("id", "status")
        .first();
      if (resource && resource.status === "PUBLISHED") {
        resourceIdsByCampaign.push({ campaign, resourceIds: [resource.id as string] });
      }
    } else if (campaign.scope === "ALL") {
      // The seller's published resources are all targeted.
      const sellers = (await db.orm.public.Resource
        .where({ sellerId: campaign.sellerId as string, status: "PUBLISHED" })
        .select("id")
        .limit(MAX_RESOURCES_PER_CAMPAIGN)
        .all()) as any[];
      if (sellers.length) {
        resourceIdsByCampaign.push({ campaign, resourceIds: sellers.map((r) => r.id as string) });
      }
    }
    // scope SERVICE: services are not alertable — skipped.
  }

  // Active alerts on all targeted resources, grouped by resource.
  const allResourceIds = Array.from(new Set(resourceIdsByCampaign.flatMap((c) => c.resourceIds)));
  const alerts = allResourceIds.length
    ? ((await db.orm.public.PriceAlert
        .where((a: any) => a.resourceId.in(allResourceIds))
        .limit(MAX_ALERTS_PER_SWEEP)
        .all()) as any[])
    : [];
  const alertsByResource = new Map<string, any[]>();
  for (const alert of alerts) {
    if (!alert.active) continue;
    if (!parseStoredAlertEvents(alert.events).includes("DISCOUNT_STARTED")) continue;
    const list = alertsByResource.get(alert.resourceId as string) ?? [];
    list.push(alert);
    alertsByResource.set(alert.resourceId as string, list);
  }
  if (!alertsByResource.size) return 0;

  const resources = await resourceMap(allResourceIds);
  let created = 0;
  for (const { campaign, resourceIds } of resourceIdsByCampaign) {
    for (const resourceId of resourceIds) {
      for (const alert of alertsByResource.get(resourceId) ?? []) {
        // One notification per user per campaign (sweep idempotency).
        const seen = await db.orm.public.Notification
          .where({
            recipientId: alert.userId as string,
            entityType: "discountCampaign",
            entityId: campaign.id as string,
          })
          .select("id")
          .first();
        if (seen) continue;
        const resource = resources.get(resourceId);
        if (!resource) continue;
        const discount =
          campaign.type === "PERCENT"
            ? `−${campaign.value}%`
            : `−${(Number(campaign.value) / 100).toFixed(2)}`;
        created += await createNotifications([
          {
            recipientId: alert.userId as string,
            type: "RESOURCE_UPDATE",
            title: `${resource.title}: началась скидка «${campaign.name}»`,
            body: `Скидка ${discount} уже действует — успейте забрать.`,
            entityType: "discountCampaign",
            entityId: campaign.id as string,
          },
        ]);
      }
    }
  }
  return created;
}

interface ReleasedVersion {
  id: string;
  version: string;
  changelog?: string | null;
}

/**
 * VERSION_RELEASED delivery for ONE version — the hook the publish path
 * calls (see the integration note in the header comment). Recipients are
 * the active alerts on the resource subscribed to VERSION_RELEASED, deduped
 * per user and per version (so the CRON sweep and the inline hook never
 * double-notify).
 */
export async function notifyVersionReleases(resourceId: string, version: ReleasedVersion): Promise<number> {
  const resource = await db.orm.public.Resource
    .where({ id: resourceId })
    .select("id", "slug", "title", "status")
    .first();
  if (!resource || resource.status !== "PUBLISHED") return 0;
  const alerts = (await db.orm.public.PriceAlert
    .where({ resourceId, active: true })
    .limit(MAX_RECIPIENTS_PER_RELEASE)
    .all()) as any[];
  const watchers = alerts
    .filter((a) => parseStoredAlertEvents(a.events).includes("VERSION_RELEASED"))
    .map((a) => a.userId as string);
  return deliverVersionRelease(resource, version, watchers);
}

/**
 * CRON counterpart of notifyVersionReleases: versions released in the last
 * 24h for resources that carry subscribed alerts.
 */
export async function sweepRecentVersionReleases(): Promise<number> {
  const since = Date.now() - ALERT_SWEEP_WINDOW_MS;
  const versions = (await db.orm.public.ResourceVersion
    .where({ releaseStatus: "PUBLISHED" })
    .orderBy((v: any) => v.publishedAt.desc())
    .limit(MAX_VERSIONS_PER_SWEEP)
    .all()) as any[];
  const recent = versions.filter(
    (v) => v.publishedAt && new Date(v.publishedAt).getTime() >= since
  );
  if (!recent.length) return 0;

  const resources = await resourceMap(recent.map((v) => v.resourceId as string));
  const publishedResourceIds = Array.from(
    new Set(
      recent
        .map((v) => v.resourceId as string)
        .filter((id) => resources.get(id)?.status === "PUBLISHED")
    )
  );
  if (!publishedResourceIds.length) return 0;

  const alerts = ((await db.orm.public.PriceAlert
    .where((a: any) => a.resourceId.in(publishedResourceIds))
    .limit(MAX_ALERTS_PER_SWEEP)
    .all()) as any[]);
  const watchersByResource = new Map<string, string[]>();
  for (const alert of alerts) {
    if (!alert.active) continue;
    if (!parseStoredAlertEvents(alert.events).includes("VERSION_RELEASED")) continue;
    const list = watchersByResource.get(alert.resourceId as string) ?? [];
    list.push(alert.userId as string);
    watchersByResource.set(alert.resourceId as string, list);
  }

  let created = 0;
  for (const version of recent) {
    const resource = resources.get(version.resourceId as string);
    if (!resource) continue;
    created += await deliverVersionRelease(
      resource,
      version as ReleasedVersion,
      watchersByResource.get(version.resourceId as string) ?? []
    );
  }
  return created;
}

/** Shared delivery: dedup by (recipient, version) and create notifications. */
async function deliverVersionRelease(
  resource: any,
  version: ReleasedVersion,
  watcherIds: string[]
): Promise<number> {
  const unique = Array.from(new Set(watcherIds)).filter(Boolean);
  if (!unique.length) return 0;
  // Sweep idempotency: users already notified for this version are skipped.
  const notifiedRows = (await db.orm.public.Notification
    .where({ entityType: "resourceVersion", entityId: version.id })
    .select("recipientId")
    .limit(MAX_RECIPIENTS_PER_RELEASE)
    .all()) as any[];
  const notified = new Set(notifiedRows.map((n) => n.recipientId as string));
  const pending = unique.filter((id) => !notified.has(id));
  if (!pending.length) return 0;
  try {
    return await createNotifications(
      pending.map((recipientId) => ({
        recipientId,
        type: "RESOURCE_UPDATE" as const,
        title: `${resource.title} — новая версия ${version.version}`,
        body: version.changelog ? version.changelog.slice(0, 200) : undefined,
        entityType: "resourceVersion",
        entityId: version.id,
      }))
    );
  } catch (error) {
    logger.warn("price_alert_version_release_failed", { resource_id: resource.id, error });
    return 0;
  }
}