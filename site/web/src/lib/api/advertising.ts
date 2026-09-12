// PLAN-017 G/H §46–§51: admin advertising + premium API client
// (lib/api/advertising.ts — sibling of lib/api/admin.ts, same façade style:
// typed functions over the shared axios `api` from lib/api.ts).
//
// Field-shape note: the task contract promises { campaigns, total, page, limit
// } / { entitlements, ... }, while the backend serializes list endpoints as
// { data, pagination: { page, limit, total, pages } }. Both spellings are
// accepted here (normalizeListPage) so the client keeps working across
// backend revisions — same defensive posture as features/admin/shared/fields.
//
// Feature-flag surfaces answer 404 { error: "Not found" } when the flag is
// off; isFeatureDisabledError() lets the admin sections render an honest
// "module disabled" state instead of a crash.
import api from "../api";

// getErrorMessage/formatRub stay re-exported from api-ext (single source of
// truth) so feature modules can import everything from "@/lib/api/advertising".
export { getErrorMessage } from "../api-ext";

// =====================================================================
// Shared helpers
// =====================================================================

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

interface NormalizedPage<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
}

/** Accept both { campaigns|entitlements, total, page, limit } and { data, pagination }. */
function normalizeListPage<T>(raw: unknown, listKeys: string[]): NormalizedPage<T> {
  const obj = asObject(raw);
  const pagination = asObject(obj.pagination);

  let rowsRaw: unknown[] = [];
  for (const key of listKeys) {
    const candidate = obj[key];
    if (Array.isArray(candidate)) {
      rowsRaw = candidate;
      break;
    }
  }

  return {
    rows: rowsRaw as T[],
    total: toCount(obj.total) ?? toCount(pagination.total) ?? rowsRaw.length,
    page: toCount(obj.page) ?? toCount(pagination.page) ?? 1,
    limit: toCount(obj.limit) ?? toCount(pagination.limit) ?? 20,
  };
}

/** 404 { error: "Not found" } = the feature flag is off (honest disabled state). */
export function isFeatureDisabledError(error: unknown): boolean {
  const e = error as { response?: { status?: number; data?: unknown } } | undefined;
  const data = asObject(e?.response?.data);
  return e?.response?.status === 404 && data.error === "Not found";
}

// =====================================================================
// 1. GET /admin/advertising/campaigns — paginated control-center list
// =====================================================================

export interface AdminAdAdvertiser {
  id?: string;
  username?: string | null;
  displayName?: string | null;
  [key: string]: unknown;
}

export interface AdminAdMetrics {
  impressions?: number | null;
  clicks?: number | null;
}

/** Row shape is defensive: every content field may be null/absent. */
export interface AdminAdCampaign {
  id: string;
  name?: string | null;
  placement?: string | null;
  title?: string | null;
  body?: string | null;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  priority?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  status?: string | null;
  reviewStatus?: string | null;
  reviewNote?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  advertiserId?: string | null;
  advertiser?: AdminAdAdvertiser | null;
  metrics?: AdminAdMetrics | null;
  [key: string]: unknown;
}

