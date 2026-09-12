// PLAN-019 E-003: resources domain API (split from lib/api-ext.ts).
// Resources / media / versions / reviews / upload / global search, plus the
// legacy admin resource+version endpoints consumed through the
// lib/api/admin.ts façade. DTO re-exports flow through lib/api-ext.ts, so
// existing `from "@/lib/api-ext"` imports keep working unchanged.
import api from "../api";
import type { Pagination, Paginated } from "@mta-market/shared";
import type { ServerCard } from "./servers";
import type { ThreadCard } from "./community";
import type { ArticleCard } from "./content";

// ---------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------
// NOTE: `Resource` is NOT duplicated from @mta-market/shared — the shared
// package does not define it; this is the canonical web-side DTO.
export interface Resource {
  id: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  status: string;
  price: number; // kopecks; 0 = FREE
  createdAt: string;
  // PLAN-002 E-006/E-007: additive fields from the server (card + product page).
  seller?: { username?: string | null; displayName?: string | null; avatar?: string | null } | null;
  rating?: number | null;
  reviewCount?: number | null;
  // PLAN-003 A-002/A-003: media (additive; null/[] for resources without media).
  coverUrl?: string | null;
  screenshots?: { id: string; url: string; position: number }[];
  updatedAt?: string;
  // PLAN-008: aggregate follower count (§42 — no lists).
  resourceFollowers?: number;
  // PLAN-018 Wave-6: активная кампания скидки (аддитивное поле; иначе null).
  // `price` — итоговая (скидочная) цена; discount.originalPrice — неизменяемая
  // базовая цена, рисуется зачёркнутой.
  discount?: { originalPrice: number } | null;
}

export interface Screenshot {
  id: string;
  url: string;
  position: number;
}

export interface ResourceVersion {
  id: string;
  version: string;
  changelog?: string | null;
  createdAt: string;
}

export interface Review {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  user?: { username?: string; displayName?: string | null } | null;
}

export interface UploadResult {
  fileUrl: string;
  fileKey: string | null;
  fileName: string;
  fileSize: number;
  fileChecksum: string;
  mimeType: string;
  storage: "s3" | "local";
}

// ---------------------------------------------------------------------
// Upload (E-003)
// ---------------------------------------------------------------------

/**
 * POST /upload/resource — multipart, field name "file".
 * The server computes the checksum and returns everything the versions
 * route needs; nothing is computed client-side.
 */
export async function uploadResourceFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<UploadResult>("/upload/resource", form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export interface CreateVersionBody {
  version: string; // "x.y.z"
  changelog?: string;
  fileUrl: string;
  fileSize: number;
  fileChecksum: string;
}

export interface ResourceVersionCreated extends ResourceVersion {
  signed?: boolean;
  artifactHash?: string;
  manifestHash?: string;
}

export interface VersionValidationIssue {
  path?: string;
  message?: string;
}

/** 422 payload returned when sandbox/static validation rejects the artifact. */
export interface VersionValidationError {
  error: string;
  validation?: { passed?: boolean; issues?: VersionValidationIssue[]; summary?: string } & Record<string, unknown>;
}

/** PLAN-003 A-002: публичный URL медиа. Сервер отдаёт server-relative
 * /media/... (локальный storage) или абсолютный S3 URL. В dev web и api
 * живут на разных портах — относительный путь резолвится против API base. */
export function mediaUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  if (url.startsWith("/media/")) {
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    return `${base}${url}`;
  }
  return url;
}

export async function createResourceVersion(
  slug: string,
  body: CreateVersionBody
): Promise<ResourceVersionCreated> {
  const { data } = await api.post<ResourceVersionCreated>(`/resources/${slug}/versions`, body);
  return data;
}

// ---------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------
/**
 * PLAN-003 F/G/H/I/T/U: единый query contract GET /resources.
 * q — поиск (title/description/продавец), type — реальный enum, price —
 * free|paid, sort — реализованные стратегии. Без параметров — прежнее
 * поведение (newest), существующие вызовы совместимы (U-003).
 */
export interface ResourceQuery {
  q?: string;
  type?: string;
  price?: "free" | "paid" | "";
  sort?: string;
  page?: number;
  limit?: number;
}

