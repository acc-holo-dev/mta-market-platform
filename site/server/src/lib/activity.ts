// PLAN-006 Workstreams B/C/D/E/H: Daily Experience Foundation read-layer.
//
// Activity is a DERIVED aggregation layer (DAILY-EXPERIENCE §17/§45): the
// sources of truth remain Server / Resource / Forum / ServerNews /
// ServerUpdate / Review. Nothing here writes to those domains — every item
// is computed from bounded, indexed window queries over existing tables and
// merged deterministically (chronological + type priority, no ML §19).
//
// Publicity rules (PLAN-006 E, DAILY-EXPERIENCE §41–42) are enforced HERE,
// at the read layer, not by hiding things in the UI:
// - only public entity states (PUBLISHED news/resources/versions, VISIBLE
//   reviews, non-deleted posts, VERIFIED/ACTIVE servers);
// - showStats=false servers never feed live aggregates or SERVER_ONLINE;
// - showCommunity=false servers' linked threads never produce items;
// - purchases/likes/views/reactions NEVER become activity items.
import { db } from "../prisma/db";
import { redis } from "./redis";
import { logger } from "./logger";

export const PUBLIC_SERVER_LIFECYCLES = ["VERIFIED", "ACTIVE"] as const;

// PLAN-006 C-002: fixed activity window (days). Configurable, capped at 30.
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = Math.min(Math.max(parseInt(process.env.ACTIVITY_WINDOW_DAYS || "7", 10) || 7, 1), 30);

// PLAN-006 K-001: cache TTL — a fast signal, not a monitor (§4).
const CACHE_TTL_SECONDS = 45;
const LIVE_CACHE_KEY = "plan006:activity:live:v1";
const snapshotCacheKey = (limit: number) => `plan006:activity:snapshot:v1:${limit}`;

export type ActivityType =
  | "SERVER_ONLINE"
  | "SERVER_UPDATE"
  | "SERVER_NEWS"
  | "NEW_SERVER"
  | "RESOURCE_RELEASE"
  | "RESOURCE_UPDATE"
  | "NEW_DISCUSSION"
  | "DISCUSSION_REPLY"
  | "NEW_REVIEW"
  // PLAN-007: Content Foundation (the slot reserved by PLAN-006 D-001).
  | "NEW_ARTICLE";

// PLAN-006 D-004: deterministic priority when timestamps are close.
// PLAN-007: NEW_ARTICLE is a high-value event (DAILY-EXPERIENCE §40) with
// the same tier as NEW_SERVER.
const TYPE_PRIORITY: Record<ActivityType, number> = {
  SERVER_UPDATE: 6,
  RESOURCE_RELEASE: 6,
  NEW_SERVER: 5,
  NEW_ARTICLE: 5,
  SERVER_NEWS: 4,
  RESOURCE_UPDATE: 4,
  SERVER_ONLINE: 3,
  NEW_DISCUSSION: 3,
  NEW_REVIEW: 2,
  DISCUSSION_REPLY: 1,
};

export interface ActivityItem {
  type: ActivityType;
  at: string; // real event time (ISO)
  href: string; // deep link destination (§43)
  server?: {
    slug: string;
    name: string;
    logoUrl: string | null;
  } | null;
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
  author?: {
    username: string | null;
    displayName: string | null;
    avatar: string | null;
  } | null;
  version?: string | null;
  count?: number | null;
  title?: string | null;
  review?: { rating: number; verified?: boolean } | null;
}

export interface LiveAggregates {
  playersOnline: number;
  serversOnline: number;
  computedAt: string;
}

export interface PopularBlock {
  servers: {
    slug: string;
    name: string;
    logoUrl: string | null;
    playerCount: number | null;
    maxPlayers: number | null;
    monitoring: string;
  }[];
  discussions: {
    id: string;
    title: string;
    replyCount: number;
    views: number;
  }[];
}

