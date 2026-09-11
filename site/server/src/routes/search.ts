// PLAN-005 Workstream W: global search with explicit result types.
// Extends the existing ILIKE search approach (resources.ts) to the new
// Server + Forum domains. Every group is typed so the UI can render
// "Resources (12) / Servers (8) / Discussions (34)".
import { Router, Response } from "express";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";
import { PUBLIC_SERVER_LIFECYCLES } from "../lib/serverAccess";

const router: Router = Router();

router.get("/", standardRateLimit, async (req, res: Response) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    if (!q || q.length < 2) {
      res.status(400).json({ error: "Введите минимум 2 символа" });
      return;
    }
    const pattern = `%${q}%`;
    const limit = Math.min(parseInt((req.query.limit as string) || "5", 10) || 5, 20);

    // Resources (existing marketplace domain).
    const resources = await db.orm.public.Resource
      .where((r: any) => r.title.ilike(pattern))
      .where({ status: "PUBLISHED" })
      .limit(limit)
      .all();
    const resourcesAgg = await db.orm.public.Resource
      .where((r: any) => r.title.ilike(pattern))
      .where({ status: "PUBLISHED" })
      .aggregate((a: any) => ({ total: a.count() }));

    // Servers (public lifecycle only). The ORM has no OR combinator, so search
// branches are unioned by id (same pattern as the resource search).
    const [serverNameIds, serverDescIds] = await Promise.all([
      db.orm.public.Server.where((s: any) => s.name.ilike(pattern)).select("id").limit(200).all(),
      db.orm.public.Server.where((s: any) => s.description.ilike(pattern)).select("id").limit(200).all(),
    ]);
    const serverIds = Array.from(
      new Set([...serverNameIds, ...serverDescIds].map((r: any) => r.id as string))
    );
    const servers = serverIds.length
      ? await db.orm.public.Server
          .where((s: any) => s.id.in(serverIds))
          .where((s: any) => s.lifecycle.in(PUBLIC_SERVER_LIFECYCLES))
          .limit(limit)
          .all()
      : [];
    const serversAgg = serverIds.length
      ? await db.orm.public.Server
          .where((s: any) => s.id.in(serverIds))
          .where((s: any) => s.lifecycle.in(PUBLIC_SERVER_LIFECYCLES))
          .aggregate((a: any) => ({ total: a.count() }))
      : { total: 0 };

    // Threads (any state; state is shown, not hidden).
    const threads = await db.orm.public.ForumThread
      .where((t: any) => t.title.ilike(pattern))
      .orderBy((t: any) => (t.lastPostAt ?? t.createdAt).desc())
      .limit(limit)
      .all();
    const threadsAgg = await db.orm.public.ForumThread
      .where((t: any) => t.title.ilike(pattern))
      .aggregate((a: any) => ({ total: a.count() }));

    // PLAN-007: articles (PUBLISHED only) — explicit result type (E-004).
    const articles = await db.orm.public.Article
      .where((a: any) => a.title.ilike(pattern))
      .where({ status: "PUBLISHED" })
      .orderBy((a: any) => (a.publishedAt ?? a.createdAt).desc())
      .limit(limit)
      .all();
    const articlesAgg = await db.orm.public.Article
      .where((a: any) => a.title.ilike(pattern))
      .where({ status: "PUBLISHED" })
      .aggregate((a: any) => ({ total: a.count() }));

    res.json({
      query: q,
      resources: {
        count: Number(resourcesAgg.total ?? 0),
        data: resources.map((r: any) => ({
          id: r.id,
          slug: r.slug,
          title: r.title,
          coverUrl: r.coverUrl,
          price: r.price,
          type: r.type,
        })),
      },
      servers: {
        count: Number(serversAgg.total ?? 0),
        data: servers.map((s: any) => ({
          id: s.id,
          slug: s.slug,
          name: s.name,
          logoUrl: s.logoUrl,
          monitoring: s.monitoring,
          playerCount: s.playerCount,
          verification: s.verification,
        })),
      },
      threads: {
        count: Number(threadsAgg.total ?? 0),
        data: threads.map((t: any) => ({
          id: t.id,
          title: t.title,
          state: t.state,
          replyCount: t.replyCount,
          lastPostAt: t.lastPostAt,
        })),
      },
      articles: {
        count: Number(articlesAgg.total ?? 0),
        data: articles.map((a: any) => ({
          id: a.id,
          slug: a.slug,
          title: a.title,
          excerpt: a.excerpt,
          category: a.category,
          publishedAt: a.publishedAt ?? a.createdAt,
        })),
      },
    });
  } catch (error) {
    reqLog(req).error("search_failed", { error });
    res.status(500).json({ error: "Search failed" });
  }
});

export default router;