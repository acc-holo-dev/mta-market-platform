// PLAN-007 Workstreams C/E: Content Foundation routes.
// Author flow: create draft в†’ submit в†’ moderation (adminCommunity.ts).
// Public: /content hub, /content/articles/[slug]. Links are explicit only
// (B-002): a resource may be any PUBLISHED resource; a server may be attached
// only by its staff (G-004 precedent). Content is plain text вЂ” never raw HTML.
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit, userRateLimit } from "../lib/rateLimit.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { makeServerSlug } from "../lib/slug.js";
import { isOwnMediaUrl } from "../lib/media.js";
import { loadStaffRole, canManage, PUBLIC_SERVER_LIFECYCLES } from "../lib/serverAccess.js";

const router: Router = Router();

const CATEGORIES = ["GUIDES", "NEWS", "REVIEWS", "OPINION"] as const;
type ArticleCategoryValue = (typeof CATEGORIES)[number];
type ArticleStatusValue = "DRAFT" | "PENDING_REVIEW" | "PUBLISHED" | "ARCHIVED";

function excerptOf(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat.length <= 300 ? flat : `${flat.slice(0, 297)}вЂ¦`;
}

function slugFor(title: string): string {
  const base = makeServerSlug(title).replace(/^server-/, "");
  return `${base || "article"}-${Math.random().toString(36).slice(2, 6)}`;
}

async function loadOwnArticle(req: AuthRequest, id: string) {
  const article = await db.orm.public.Article.where({ id }).first();
  if (!article || article.authorId !== req.user!.userId) return null;
  return article;
}

function validLinks(resourceIds: unknown, serverIds: unknown) {
  const resIds = Array.isArray(resourceIds) ? resourceIds.filter((x: any) => typeof x === "string").slice(0, 5) : [];
  const svIds = Array.isArray(serverIds) ? serverIds.filter((x: any) => typeof x === "string").slice(0, 3) : [];
  return { resIds, svIds };
}

// ---------- author flow ----------

// POST /content вЂ” create draft (C-001). body: {title, category, tags?,
// content, coverUrl?, resourceIds?, serverIds?, createDiscussion?}
router.post(
  "/",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 20, action: "article_create" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const { title, category, tags, content, coverUrl, resourceIds, serverIds } = req.body ?? {};
      if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 120) {
        res.status(400).json({ error: "Р—Р°РіРѕР»РѕРІРѕРє: РѕС‚ 3 РґРѕ 120 СЃРёРјРІРѕР»РѕРІ" });
        return;
      }
      if (typeof content !== "string" || content.trim().length < 30 || content.length > 20000) {
        res.status(400).json({ error: "РўРµРєСЃС‚ СЃС‚Р°С‚СЊРё: РѕС‚ 30 РґРѕ 20000 СЃРёРјРІРѕР»РѕРІ" });
        return;
      }
      if (category !== undefined && !CATEGORIES.includes(category)) {
        res.status(400).json({ error: "РќРµРёР·РІРµСЃС‚РЅР°СЏ РєР°С‚РµРіРѕСЂРёСЏ" });
        return;
      }
      if (tags !== undefined && (typeof tags !== "string" || tags.length > 200)) {
        res.status(400).json({ error: "РўРµРіРё: СЃС‚СЂРѕРєР° РґРѕ 200 СЃРёРјРІРѕР»РѕРІ" });
        return;
      }
      if (coverUrl !== undefined && coverUrl !== null && !isOwnMediaUrl(coverUrl)) {
        res.status(400).json({ error: "РћР±Р»РѕР¶РєР° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ Р·Р°РіСЂСѓР¶РµРЅР° С‡РµСЂРµР· /upload/media" });
        return;
      }
      const { resIds, svIds } = validLinks(resourceIds, serverIds);

      // B-002: resources must be PUBLISHED; servers must be public AND
      // attached only by their staff (G-004 precedent).
      const validResources = resIds.length
        ? await db.orm.public.Resource
            .where((r: any) => r.id.in(resIds))
            .where({ status: "PUBLISHED" })
            .select("id")
            .all()
        : [];
      const validResourceIds = new Set(validResources.map((r: any) => r.id as string));
      if (validResourceIds.size !== resIds.length) {
        res.status(400).json({ error: "РќРµРєРѕС‚РѕСЂС‹Рµ СЂРµСЃСѓСЂСЃС‹ РЅРµ СЃСѓС‰РµСЃС‚РІСѓСЋС‚ РёР»Рё РЅРµ РѕРїСѓР±Р»РёРєРѕРІР°РЅС‹" });
        return;
      }
      for (const sid of svIds) {
        const server = await db.orm.public.Server.where({ id: sid }).first();
        if (!server || !(PUBLIC_SERVER_LIFECYCLES as readonly string[]).includes(server.lifecycle)) {
          res.status(400).json({ error: "РЎРµСЂРІРµСЂ РЅРµ СЃСѓС‰РµСЃС‚РІСѓРµС‚ РёР»Рё РЅРµ РїСѓР±Р»РёС‡РµРЅ" });
          return;
        }
        const role = await loadStaffRole(server as any, req.user!.userId);
        if (!canManage(role)) {
          res.status(403).json({ error: "РЎРІРѕР№ СЃРµСЂРІРµСЂ РјРѕР¶РµС‚ РїСЂРёРІСЏР·Р°С‚СЊ С‚РѕР»СЊРєРѕ РµРіРѕ РїРµСЂСЃРѕРЅР°Р»" });
          return;
        }
      }

      let slug = slugFor(title.trim());
      // Unique slug (retry a few times on collision).
      for (let i = 0; i < 5; i++) {
        const exists = await db.orm.public.Article.where({ slug }).first();
        if (!exists) break;
        slug = slugFor(title.trim());
      }

      const article = await db.orm.public.Article.create({
        authorId: req.user!.userId,
        slug,
        title: title.trim(),
        content,
        excerpt: excerptOf(content),
        category: (CATEGORIES as readonly string[]).includes(category as string) ? (category as ArticleCategoryValue) : "GUIDES",
        tags: typeof tags === "string" && tags.trim() ? tags.trim() : null,
        coverUrl: typeof coverUrl === "string" && coverUrl ? coverUrl : null,
        status: "DRAFT",
      });
      const linkedResources = Array.from(validResourceIds);
      for (const [position, rid] of linkedResources.entries()) {
        await db.orm.public.ArticleResourceLink.create({ articleId: article.id, resourceId: rid, position });
      }
      for (const [position, sid] of svIds.entries()) {
        await db.orm.public.ArticleServerLink.create({ articleId: article.id, serverId: sid, position });
      }
      res.status(201).json(article);
    } catch (error) {
      reqLog(req).error("article_create_failed", { error });
      res.status(500).json({ error: "Failed to create article" });
    }
  }
);