export function fetchResources(query: ResourceQuery | number = 1, limit?: number) {
  // Backward-compatible: fetchResources(page, limit) still works.
  const params: Record<string, string | number> =
    typeof query === "number"
      ? { page: query, limit: limit ?? 12 }
      : {
          ...(query.q ? { q: query.q } : {}),
          ...(query.type ? { type: query.type } : {}),
          ...(query.price ? { price: query.price } : {}),
          ...(query.sort ? { sort: query.sort } : {}),
          page: query.page ?? 1,
          limit: query.limit ?? 12,
        };
  return api
    .get<Paginated<Resource>>("/resources", { params })
    .then(({ data }) => data);
}

/** PLAN-003 J-006: агрегированные реальные секции homepage (один запрос). */
export interface HomepageData {
  newest: Resource[];
  popular: Resource[];
  free: Resource[];
}

export async function fetchHomepage(): Promise<HomepageData> {
  const { data } = await api.get<HomepageData>("/resources/homepage");
  return data;
}

export async function fetchResource(slug: string) {
  const { data } = await api.get<Resource>(`/resources/${slug}`);
  return data;
}

export async function fetchResourceVersions(slug: string) {
  const { data } = await api.get<ResourceVersion[] | { data: ResourceVersion[] }>(
    `/resources/${slug}/versions`
  );
  // Server returns a plain array; tolerate a {data} wrapper defensively.
  return Array.isArray(data) ? data : data.data;
}

export async function fetchResourceReviews(slug: string, page = 1, limit = 10) {
  const { data } = await api.get<{
    data: Review[];
    stats: { total: number; averageRating: number | null };
    pagination: Pagination;
  }>(`/resources/${slug}/reviews`, { params: { page, limit } });
  return data;
}

export async function postReview(slug: string, rating: number, comment: string) {
  const { data } = await api.post<Review>(`/resources/${slug}/reviews`, { rating, comment });
  return data;
}

// ---------------------------------------------------------------------
// Seller (own resources)
// ---------------------------------------------------------------------

export async function createResource(body: {
  title: string;
  description: string;
  type: string;
  price: number;
  slug?: string;
}) {
  const { data } = await api.post<Resource>("/resources", body);
  return data;
}

/**
 * Submit / withdraw a listing. The server contract is PATCH /resources/:slug
 * with { status } (seller transitions: DRAFT <-> PENDING_REVIEW only) —
 * there is no /resources/:slug/status route.
 */
export async function setResourceStatus(slug: string, status: string) {
  const { data } = await api.patch(`/resources/${slug}`, { status });
  return data;
}

/** GET /resources/my — the seller's own resources (all statuses). */
export async function fetchMyResources(): Promise<Resource[]> {
  const { data } = await api.get<{ data: Resource[] }>("/resources/my");
  return Array.isArray(data) ? ((data as unknown as { data: Resource[] }).data ?? []) : (data as unknown as Resource[]);
}

// PLAN-010: Creator Analytics (honest demand signal).
export async function countResourceView(slug: string): Promise<void> {
  try {
    await api.post(`/resources/${encodeURIComponent(slug)}/view`);
  } catch {
    // fire-and-forget: a failed counter never breaks the page
  }
}

// ---------------------------------------------------------------------
// Media (PLAN-003 A/B)
// ---------------------------------------------------------------------
/**
 * POST /upload/media — multipart, field "file". Сервер проверяет магические
 * байты и возвращает публичный URL (/media/... или S3). Прогресс загрузки
 * с fetch не наблюдается — колбэк onProgress оставлен для совместимости
 * сигнатуры и игнорируется (файлы до 5 МБ; состояние
 * uploading/uploaded/failed различается на UI).
 */
export interface MediaUploadResult {
  url: string;
  mimeType: string;
  sizeBytes: number;
  storage: "s3" | "local";
}

export async function uploadMedia(
  file: File,
  onProgress?: (percent: number) => void
): Promise<MediaUploadResult> {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post<MediaUploadResult>("/upload/media", form, {
    headers: { "Content-Type": "multipart/form-data" },
    onUploadProgress: (e) => {
      if (onProgress && e.total) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    },
  });
  return data;
}

export async function setResourceCover(slug: string, url: string | null) {
  if (url === null) {
    const { data } = await api.delete<{ coverUrl: string | null }>(`/resources/${slug}/media/cover`);
    return data;
  }
  const { data } = await api.put<{ coverUrl: string }>(`/resources/${slug}/media/cover`, { url });
  return data;
}