// ---------- cache helpers (fail-open, like the bulk rate limiter) ----------

async function cached<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // Redis outage must never break the read layer
  }
}

async function storeCache(key: string, value: unknown): Promise<void> {
  try {
    await redis.set(key, JSON.stringify(value), "EX", CACHE_TTL_SECONDS);
  } catch (error) {
    logger.warn("activity_cache_write_failed", { error });
  }
}

// Cache invalidation on high-value mutations (publish news/update, resource
// release, new thread/review). The TTL stays as the safety net for sources
// without a natural write hook (heartbeat-driven SERVER_ONLINE, replies).
export async function bustActivityCache(): Promise<void> {
  try {
    const keys = [LIVE_CACHE_KEY];
    for (let limit = 5; limit <= 50; limit += 5) keys.push(snapshotCacheKey(limit));
    await redis.del(...keys);
  } catch {
    // fail-open: TTL will expire the stale snapshot anyway
  }
}

// ---------- WORKSTREAM B: live aggregates ----------

// B-002 honesty rules: only VERIFIED/ACTIVE + ONLINE + showStats=true
// servers with a real playerCount are counted. UNKNOWN ≠ ONLINE, OFFLINE is
// not online, suspended/pending servers do not exist publicly.
export async function computeLiveAggregates(): Promise<LiveAggregates> {
  const rows = await db.orm.public.Server
    .where((s: any) => s.lifecycle.in(PUBLIC_SERVER_LIFECYCLES as unknown as string[]))
    .where({ monitoring: "ONLINE", showStats: true })
    .select("id", "playerCount")
    .limit(1000)
    .all();

  let playersOnline = 0;
  let serversOnline = 0;
  for (const s of rows) {
    const players = s.playerCount as number | null;
    if (players === null || players === undefined || !Number.isFinite(players)) continue;
    playersOnline += players;
    serversOnline += 1;
  }
  return { playersOnline, serversOnline, computedAt: new Date().toISOString() };
}

export async function getLiveAggregates(): Promise<LiveAggregates> {
  const hit = await cached<LiveAggregates>(LIVE_CACHE_KEY);
  if (hit) return hit;
  const fresh = await computeLiveAggregates();
  await storeCache(LIVE_CACHE_KEY, fresh);
  return fresh;
}

// ---------- shared lookups ----------

async function publicServersByIds(ids: string[]) {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return new Map<string, any>();
  const rows = await db.orm.public.Server
    .where((s: any) => s.id.in(unique))
    .select("id", "slug", "name", "logoUrl", "lifecycle", "showStats", "showCommunity", "playerCount", "maxPlayers", "monitoring")
    .all();
  return new Map(rows.map((s: any) => [s.id, s]));
}

const isPublicServer = (s: any): boolean =>
  !!s && (PUBLIC_SERVER_LIFECYCLES as readonly string[]).includes(s.lifecycle);

async function publishedResourcesByIds(ids: string[]) {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return new Map<string, any>();
  const rows = await db.orm.public.Resource
    .where((r: any) => r.id.in(unique))
    .select("id", "slug", "title", "coverUrl", "status", "sellerId")
    .all();
  return new Map(rows.filter((r: any) => r.status === "PUBLISHED").map((r: any) => [r.id, r]));
}

async function usersByIds(ids: string[]) {
  const unique = Array.from(new Set(ids));
  if (!unique.length) return new Map<string, any>();
  const rows = await db.orm.public.User
    .where((u: any) => u.id.in(unique))
    .select("id", "username", "displayName", "avatar")
    .all();
  return new Map(rows.map((u: any) => [u.id, u]));
}

// ---------- WORKSTREAM C/D: source builders ----------