// PATCH /content/:id вЂ” author edits. DRAFT/PENDING stay; PUBLISHED/ARCHIVED
// go back to PENDING_REVIEW (re-moderation, C-002).
router.patch(
  "/:id",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 40, action: "article_edit" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const article = await loadOwnArticle(req, req.params.id as string);
      if (!article) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      const { title, category, tags, content, coverUrl } = req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (title !== undefined) {
        if (typeof title !== "string" || title.trim().length < 3 || title.trim().length > 120) {
          res.status(400).json({ error: "Р—Р°РіРѕР»РѕРІРѕРє: РѕС‚ 3 РґРѕ 120 СЃРёРјРІРѕР»РѕРІ" });
          return;
        }
        patch.title = title.trim();
      }
      if (content !== undefined) {
        if (typeof content !== "string" || content.trim().length < 30 || content.length > 20000) {
          res.status(400).json({ error: "РўРµРєСЃС‚ СЃС‚Р°С‚СЊРё: РѕС‚ 30 РґРѕ 20000 СЃРёРјРІРѕР»РѕРІ" });
          return;
        }
        patch.content = content;
        patch.excerpt = excerptOf(content);
      }
      if (category !== undefined) {
        if (!CATEGORIES.includes(category)) {
          res.status(400).json({ error: "РќРµРёР·РІРµСЃС‚РЅР°СЏ РєР°С‚РµРіРѕСЂРёСЏ" });
          return;
        }
        patch.category = category;
      }
      if (tags !== undefined) {
        if (typeof tags !== "string" || tags.length > 200) {
          res.status(400).json({ error: "РўРµРіРё: СЃС‚СЂРѕРєР° РґРѕ 200 СЃРёРјРІРѕР»РѕРІ" });
          return;
        }
        patch.tags = tags.trim() || null;
      }
      if (coverUrl !== undefined) {
        if (coverUrl !== null && !isOwnMediaUrl(coverUrl)) {
          res.status(400).json({ error: "РћР±Р»РѕР¶РєР° РґРѕР»Р¶РЅР° Р±С‹С‚СЊ Р·Р°РіСЂСѓР¶РµРЅР° С‡РµСЂРµР· /upload/media" });
          return;
        }
        patch.coverUrl = coverUrl;
      }
      const republished: { status?: ArticleStatusValue; reviewNote?: null } =
        article.status === "PUBLISHED" || article.status === "ARCHIVED"
          ? { status: "PENDING_REVIEW", reviewNote: null }
          : {};
      const updated = await db.orm.public.Article
        .where({ id: article.id })
        .update({ ...patch, ...republished });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("article_edit_failed", { error });
      res.status(500).json({ error: "Failed to update article" });
    }
  }
);