export async function addResourceScreenshot(slug: string, url: string): Promise<Screenshot> {
  const { data } = await api.post<Screenshot>(`/resources/${slug}/media/screenshots`, { url });
  return data;
}

export async function removeResourceScreenshot(slug: string, mediaId: string) {
  const { data } = await api.delete(`/resources/${slug}/media/screenshots/${mediaId}`);
  return data;
}

export async function reorderResourceScreenshots(slug: string, ids: string[]) {
  const { data } = await api.put(`/resources/${slug}/media/screenshots/order`, { ids });
  return data;
}

/** B-006: текущее медиа-состояние своего ресурса (в т.ч. черновика). */
export async function fetchResourceMedia(slug: string) {
  const { data } = await api.get<{
    coverUrl: string | null;
    screenshots: Screenshot[];
    editable: boolean;
  }>(`/resources/${slug}/media`);
  return data;
}

// ---------------------------------------------------------------------
// Seller storefront (PLAN-003 E)
// ---------------------------------------------------------------------

export interface SellerStore {
  seller: {
    username: string;
    displayName: string;
    avatar: string | null;
    supportInfo: string | null;
    memberSince: string;
    resourceCount: number;
    // PLAN-008: aggregate follower count (§42 — no lists).
    creatorFollowers?: number;
  };
  resources: Resource[];
}

export async function fetchSellerStore(username: string): Promise<SellerStore> {
  const { data } = await api.get<SellerStore>(`/sellers/${encodeURIComponent(username)}`);
  return data;
}

// ---------------------------------------------------------------------
// Global search (GET /search — covers resources + servers + threads +
// articles + services + creators + news, PLAN-018 H-001..H-003)
// ---------------------------------------------------------------------

export interface SearchResults {
  query: string;
  resources: { count: number; data: Partial<Resource>[] };
  servers: { count: number; data: ServerCard[] };
  threads: { count: number; data: ThreadCard[] };
  // PLAN-007 E-004: articles group (additive; older caches may omit it).
  articles?: { count: number; data: ArticleCard[] };
  // PLAN-018 H-001: services / creators / news (additive; older caches omit).
  services?: { count: number; data: SearchServiceItem[] };
  creators?: { count: number; data: SearchCreatorItem[] };
  news?: { count: number; data: SearchNewsItem[] };
}

export interface SearchServiceItem {
  id: string;
  slug: string;
  title: string;
  price: number;
  type: string;
  deliveryDays?: number | null;
}

export interface SearchCreatorItem {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
  followers: number;
}

export interface SearchNewsItem {
  id: string;
  title: string;
  excerpt: string;
  coverUrl?: string | null;
  server?: { slug: string; name: string } | null;
  publishedAt?: string | null;
}

/** H-002 filters (unknown values are ignored by the server — lenient). */
export interface SearchFilters {
  /** Comma list of group keys; absent → all groups. */
  type?: string;
  category?: string;
  price?: "free" | "paid" | "";
  verified?: boolean;
  rating_min?: string;
  updated_within?: "7d" | "30d" | "";
}

export async function search(q: string, filters?: SearchFilters): Promise<SearchResults> {
  const { data } = await api.get<SearchResults>("/search", {
    params: {
      q,
      ...(filters?.type ? { type: filters.type } : {}),
      ...(filters?.category ? { category: filters.category } : {}),
      ...(filters?.price ? { price: filters.price } : {}),
      ...(filters?.verified ? { verified: "true" } : {}),
      ...(filters?.rating_min ? { rating_min: filters.rating_min } : {}),
      ...(filters?.updated_within ? { updated_within: filters.updated_within } : {}),
    },
  });
  return data;
}

// ---------------------------------------------------------------------
// Legacy admin resources / versions (source of truth for the
// lib/api/admin.ts façade — feature modules import admin data access
// only from "@/lib/api/admin").
// ---------------------------------------------------------------------

export interface AdminResourceVersion {
  id: string;
  version: string;
  changelog: string | null;
  fileSize: number;
  releaseStatus: string;
  artifactHash: string | null;
  signed: boolean;
  signedAt: string | null;
  validationStatus: string;
}

