// PLAN-017 §36: admin API façade (lib/api/admin.ts).
//
// Two responsibilities:
// 1. Typed client for the NEW /admin endpoints (overview, users, roles,
//    permissions, audit-events, system-logs, search-entities) introduced by
//    the parallel backend work — mounted under /admin, session cookie auth,
//    error shape { error: string }.
// 2. Organized re-export façade for the pre-existing admin functions that
//    still live in lib/api-ext.ts (admin resources/sellers/disputes/versions/
//    servers/reports/community/articles). The underlying api-ext functions
//    stay the single source of truth (no duplication); feature modules import
//    everything admin-related from here.
//
// NOTE: api-ext.ts is read-only (PLAN-017 ownership); it does not import this
// module, so no import cycle is possible.
import api from "../api";

// =====================================================================
// Shared admin pagination envelope (new endpoints)
// =====================================================================

export interface AdminPageInfo {
  total: number;
  page: number;
  limit: number;
}

// =====================================================================
// 1. GET /admin/overview
// =====================================================================

/** Сводный дашборд. Деньги — integer kopecks (revenueMinor). */
export interface AdminOverview {
  users: { total: number; active: number; suspended: number };
  resources: { total: number; published: number; pendingReview: number };
  servers: { total: number; verified: number; pending: number };
  reports: { open: number };
  disputes: { open: number };
  sales: { count30d: number; revenueMinor30d: number };
  advertising: { activeCampaigns: number };
  premium: { activeEntitlements: number };
  system: { database: "ok" | "unavailable"; uptimeSeconds: number };
}

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const { data } = await api.get<AdminOverview>("/admin/overview");
  return data;
}

// =====================================================================
// 2-6. GET /admin/users, GET /admin/users/:id, suspend/restore, activity, role
// =====================================================================

export interface AdminUserRow {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  status: string;
  createdAt: string;
  lastLoginAt: string | null;
  counts: { resources: number; purchases: number; identities: number };
}

export interface AdminUsersPage extends AdminPageInfo {
  users: AdminUserRow[];
}

export interface AdminUsersQuery {
  search?: string;
  status?: string;
  role?: string;
  page?: number;
  limit?: number;
}