// PLAN-007 F-001: NEW_ARTICLE — published articles within the window. Only
// PUBLISHED rows exist publicly; DRAFT/PENDING/ARCHIVED never appear.
async function buildArticleItems(since: string): Promise<ActivityItem[]> {
  const rows = await db.orm.public.Article
    .where({ status: "PUBLISHED" })
    .where((a: any) => (a.publishedAt ?? a.createdAt).gte(since))
    .orderBy((a: any) => (a.publishedAt ?? a.createdAt).desc())
    .limit(8)
    .all();
  const authorIds = Array.from(new Set(rows.map((a: any) => a.authorId as string)));
  const authors = authorIds.length
    ? await db.orm.public.User
        .where((u: any) => u.id.in(authorIds))
        .select("id", "username", "displayName", "avatar")
        .all()
    : [];
  const authorById = new Map(authors.map((u: any) => [u.id, u]));
  return rows.map((a: any) => {
    const author = authorById.get(a.authorId);
    return {
      type: "NEW_ARTICLE" as const,
      at: a.publishedAt ?? a.createdAt,
      href: `/content/articles/${a.slug}`,
      article: {
        slug: a.slug as string,
        title: a.title as string,
        coverUrl: a.coverUrl ?? null,
        category: a.category as string,
      },
      author: author
        ? {
            username: author.username ?? null,
            displayName: author.displayName ?? null,
            avatar: author.avatar ?? null,
          }
        : null,
      title: a.title,
    } satisfies ActivityItem;
  });
}

async function buildServerUpdateItems(since: string): Promise<ActivityItem[]> {
  const rows = await db.orm.public.ServerUpdate
    .where((u: any) => u.publishedAt.gte(since))
    .orderBy((u: any) => u.publishedAt.desc())
    .limit(8)
    .all();
  const servers = await publicServersByIds(rows.map((u: any) => u.serverId as string));
  return rows
    .filter((u: any) => isPublicServer(servers.get(u.serverId)))
    .map((u: any) => {
      const server = servers.get(u.serverId);
      return {
        type: "SERVER_UPDATE" as const,
        at: u.publishedAt,
        href: `/servers/${server.slug}`,
        server: { slug: server.slug, name: server.name, logoUrl: server.logoUrl ?? null },
        version: u.version,
        title: u.title,
      } satisfies ActivityItem;
    });
}

async function buildServerNewsItems(since: string): Promise<ActivityItem[]> {
  const rows = await db.orm.public.ServerNews
    .where({ status: "PUBLISHED" })
    .orderBy((n: any) => (n.publishedAt ?? n.createdAt).desc())
    .limit(10)
    .all();
  const inWindow = rows.filter((n: any) => new Date(n.publishedAt ?? n.createdAt).getTime() >= Date.parse(since));
  const servers = await publicServersByIds(inWindow.map((n: any) => n.serverId as string));
  return inWindow
    .filter((n: any) => isPublicServer(servers.get(n.serverId)))
    .map((n: any) => {
      const server = servers.get(n.serverId);
      return {
        type: "SERVER_NEWS" as const,
        at: n.publishedAt ?? n.createdAt,
        href: `/servers/${server.slug}/news/${n.id}`,
        server: { slug: server.slug, name: server.name, logoUrl: server.logoUrl ?? null },
        title: n.title,
      } satisfies ActivityItem;
    });
}

async function buildNewServerItems(since: string): Promise<ActivityItem[]> {
  const rows = await db.orm.public.Server
    .where((s: any) => s.lifecycle.in(PUBLIC_SERVER_LIFECYCLES as unknown as string[]))
    .where((s: any) => s.verifiedAt.gte(since))
    .orderBy((s: any) => s.verifiedAt.desc())
    .limit(5)
    .all();
  return rows.map((s: any) => ({
    type: "NEW_SERVER" as const,
    at: s.verifiedAt,
    href: `/servers/${s.slug}`,
    server: { slug: s.slug, name: s.name, logoUrl: s.logoUrl ?? null },
    title: s.name,
  })) satisfies ActivityItem[];
}