export interface AdminCampaignsPage {
  campaigns: AdminAdCampaign[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminCampaignsQuery {
  status?: string;
  placement?: string;
  reviewStatus?: string;
  page?: number;
  limit?: number;
}

export async function fetchAdminCampaigns(
  query: AdminCampaignsQuery = {}
): Promise<AdminCampaignsPage> {
  const { data } = await api.get<unknown>("/admin/advertising/campaigns", {
    params: {
      ...(query.status ? { status: query.status } : {}),
      ...(query.placement ? { placement: query.placement } : {}),
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.page ? { page: query.page } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    },
  });
  const normalized = normalizeListPage<AdminAdCampaign>(data, ["campaigns", "data"]);
  return {
    campaigns: normalized.rows,
    total: normalized.total,
    page: normalized.page,
    limit: normalized.limit,
  };
}

// =====================================================================
// 2-3. POST /admin/advertising/campaigns, PATCH /admin/advertising/campaigns/:id
// =====================================================================

export interface AdminCampaignInput {
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
}

/** POST /campaigns → 201 campaign (DRAFT + review PENDING server-side). */
export async function createAdminCampaign(input: AdminCampaignInput): Promise<AdminAdCampaign> {
  const { data } = await api.post<unknown>("/admin/advertising/campaigns", input);
  return asObject(data) as AdminAdCampaign;
}

/**
 * PATCH /campaigns/:id — content edits only while DRAFT/PAUSED or review
 * REJECTED (409 otherwise; editing a rejected campaign re-opens review).
 * advertiserId is NOT editable server-side → stripped here.
 */
export async function updateAdminCampaign(
  id: string,
  input: Omit<AdminCampaignInput, "advertiserId">
): Promise<AdminAdCampaign> {
  const { data } = await api.patch<unknown>(
    `/admin/advertising/campaigns/${encodeURIComponent(id)}`,
    input
  );
  return asObject(data) as AdminAdCampaign;
}

// =====================================================================
// 4. POST /admin/advertising/campaigns/:id/transition
// =====================================================================

export type AdminCampaignTransitionAction =
  | "approve"
  | "reject"
  | "activate"
  | "pause"
  | "resume"
  | "cancel";

/** reject requires reason (400 without); state-guard violations → 409. */
export async function transitionAdminCampaign(
  id: string,
  action: AdminCampaignTransitionAction,
  reason?: string
): Promise<AdminAdCampaign> {
  const { data } = await api.post<unknown>(
    `/admin/advertising/campaigns/${encodeURIComponent(id)}/transition`,
    { action, ...(reason ? { reason } : {}) }
  );
  return asObject(data) as AdminAdCampaign;
}

// =====================================================================
// 5. DELETE /admin/advertising/campaigns/:id (only DRAFT/REJECTED)
// =====================================================================

export async function deleteAdminCampaign(id: string): Promise<unknown> {
  const { data } = await api.delete(`/admin/advertising/campaigns/${encodeURIComponent(id)}`);
  return data;
}

// =====================================================================
// 6. GET /admin/advertising/campaigns/:id/analytics?days= (1..30)
// =====================================================================

export interface AdminCampaignAnalyticsDay {
  date: string;
  impressions: number;
  clicks: number;
}

export interface AdminCampaignAnalytics {
  campaignId?: string;
  totals: { impressions: number; clicks: number; ctr: number };
  byDay: AdminCampaignAnalyticsDay[];
}

export async function fetchAdminCampaignAnalytics(
  id: string,
  days = 30
): Promise<AdminCampaignAnalytics> {
  const { data } = await api.get<unknown>(
    `/admin/advertising/campaigns/${encodeURIComponent(id)}/analytics`,
    { params: { ...(days ? { days } : {}) } }
  );
  const obj = asObject(data);
  const totals = asObject(obj.totals);
  return {
    campaignId: typeof obj.campaignId === "string" ? obj.campaignId : undefined,
    totals: {
      impressions: toCount(totals.impressions) ?? 0,
      clicks: toCount(totals.clicks) ?? 0,
      ctr: typeof totals.ctr === "number" && Number.isFinite(totals.ctr) ? totals.ctr : 0,
    },
    byDay: asArray(obj.byDay).map((day, index) => {
      const d = asObject(day);
      return {
        date: typeof d.date === "string" ? d.date : `#${index + 1}`,
        impressions: toCount(d.impressions) ?? 0,
        clicks: toCount(d.clicks) ?? 0,
      };
    }),
  };
}

// =====================================================================
// 7. GET /admin/premium/plans — ALWAYS responds, even when the flag is off
// =====================================================================

export type AdminPremiumSubjectType = "USER" | "RESOURCE" | "SERVER";

export type AdminPremiumKind =
  | "CREATOR_PREMIUM"
  | "SERVER_PREMIUM"
  | "MARKETPLACE_PREMIUM"
  | "ADVERTISING_PREMIUM"
  | "ANALYTICS_PREMIUM";

export interface AdminPremiumPlan {
  kind?: string | null;
  label?: string | null;
  description?: string | null;
  features?: string[] | null;
  available?: boolean | null;
  enabled?: boolean | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface AdminPremiumPlansPage {
  plans: AdminPremiumPlan[];
  /** null = backend did not spell the flag out (older revision). */
  featureEnabled: boolean | null;
}

export async function fetchAdminPremiumPlans(): Promise<AdminPremiumPlansPage> {
  const { data } = await api.get<unknown>("/admin/premium/plans");
  const obj = asObject(data);
  return {
    plans: asArray(obj.plans).map((plan) => asObject(plan) as AdminPremiumPlan),
    featureEnabled: typeof obj.featureEnabled === "boolean" ? obj.featureEnabled : null,
  };
}

// =====================================================================
// 8. GET /admin/premium/entitlements — paginated list with subject labels
// =====================================================================

export interface AdminPremiumEntitlement {
  id: string;
  subjectType?: string | null;
  subjectId?: string | null;
  kind?: string | null;
  source?: string | null;
  note?: string | null;
  grantedAt?: string | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  revokedById?: string | null;
  grantedById?: string | null;
  /** subjectLabel? (contract) or subject.label (current backend revision). */
  subjectLabel?: string | null;
  [key: string]: unknown;
}

export interface AdminEntitlementsPage {
  entitlements: AdminPremiumEntitlement[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminEntitlementsQuery {
  subjectType?: string;
  subjectId?: string;
  kind?: string;
  active?: boolean;
  page?: number;
  limit?: number;
}

export async function fetchAdminPremiumEntitlements(
  query: AdminEntitlementsQuery = {}
): Promise<AdminEntitlementsPage> {
  const { data } = await api.get<unknown>("/admin/premium/entitlements", {
    params: {
      ...(query.subjectType ? { subjectType: query.subjectType } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.active === undefined ? {} : { active: String(query.active) }),
      ...(query.page ? { page: query.page } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    },
  });
  const normalized = normalizeListPage<Record<string, unknown>>(data, ["entitlements", "data"]);
  return {
    entitlements: normalized.rows.map((row) => {
      const obj = asObject(row);
      // subjectLabel? per contract; current backend nests subject: {type, label}.
      const subject = asObject(obj.subject);
      const subjectLabel =
        typeof obj.subjectLabel === "string" && obj.subjectLabel
          ? obj.subjectLabel
          : typeof subject.label === "string" && subject.label
            ? subject.label
            : null;
      return { ...obj, subjectLabel } as AdminPremiumEntitlement;
    }),
    total: normalized.total,
    page: normalized.page,
    limit: normalized.limit,
  };
}

// =====================================================================
// 9. POST /admin/premium/entitlements — idempotent grant
// =====================================================================

export interface AdminEntitlementGrantInput {
  subjectType: string;
  subjectId: string;
  kind: string;
  note?: string;
  expiresAt?: string;
}

export interface AdminEntitlementGrantResult {
  entitlement: AdminPremiumEntitlement;
  /** false = an active grant already exists (surface «уже выдан»). */
  created: boolean;
}

export async function grantAdminPremiumEntitlement(
  input: AdminEntitlementGrantInput
): Promise<AdminEntitlementGrantResult> {
  const { data } = await api.post<unknown>("/admin/premium/entitlements", input);
  const obj = asObject(data);
  return {
    entitlement: asObject(obj.entitlement) as AdminPremiumEntitlement,
    created: obj.created === true,
  };
}

// =====================================================================
// 10. DELETE /admin/premium/entitlements/:id — reason required (CAS revoke)
// =====================================================================

export interface AdminEntitlementRevokeResult {
  entitlement: AdminPremiumEntitlement;
  /** false = уже отозван. */
  revoked: boolean;
}

export async function revokeAdminPremiumEntitlement(
  id: string,
  reason: string
): Promise<AdminEntitlementRevokeResult> {
  const { data } = await api.delete<unknown>(
    `/admin/premium/entitlements/${encodeURIComponent(id)}`,
    { data: { reason } }
  );
  const obj = asObject(data);
  return {
    entitlement: asObject(obj.entitlement) as AdminPremiumEntitlement,
    revoked: obj.revoked === true,
  };
}