// POST /content/:id/submit вЂ” DRAFT/ARCHIVED в†’ PENDING_REVIEW (C-001).
router.post(
  "/:id/submit",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const article = await loadOwnArticle(req, req.params.id as string);
      if (!article) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      if (article.status !== "DRAFT" && article.status !== "ARCHIVED") {
        res.status(409).json({ error: "РћС‚РїСЂР°РІРёС‚СЊ РЅР° РјРѕРґРµСЂР°С†РёСЋ РјРѕР¶РЅРѕ С‡РµСЂРЅРѕРІРёРє РёР»Рё Р°СЂС…РёРІРЅСѓСЋ СЃС‚Р°С‚СЊСЋ" });
        return;
      }
      const updated = await db.orm.public.Article
        .where({ id: article.id })
        .update({ status: "PENDING_REVIEW" as const, reviewNote: null });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("article_submit_failed", { error });
      res.status(500).json({ error: "Failed to submit article" });
    }
  }
);

// GET /content/mine вЂ” all own articles with statuses (C-002).
router.get("/mine", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const rows = await db.orm.public.Article
      .where({ authorId: req.user!.userId })
      .orderBy((a: any) => a.createdAt.desc())
      .limit(50)
      .all();
    const articleIds = Array.from(new Set(rows.map((a: any) => a.id as string)));
    const threadRows = articleIds.length
      ? await db.orm.public.ForumThread
          .where((t: any) => t.articleId.in(articleIds))
          .select("id", "articleId", "replyCount")
          .all()
      : [];
    const threadByArticle = new Map(threadRows.map((t: any) => [t.articleId, t]));
    res.json({
      data: rows.map((a: any) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        category: a.category,
        status: a.status,
        reviewNote: a.reviewNote,
        publishedAt: a.publishedAt,
        createdAt: a.createdAt,
        threadId: threadByArticle.get(a.id)?.id ?? null,
        replyCount: threadByArticle.get(a.id)?.replyCount ?? 0,
      })),
    });
  } catch (error) {
    reqLog(req).error("articles_mine_failed", { error });
    res.status(500).json({ error: "Failed to fetch own articles" });
  }
});

// POST /content/:id/discussion вЂ” create the article thread (B-003). Author
// (published article) or admin; one thread per article (articleId unique).
router.post(
  "/:id/discussion",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 10, action: "article_discussion" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const article = await db.orm.public.Article.where({ id: req.params.id as string }).first();
      if (!article) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      const isAdmin = req.user!.role === "ADMIN" || req.user!.role === "MODERATOR";
      if (!isAdmin && article.authorId !== req.user!.userId) {
        res.status(403).json({ error: "Not allowed" });
        return;
      }
      if (article.status !== "PUBLISHED") {
        res.status(409).json({ error: "РћР±СЃСѓР¶РґРµРЅРёРµ РґРѕСЃС‚СѓРїРЅРѕ РґР»СЏ РѕРїСѓР±Р»РёРєРѕРІР°РЅРЅС‹С… СЃС‚Р°С‚РµР№" });
        return;
      }
      const existing = await db.orm.public.ForumThread.where({ articleId: article.id }).first();
      if (existing) {
        res.status(409).json({ error: "РћР±СЃСѓР¶РґРµРЅРёРµ СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚" });
        return;
      }
      // "РћР±СЃСѓР¶РґРµРЅРёСЏ" category when present, else first by position.
      const category =
        (await db.orm.public.ForumCategory.where({ slug: "servers" }).first()) ??
        (await db.orm.public.ForumCategory.orderBy((c: any) => c.position.asc()).first());
      if (!category) {
        res.status(409).json({ error: "Р¤РѕСЂСѓРјРЅС‹Рµ РєР°С‚РµРіРѕСЂРёРё РЅРµ РЅР°СЃС‚СЂРѕРµРЅС‹" });
        return;
      }
      const thread = await db.orm.public.ForumThread.create({
        categoryId: category.id,
        authorId: req.user!.userId,
        articleId: article.id,
        title: article.title,
      });
      await db.orm.public.ForumPost.create({
        threadId: thread.id,
        authorId: req.user!.userId,
        content: `РћР±СЃСѓР¶РґРµРЅРёРµ СЃС‚Р°С‚СЊРё В«${article.title}В». ${article.excerpt}`,
        position: 0,
      });
      await db.orm.public.ForumThread
        .where({ id: thread.id })
        .update({ lastPostAt: new Date().toISOString() });
      res.status(201).json(thread);
    } catch (error) {
      reqLog(req).error("article_discussion_failed", { error });
      res.status(500).json({ error: "Failed to create article discussion" });
    }
  }
);