export async function fetchAdminUsers(query: AdminUsersQuery = {}): Promise<AdminUsersPage> {
  const { data } = await api.get<AdminUsersPage>("/admin/users", {
    params: {
      ...(query.search ? { search: query.search } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.page ? { page: query.page } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    },
  });
  return data;
}

export interface AdminUserIdentity {
  provider: string;
  providerAccountId: string;
  createdAt: string;
}

/** Audit/log-style записи приходят с разными именами колонок — читаем defensively. */
export interface AdminModerationEntry {
  type?: string;
  action?: string;
  at?: string;
  createdAt?: string;
  summary?: string;
  reason?: string | null;
  [key: string]: unknown;
}

/** Покупки в карточке пользователя — shape зависит от backend, читаем defensively. */
export interface AdminUserPurchase {
  id?: string;
  status?: string;
  createdAt?: string;
  resourceTitle?: string;
  amountMinor?: number;
  [key: string]: unknown;
}

export interface AdminUserDetail {
  user: AdminUserRow;
  identities: AdminUserIdentity[];
  moderationHistory: AdminModerationEntry[];
  resources: { id: string; slug: string; title: string; status: string }[];
  purchases: AdminUserPurchase[];
  sessionsCount: number;
  lastLoginAt: string | null;
}

export async function fetchAdminUser(id: string): Promise<AdminUserDetail> {
  const { data } = await api.get<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`);
  return data;
}

/** POST /admin/users/:id/suspend — body { reason, confirm? }. */
export async function adminSuspendUser(
  id: string,
  reason: string,
  confirm?: boolean
): Promise<unknown> {
  const { data } = await api.post(`/admin/users/${encodeURIComponent(id)}/suspend`, {
    reason,
    ...(confirm ? { confirm: true } : {}),
  });
  return data;
}

/** POST /admin/users/:id/restore — body { reason }. */
export async function adminRestoreUser(id: string, reason: string): Promise<unknown> {
  const { data } = await api.post(`/admin/users/${encodeURIComponent(id)}/restore`, { reason });
  return data;
}

export interface AdminActivityEntry {
  type: string;
  at: string;
  summary: string;
  refType?: string;
  refId?: string;
  amountMinor?: number;
}

export async function fetchAdminUserActivity(id: string, limit = 50): Promise<{ entries: AdminActivityEntry[] }> {
  const { data } = await api.get<{ entries: AdminActivityEntry[] }>(
    `/admin/users/${encodeURIComponent(id)}/activity`,
    { params: { limit } }
  );
  return data;
}

/**
 * PATCH /admin/users/:id/role — body { role, confirm?, reason? }.
 * Ошибки: 403 self_change_forbidden, 409 last_superadmin, 409 confirmation_required.
 */
export async function adminChangeUserRole(
  id: string,
  role: string,
  opts: { confirm?: boolean; reason?: string } = {}
): Promise<unknown> {
  const { data } = await api.patch(`/admin/users/${encodeURIComponent(id)}/role`, {
    role,
    ...(opts.confirm ? { confirm: true } : {}),
    ...(opts.reason ? { reason: opts.reason } : {}),
  });
  return data;
}

// =====================================================================
// 7-8. GET /admin/roles, GET /admin/permissions
// =====================================================================

export interface AdminRoleInfo {
  role: string;
  label: string;
  permissions: string[];
  members: number;
}

export async function fetchAdminRoles(): Promise<{ roles: AdminRoleInfo[] }> {
  const { data } = await api.get<{ roles: AdminRoleInfo[] }>("/admin/roles");
  return data;
}

export interface AdminPermissionInfo {
  key: string;
  label: string;
  description: string;
  group: string;
}

export async function fetchAdminPermissions(): Promise<{ permissions: AdminPermissionInfo[] }> {
  const { data } = await api.get<{ permissions: AdminPermissionInfo[] }>("/admin/permissions");
  return data;
}

// =====================================================================
// 9. GET /admin/audit-events
// =====================================================================

export interface AdminAuditQuery {
  actorId?: string;
  userId?: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  ip?: string;
  requestId?: string;
  page?: number;
  limit?: number;
}

/**
 * Колонки событий могут отличаться в деталях (code defensively: поля читаются
 * по наличию — см. features/admin/audit). before/after — произвольный JSON.
 */
export interface AdminAuditEvent {
  id?: string;
  action?: string;
  actorId?: string;
  userId?: string;
  targetType?: string;
  targetId?: string;
  ip?: string;
  requestId?: string;
  createdAt?: string;
  before?: unknown;
  after?: unknown;
  [key: string]: unknown;
}

export interface AdminAuditPage extends AdminPageInfo {
  events: AdminAuditEvent[];
}

export async function fetchAdminAuditEvents(query: AdminAuditQuery = {}): Promise<AdminAuditPage> {
  const { data } = await api.get<AdminAuditPage>("/admin/audit-events", {
    params: {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.ip ? { ip: query.ip } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.page ? { page: query.page } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    },
  });
  return data;
}

// =====================================================================
// 10. GET /admin/system-logs
// =====================================================================

export interface AdminLogsQuery {
  level?: string;
  service?: string;
  requestId?: string;
  route?: string;
  errorCode?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface AdminSystemLog {
  id?: string;
  level?: string;
  service?: string;
  route?: string;
  errorCode?: string;
  message?: string;
  requestId?: string;
  createdAt?: string;
  meta?: unknown;
  [key: string]: unknown;
}

export interface AdminLogsPage extends AdminPageInfo {
  logs: AdminSystemLog[];
}

export async function fetchAdminSystemLogs(query: AdminLogsQuery = {}): Promise<AdminLogsPage> {
  const { data } = await api.get<AdminLogsPage>("/admin/system-logs", {
    params: {
      ...(query.level ? { level: query.level } : {}),
      ...(query.service ? { service: query.service } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.route ? { route: query.route } : {}),
      ...(query.errorCode ? { errorCode: query.errorCode } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.page ? { page: query.page } : {}),
      ...(query.limit ? { limit: query.limit } : {}),
    },
  });
  return data;
}

// =====================================================================
// 11. GET /admin/search-entities
// =====================================================================

export type AdminSearchEntityType =
  | "user"
  | "resource"
  | "server"
  | "review"
  | "thread"
  | "news"
  | "article"
  | "version";

export interface AdminSearchItem {
  id: string;
  label: string;
  sublabel?: string;
}

export async function searchAdminEntities(
  type: AdminSearchEntityType,
  q: string,
  limit = 10
): Promise<{ items: AdminSearchItem[] }> {
  const { data } = await api.get<{ items: AdminSearchItem[] }>("/admin/search-entities", {
    params: { type, q, ...(limit ? { limit } : {}) },
  });
  return data;
}

// =====================================================================
// Façade: pre-existing admin functions (source of truth stays lib/api-ext.ts).
// Feature modules import admin data access only from "@/lib/api/admin".
// =====================================================================

export {
  // stats / resources / moderation
  fetchAdminStats,
  fetchAdminResources,
  adminSetResourceStatus,
  fetchAdminResourceDetail,
  fetchModerationEvents,
  // sellers
  fetchAdminSellers,
  adminSellerAction,
  // disputes
  fetchAdminDisputes,
  adminTransitionDispute,
  fetchDispute,
  postDisputeMessage,
  // versions
  adminYankVersion,
  adminVersionCompatibility,
  // servers
  fetchAdminServers,
  fetchAdminServerDetail,
  adminServerLifecycle,
  adminServerVerification,
  // reports
  fetchAdminReports,
  adminResolveReport,
  // community content
  adminModerateNews,
  adminModerateServerReview,
  adminModerateThread,
  // articles
  fetchAdminArticles,
  adminArticleAction,
  // helpers previously imported from api-ext by the admin page
  getErrorMessage,
  formatRub,
} from "../api-ext";

export type {
  Resource,
  Screenshot,
  Paginated,
  Dispute,
  SellerProfile,
  AdminResourceVersion,
  AdminResourceDetail,
  ServerNewsItem,
  AdminServerRow,
  AdminReport,
  AdminArticle,
} from "../api-ext";