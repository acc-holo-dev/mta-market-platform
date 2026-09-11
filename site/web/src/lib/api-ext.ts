// Typed API helpers + error extraction (M-001..M-003).
// Kept out of lib/api.ts to avoid touching existing client code.
import api from "./api";
import type { User } from "@/store/auth";

// ---------- Error helpers ----------
// Canonical implementation lives in @mta-market/shared; the web wrapper
// keeps re-exporting it (pages import getErrorMessage from this module).
export { getErrorMessage } from "@mta-market/shared";

// ---------- Shared types ----------
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
}

export interface Screenshot {
  id: string;
  url: string;
  position: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
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

export interface Purchase {
  id: string;
  status: string;
  priceSnapshot: number;
  createdAt: string;
  resource: { slug: string; title: string; type: string };
  version?: { version: string } | null;
  license?: { id: string; status: string } | null;
}

export interface Service {
  id: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  price: number;
  deliveryDays: number;
  requirements?: string | null;
}

export interface ServiceOrder {
  id: string;
  status: string;
  finalPrice: number;
  createdAt: string;
  buyerNotes?: string | null;
  service: { slug: string; title: string };
}

export interface Dispute {
  id: string;
  targetType: string;
  status: string;
  reason: string;
  resolution?: string | null;
  createdAt: string;
}

export interface SellerProfile {
  id: string;
  userId: string;
  status: string;
  displayName?: string | null;
  supportInfo?: string | null;
}

// ---------- Auth / profile (PLAN-001 A-003, B-002, C-003, D-002) ----------
export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface Balance {
  available: number; // kopecks
  currency: string;
}

/** GET /auth/me response shape: the profile plus the balance (C-003). */
export type MeUser = User & { createdAt?: string; balance: Balance };

export async function fetchMe(): Promise<MeUser> {
  const { data } = await api.get<MeUser>("/auth/me");
  return data;
}

/** Login with username OR email + password (A-002/A-003). */
export async function loginRequest(login: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/login", { login, password });
  return data;
}

/** Register; the server returns 201 with a session (A-001). */
export async function registerRequest(body: {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/register", body);
  return data;
}

/** PATCH /auth/me — only displayName and avatar are editable (B-002). */
export async function patchProfile(body: { displayName?: string; avatar?: string }): Promise<MeUser> {
  const { data } = await api.patch<MeUser>("/auth/me", body);
  return data;
}

export interface Identity {
  id: string;
  provider: string;
  providerAccountId: string;
}

export async function fetchIdentities(): Promise<Identity[]> {
  const { data } = await api.get<Identity[]>("/auth/identities");
  return data;
}

// ---------- File upload (E-003) ----------
export interface UploadResult {
  fileUrl: string;
  fileKey: string | null;
  fileName: string;
  fileSize: number;
  fileChecksum: string;
  mimeType: string;
  storage: "s3" | "local";
}

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

export async function createResourceVersion(
  slug: string,
  body: CreateVersionBody
): Promise<ResourceVersionCreated> {
  const { data } = await api.post<ResourceVersionCreated>(`/resources/${slug}/versions`, body);
  return data;
}

// ---------- Money formatting (kopecks -> RUB) ----------
export { formatRub } from "@mta-market/shared";

/**
 * PLAN-003 A-002: публичный URL медиа. Сервер отдаёт server-relative
 * /media/... (локальный storage) или абсолютный S3 URL. В dev web и api
 * живут на разных портах — относительный путь резолвится против API base.
 */
export function mediaUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  if (url.startsWith("/media/")) {
    const base = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
    return `${base}${url}`;
  }
  return url;
}

// ---------- Buyer ----------
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

export async function patchReview(slug: string, rating: number, comment: string) {
  const { data } = await api.patch<Review>(`/resources/${slug}/reviews`, { rating, comment });
  return data;
}

export async function createPurchase(resourceSlug: string, discountCode?: string) {
  const { data } = await api.post<
    | {
        status: "completed";
        purchaseId: string;
        licenseId: string;
        orderId: string;
      }
    | {
        status: "pending";
        purchaseId: string;
        amount: number;
        originalAmount: number;
        discount?: { amount: number; percentage: number };
      }
  >("/purchases", discountCode ? { resourceSlug, discountCode } : { resourceSlug });
  return data;
}

export async function createPayment(purchaseId: string) {
  const { data } = await api.post<{ paymentUrl?: string; paymentId?: string; message?: string }>(
    "/payments/create",
    { purchaseId }
  );
  return data;
}

export async function fetchMyPurchases() {
  const { data } = await api.get<Purchase[]>("/purchases/my");
  return data;
}

// ---------- Seller ----------
/**
 * GET /seller/profile — the server wraps the row: { profile: SellerProfile | null }.
 * Returns the unwrapped profile (null when the user has not applied yet).
 */
/** GET /resources/my — the seller's own resources (all statuses). */
export async function fetchMyResources(): Promise<Resource[]> {
  const { data } = await api.get<{ data: Resource[] }>("/resources/my");
  return Array.isArray(data) ? ((data as unknown as { data: Resource[] }).data ?? []) : (data as unknown as Resource[]);
}

export async function fetchSellerProfile(): Promise<SellerProfile | null> {
  const { data } = await api.get<{ profile: SellerProfile | null }>("/seller/profile");
  return data.profile ?? null;
}

export async function applySeller(body: { displayName?: string; supportInfo?: string }) {
  const { data } = await api.post<SellerProfile>("/seller/apply", body);
  return data;
}

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

export async function fetchServices() {
  const { data } = await api.get<{ data: Service[] }>("/services");
  return data.data;
}

export async function fetchService(slug: string) {
  const { data } = await api.get<Service>(`/services/${slug}`);
  return data;
}

export async function fetchMyServices() {
  const { data } = await api.get<{ data: Service[] } | Service[]>("/services/my");
  return Array.isArray(data) ? data : data.data;
}

export async function createService(body: {
  title: string;
  description: string;
  type: string;
  price: number;
  deliveryDays: number;
  requirements?: string;
}) {
  const { data } = await api.post<Service>("/services", body);
  return data;
}

export async function orderService(slug: string, buyerNotes?: string) {
  const { data } = await api.post<{ servicePurchaseId: string; status: string; finalPrice: number }>(
    `/services/${slug}/order`,
    buyerNotes ? { buyerNotes } : {}
  );
  return data;
}

export async function fetchMyServiceOrders() {
  const { data } = await api.get<Paginated<ServiceOrder>>("/services/orders/my");
  return data;
}

export async function serviceOrderAction(id: string, action: string, body?: Record<string, unknown>) {
  const { data } = await api.post(`/services/orders/${id}/${action}`, body ?? {});
  return data;
}

export async function postServiceOrderMessage(id: string, body: string) {
  const { data } = await api.post(`/services/orders/${id}/messages`, { body });
  return data;
}

// ---------- Disputes ----------
export async function createDispute(body: {
  targetType: "PURCHASE" | "SERVICE_PURCHASE";
  purchaseId?: string;
  servicePurchaseId?: string;
  reason: string;
}) {
  const { data } = await api.post<Dispute>("/disputes", body);
  return data;
}

export async function fetchMyDisputes() {
  const { data } = await api.get<Paginated<Dispute>>("/disputes/my");
  return data;
}

export async function fetchDispute(id: string) {
  const { data } = await api.get<{
    dispute: Dispute;
    messages: { id: string; body: string; createdAt: string; authorId?: string }[];
  }>(`/disputes/${id}`);
  return data;
}

export async function postDisputeMessage(id: string, body: string) {
  const { data } = await api.post(`/disputes/${id}/messages`, { body });
  return data;
}

// ---------- Media (PLAN-003 A/B) ----------
/**
 * POST /upload/media — multipart, field "file". Сервер проверяет магические
 * байты и возвращает публичный URL (/media/... или S3). Прогресс через
 * axios onUploadProgress не нужен для файлов до 5 МБ, но состояние
 * uploading/uploaded/failed различается на UI.
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

// ---------- Seller storefront (PLAN-003 E) ----------
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

// ---------- Admin (PLAN-003 M) ----------
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

/** Seller approval queue lives at GET /seller/list (ADMIN only). */
export async function fetchAdminSellers(status?: string) {
  const { data } = await api.get<{ data: SellerProfile[]; total: number }>("/seller/list", {
    params: status ? { status } : {},
  });
  return data;
}

/** Server contract: POST /seller/:userId/approve | /seller/:userId/reject. */
export async function adminSellerAction(userId: string, action: "approve" | "reject", reason?: string) {
  const { data } = await api.post(`/seller/${userId}/${action}`, action === "reject" ? { reason: reason ?? "Отклонено" } : {});
  return data;
}

/** Admin dispute list lives at GET /disputes/admin/all (ADMIN only). */
export async function fetchAdminDisputes(status?: string) {
  const { data } = await api.get<Paginated<Dispute>>("/disputes/admin/all", {
    params: status ? { status } : {},
  });
  return data;
}

export async function adminTransitionDispute(id: string, status: string, resolution?: string) {
  const { data } = await api.post(`/admin/disputes/${id}/transition`, resolution ? { status, resolution } : { status });
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

// =====================================================================
// PLAN-005: Community & Server Foundation — typed API surface
// =====================================================================

// ---------- Servers ----------
export interface ServerCard {
  id: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  accentColor: string | null;
  websiteUrl: string | null;
  discordUrl: string | null;
  region: string | null;
  lifecycle: string;
  verification: string;
  monitoring: string;
  playerCount: number | null;
  maxPlayers: number | null;
  lastSeenAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  followerCount?: number;
  rating?: number | null;
}

export interface ServerFull extends ServerCard {
  showStats: boolean;
  showCommunity: boolean;
  showStaff: boolean;
  showResources: boolean;
}

export interface ServerDetail {
  server: ServerCard & { followerCount: number; rating: number | null };
  caller: { isStaff: boolean; role: string | null };
  privacy: {
    showStats: boolean;
    showStaff: boolean;
    showResources: boolean;
    showCommunity: boolean;
    showTechStack: boolean;
  };
}

export interface StaffMember {
  userId: string;
  role: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
}

export interface ServerResourceCard {
  id: string;
  displayName: string;
  slug: string | null;
  coverUrl: string | null;
  note: string | null;
}

export async function fetchServers(params: {
  q?: string;
  sort?: string;
  page?: number;
  limit?: number;
}) {
  const { data } = await api.get<Paginated<ServerCard>>("/servers", { params });
  return data;
}

export async function fetchServer(slug: string): Promise<ServerDetail> {
  const { data } = await api.get<ServerDetail>(`/servers/${slug}`);
  return data;
}

export async function fetchMyServers() {
  const { data } = await api.get<{ data: ServerFull[] }>("/servers/my");
  return data.data;
}

export interface ServerManage {
  server: ServerFull & { integrationTokenIssuedAt?: string | null; verificationNote?: string | null };
  staffRole: string;
  stats: {
    followerCount: number;
    reviewCount: number;
    rating: number | null;
    draftNewsCount: number;
    resourceCount: number;
  };
  recentNews: ServerNewsItem[];
  recentUpdates: ServerUpdateItem[];
  heartbeat: { staleMs: number; fresh: boolean; lastSeenAt: string | null };
}

export async function fetchServerManage(slug: string): Promise<ServerManage> {
  const { data } = await api.get<ServerManage>(`/servers/${slug}/manage`);
  return data;
}

export async function createServer(payload: {
  name: string;
  description?: string;
  host?: string | null;
  port?: number | null;
  region?: string | null;
  websiteUrl?: string | null;
  discordUrl?: string | null;
}) {
  const { data } = await api.post<ServerFull>("/servers", payload);
  return data;
}

export async function updateServer(slug: string, patch: Record<string, unknown>) {
  const { data } = await api.patch<ServerFull>(`/servers/${slug}`, patch);
  return data;
}

export async function updateServerPrivacy(slug: string, patch: Record<string, boolean>) {
  const { data } = await api.patch<ServerFull>(`/servers/${slug}/privacy`, patch);
  return data;
}

export async function archiveServer(slug: string) {
  const { data } = await api.delete(`/servers/${slug}`);
  return data;
}

export async function issueIntegrationToken(slug: string) {
  const { data } = await api.post<{ token: string; server: ServerFull }>(
    `/servers/${slug}/integration-token`
  );
  return data;
}

export async function fetchVerification(slug: string) {
  const { data } = await api.get<{
    verification: string;
    note: string | null;
    verifiedAt: string | null;
    issuedAt: string | null;
    hasToken: boolean;
  }>(`/servers/${slug}/verification`);
  return data;
}

export async function fetchServerStaff(slug: string) {
  const { data } = await api.get<{ visible: boolean; data: StaffMemberRow[] }>(
    `/servers/${slug}/staff`
  );
  return data;
}

export interface StaffMemberRow {
  userId: string;
  role: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
}

export async function addServerStaff(slug: string, userId: string, role: "ADMIN" | "MODERATOR") {
  const { data } = await api.post(`/servers/${slug}/staff`, { userId, role });
  return data;
}

export async function removeServerStaff(slug: string, userId: string) {
  const { data } = await api.delete(`/servers/${slug}/staff/${userId}`);
  return data;
}

export async function fetchServerResources(slug: string) {
  const { data } = await api.get<{ enabled: boolean; data: ServerResourceCard[] }>(
    `/servers/${slug}/resources`
  );
  return data;
}

export async function linkServerResource(
  slug: string,
  payload: { resourceId?: string; displayName?: string; note?: string }
) {
  const { data } = await api.post(`/servers/${slug}/resources`, payload);
  return data;
}

export async function unlinkServerResource(slug: string, rowId: string) {
  const { data } = await api.delete(`/servers/${slug}/resources/${rowId}`);
  return data;
}

export async function followServer(slug: string) {
  const { data } = await api.post<{ following: boolean }>(`/servers/${slug}/follow`);
  return data;
}

export async function unfollowServer(slug: string) {
  const { data } = await api.delete<{ following: boolean }>(`/servers/${slug}/follow`);
  return data;
}

export async function fetchServerStatistics(slug: string, range: string) {
  const { data } = await api.get<{
    enabled: boolean;
    range: { hours: number; label: string };
    data: {
      peak: number | null;
      average: number | null;
      uptimePct: number | null;
      sampleCount: number;
      current: { state: string; players: number | null; maxPlayers: number | null; lastSeenAt: string | null };
      samples: { t: string; players: number; state: string }[];
    } | null;
  }>(`/servers/${slug}/statistics`, { params: { range } });
  return data;
}

// ---------- Server news / updates ----------
export interface ServerNewsItem {
  id: string;
  serverId: string;
  authorId: string;
  title: string;
  content: string;
  coverUrl: string | null;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  thread?: { id: string; title: string; replyCount: number } | null;
}

export interface ServerUpdateItem {
  id: string;
  serverId: string;
  version: string;
  title: string;
  changelog: string;
  publishedAt: string;
}

export async function fetchServerNews(slug: string, page = 1) {
  const { data } = await api.get<Paginated<ServerNewsItem>>(`/servers/${slug}/news`, {
    params: { page },
  });
  return data;
}

export async function fetchServerNewsItem(slug: string, id: string) {
  const { data } = await api.get<{
    news: ServerNewsItem;
    thread: { id: string; title: string; replyCount: number; state: string } | null;
    author: { username: string | null; displayName: string | null; avatar: string | null } | null;
    server: { slug: string; name: string };
  }>(`/servers/${slug}/news/${id}`);
  return data;
}

export async function createServerNews(
  slug: string,
  payload: { title: string; content: string; coverUrl?: string | null }
) {
  const { data } = await api.post<ServerNewsItem>(`/servers/${slug}/news`, payload);
  return data;
}

export async function updateServerNews(slug: string, id: string, patch: Record<string, unknown>) {
  const { data } = await api.patch<ServerNewsItem>(`/servers/${slug}/news/${id}`, patch);
  return data;
}

export async function publishServerNews(
  slug: string,
  id: string,
  createDiscussion?: boolean
) {
  const { data } = await api.post<{ news: ServerNewsItem; thread: { id: string } | null }>(
    `/servers/${slug}/news/${id}/publish`,
    { ...(createDiscussion ? { createDiscussion: true } : {}) }
  );
  return data;
}

export async function deleteServerNews(slug: string, id: string) {
  const { data } = await api.delete(`/servers/${slug}/news/${id}`);
  return data;
}

export async function fetchServerUpdates(slug: string, page = 1) {
  const { data } = await api.get<Paginated<ServerUpdateItem>>(`/servers/${slug}/updates`, {
    params: { page },
  });
  return data;
}

export async function createServerUpdate(
  slug: string,
  payload: { version: string; title: string; changelog: string; createDiscussion?: boolean }
) {
  const { data } = await api.post<ServerUpdateItem>(`/servers/${slug}/updates`, payload);
  return data;
}

export async function deleteServerUpdate(slug: string, id: string) {
  const { data } = await api.delete(`/servers/${slug}/updates/${id}`);
  return data;
}

// ---------- Global news feed ----------
export interface NewsFeedItem {
  kind: "NEWS" | "UPDATE";
  id: string;
  version?: string;
  title: string;
  preview: string;
  coverUrl?: string | null;
  publishedAt: string;
  server: { id: string; slug: string; name: string; logoUrl: string | null } | null;
  author: { username: string | null; displayName: string | null; avatar: string | null } | null;
}

export async function fetchNewsFeed(kind: "all" | "news" | "updates" = "all", page = 1) {
  const { data } = await api.get<{ data: NewsFeedItem[] }>("/news", {
    params: { kind, page },
  });
  return data;
}

// ---------- Server reviews + tokens ----------
export interface ServerReviewItem {
  id: string;
  rating: number;
  comment: string | null;
  verifiedInteraction: boolean;
  createdAt: string;
  updatedAt?: string;
  author: { id: string; username: string | null; displayName: string | null; avatar: string | null };
}

export async function fetchServerReviews(slug: string, page = 1) {
  const { data } = await api.get<{
    data: ServerReviewItem[];
    stats: { total: number; averageRating: number | null; verifiedCount: number };
    pagination: Pagination;
  }>(`/servers/${slug}/reviews`, { params: { page } });
  return data;
}

export async function fetchReviewEligibility(slug: string) {
  const { data } = await api.get<{
    eligible: boolean;
    reason: string | null;
    verifiedInteraction: boolean;
  }>(`/servers/${slug}/reviews/eligibility`);
  return data;
}

export async function claimReviewToken(slug: string, token: string) {
  const { data } = await api.post<{ eligible: boolean }>(`/servers/${slug}/review-token/claim`, {
    token,
  });
  return data;
}

export async function createServerReview(slug: string, rating: number, comment?: string | null) {
  const { data } = await api.post<ServerReviewItem>(`/servers/${slug}/reviews`, {
    rating,
    comment: comment ?? null,
  });
  return data;
}

export async function deleteServerReview(slug: string) {
  const { data } = await api.delete(`/servers/${slug}/reviews`);
  return data;
}

// ---------- Community / forum ----------
export interface ForumCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  position: number;
  threadCount?: number;
}

export interface ThreadCard {
  id: string;
  title: string;
  state: string;
  pinned?: boolean;
  replyCount: number;
  views?: number;
  lastPostAt: string | null;
  createdAt: string;
  author: { username: string | null; displayName: string | null; avatar: string | null } | null;
}

export interface CommunityHub {
  categories: ForumCategory[];
  latest: ThreadCard[];
  active: ThreadCard[];
  pinned: ThreadCard[];
  recentActivity: {
    postId: string;
    threadId: string;
    threadTitle: string | null;
    author: { username: string | null; displayName: string | null; avatar: string | null } | null;
    createdAt: string;
  }[];
}

export async function fetchCommunityHub(): Promise<CommunityHub> {
  const { data } = await api.get<CommunityHub>("/community");
  return data;
}

export async function fetchForumCategories() {
  const { data } = await api.get<{ data: ForumCategory[] }>("/community/categories");
  return data.data;
}

export async function fetchCategoryThreads(slug: string, page = 1) {
  const { data } = await api.get<{
    category: ForumCategory;
    data: ThreadCard[];
    pagination: Pagination;
  }>(`/community/categories/${slug}/threads`, { params: { page } });
  return data;
}

export async function createForumThread(
  categorySlug: string,
  payload: { title: string; content: string; serverId?: string }
) {
  const { data } = await api.post<{ id: string }>(
    `/community/categories/${encodeURIComponent(categorySlug)}/threads`,
    payload
  );
  return data;
}

export interface ForumThreadDetail {
  thread: ThreadCard & { newsId?: string | null; serverId?: string | null; categoryId: string };
  // PLAN-009: aggregate thread-follower count (top-level; §42 — no lists).
  followersCount?: number;
  category: { id: string; slug: string; name: string } | null;
  server: { id: string; slug: string; name: string } | null;
  data: ForumPostItem[];
  pagination: Pagination;
}

export interface ForumPostItem {
  id: string;
  content: string | null;
  deleted: boolean;
  edited: boolean;
  position: number;
  createdAt: string;
  author: { id: string; username: string | null; displayName: string | null; avatar: string | null };
  reactionCount: number;
  reactedByMe: string[];
}

export async function fetchThread(id: string, page = 1) {
  const { data } = await api.get<ForumThreadDetail>(`/community/threads/${id}`, {
    params: { page },
  });
  return data;
}

export async function replyToThread(id: string, content: string) {
  const { data } = await api.post<ForumPostItem>(`/community/threads/${id}/posts`, { content });
  return data;
}

export async function editForumPost(id: string, content: string) {
  const { data } = await api.patch(`/community/posts/${id}`, { content });
  return data;
}

export async function deleteForumPost(id: string) {
  const { data } = await api.delete(`/community/posts/${id}`);
  return data;
}

export async function toggleReaction(postId: string, kind = "LIKE") {
  const { data } = await api.put<{ reacted: boolean; kind: string }>(
    `/community/posts/${postId}/reactions/${kind}`
  );
  return data;
}

export async function setThreadState(id: string, state?: string, pinned?: boolean) {
  const { data } = await api.post(`/community/threads/${id}/state`, {
    ...(state ? { state } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
  });
  return data;
}

export async function fetchServerCommunityThreads(slug: string, page = 1) {
  const { data } = await api.get<{ enabled: boolean; data: ThreadCard[]; pagination?: Pagination }>(
    `/community/servers/${slug}/threads`,
    { params: { page } }
  );
  return data;
}

export async function fetchServerCommunityMembers(slug: string) {
  const { data } = await api.get<{
    enabled: boolean;
    followerCount: number;
    data: { userId: string; joinedAt: string; username: string | null; displayName: string | null; avatar: string | null }[];
  }>(`/community/servers/${slug}/members`);
  return data;
}

// ---------- Notifications ----------
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function fetchNotifications(filter: "all" | "unread" = "all", page = 1) {
  const { data } = await api.get<{
    data: NotificationItem[];
    unreadCount: number;
    pagination: Pagination;
  }>("/notifications", { params: { filter, page } });
  return data;
}

export async function markNotificationRead(id: string) {
  const { data } = await api.post(`/notifications/${id}/read`);
  return data;
}

export async function markAllNotificationsRead() {
  const { data } = await api.post("/notifications/read-all");
  return data;
}

// ---------- Reports ----------
export async function createReport(targetType: string, targetId: string, reason: string) {
  const { data } = await api.post("/reports", { targetType, targetId, reason });
  return data;
}

// ---------- Profiles ----------
export interface PublicProfile {
  profile: {
    username: string;
    displayName: string;
    avatar: string | null;
    memberSince: string;
  };
  badges: string[];
  servers: {
    id: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    bannerUrl: string | null;
    monitoring: string;
    playerCount: number | null;
    maxPlayers: number | null;
    verification: string;
    followerCount: number;
  }[];
  resources: Resource[];
  forumActivity: { threadCount: number; postCount: number };
  // PLAN-007 E-003: published articles of the author (additive).
  articles?: {
    slug: string;
    title: string;
    excerpt: string;
    coverUrl: string | null;
    category: string;
    publishedAt: string;
  }[];
}

export async function fetchProfile(username: string): Promise<PublicProfile> {
  const { data } = await api.get<PublicProfile>(`/profiles/${username}`);
  return data;
}

// ---------- Search ----------
export interface SearchResults {
  query: string;
  resources: { count: number; data: Partial<Resource>[] };
  servers: { count: number; data: ServerCard[] };
  threads: { count: number; data: ThreadCard[] };
  // PLAN-007 E-004: articles group (additive; older caches may omit it).
  articles?: { count: number; data: ArticleCard[] };
}

export async function search(q: string): Promise<SearchResults> {
  const { data } = await api.get<SearchResults>("/search", { params: { q } });
  return data;
}

// ---------- Dashboard community widgets ----------
export interface DashboardCommunity {
  ownedServers: {
    id: string;
    slug: string;
    name: string;
    monitoring: string;
    playerCount: number | null;
    maxPlayers: number | null;
    lifecycle: string;
    verification: string;
  }[];
  following: { slug: string; name: string; monitoring: string }[];
  followedNews: { id: string; title: string; server: { slug: string; name: string } | null; publishedAt: string }[];
  updates: { id: string; version: string; title: string; serverSlug: string | null; publishedAt: string }[];
  discussions: { id: string; title: string; replyCount: number; lastPostAt: string | null; state: string }[];
  unreadNotifications: number;
}

export async function fetchDashboardCommunity(): Promise<DashboardCommunity> {
  const { data } = await api.get<DashboardCommunity>("/dashboard/community");
  return data;
}

// ---------- Admin: servers / reports / community moderation ----------
export interface AdminServerRow extends ServerCard {
  host: string | null;
  port: number | null;
  ownerId: string;
  showStats: boolean;
  showStaff: boolean;
  showResources: boolean;
  showCommunity: boolean;
  showTechStack: boolean;
  verificationNote: string | null;
  owner?: { id: string; username: string | null; displayName: string | null } | null;
}

export async function fetchAdminServers(lifecycle?: string, page = 1) {
  const { data } = await api.get<Paginated<AdminServerRow>>("/admin/servers", {
    params: { ...(lifecycle ? { lifecycle } : {}), page },
  });
  return data;
}

export async function fetchAdminServerDetail(id: string) {
  const { data } = await api.get<{
    server: AdminServerRow;
    owner: { id: string; username: string; email: string; displayName: string | null } | null;
    counts: { followers: number; reviews: number; resources: number };
    recentNews: ServerNewsItem[];
  }>(`/admin/servers/${id}`);
  return data;
}

export async function adminServerLifecycle(id: string, lifecycle: string, reason?: string) {
  const { data } = await api.patch(`/admin/servers/${id}/status`, { lifecycle, ...(reason ? { reason } : {}) });
  return data;
}

export async function adminServerVerification(id: string, verification: string, note?: string) {
  const { data } = await api.patch(`/admin/servers/${id}/verification`, { verification, ...(note ? { note } : {}) });
  return data;
}

export interface AdminReport {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  status: string;
  resolution: string | null;
  createdAt: string;
  reporter?: { id: string; username: string | null; displayName: string | null } | null;
}

export async function fetchAdminReports(status: string = "OPEN") {
  const { data } = await api.get<{ data: AdminReport[] }>("/admin/reports", {
    params: { status },
  });
  return data;
}

export async function adminResolveReport(id: string, status: "RESOLVED" | "DISMISSED", resolution?: string) {
  const { data } = await api.post(`/admin/reports/${id}/resolve`, { status, ...(resolution ? { resolution } : {}) });
  return data;
}

export async function adminModerateNews(id: string, status: "DRAFT" | "PUBLISHED", reason?: string) {
  const { data } = await api.patch(`/admin/server-news/${id}`, { status, ...(reason ? { reason } : {}) });
  return data;
}

export async function adminModerateServerReview(id: string, status: "VISIBLE" | "HIDDEN", reason?: string) {
  const { data } = await api.patch(`/admin/server-reviews/${id}`, { status, ...(reason ? { reason } : {}) });
  return data;
}

export async function adminModerateThread(id: string, state?: string, pinned?: boolean) {
  const { data } = await api.patch(`/admin/forum-threads/${id}`, {
    ...(state ? { state } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
  });
  return data;
}

// ---------- PLAN-006: Daily Experience (activity read layer) ----------
export interface ActivityItem {
  type: string;
  at: string;
  href: string;
  title?: string | null;
  server?: { slug: string; name: string; logoUrl: string | null } | null;
  resource?: {
    slug: string;
    title: string;
    coverUrl: string | null;
    sellerName?: string | null;
  } | null;
  article?: {
    slug: string;
    title: string;
    coverUrl: string | null;
    category: string;
  } | null;
  thread?: { id: string; title: string; replyCount: number } | null;
  author?: { username: string | null; displayName: string | null; avatar: string | null } | null;
  version?: string | null;
  count?: number | null;
  review?: { rating: number; verified?: boolean } | null;
}

export interface ActivityLive {
  playersOnline: number;
  serversOnline: number;
  computedAt: string;
}

export interface ActivitySnapshot {
  live: ActivityLive;
  items: ActivityItem[];
  popular: {
    servers: {
      slug: string;
      name: string;
      logoUrl: string | null;
      playerCount: number | null;
      maxPlayers: number | null;
      monitoring: string;
    }[];
    discussions: { id: string; title: string; replyCount: number; views: number }[];
  };
  generatedAt: string;
}

export async function fetchActivity(): Promise<ActivitySnapshot> {
  const { data } = await api.get<ActivitySnapshot>("/activity?limit=14");
  return data;
}



export async function fetchDashboardNow(): Promise<DashboardNow> {
  const { data } = await api.get<DashboardNow>("/dashboard/now");
  return data;
}

// ---------- PLAN-007: admin content moderation (D) ----------
export interface AdminArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  status: string;
  createdAt: string;
  author: { username: string | null; displayName: string | null } | null;
}

export async function fetchAdminArticles(status = "PENDING_REVIEW"): Promise<{ data: AdminArticle[] }> {
  const { data } = await api.get("/admin/content", { params: { status } });
  return data;
}

export async function adminArticleAction(
  id: string,
  action: "approve" | "reject" | "hide",
  reason?: string
) {
  const { data } = await api.post(`/admin/content/${id}/${action}`, action === "approve" ? {} : { reason });
  return data;
}

// ---------- PLAN-010: Creator Analytics (honest demand signal) ----------
export async function countResourceView(slug: string): Promise<void> {
  try {
    await api.post(`/resources/${encodeURIComponent(slug)}/view`);
  } catch {
    // fire-and-forget: a failed counter never breaks the page
  }
}

export interface SellerAnalytics {
  days: number;
  totalViews: number;
  totalPurchases: number;
  byResource: {
    resourceId: string;
    slug: string;
    title: string;
    views30d: number;
    purchases30d: number;
    conversionPct: number | null;
  }[];
}

export async function fetchSellerAnalytics(): Promise<SellerAnalytics> {
  const { data } = await api.get("/seller/analytics");
  return data;
}

// ---------- PLAN-008: Follow Expansion (Creator + Resource) ----------
export async function followCreator(username: string) {
  const { data } = await api.post(`/creators/${encodeURIComponent(username)}/follow`);
  return data as { following: boolean; creatorFollowers: number };
}

export async function unfollowCreator(username: string) {
  const { data } = await api.delete(`/creators/${encodeURIComponent(username)}/follow`);
  return data as { following: boolean; creatorFollowers: number };
}

export async function followResource(slug: string) {
  const { data } = await api.post(`/resources/${encodeURIComponent(slug)}/follow`);
  return data as { following: boolean; resourceFollowers: number };
}

export async function unfollowResource(slug: string) {
  const { data } = await api.delete(`/resources/${encodeURIComponent(slug)}/follow`);
  return data as { following: boolean; resourceFollowers: number };
}

export async function fetchMyCreatorFollows(): Promise<{ username: string; displayName: string | null; avatar: string | null }[]> {
  const { data } = await api.get("/me/follows/creators");
  return data.data ?? [];
}

export async function fetchMyResourceFollows(): Promise<{ slug: string; title: string; coverUrl: string | null }[]> {
  const { data } = await api.get("/me/follows/resources");
  return data.data ?? [];
}

// PLAN-009: thread follow (Community Loop completion).
export async function followThread(threadId: string) {
  const { data } = await api.post(`/community/forum/thread/${threadId}/follow`);
  return data as { following: boolean; followersCount: number };
}

export async function unfollowThread(threadId: string) {
  const { data } = await api.delete(`/community/forum/thread/${threadId}/follow`);
  return data as { following: boolean; followersCount: number };
}

export async function fetchMyThreadFollows(): Promise<
  { id: string; title: string; state: string; replyCount: number; lastPostAt: string | null }[]
> {
  const { data } = await api.get("/me/follows/threads");
  return data.data ?? [];
}

// ---------- PLAN-007: Content Foundation (articles) ----------
export interface ArticleCard {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  coverUrl: string | null;
  category: string;
  tags?: string | null;
  publishedAt: string;
  author: { username: string | null; displayName: string | null; avatar: string | null } | null;
  replyCount: number;
}

export interface ArticleDetail {
  id: string;
  slug: string;
  title: string;
  content: string;
  coverUrl: string | null;
  category: string;
  tags: string | null;
  publishedAt: string;
  author: { id: string; username: string | null; displayName: string | null; avatar: string | null } | null;
  thread: { id: string; replyCount: number } | null;
  resources: {
    slug: string;
    title: string;
    coverUrl: string | null;
    price: number;
    type: string;
  }[];
  servers: {
    slug: string;
    name: string;
    logoUrl: string | null;
    monitoring: string;
    playerCount: number | null;
    maxPlayers: number | null;
  }[];
}

export interface ArticleStatus {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  status: "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "ARCHIVED";
  reviewNote: string | null;
  publishedAt: string | null;
  createdAt: string;
  threadId: string | null;
  replyCount: number;
}

export async function fetchContentHub(
  category?: string,
  page = 1
): Promise<{ data: ArticleCard[]; pagination: Pagination }> {
  const { data } = await api.get("/content", {
    params: { ...(category ? { category } : {}), page, limit: 9 },
  });
  return data;
}

export async function fetchArticle(slug: string): Promise<ArticleDetail> {
  const { data } = await api.get<ArticleDetail>(`/content/articles/${slug}`);
  return data;
}

export async function fetchMyArticles(): Promise<{ data: ArticleStatus[] }> {
  const { data } = await api.get("/content/mine");
  return data;
}

export async function createArticle(body: {
  title: string;
  content: string;
  category: string;
  tags?: string;
  coverUrl?: string | null;
  resourceIds?: string[];
  serverIds?: string[];
}) {
  const { data } = await api.post("/content", body);
  return data;
}

export async function updateArticle(
  id: string,
  body: { title?: string; content?: string; category?: string; tags?: string; coverUrl?: string | null }
) {
  const { data } = await api.patch(`/content/${id}`, body);
  return data;
}

export async function submitArticle(id: string) {
  const { data } = await api.post(`/content/${id}/submit`);
  return data;
}

export async function createArticleDiscussion(id: string) {
  const { data } = await api.post(`/content/${id}/discussion`);
  return data;
}


// PLAN-008: dashboard summary — follow-related rows (additive).
export interface DashboardNow {
  since: string;
  firstVisit: boolean;
  unreadNotifications: number;
  serverUpdates: {
    count: number;
    items: {
      id: string;
      version: string;
      title: string;
      publishedAt: string;
      server: { slug: string; name: string } | null;
    }[];
  };
  serverNews: {
    count: number;
    items: {
      id: string;
      title: string;
      publishedAt: string;
      server: { slug: string; name: string } | null;
    }[];
  };
  discussionReplies: {
    count: number;
    items: { threadId: string; threadTitle: string | null; createdAt: string }[];
  };
  purchasedUpdates: {
    count: number;
    items: {
      id: string;
      version: string;
      publishedAt: string;
      resource: { slug: string; title: string } | null;
    }[];
  };
  creatorUpdates?: {
    count: number;
    items: {
      id: string;
      version: string;
      publishedAt: string;
      resource: { slug: string; title: string } | null;
    }[];
  };
  followedResourceUpdates?: {
    count: number;
    items: {
      id: string;
      version: string;
      publishedAt: string;
      resource: { slug: string; title: string } | null;
    }[];
  };
  followedThreadReplies?: {
    count: number;
    items: { threadId: string; threadTitle: string | null; createdAt: string }[];
  };
}
