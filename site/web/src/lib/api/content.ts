// PLAN-019 E-003: content domain API (split from lib/api-ext.ts).
// Articles / dashboard widgets / activity read layer, plus the legacy admin
// article moderation endpoints consumed through the lib/api/admin.ts façade.
import api from "../api";
import type { Pagination } from "@mta-market/shared";

// ---------------------------------------------------------------------
// Articles (PLAN-007: Content Foundation)
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Activity read layer (PLAN-006: Daily Experience)
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// Dashboard widgets
// ---------------------------------------------------------------------

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

export async function fetchDashboardNow(): Promise<DashboardNow> {
  const { data } = await api.get<DashboardNow>("/dashboard/now");
  return data;
}

// ---------------------------------------------------------------------
// Legacy admin article moderation (PLAN-007 D; source of truth for the
// lib/api/admin.ts façade).
// ---------------------------------------------------------------------

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