export interface AdminResourceDetail {
  resource: Resource & { seller: SellerStore["seller"] | null };
  cover: string | null;
  screenshots: Screenshot[];
  versions: AdminResourceVersion[];
}

export async function fetchAdminResourceDetail(id: string): Promise<AdminResourceDetail> {
  const { data } = await api.get<AdminResourceDetail>(`/admin/resources/${id}`);
  return data;
}

export async function fetchAdminStats() {
  const { data } = await api.get<{
    users: { total: number; active: number; banned: number };
    resources: { total: number; published: number; draft: number; pendingReview: number; suspended: number };
    purchases: Record<string, number>;
    reviews: { total: number; averageRating: number | null };
  }>("/admin/stats");
  return data;
}

export async function fetchAdminResources(status?: string, page = 1) {
  const { data } = await api.get<Paginated<Resource>>("/admin/resources", {
    params: { ...(status ? { status } : {}), page },
  });
  return data;
}

/**
 * Server contract: PATCH /admin/resources/:id/status
 * (POST is not registered on the backend).
 */
export async function adminSetResourceStatus(id: string, status: string, reason?: string) {
  const { data } = await api.patch(`/admin/resources/${id}/status`, reason ? { status, reason } : { status });
  return data;
}

export async function fetchModerationEvents(id: string) {
  const { data } = await api.get<{ data?: unknown[] } | unknown[]>(`/admin/resources/${id}/moderation-events`);
  return data;
}

export async function adminYankVersion(id: string, reason: string) {
  const { data } = await api.post(`/admin/versions/${id}/yank`, { reason });
  return data;
}

export async function adminVersionCompatibility(id: string) {
  const { data } = await api.get(`/admin/versions/${id}/compatibility`);
  return data;
}

// ---------------------------------------------------------------------------
// PLAN-018 Wave-6 (buyer/personal surfaces): favorites, price alerts, trust
// read models, update center, buyer transactions. Query keys for these
// families are declared inline by the consuming pages as namespaced arrays
// (["favorites", …], ["alerts", …], ["trust", …], ["updates", …]) — the
// lib/queries.ts factory is frozen for this wave.
// All DTOs are defensive: fields the server may omit stay optional/null.
// ---------------------------------------------------------------------------

// ---------- Favorites (PUT/DELETE /:surface/favorite, GET /me/favorites) ----------

export type FavoriteTargetType = "RESOURCE" | "SERVER" | "CREATOR" | "DISCUSSION";

/** Response of the idempotent PUT/DELETE favorite toggles. */
export interface FavoriteToggleResult {
  favorited: boolean;
  targetType?: string;
  targetId?: string;
}

/** Minimal resource card embedded as a favorite subject (defensive). */
export interface FavoriteResourceSubject {
  id?: string;
  slug?: string;
  title?: string;
  coverUrl?: string | null;
  price?: number;
}

export interface FavoriteServerSubject {
  id?: string;
  slug?: string;
  name?: string;
  logoUrl?: string | null;
}

export interface FavoriteCreatorSubject {
  id?: string;
  username?: string;
  displayName?: string | null;
  avatar?: string | null;
}

export interface FavoriteDiscussionSubject {
  id?: string;
  title?: string;
  state?: string;
  replyCount?: number;
  lastPostAt?: string | null;
}

/** One favorite row; subject is null for stale (deleted) targets. */
export interface FavoriteEntry<S = unknown> {
  id: string;
  targetType: FavoriteTargetType | string;
  targetId: string;
  createdAt?: string;
  subject: S | null;
}

export interface MyFavorites {
  total?: number;
  data: {
    RESOURCE: FavoriteEntry<FavoriteResourceSubject>[];
    SERVER: FavoriteEntry<FavoriteServerSubject>[];
    CREATOR: FavoriteEntry<FavoriteCreatorSubject>[];
    DISCUSSION: FavoriteEntry<FavoriteDiscussionSubject>[];
  };
}

export async function toggleResourceFavorite(slug: string, on: boolean): Promise<FavoriteToggleResult> {
  const path = `/resources/${encodeURIComponent(slug)}/favorite`;
  const { data } = on
    ? await api.put<FavoriteToggleResult>(path)
    : await api.delete<FavoriteToggleResult>(path);
  return data;
}

