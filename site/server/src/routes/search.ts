// PLAN-005 Workstream W: global search with explicit result types.
// PLAN-018 Workstream H (H-001/H-002/H-003): the same ILIKE-based search now
// also covers Services, Creators (sellers) and ServerNews, accepts filters
// and ranks every group with ONE documented formula (see scoreOf below).
//
// Compatibility contract: the existing groups keep their exact keys and item
// shapes (resources/servers/threads/articles — GlobalSearch.tsx depends on
// them); the wave ADDS "services", "creators", "news". A `type` filter
// (comma list of group keys) restricts which groups are searched/returned —
// without it every group is returned, so existing consumers are unaffected.
import { Router, Response } from "express";
import { standardRateLimit } from "../lib/rateLimit.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { PUBLIC_SERVER_LIFECYCLES } from "../lib/serverAccess.js";

const router: Router = Router();

// ---------------------------------------------------------------------------
// H-003 ranking formula (deterministic, computed in JS over bounded
// candidate sets — max 50 candidates per ILIKE branch per group):
//
//   score = relevance + activity + 2*rating + trust + recency
//     relevance : title/name match +3, description/content match +1
//     activity  : min(3, log10(1 + views/reviews/replies/orders/players))
//     rating    : average rating (0..5) → 0..10 points
//     trust     : moderated/verified entity +2 (published-only groups are
//                 always moderated, so the term is a constant for them)
//     recency   : entity updated/published within the last 7 days +2
//
// Groups sort by score desc, ties break on title/id, and only the requested
// `limit` items are returned.
// ---------------------------------------------------------------------------
const RELEVANCE_TITLE = 3;
const RELEVANCE_DESCRIPTION = 1;
const TRUST_MODERATED = 2;
const RECENCY_RECENT_DAYS = 7;
const RECENCY_BONUS = 2;

/** log-scaled activity term, capped at 3 (see formula above). */
function activityTerm(count: number): number {
  if (count <= 0) return 0;
  return Math.min(3, Math.log10(1 + count));
}

function recencyTerm(timestamp: string | null | undefined): number {
  if (!timestamp) return 0;
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return 0;
  return Date.now() - t <= RECENCY_RECENT_DAYS * 24 * 60 * 60 * 1000 ? RECENCY_BONUS : 0;
}

const GROUP_KEYS = [
  "resources",
  "servers",
  "threads",
  "articles",
  "services",
  "creators",
  "news",
] as const;
type GroupKey = (typeof GROUP_KEYS)[number];

/** Bounded candidate fetch cap per ILIKE branch (H-003). */
const CANDIDATE_LIMIT = 50;

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Union of id sets from bounded ILIKE branches. */
function unionIds(...branches: { id: string }[][]): string[] {
  const ids = new Set<string>();
  for (const branch of branches) for (const row of branch) ids.add(row.id);
  return [...ids];
}

interface RankedRow {
  key: string;
  score: number;
  data: any;
}

function rankRows(rows: RankedRow[], limit: number): any[] {
  return rows
    .sort((a, b) => b.score - a.score || String(a.key).localeCompare(String(b.key)))
    .slice(0, limit)
    .map((r) => r.data);
}

function group(count: number, data: any[]) {
  return { count: Number(count), data };
}