// D-003: SERVER_ONLINE derived from real monitoring samples — a server that
// is ONLINE now and crossed into ONLINE at the window boundary. Bounded:
// only the K most recently seen eligible servers are inspected (2 indexed
// point queries each on [serverId, sampledAt]). Ambiguous histories are
// skipped, never fabricated.
async function buildServerOnlineItems(since: string, sinceMs: number): Promise<ActivityItem[]> {
  const candidates = (
    await db.orm.public.Server
      .where((s: any) => s.lifecycle.in(PUBLIC_SERVER_LIFECYCLES as unknown as string[]))
      .where({ monitoring: "ONLINE", showStats: true })
      .select("id", "slug", "name", "logoUrl", "createdAt", "lastSeenAt")
      .orderBy((s: any) => s.lastSeenAt.desc())
      .limit(12)
      .all()
  ).filter((s: any) => !!s.lastSeenAt);

  const items: ActivityItem[] = [];
  for (const s of candidates) {
    if (new Date(s.createdAt as string).getTime() >= sinceMs) continue; // NEW_SERVER covers it
    const earliestInWindow = await db.orm.public.ServerStatusSample
      .where({ serverId: s.id })
      .where((w: any) => w.sampledAt.gte(since))
      .orderBy((w: any) => w.sampledAt.asc())
      .limit(1)
      .first();
    if (!earliestInWindow || earliestInWindow.state !== "ONLINE") continue;
    const lastBeforeWindow = await db.orm.public.ServerStatusSample
      .where({ serverId: s.id })
      .where((w: any) => w.sampledAt.lt(since))
      .orderBy((w: any) => w.sampledAt.desc())
      .limit(1)
      .first();
    if (!lastBeforeWindow) continue; // no honest pre-window state — skip
    if (lastBeforeWindow.state === "ONLINE") continue; // was already online
    items.push({
      type: "SERVER_ONLINE",
      at: earliestInWindow.sampledAt,
      href: `/servers/${s.slug}`,
      server: { slug: s.slug, name: s.name, logoUrl: s.logoUrl ?? null },
      title: s.name,
    });
    if (items.length >= 5) break;
  }
  return items;
}

// RESOURCE_RELEASE: the moderation approval event is the real "published at"
// moment (Resource has no publishedAt of its own).
async function buildResourceReleaseItems(since: string): Promise<ActivityItem[]> {
  const events = await db.orm.public.ModerationEvent
    .where({ toStatus: "PUBLISHED" })
    .where((e: any) => e.createdAt.gte(since))
    .orderBy((e: any) => e.createdAt.desc())
    .limit(8)
    .all();
  const resources = await publishedResourcesByIds(events.map((e: any) => e.resourceId as string));
  const inWindow = events.filter((e: any) => resources.has(e.resourceId));
  const sellers = await usersByIds(inWindow.map((e: any) => resources.get(e.resourceId).sellerId as string));
  return inWindow.map((e: any) => {
    const resource = resources.get(e.resourceId);
    const seller = sellers.get(resource.sellerId);
    return {
      type: "RESOURCE_RELEASE" as const,
      at: e.createdAt,
      href: `/resources/${resource.slug}`,
      resource: {
        slug: resource.slug,
        title: resource.title,
        coverUrl: resource.coverUrl ?? null,
        sellerName: seller?.displayName ?? seller?.username ?? null,
      },
      title: resource.title,
    } satisfies ActivityItem;
  });
}

async function buildResourceUpdateItems(since: string): Promise<ActivityItem[]> {
  const versions = await db.orm.public.ResourceVersion
    .where({ releaseStatus: "PUBLISHED" })
    .where((v: any) => v.publishedAt.gte(since))
    .orderBy((v: any) => v.publishedAt.desc())
    .limit(8)
    .all();
  const resources = await publishedResourcesByIds(versions.map((v: any) => v.resourceId as string));
  return versions
    .filter((v: any) => resources.has(v.resourceId))
    .map((v: any) => {
      const resource = resources.get(v.resourceId);
      return {
        type: "RESOURCE_UPDATE" as const,
        at: v.publishedAt,
        href: `/resources/${resource.slug}`,
        resource: {
          slug: resource.slug,
          title: resource.title,
          coverUrl: resource.coverUrl ?? null,
        },
        version: v.version,
        title: resource.title,
      } satisfies ActivityItem;
    });
}