export async function toggleServerFavorite(slug: string, on: boolean): Promise<FavoriteToggleResult> {
  const path = `/servers/${encodeURIComponent(slug)}/favorite`;
  const { data } = on
    ? await api.put<FavoriteToggleResult>(path)
    : await api.delete<FavoriteToggleResult>(path);
  return data;
}

export async function toggleCreatorFavorite(username: string, on: boolean): Promise<FavoriteToggleResult> {
  const path = `/sellers/${encodeURIComponent(username)}/favorite`;
  const { data } = on
    ? await api.put<FavoriteToggleResult>(path)
    : await api.delete<FavoriteToggleResult>(path);
  return data;
}

export async function toggleThreadFavorite(threadId: string, on: boolean): Promise<FavoriteToggleResult> {
  const path = `/community/forum/thread/${encodeURIComponent(threadId)}/favorite`;
  const { data } = on
    ? await api.put<FavoriteToggleResult>(path)
    : await api.delete<FavoriteToggleResult>(path);
  return data;
}

/** GET /me/favorites?type= — the owner's bookmarks, grouped by target type. */
export async function fetchMyFavorites(type?: FavoriteTargetType): Promise<MyFavorites> {
  const { data } = await api.get<MyFavorites>("/me/favorites", {
    params: type ? { type } : {},
  });
  return data;
}

/** DELETE /me/favorites/:favoriteId — owner-scoped removal by row id
 * (works for stale rows whose target no longer resolves). */
export async function removeFavoriteById(favoriteId: string): Promise<{ removed: boolean; id: string }> {
  const { data } = await api.delete<{ removed: boolean; id: string }>(
    `/me/favorites/${favoriteId}`
  );
  return data;
}

// ---------- Price alerts (PUT/DELETE /resources/:slug/alert, GET /me/alerts) ----------

export type PriceAlertEvent = "PRICE_DROP" | "DISCOUNT_STARTED" | "VERSION_RELEASED";
export const PRICE_ALERT_EVENT_LABELS: Record<PriceAlertEvent, string> = {
  PRICE_DROP: "Снижение цены",
  DISCOUNT_STARTED: "Начало скидки",
  VERSION_RELEASED: "Выход новой версии",
};

export interface ResourceAlertBody {
  events: PriceAlertEvent[];
  /** Kopecks; only meaningful together with PRICE_DROP. */
  targetPriceMinor?: number | null;
}

export interface ResourceAlert {
  id?: string;
  userId?: string;
  resourceId?: string;
  events: PriceAlertEvent[];
  targetPriceMinor?: number | null;
  active: boolean;
  createdAt?: string;
}

/** PUT /resources/:slug/alert — create or update (upsert; re-PUT reactivates). */
export async function putResourceAlert(slug: string, body: ResourceAlertBody): Promise<ResourceAlert> {
  const { data } = await api.put<ResourceAlert>(`/resources/${encodeURIComponent(slug)}/alert`, body);
  return data;
}

/** DELETE /resources/:slug/alert — deactivate (idempotent). */
export async function deleteResourceAlert(slug: string): Promise<{ active: boolean }> {
  const { data } = await api.delete<{ active: boolean }>(`/resources/${encodeURIComponent(slug)}/alert`);
  return data;
}

/** GET /me/alerts — the caller's own alerts with resource labels. */
export interface MyAlert {
  id: string;
  resourceId?: string | null;
  events: PriceAlertEvent[];
  targetPriceMinor?: number | null;
  active: boolean;
  createdAt?: string;
  resource?: { id?: string; slug?: string; title?: string; price?: number; status?: string } | null;
}

export async function fetchMyAlerts(): Promise<{ data: MyAlert[] }> {
  const { data } = await api.get<{ data: MyAlert[] }>("/me/alerts");
  return data;
}

// ---------- Trust read models (GET /trust/resource/:slug, /trust/seller/:username) ----------

/** Explainable factor: value 0..1 (null = no evidence), weight and contribution. */
export interface TrustFactor {
  name: string;
  value: number | null;
  weight: number;
  contribution: number;
  note?: string;
}

export interface ResourceVerificationReport {
  /** VERIFIED | UNVERIFIED | FAILED (string — defensive for new states). */
  state?: string | null;
  factors?: TrustFactor[] | null;
}

