// PLAN-019 E-003: community domain API (split from lib/api-ext.ts).
// Forum / follows (creator + resource + thread) / notifications / reports /
// public profiles, plus the legacy admin report + thread moderation
// endpoints consumed through the lib/api/admin.ts façade.
import api from "../api";
import type { Pagination } from "@mta-market/shared";
import type { Resource } from "./resources";

// ---------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Forum
// ---------------------------------------------------------------------

export async function fetchCommunityHub(): Promise<CommunityHub> {
  const { data } = await api.get<CommunityHub>("/community");
  return data;
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

// ---------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------

export async function createReport(targetType: string, targetId: string, reason: string) {
  const { data } = await api.post("/reports", { targetType, targetId, reason });
  return data;
}

// ---------------------------------------------------------------------
// Public profiles
// ---------------------------------------------------------------------

export async function fetchProfile(username: string): Promise<PublicProfile> {
  const { data } = await api.get<PublicProfile>(`/profiles/${username}`);
  return data;
}

// ---------------------------------------------------------------------
// Follow expansion (PLAN-008/009: creator + resource + thread)
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Legacy admin reports / thread moderation (source of truth for the
// lib/api/admin.ts façade).
// ---------------------------------------------------------------------

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

export async function adminModerateThread(id: string, state?: string, pinned?: boolean) {
  const { data } = await api.patch(`/admin/forum-threads/${id}`, {
    ...(state ? { state } : {}),
    ...(pinned !== undefined ? { pinned } : {}),
  });
  return data;
}