// Discussions: NEW_DISCUSSION (thread created in window) and DISCUSSION_REPLY
// (replies to older threads), one item per thread (D-005). News-linked
// threads are excluded — the news itself is already an item (noise, §40).
// ARCHIVED threads and showCommunity=false server-linked threads are
// excluded (E-001/E-004).
async function visibleThreadFilter(threadIds: string[]) {
  if (!threadIds.length) return new Map<string, any>();
  const rows = await db.orm.public.ForumThread
    .where((t: any) => t.id.in(threadIds))
    .all();
  const serverIds = Array.from(new Set(rows.map((t: any) => t.serverId as string).filter(Boolean))) as string[];
  const servers = await publicServersByIds(serverIds);
  const visible = new Map<string, any>();
  for (const t of rows) {
    if (t.newsId || t.articleId) continue;
    if (t.state === "ARCHIVED") continue;
    if (t.serverId) {
      const server = servers.get(t.serverId);
      if (!isPublicServer(server) || !server.showCommunity) continue;
    }
    visible.set(t.id, t);
  }
  return visible;
}

interface DiscussionAggregate {
  threadId: string;
  latestAt: string;
  replyCount: number;
}

async function discussionAggregates(since: string): Promise<DiscussionAggregate[]> {
  const posts = await db.orm.public.ForumPost
    .where({ deletedAt: null })
    .where((p: any) => p.position.gt(0))
    .where((p: any) => p.createdAt.gte(since))
    .orderBy((p: any) => p.createdAt.desc())
    .limit(100)
    .all();
  const byThread = new Map<string, DiscussionAggregate>();
  for (const p of posts) {
    const prev = byThread.get(p.threadId as string);
    if (prev) {
      prev.replyCount += 1;
    } else {
      byThread.set(p.threadId as string, {
        threadId: p.threadId as string,
        latestAt: p.createdAt as string,
        replyCount: 1,
      });
    }
  }
  return Array.from(byThread.values());
}

async function buildDiscussionItems(since: string, sinceMs: number): Promise<ActivityItem[]> {
  const agg = await discussionAggregates(since);
  const threads = await visibleThreadFilter(agg.map((a) => a.threadId));
  const items: ActivityItem[] = [];
  for (const a of agg.sort((x, y) => Date.parse(y.latestAt) - Date.parse(x.latestAt))) {
    const thread = threads.get(a.threadId);
    if (!thread) continue;
    if (items.length >= 8) break;
    if (new Date(thread.createdAt as string).getTime() >= sinceMs) {
      // Thread itself is new: one NEW_DISCUSSION item, replies fold in.
      items.push({
        type: "NEW_DISCUSSION",
        at: thread.createdAt,
        href: `/community/forum/thread/${thread.id}`,
        thread: { id: thread.id, title: thread.title, replyCount: thread.replyCount ?? 0 },
        author: null,
        title: thread.title,
      });
    } else {
      items.push({
        type: "DISCUSSION_REPLY",
        at: a.latestAt,
        href: `/community/forum/thread/${thread.id}`,
        thread: { id: thread.id, title: thread.title, replyCount: thread.replyCount ?? 0 },
        count: a.replyCount,
        title: thread.title,
      });
    }
  }
  return items;
}