export interface ResourceCompatibilityReport {
  /** VERIFIED | PARTIAL | UNKNOWN | FAILED — null when never tested. */
  result?: string | null;
  mtaVersion?: string | null;
  mtaMin?: string | null;
  mtaMax?: string | null;
  os?: string | null;
  /** The route exposes `arch`; `architecture` accepted defensively. */
  arch?: string | null;
  architecture?: string | null;
  nativeModules?: unknown;
  dependencies?: { slug?: string | null; minVersion?: string | null; type?: string | null }[] | null;
  notes?: string | null;
  verifiedAt?: string | null;
}

export interface ResourceTrustReport {
  verification: ResourceVerificationReport;
  compatibility: ResourceCompatibilityReport;
  health: { score?: number | null; factors?: TrustFactor[] | null };
}

export async function fetchResourceTrust(slug: string): Promise<ResourceTrustReport> {
  const { data } = await api.get<ResourceTrustReport>(`/trust/resource/${encodeURIComponent(slug)}`);
  return data;
}

export interface SellerTrustReport {
  seller?: {
    username?: string;
    displayName?: string | null;
    memberSince?: string | null;
  } | null;
  score?: number | null;
  factors?: TrustFactor[] | null;
}

export async function fetchSellerTrust(username: string): Promise<SellerTrustReport> {
  const { data } = await api.get<SellerTrustReport>(`/trust/seller/${encodeURIComponent(username)}`);
  return data;
}

// ---------- Update center (GET /me/updates, /me/updates/changelog/:resourceId) ----------

export interface UpdateCenterRow {
  purchaseId?: string;
  licenseId?: string | null;
  licenseStatus?: string | null;
  resourceId?: string | null;
  slug?: string | null;
  title?: string | null;
  installedVersion?: string | null;
  latestVersion?: string | null;
  latestChannel?: string | null;
  updateAvailable?: boolean;
  compatibility?: { result?: string | null; verifiedAt?: string | null } | null;
  health?: { score?: number | null; factors?: TrustFactor[] | null } | null;
  actions?: {
    canUpdate?: boolean;
    canRollback?: boolean;
    changelogUrl?: string | null;
  } | null;
}

export async function fetchMyUpdates(page = 1): Promise<{ data: UpdateCenterRow[]; pagination: Pagination }> {
  const { data } = await api.get<{ data: UpdateCenterRow[]; pagination: Pagination }>("/me/updates", {
    params: { page },
  });
  return data;
}

export interface ChangelogVersion {
  id: string;
  version: string;
  changelog?: string | null;
  channel?: string | null;
  releaseStatus?: string | null;
  publishedAt?: string | null;
}

export async function fetchChangelog(
  resourceId: string,
  from?: string
): Promise<{
  resource?: { id?: string; slug?: string; title?: string } | null;
  data: ChangelogVersion[];
  nextCursor?: string | null;
}> {
  const { data } = await api.get<{
    resource?: { id?: string; slug?: string; title?: string } | null;
    data: ChangelogVersion[];
    nextCursor?: string | null;
  }>(`/me/updates/changelog/${encodeURIComponent(resourceId)}`, {
    params: from ? { from } : {},
  });
  return data;
}

// ---------- Buyer transactions (GET /payments/transactions/mine) ----------

export interface TransactionPayment {
  id: string;
  purchaseId?: string | null;
  provider?: string | null;
  amount?: number;
  currency?: string | null;
  status?: string;
  createdAt?: string;
  succeededAt?: string | null;
}

export interface TransactionRefund {
  id: string;
  paymentId?: string | null;
  amount?: number;
  currency?: string | null;
  status?: string;
  reason?: string | null;
  createdAt?: string;
  processedAt?: string | null;
}

export interface TransactionPurchase {
  id: string;
  resourceId?: string | null;
  status?: string;
  finalPrice?: number;
  createdAt?: string;
  completedAt?: string | null;
}

export interface TransactionsMine {
  payments: TransactionPayment[];
  refunds: TransactionRefund[];
  purchases: TransactionPurchase[];
  totals?: { payments?: number; refunds?: number; purchases?: number };
}

export async function fetchTransactionsMine(): Promise<TransactionsMine> {
  const { data } = await api.get<TransactionsMine>("/payments/transactions/mine");
  return data;
}