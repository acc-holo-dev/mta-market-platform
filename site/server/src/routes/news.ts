// PLAN-005 Workstream H-005: global news feed. One ServerNews object, many
// surfaces — the global feed joins the same ServerNews rows the server page
// and follower dashboards read. No content duplication.
import { Router, Response } from "express";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

// GET /news — global feed of published server news (+updates mixed view).
router.get("/", standardRateLimit, async (req, res: Response) => {
  try {
    const page = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "12", 10) || 12, 1), 50);
    const kind = (req.query.kind as string | undefined) || "all"; // all | news | updates

    const includeNews = kind === "all" || kind === "news";
    const includeUpdates = kind === "all" || kind === "updates";

    const news = includeNews
      ? await db.orm.public.ServerNews
          .where({ status: "PUBLISHED" })
          .orderBy((n: any) => (n.publishedAt ?? n.createdAt).desc())
          .limit(limit)
          .offset((page - 1) * limit)
          .all()
      : [];
    const updates = includeUpdates
      ? await db.orm.public.ServerUpdate
          .where({})
          .orderBy((u: any) => u.publishedAt.desc())
          .limit(limit)
          .offset((page - 1) * limit)
          .all()
      : [];

    // Honest totals (PLAN B-004) so the feed can paginate exactly.
    const newsAgg = includeNews
      ? await db.orm.public.ServerNews.where({ status: "PUBLISHED" }).aggregate(
          (a: any) => ({ total: a.count() })
        )
      : { total: 0 };
    const updatesAgg = includeUpdates
      ? await db.orm.public.ServerUpdate.where({}).aggregate((a: any) => ({ total: a.count() }))
      : { total: 0 };

    const serverIds = Array.from(
      new Set([...news, ...updates].map((n: any) => n.serverId as string))
    );
    const servers = serverIds.length
      ? await db.orm.public.Server
          .where((s: any) => s.id.in(serverIds))
          .select("id", "slug", "name", "logoUrl")
          .all()
      : [];
    const authors = await db.orm.public.User
      .where((u: any) =>
        u.id.in(Array.from(new Set([...news, ...updates].map((n: any) => n.authorId as string))))
      )
      .select("id", "username", "displayName", "avatar")
      .all();

    const serverById = new Map(servers.map((s: any) => [s.id, s]));
    const authorById = new Map(authors.map((a: any) => [a.id, a]));

    const newsItems = news.map((n: any) => ({
      kind: "NEWS" as const,
      id: n.id,
      title: n.title,
      preview: n.content.slice(0, 300),
      coverUrl: n.coverUrl,
      publishedAt: n.publishedAt ?? n.createdAt,
      server: serverById.get(n.serverId) ?? null,
      author: authorById.get(n.authorId) ?? null,
    }));
    const updateItems = updates.map((u: any) => ({
      kind: "UPDATE" as const,
      id: u.id,
      version: u.version,
      title: u.title,
      preview: u.changelog.slice(0, 300),
      publishedAt: u.publishedAt,
      server: serverById.get(u.serverId) ?? null,
      author: authorById.get(u.authorId) ?? null,
    }));

    const items = [...newsItems, ...updateItems].sort(
      (a: any, b: any) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );

    const total = Number(newsAgg.total ?? 0) + Number(updatesAgg.total ?? 0);
    res.json({
      data: items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    reqLog(req).error("news_feed_failed", { error });
    res.status(500).json({ error: "Failed to fetch news feed" });
  }
});

export default router;