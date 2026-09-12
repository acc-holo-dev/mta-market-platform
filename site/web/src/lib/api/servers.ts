// PLAN-019 E-003: servers domain API (split from lib/api-ext.ts).
// Servers / server news & updates / global news feed / server reviews +
// review tokens / integration, plus the legacy admin server endpoints
// consumed through the lib/api/admin.ts façade.
import api from "../api";
import type { Pagination, Paginated } from "@mta-market/shared";

// ---------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------
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

export interface ServerResourceCard {
  id: string;
  displayName: string;
  slug: string | null;
  coverUrl: string | null;
  note: string | null;
}

// Active-server staff row (used by GET /servers/:slug/staff). The unused
// duplicate `StaffMember` interface was removed as a dead export (§61).
export interface StaffMemberRow {
  userId: string;
  role: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
}

// ---------------------------------------------------------------------
// Discovery / management
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Server news / updates
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Global news feed
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Server reviews + review tokens
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Legacy admin servers / news / reviews moderation (source of truth for the
// lib/api/admin.ts façade).
// ---------------------------------------------------------------------

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

export async function adminModerateNews(id: string, status: "DRAFT" | "PUBLISHED", reason?: string) {
  const { data } = await api.patch(`/admin/server-news/${id}`, { status, ...(reason ? { reason } : {}) });
  return data;
}

export async function adminModerateServerReview(id: string, status: "VISIBLE" | "HIDDEN", reason?: string) {
  const { data } = await api.patch(`/admin/server-reviews/${id}`, { status, ...(reason ? { reason } : {}) });
  return data;
}