async function buildReviewItems(since: string): Promise<ActivityItem[]> {
  const serverReviews = await db.orm.public.ServerReview
    .where({ status: "VISIBLE" })
    .where((r: any) => r.createdAt.gte(since))
    .orderBy((r: any) => r.createdAt.desc())
    .limit(5)
    .all();
  const servers = await publicServersByIds(serverReviews.map((r: any) => r.serverId as string));

  const resourceReviews = await db.orm.public.Review
    .where((r: any) => r.createdAt.gte(since))
    .orderBy((r: any) => r.createdAt.desc())
    .limit(5)
    .all();
  const resources = await publishedResourcesByIds(resourceReviews.map((r: any) => r.resourceId as string));

  const authors = await usersByIds([
    ...serverReviews.map((r: any) => r.userId as string),
    ...resourceReviews.map((r: any) => r.buyerId as string),
  ]);

  const serverItems: ActivityItem[] = serverReviews
    .filter((r: any) => isPublicServer(servers.get(r.serverId)))
    .map((r: any) => {
      const server = servers.get(r.serverId);
      const author = authors.get(r.userId);
      return {
        type: "NEW_REVIEW" as const,
        at: r.createdAt,
        href: `/servers/${server.slug}`,
        server: { slug: server.slug, name: server.name, logoUrl: server.logoUrl ?? null },
        author: author
          ? { username: author.username ?? null, displayName: author.displayName ?? null, avatar: author.avatar ?? null }
          : null,
        review: { rating: r.rating, verified: !!r.verifiedInteraction },
      } satisfies ActivityItem;
    });

  const resourceItems: ActivityItem[] = resourceReviews
    .filter((r: any) => resources.has(r.resourceId))
    .map((r: any) => {
      const resource = resources.get(r.resourceId);
      const author = authors.get(r.buyerId);
      return {
        type: "NEW_REVIEW" as const,
        at: r.createdAt,
        href: `/resources/${resource.slug}`,
        resource: {
          slug: resource.slug,
          title: resource.title,
          coverUrl: resource.coverUrl ?? null,
        },
        author: author
          ? { username: author.username ?? null, displayName: author.displayName ?? null, avatar: author.avatar ?? null }
          : null,
        review: { rating: r.rating },
      } satisfies ActivityItem;
    });

  return [...serverItems, ...resourceItems];
}

// ---------- WORKSTREAM H: popular blocks (real metrics only) ----------

async function buildPopular(since: string): Promise<PopularBlock> {
  // Nullable playerCount is sorted in JS (never in the DB orderBy) — same
  // discipline as the /servers "players" sort (no fabricated ordering).
  const onlineServers = await db.orm.public.Server
    .where((s: any) => s.lifecycle.in(PUBLIC_SERVER_LIFECYCLES as unknown as string[]))
    .where({ monitoring: "ONLINE", showStats: true })
    .limit(50)
    .all();
  const topServers = onlineServers
    .filter((s: any) => (s.playerCount ?? 0) > 0)
    .sort((a: any, b: any) => (b.playerCount ?? 0) - (a.playerCount ?? 0))
    .slice(0, 4);

  const hotThreads = await db.orm.public.ForumThread
    .where({ newsId: null, articleId: null })
    .where((t: any) => t.lastPostAt.gte(since))
    .where((t: any) => t.state.in(["OPEN", "LOCKED"]))
    .orderBy((t: any) => t.lastPostAt.desc())
    .limit(12)
    .all();
  // showCommunity rule (E-004) for server-linked threads.
  const serverIds = Array.from(new Set(hotThreads.map((t: any) => t.serverId as string).filter(Boolean))) as string[];
  const servers = await publicServersByIds(serverIds);
  const discussions = hotThreads
    .filter((t: any) => {
      if (!t.serverId) return true;
      const server = servers.get(t.serverId);
      return isPublicServer(server) && server.showCommunity;
    })
    .slice(0, 4)
    .map((t: any) => ({
      id: t.id as string,
      title: t.title as string,
      replyCount: t.replyCount ?? 0,
      views: t.views ?? 0,
    }));

  return {
    servers: topServers
      .filter((s: any) => (s.playerCount ?? 0) > 0)
      .map((s: any) => ({
        slug: s.slug as string,
        name: s.name as string,
        logoUrl: s.logoUrl ?? null,
        playerCount: s.playerCount ?? null,
        maxPlayers: s.maxPlayers ?? null,
        monitoring: s.monitoring as string,
      })),
    discussions,
  };
}