// ---------- public surfaces ----------

// GET /content вЂ” public hub (E-001): PUBLISHED only, category filter,
// honest pagination.
router.get("/", standardRateLimit, async (req, res: Response) => {
  try {
    const page = Math.max(parseInt((req.query.page as string) || "1", 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || "9", 10) || 9, 1), 30);
    const category = req.query.category as string | undefined;
    const base = () => {
      const q = db.orm.public.Article.where({ status: "PUBLISHED" as const });
      return category && (CATEGORIES as readonly string[]).includes(category)
        ? q.where({ category: category as ArticleCategoryValue })
        : q;
    };
    const rows = await base()
      .orderBy((a: any) => (a.publishedAt ?? a.createdAt).desc())
      .limit(limit)
      .offset((page - 1) * limit)
      .all();
    const agg = await base().aggregate((a: any) => ({ total: a.count() }));
    const total = Number(agg.total ?? 0);

    const authorIds = Array.from(new Set(rows.map((a: any) => a.authorId as string)));
    const authors = authorIds.length
      ? await db.orm.public.User
          .where((u: any) => u.id.in(authorIds))
          .select("id", "username", "displayName", "avatar")
          .all()
      : [];
    const authorById = new Map(authors.map((u: any) => [u.id, u]));
    const threads = rows.length
      ? await db.orm.public.ForumThread
          .where((t: any) => t.articleId.in(rows.map((a: any) => a.id as string)))
          .select("articleId", "replyCount")
          .all()
      : [];
    const repliesByArticle = new Map(threads.map((t: any) => [t.articleId, t.replyCount ?? 0]));

    res.json({
      data: rows.map((a: any) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        excerpt: a.excerpt,
        coverUrl: a.coverUrl,
        category: a.category,
        tags: a.tags,
        publishedAt: a.publishedAt ?? a.createdAt,
        author: authorById.get(a.authorId) ?? null,
        replyCount: repliesByArticle.get(a.id) ?? 0,
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    reqLog(req).error("content_hub_failed", { error });
    res.status(500).json({ error: "Failed to fetch content hub" });
  }
});

// GET /content/articles/:slug вЂ” public article page (E-002). PUBLISHED only;
// links render only while the linked entity remains public.
router.get("/articles/:slug", standardRateLimit, async (req, res: Response) => {
    try {
      const article = await db.orm.public.Article
        .where({ slug: req.params.slug as string, status: "PUBLISHED" })
        .first();
      if (!article) {
        res.status(404).json({ error: "Article not found" });
        return;
      }
      const author = await db.orm.public.User
        .where({ id: article.authorId })
        .select("id", "username", "displayName", "avatar")
        .first();

      const resourceLinks = await db.orm.public.ArticleResourceLink
        .where({ articleId: article.id })
        .orderBy((l: any) => l.position.asc())
        .all();
      const resources = resourceLinks.length
        ? await db.orm.public.Resource
            .where((r: any) => r.id.in(resourceLinks.map((l: any) => l.resourceId as string)))
            .where({ status: "PUBLISHED" })
            .select("id", "slug", "title", "coverUrl", "price", "type")
            .all()
        : [];
      const serverLinks = await db.orm.public.ArticleServerLink
        .where({ articleId: article.id })
        .orderBy((l: any) => l.position.asc())
        .all();
      const servers = serverLinks.length
        ? await db.orm.public.Server
            .where((s: any) => s.id.in(serverLinks.map((l: any) => l.serverId as string)))
            .where((s: any) => s.lifecycle.in(PUBLIC_SERVER_LIFECYCLES))
            .select("id", "slug", "name", "logoUrl", "monitoring", "playerCount", "maxPlayers")
            .all()
        : [];

      const thread = await db.orm.public.ForumThread.where({ articleId: article.id }).first();

      res.json({
        id: article.id,
        slug: article.slug,
        title: article.title,
        content: article.content,
        coverUrl: article.coverUrl,
        category: article.category,
        tags: article.tags,
        publishedAt: article.publishedAt ?? article.createdAt,
        author,
        thread: thread ? { id: thread.id, replyCount: thread.replyCount } : null,
        resources,
        servers,
      });
    } catch (error) {
      reqLog(req).error("article_page_failed", { error });
      res.status(500).json({ error: "Failed to fetch article" });
    }
  }
);

export default router;