router.get("/", standardRateLimit, async (req, res: Response) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q || q.length < 2) {
      res.status(400).json({ error: "Введите минимум 2 символа" });
      return;
    }
    const pattern = `%${q}%`;
    const ql = q.toLowerCase();
    const limit = Math.min(parseInt((req.query.limit as string) || "5", 10) || 5, 20);

    // ------------------------------------------------------------------
    // H-002 filters:
    //   type           — comma list of group keys to include (default: all)
    //   category       — ResourceType enum, applies to the resources group
    //   price          — free | paid, applies to the resources group
    //   verified=true  — moderated/verified entities only: servers must be
    //                    verification=VERIFIED, creators must hold an
    //                    APPROVED SellerProfile (published-only groups are
    //                    already moderated by construction)
    //   rating_min     — resources with average rating ≥ value (no reviews → out)
    //   updated_within — 7d | 30d, applied to resources/services (updatedAt)
    //                    and news/articles (publishedAt)
    // Unknown values are ignored (lenient, like the catalog filters).
    // ------------------------------------------------------------------
    const requested = String(req.query.type || "")
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is GroupKey => (GROUP_KEYS as readonly string[]).includes(s));
    const active: Set<GroupKey> = new Set(requested.length ? requested : [...GROUP_KEYS]);

    const category = typeof req.query.category === "string" && req.query.category
      ? req.query.category
      : undefined;
    const price = req.query.price === "free" || req.query.price === "paid" ? req.query.price : undefined;
    const verifiedOnly = ["true", "1"].includes(String(req.query.verified || ""));
    const ratingMin = Number.isFinite(parseFloat(req.query.rating_min as string))
      ? parseFloat(req.query.rating_min as string)
      : null;
    const withinDays = req.query.updated_within === "7d" ? 7 : req.query.updated_within === "30d" ? 30 : null;

    const response: Record<string, unknown> = { query: q };

    // ---------------------------------------------------------------
    // Resources (existing marketplace domain; title OR description).
    // ---------------------------------------------------------------
    if (active.has("resources")) {
      const base = () => {
        let b = db.orm.public.Resource.where({ status: "PUBLISHED" });
        if (category) b = b.where({ type: category as any });
        if (price === "free") b = b.where({ price: 0 });
        else if (price === "paid") b = b.where((r: any) => r.price.gt(0));
        return b;
      };
      const [titleIds, descIds] = await Promise.all([
        base().where((r: any) => r.title.ilike(pattern)).select("id").limit(CANDIDATE_LIMIT).all(),
        base().where((r: any) => r.description.ilike(pattern)).select("id").limit(CANDIDATE_LIMIT).all(),
      ]);
      const ids = unionIds(titleIds, descIds);

      const rows = ids.length
        ? await db.orm.public.Resource
            .where((r: any) => r.id.in(ids))
            .where({ status: "PUBLISHED" })
            .limit(CANDIDATE_LIMIT * 2)
            .all()
        : [];
      const reviewAggs = ids.length
        ? await db.orm.public.Review
            .where((r: any) => r.resourceId.in(ids))
            .groupBy("resourceId")
            .aggregate((a: any) => ({ total: a.count(), avg: a.avg("rating") }))
        : [];
      const aggByResource = new Map<string, { total: number; avg: number | null }>();
      for (const a of reviewAggs as any[]) {
        aggByResource.set(a.resourceId, { total: Number(a.total ?? 0), avg: a.avg == null ? null : Number(a.avg) });
      }

      const countAgg = ids.length
        ? await db.orm.public.Resource
            .where((r: any) => r.id.in(ids))
            .where({ status: "PUBLISHED" })
            .aggregate((a: any) => ({ total: a.count() }))
        : { total: 0 };

      const ranked: RankedRow[] = [];
      for (const r of rows as any[]) {
        const agg = aggByResource.get(r.id) ?? { total: 0, avg: null };
        if (ratingMin !== null && (agg.avg == null || agg.avg < ratingMin)) continue;
        if (withinDays !== null && new Date(r.updatedAt as string) < new Date(daysAgoIso(withinDays))) continue;
        const titleMatch = String(r.title).toLowerCase().includes(ql);
        const descMatch = String(r.description).toLowerCase().includes(ql);
        const score =
          (titleMatch ? RELEVANCE_TITLE : 0) +
          (descMatch ? RELEVANCE_DESCRIPTION : 0) +
          activityTerm(agg.total) +
          (agg.avg != null ? agg.avg * 2 : 0) +
          TRUST_MODERATED + // status PUBLISHED = moderated (lib/moderation.ts)
          recencyTerm(r.updatedAt);
        ranked.push({
          key: r.id,
          score,
          data: {
            id: r.id,
            slug: r.slug,
            title: r.title,
            coverUrl: r.coverUrl,
            price: r.price,
            type: r.type,
          },
        });
      }
      response.resources = group(Number(countAgg.total ?? 0), rankRows(ranked, limit));
    }

    // ---------------------------------------------------------------
    // Servers (public lifecycle only; name OR description).
    // ---------------------------------------------------------------
    if (active.has("servers")) {
      const [nameIds, descIds] = await Promise.all([
        db.orm.public.Server.where((s: any) => s.name.ilike(pattern)).select("id").limit(CANDIDATE_LIMIT).all(),
        db.orm.public.Server.where((s: any) => s.description.ilike(pattern)).select("id").limit(CANDIDATE_LIMIT).all(),
      ]);
      const ids = unionIds(nameIds, descIds);

      const rows = ids.length
        ? await db.orm.public.Server
            .where((s: any) => s.id.in(ids))
            .where((s: any) => s.lifecycle.in(PUBLIC_SERVER_LIFECYCLES))
            .limit(CANDIDATE_LIMIT * 2)
            .all()
        : [];
      const reviewAggs = ids.length
        ? await db.orm.public.ServerReview
            .where((r: any) => r.serverId.in(ids))
            .where({ status: "VISIBLE" })
            .groupBy("serverId")
            .aggregate((a: any) => ({ total: a.count(), avg: a.avg("rating") }))
        : [];
      const aggByServer = new Map<string, { total: number; avg: number | null }>();
      for (const a of reviewAggs as any[]) {
        aggByServer.set(a.serverId, { total: Number(a.total ?? 0), avg: a.avg == null ? null : Number(a.avg) });
      }

      const countAgg = ids.length
        ? await db.orm.public.Server
            .where((s: any) => s.id.in(ids))
            .where((s: any) => s.lifecycle.in(PUBLIC_SERVER_LIFECYCLES))
            .aggregate((a: any) => ({ total: a.count() }))
        : { total: 0 };

      const ranked: RankedRow[] = [];
      for (const s of rows as any[]) {
        if (verifiedOnly && s.verification !== "VERIFIED") continue;
        const agg = aggByServer.get(s.id) ?? { total: 0, avg: null };
        const titleMatch = String(s.name).toLowerCase().includes(ql);
        const descMatch = String(s.description ?? "").toLowerCase().includes(ql);
        const score =
          (titleMatch ? RELEVANCE_TITLE : 0) +
          (descMatch ? RELEVANCE_DESCRIPTION : 0) +
          activityTerm(Number(s.playerCount ?? 0)) +
          (agg.avg != null ? agg.avg * 2 : 0) +
          (s.verification === "VERIFIED" ? TRUST_MODERATED : 0) +
          recencyTerm(s.lastSeenAt);
        ranked.push({
          key: s.id,
          score,
          data: {
            id: s.id,
            slug: s.slug,
            name: s.name,
            logoUrl: s.logoUrl,
            monitoring: s.monitoring,
            playerCount: s.playerCount,
            verification: s.verification,
          },
        });
      }
      response.servers = group(Number(countAgg.total ?? 0), rankRows(ranked, limit));
    }

    // ---------------------------------------------------------------
    // Threads (any state; state is shown, not hidden).
    // ---------------------------------------------------------------
    if (active.has("threads")) {
      const idRows = await db.orm.public.ForumThread
        .where((t: any) => t.title.ilike(pattern))
        .select("id")
        .limit(CANDIDATE_LIMIT)
        .all();
      const ids = unionIds(idRows);
      const rows = ids.length
        ? await db.orm.public.ForumThread.where((t: any) => t.id.in(ids)).limit(CANDIDATE_LIMIT).all()
        : [];
      const countAgg = ids.length
        ? await db.orm.public.ForumThread
            .where((t: any) => t.id.in(ids))
            .aggregate((a: any) => ({ total: a.count() }))
        : { total: 0 };

      const ranked: RankedRow[] = [];
      for (const t of rows as any[]) {
        const titleMatch = String(t.title).toLowerCase().includes(ql);
        const lastActivity = t.lastPostAt ?? t.createdAt;
        const score =
          (titleMatch ? RELEVANCE_TITLE : 0) +
          activityTerm(Number(t.replyCount ?? 0)) +
          recencyTerm(lastActivity);
        ranked.push({
          key: t.id,
          score,
          data: {
            id: t.id,
            title: t.title,
            state: t.state,
            replyCount: t.replyCount,
            lastPostAt: t.lastPostAt,
          },
        });
      }
      response.threads = group(Number(countAgg.total ?? 0), rankRows(ranked, limit));
    }

    // ---------------------------------------------------------------
    // PLAN-007: articles (PUBLISHED only) — explicit result type (E-004).
    // ---------------------------------------------------------------
    if (active.has("articles")) {
      const base = () => {
        let b = db.orm.public.Article.where({ status: "PUBLISHED" });
        if (withinDays !== null) {
          b = b.where((a: any) => (a.publishedAt ?? a.createdAt).gte(daysAgoIso(withinDays)));
        }
        return b;
      };
      const [titleIds, excerptIds] = await Promise.all([
        base().where((a: any) => a.title.ilike(pattern)).select("id").limit(CANDIDATE_LIMIT).all(),
        base().where((a: any) => a.excerpt.ilike(pattern)).select("id").limit(CANDIDATE_LIMIT).all(),
      ]);
      const ids = unionIds(titleIds, excerptIds);
      const rows = ids.length
        ? await db.orm.public.Article
            .where((a: any) => a.id.in(ids))
            .where({ status: "PUBLISHED" })
            .limit(CANDIDATE_LIMIT * 2)
            .all()
        : [];
      const countAgg = ids.length
        ? await db.orm.public.Article
            .where((a: any) => a.id.in(ids))
            .where({ status: "PUBLISHED" })
            .aggregate((a: any) => ({ total: a.count() }))
        : { total: 0 };

      const ranked: RankedRow[] = [];
      for (const a of rows as any[]) {
        const titleMatch = String(a.title).toLowerCase().includes(ql);
        const descMatch = String(a.excerpt ?? "").toLowerCase().includes(ql);
        const score =
          (titleMatch ? RELEVANCE_TITLE : 0) +
          (descMatch ? RELEVANCE_DESCRIPTION : 0) +
          TRUST_MODERATED +
          recencyTerm(a.publishedAt ?? a.createdAt);
        ranked.push({
          key: a.id,
          score,
          data: {
            id: a.id,
            slug: a.slug,
            title: a.title,
            excerpt: a.excerpt,
            category: a.category,
            publishedAt: a.publishedAt ?? a.createdAt,
          },
        });
      }
      response.articles = group(Number(countAgg.total ?? 0), rankRows(ranked, limit));
    }

    // ---------------------------------------------------------------
    // PLAN-018 H-001: services (PUBLISHED only; title OR description).
    // ---------------------------------------------------------------
    if (active.has("services")) {
      const base = () => {
        let b = db.orm.public.Service.where({ status: "PUBLISHED" });
        if (withinDays !== null) b = b.where((s: any) => s.updatedAt.gte(daysAgoIso(withinDays)));
        return b;
      };
      const [titleIds, descIds] = await Promise.all([
        base().where((s: any) => s.title.ilike(pattern)).select("id").limit(CANDIDATE_LIMIT).all(),
        base().where((s: any) => s.description.ilike(pattern)).select("id").limit(CANDIDATE_LIMIT).all(),
      ]);
      const ids = unionIds(titleIds, descIds);
      const rows = ids.length
        ? await db.orm.public.Service
            .where((s: any) => s.id.in(ids))
            .where({ status: "PUBLISHED" })
            .limit(CANDIDATE_LIMIT * 2)
            .all()
        : [];
      const orderAggs = ids.length
        ? await db.orm.public.ServiceOrderItem
            .where((i: any) => i.serviceId.in(ids))
            .groupBy("serviceId")
            .aggregate((a: any) => ({ total: a.count() }))
        : [];
      const ordersByService = new Map<string, number>();
      for (const a of orderAggs as any[]) ordersByService.set(a.serviceId, Number(a.total ?? 0));
      const countAgg = ids.length
        ? await db.orm.public.Service
            .where((s: any) => s.id.in(ids))
            .where({ status: "PUBLISHED" })
            .aggregate((a: any) => ({ total: a.count() }))
        : { total: 0 };

      const ranked: RankedRow[] = [];
      for (const s of rows as any[]) {
        const titleMatch = String(s.title).toLowerCase().includes(ql);
        const descMatch = String(s.description).toLowerCase().includes(ql);
        const score =
          (titleMatch ? RELEVANCE_TITLE : 0) +
          (descMatch ? RELEVANCE_DESCRIPTION : 0) +
          activityTerm(ordersByService.get(s.id) ?? 0) +
          TRUST_MODERATED +
          recencyTerm(s.updatedAt);
        ranked.push({
          key: s.id,
          score,
          data: {
            id: s.id,
            slug: s.slug,
            title: s.title,
            price: s.price,
            type: s.type,
            deliveryDays: s.deliveryDays,
          },
        });
      }
      response.services = group(Number(countAgg.total ?? 0), rankRows(ranked, limit));
    }

    // ---------------------------------------------------------------
    // PLAN-018 H-001: creators — SellerProfile.displayName + User.username
    // where role SELLER or a seller profile exists.
    // ---------------------------------------------------------------
    if (active.has("creators")) {
      const [usernameIds, profileIds] = await Promise.all([
        db.orm.public.User
          .where((u: any) => u.username.ilike(pattern))
          .where({ status: "ACTIVE" })
          .select("id")
          .limit(CANDIDATE_LIMIT)
          .all(),
        db.orm.public.SellerProfile
          .where((p: any) => p.displayName.ilike(pattern))
          .select("userId")
          .limit(CANDIDATE_LIMIT)
          .all(),
      ]);
      const ids = unionIds(
        usernameIds,
        (profileIds as any[]).map((p) => ({ id: p.userId as string }))
      );

      const users = ids.length
        ? await db.orm.public.User
            .where((u: any) => u.id.in(ids))
            .where({ status: "ACTIVE" })
            .limit(CANDIDATE_LIMIT * 2)
            .all()
        : [];
      const profiles = ids.length
        ? await db.orm.public.SellerProfile.where((p: any) => p.userId.in(ids)).all()
        : [];
      const profileByUser = new Map<string, any>();
      for (const p of profiles as any[]) profileByUser.set(p.userId, p);

      // Only seller identities: role SELLER or any seller profile.
      const sellers = users.filter((u: any) => u.role === "SELLER" || profileByUser.has(u.id));

      const followerAggs = sellers.length
        ? await db.orm.public.SellerFollow
            .where((f: any) => f.sellerUserId.in(sellers.map((u: any) => u.id)))
            .groupBy("sellerUserId")
            .aggregate((a: any) => ({ total: a.count() }))
        : [];
      const followersByUser = new Map<string, number>();
      for (const a of followerAggs as any[]) followersByUser.set(a.sellerUserId, Number(a.total ?? 0));

      // Count over the same candidate set (bounded), profile-gated.
      const count = sellers.length;

      const ranked: RankedRow[] = [];
      for (const u of sellers as any[]) {
        const profile = profileByUser.get(u.id);
        if (verifiedOnly && profile?.status !== "APPROVED") continue;
        const usernameMatch = String(u.username ?? "").toLowerCase().includes(ql);
        const displayMatch = String(profile?.displayName ?? u.displayName ?? "").toLowerCase().includes(ql);
        const score =
          (usernameMatch ? RELEVANCE_TITLE : 0) +
          (displayMatch ? RELEVANCE_DESCRIPTION : 0) +
          activityTerm(followersByUser.get(u.id) ?? 0) +
          (profile?.status === "APPROVED" ? TRUST_MODERATED : 0);
        ranked.push({
          key: u.id,
          score,
          data: {
            id: u.id,
            username: u.username,
            displayName: profile?.displayName || u.displayName || u.username,
            avatar: u.avatar,
            followers: followersByUser.get(u.id) ?? 0,
          },
        });
      }
      response.creators = group(count, rankRows(ranked, limit));
    }

    // ---------------------------------------------------------------
    // PLAN-018 H-001: server news (PUBLISHED only; title OR content).
    // ---------------------------------------------------------------
    if (active.has("news")) {
      const base = () => {
        let b = db.orm.public.ServerNews.where({ status: "PUBLISHED" });
        if (withinDays !== null) {
          b = b.where((n: any) => (n.publishedAt ?? n.createdAt).gte(daysAgoIso(withinDays)));
        }
        return b;
      };
      const [titleIds, contentIds] = await Promise.all([
        base().where((n: any) => n.title.ilike(pattern)).select("id").limit(CANDIDATE_LIMIT).all(),
        base().where((n: any) => n.content.ilike(pattern)).select("id").limit(CANDIDATE_LIMIT).all(),
      ]);
      const ids = unionIds(titleIds, contentIds);
      const rows = ids.length
        ? await db.orm.public.ServerNews
            .where((n: any) => n.id.in(ids))
            .where({ status: "PUBLISHED" })
            .limit(CANDIDATE_LIMIT * 2)
            .include("server", (s: any) => s.select("slug", "name"))
            .all()
        : [];
      const countAgg = ids.length
        ? await db.orm.public.ServerNews
            .where((n: any) => n.id.in(ids))
            .where({ status: "PUBLISHED" })
            .aggregate((a: any) => ({ total: a.count() }))
        : { total: 0 };

      const ranked: RankedRow[] = [];
      for (const n of rows as any[]) {
        const titleMatch = String(n.title).toLowerCase().includes(ql);
        const descMatch = String(n.content).toLowerCase().includes(ql);
        const score =
          (titleMatch ? RELEVANCE_TITLE : 0) +
          (descMatch ? RELEVANCE_DESCRIPTION : 0) +
          TRUST_MODERATED +
          recencyTerm(n.publishedAt ?? n.createdAt);
        ranked.push({
          key: n.id,
          score,
          data: {
            id: n.id,
            title: n.title,
            excerpt: String(n.content ?? "").slice(0, 160),
            coverUrl: n.coverUrl,
            server: n.server ? { slug: n.server.slug, name: n.server.name } : null,
            publishedAt: n.publishedAt ?? n.createdAt,
          },
        });
      }
      response.news = group(Number(countAgg.total ?? 0), rankRows(ranked, limit));
    }

    res.json(response);
  } catch (error) {
    reqLog(req).error("search_failed", { error });
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;