// ---------- snapshot assembly ----------

export interface ActivitySnapshot {
  live: LiveAggregates;
  items: ActivityItem[];
  popular: PopularBlock;
  generatedAt: string;
}

// Deterministic merge: chronological desc, then type priority, then
// type/href lexicographic — stable ordering for equal timestamps (D-004).
function sortItems(items: ActivityItem[]): ActivityItem[] {
  return items.sort((a, b) => {
    const d = Date.parse(b.at) - Date.parse(a.at);
    if (d !== 0) return d;
    const p = TYPE_PRIORITY[b.type] - TYPE_PRIORITY[a.type];
    if (p !== 0) return p;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.href < b.href ? -1 : a.href > b.href ? 1 : 0;
  });
}

// D-005 dedup: at most one discussion item per thread and one online item
// per server (NEW_SERVER wins over SERVER_ONLINE for the same server).
function dedupItems(items: ActivityItem[]): ActivityItem[] {
  const threadSeen = new Set<string>();
  const serverSeen = new Set<string>();
  const newServerSlugs = new Set(items.filter((i) => i.type === "NEW_SERVER").map((i) => i.server?.slug ?? ""));
  const out: ActivityItem[] = [];
  for (const item of sortItems(items)) {
    if ((item.type === "NEW_DISCUSSION" || item.type === "DISCUSSION_REPLY") && item.thread) {
      if (threadSeen.has(item.thread.id)) continue;
      threadSeen.add(item.thread.id);
    }
    if (item.server && (item.type === "SERVER_ONLINE" || item.type === "NEW_SERVER")) {
      if (serverSeen.has(item.server.slug)) continue;
      if (item.type === "SERVER_ONLINE" && newServerSlugs.has(item.server.slug)) continue;
      serverSeen.add(item.server.slug);
    }
    out.push(item);
  }
  return out;
}

export async function computeActivitySnapshot(limit: number): Promise<ActivitySnapshot> {
  const now = new Date();
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString();
  const sinceMs = Date.parse(since);

  const [
    live,
    updates,
    news,
    newServers,
    online,
    releases,
    resourceUpdates,
    discussions,
    reviews,
    articles,
    popular,
  ] = await Promise.all([
    getLiveAggregates(),
    buildServerUpdateItems(since),
    buildServerNewsItems(since),
    buildNewServerItems(since),
    buildServerOnlineItems(since, sinceMs),
    buildResourceReleaseItems(since),
    buildResourceUpdateItems(since),
    buildDiscussionItems(since, sinceMs),
    buildReviewItems(since),
    buildArticleItems(since),
    buildPopular(since),
  ]);

  return {
    live,
    items: dedupItems([
      ...updates,
      ...news,
      ...newServers,
      ...online,
      ...releases,
      ...resourceUpdates,
      ...discussions,
      ...reviews,
      ...articles,
    ]).slice(0, limit),
    popular,
    generatedAt: now.toISOString(),
  };
}

export async function getActivitySnapshot(limit: number): Promise<ActivitySnapshot> {
  // Cache keys are bucketed to multiples of 5 so bustActivityCache() can
  // enumerate them; arbitrary client limits never fragment the cache.
  const capped = Math.min(50, Math.max(5, Math.ceil(Math.min(Math.max(limit, 5), 50) / 5) * 5));
  const key = snapshotCacheKey(capped);
  const hit = await cached<ActivitySnapshot>(key);
  if (hit) return hit;
  const fresh = await computeActivitySnapshot(capped);
  await storeCache(key, fresh);
  return fresh;
}

export const ACTIVITY_WINDOW_DAYS_VALUE = WINDOW_DAYS;
