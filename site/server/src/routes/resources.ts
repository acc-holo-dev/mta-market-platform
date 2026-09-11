// Resources API routes (CRUD for marketplace products)
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { db } from "../prisma/db.js";
import { validate, validateParam } from "../middleware/validate.js";
import {
  createResourceSchema,
  updateResourceSchema,
  paginationSchema,
  resourceFiltersSchema,
} from "../lib/validation.js";
import {
  isResourceStatus,
  isTransitionAllowed,
  RESOURCE_STATUSES,
  type ResourceStatus,
} from "../lib/moderation.js";
import { canCreateListings, sellerGateMessage } from "../lib/permissions.js";
import {
  isOwnMediaUrl,
  cleanupMediaUrl,
  MAX_SCREENSHOTS_PER_RESOURCE,
} from "../lib/media.js";
import { reqLog } from "../middleware/requestId.js";

const router: Router = Router();

// ----------------------------------------------------------------------------
// PLAN-003 A-002/A-003/A-004: resource media (cover + screenshots).
//
// Rules:
// - media URLs must reference media uploaded through POST /upload/media
//   (A-005: arbitrary URLs are rejected);
// - media is editable while the resource is DRAFT or PENDING_REVIEW вЂ”
//   published listings were approved by moderation as complete products
//   (B-006: no unrestricted changes to published resources);
// - replacement/deletion cleans up the underlying file (A-004);
// - screenshots are ordered by `position` (tie-break createdAt).
// ----------------------------------------------------------------------------
const MEDIA_EDITABLE_STATUSES = ["DRAFT", "PENDING_REVIEW"];

function mediaEditable(resource: { status: string }): boolean {
  return MEDIA_EDITABLE_STATUSES.includes(resource.status);
}

async function loadOwnResource(req: AuthRequest, slug: string) {
  const resource = await db.orm.public.Resource.where({ slug }).first();
  if (!resource) {
    return { error: "not_found" as const };
  }
  if (resource.sellerId !== req.user!.userId) {
    return { error: "forbidden" as const };
  }
  return { resource };
}

// PUT /resources/:slug/media/cover вЂ” set or replace the cover
router.put(
  "/:slug/media/cover",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { url } = req.body as { url?: string };
      if (typeof url !== "string" || !isOwnMediaUrl(url)) {
        res.status(400).json({ error: "Cover must reference a previously uploaded media file" });
        return;
      }

      const resource = await db.orm.public.Resource.where({ slug: req.params.slug as string }).first();
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      if (resource.sellerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
      if (!mediaEditable(resource)) {
        res.status(409).json({
          error: "РћС„РѕСЂРјР»РµРЅРёРµ РѕРїСѓР±Р»РёРєРѕРІР°РЅРЅРѕРіРѕ СЂРµСЃСѓСЂСЃР° РёР·РјРµРЅРёС‚СЊ РЅРµР»СЊР·СЏ. РћС‚Р·РѕРІРёС‚Рµ СЂРµСЃСѓСЂСЃ РёР»Рё СЃРѕР·РґР°Р№С‚Рµ РЅРѕРІСѓСЋ РІРµСЂСЃРёСЋ С‡РµСЂРµР· РјРѕРґРµСЂР°С†РёСЋ.",
        });
        return;
      }

      const previousUrl = resource.coverUrl;
      await db.orm.public.Resource.where({ id: resource.id }).update({ coverUrl: url });

      // A-004: the replaced cover file must not become an orphan.
      if (previousUrl && previousUrl !== url) {
        cleanupMediaUrl(previousUrl);
      }

      res.json({ coverUrl: url });
    } catch (error) {
      reqLog(req).error("cover_update_failed", { error });
      res.status(500).json({ error: "Failed to update cover" });
    }
  }
);

// DELETE /resources/:slug/media/cover вЂ” remove the cover
router.delete(
  "/:slug/media/cover",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const resource = await db.orm.public.Resource.where({ slug: req.params.slug as string }).first();
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      if (resource.sellerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
      if (!mediaEditable(resource)) {
        res.status(409).json({ error: "РћС„РѕСЂРјР»РµРЅРёРµ РѕРїСѓР±Р»РёРєРѕРІР°РЅРЅРѕРіРѕ СЂРµСЃСѓСЂСЃР° РёР·РјРµРЅРёС‚СЊ РЅРµР»СЊР·СЏ" });
        return;
      }

      const previousUrl = resource.coverUrl;
      await db.orm.public.Resource.where({ id: resource.id }).update({ coverUrl: null });
      cleanupMediaUrl(previousUrl);

      res.json({ coverUrl: null });
    } catch (error) {
      reqLog(req).error("cover_delete_failed", { error });
      res.status(500).json({ error: "Failed to remove cover" });
    }
  }
);

// POST /resources/:slug/media/screenshots вЂ” append a screenshot
router.post(
  "/:slug/media/screenshots",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { url } = req.body as { url?: string };
      if (typeof url !== "string" || !isOwnMediaUrl(url)) {
        res.status(400).json({ error: "Screenshot must reference a previously uploaded media file" });
        return;
      }

      const resource = await db.orm.public.Resource.where({ slug: req.params.slug as string }).first();
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      if (resource.sellerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
      if (!mediaEditable(resource)) {
        res.status(409).json({ error: "РћС„РѕСЂРјР»РµРЅРёРµ РѕРїСѓР±Р»РёРєРѕРІР°РЅРЅРѕРіРѕ СЂРµСЃСѓСЂСЃР° РёР·РјРµРЅРёС‚СЊ РЅРµР»СЊР·СЏ" });
        return;
      }

      const existing = await db.orm.public.ResourceMedia
        .where({ resourceId: resource.id, kind: "SCREENSHOT" })
        .all();
      if (existing.length >= MAX_SCREENSHOTS_PER_RESOURCE) {
        res.status(409).json({ error: `РњР°РєСЃРёРјСѓРј ${MAX_SCREENSHOTS_PER_RESOURCE} СЃРєСЂРёРЅС€РѕС‚РѕРІ РЅР° СЂРµСЃСѓСЂСЃ` });
        return;
      }
      if (existing.some((m: any) => m.url === url)) {
        res.status(409).json({ error: "Р­С‚РѕС‚ СЃРєСЂРёРЅС€РѕС‚ СѓР¶Рµ РґРѕР±Р°РІР»РµРЅ" });
        return;
      }

      const media = await db.orm.public.ResourceMedia.create({
        resourceId: resource.id,
        kind: "SCREENSHOT",
        url,
        position: existing.length,
      });

      res.status(201).json(media);
    } catch (error) {
      reqLog(req).error("screenshot_add_failed", { error });
      res.status(500).json({ error: "Failed to add screenshot" });
    }
  }
);

// DELETE /resources/:slug/media/screenshots/:mediaId вЂ” remove a screenshot
router.delete(
  "/:slug/media/screenshots/:mediaId",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const resource = await db.orm.public.Resource.where({ slug: req.params.slug as string }).first();
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      if (resource.sellerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
      if (!mediaEditable(resource)) {
        res.status(409).json({ error: "РћС„РѕСЂРјР»РµРЅРёРµ РѕРїСѓР±Р»РёРєРѕРІР°РЅРЅРѕРіРѕ СЂРµСЃСѓСЂСЃР° РёР·РјРµРЅРёС‚СЊ РЅРµР»СЊР·СЏ" });
        return;
      }

      const media = await db.orm.public.ResourceMedia
        .where({ id: req.params.mediaId as string, resourceId: resource.id })
        .first();
      if (!media) {
        res.status(404).json({ error: "Screenshot not found" });
        return;
      }

      await db.orm.public.ResourceMedia.where({ id: media.id }).delete();
      cleanupMediaUrl(media.url);

      // Normalize positions so the order stays contiguous (B-004).
      const rest = await db.orm.public.ResourceMedia
        .where({ resourceId: resource.id, kind: "SCREENSHOT" })
        .orderBy((m: any) => m.position.asc())
        .all();
      for (let i = 0; i < rest.length; i++) {
        if (rest[i].position !== i) {
          await db.orm.public.ResourceMedia.where({ id: rest[i].id }).update({ position: i });
        }
      }

      res.json({ ok: true });
    } catch (error) {
      reqLog(req).error("screenshot_delete_failed", { error });
      res.status(500).json({ error: "Failed to delete screenshot" });
    }
  }
);

// PUT /resources/:slug/media/screenshots/order вЂ” reorder screenshots
router.put(
  "/:slug/media/screenshots/order",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { ids } = req.body as { ids?: string[] };
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
        res.status(400).json({ error: "ids must be an array of media ids" });
        return;
      }

      const resource = await db.orm.public.Resource.where({ slug: req.params.slug as string }).first();
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      if (resource.sellerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
      if (!mediaEditable(resource)) {
        res.status(409).json({ error: "РћС„РѕСЂРјР»РµРЅРёРµ РѕРїСѓР±Р»РёРєРѕРІР°РЅРЅРѕРіРѕ СЂРµСЃСѓСЂСЃР° РёР·РјРµРЅРёС‚СЊ РЅРµР»СЊР·СЏ" });
        return;
      }

      const existing = await db.orm.public.ResourceMedia
        .where({ resourceId: resource.id, kind: "SCREENSHOT" })
        .all();
      const existingIds = new Set(existing.map((m: any) => m.id));
      if (ids.length !== existing.length || !ids.every((id) => existingIds.has(id))) {
        res.status(400).json({ error: "Order must contain every screenshot id exactly once" });
        return;
      }

      for (let i = 0; i < ids.length; i++) {
        await db.orm.public.ResourceMedia.where({ id: ids[i] }).update({ position: i });
      }

      res.json({ ok: true });
    } catch (error) {
      reqLog(req).error("screenshot_reorder_failed", { error });
      res.status(500).json({ error: "Failed to reorder screenshots" });
    }
  }
);

// PLAN-002 E-006/E-007 + PLAN-003 C/K: РєР°СЂС‚РѕС‡РєР° С‚РѕРІР°СЂР° РїРѕРєР°Р·С‹РІР°РµС‚ РїСЂРѕРґР°РІС†Р°,
// СЂРµР№С‚РёРЅРі Рё cover. Rating/reviewCount Р°РіСЂРµРіРёСЂСѓСЋС‚СЃСЏ РѕРґРЅРёРј include-Р·Р°РїСЂРѕСЃРѕРј
// (PLAN-003 S-002: РЅРµ РІС‹РїРѕР»РЅСЏС‚СЊ РїРѕ 2 Р·Р°РїСЂРѕСЃР° РЅР° РєР°Р¶РґС‹Р№ СЂРµСЃСѓСЂСЃ СЃС‚СЂР°РЅРёС†С‹).
// Additive fields вЂ” СЃСѓС‰РµСЃС‚РІСѓСЋС‰РёР№ РєРѕРЅС‚СЂР°РєС‚ РЅРµ РјРµРЅСЏРµС‚СЃСЏ.
function withCardEnrichment(resource: any): any {
  const agg = resource.reviews as { total?: number; avg?: number | null } | undefined;
  const total = Number(agg?.total ?? 0);
  const average = agg?.avg != null ? Number(agg.avg) : null;
  const seller = resource.seller as
    | { username: string | null; displayName: string | null; avatar: string | null }
    | undefined;
  const { reviews: _reviews, seller: _seller, ...rest } = resource;
  return {
    ...rest,
    seller: seller ?? null,
    rating: total > 0 && average != null ? Math.round(average * 10) / 10 : null,
    reviewCount: total,
  };
}

// Р—Р°РіСЂСѓР·РєР° РєР°СЂС‚РѕС‡РµРє c seller + review-Р°РіСЂРµРіР°С‚Р°РјРё РѕРґРЅРёРј Р·Р°РїСЂРѕСЃРѕРј.
// Р’РЎР•Р“Р”Рђ С‚РѕР»СЊРєРѕ PUBLISHED: РєР°СЂС‚РѕС‡РєРё РїСЂРµРґРЅР°Р·РЅР°С‡РµРЅС‹ РґР»СЏ РїРѕРєСѓРїР°С‚РµР»РµР№.
function cardsWithAggregates() {
  return db.orm.public.Resource
    .where({ status: "PUBLISHED" })
    .include("seller", (s: any) => s.select("username", "displayName", "avatar"))
    .include("reviews", (r: any) => r.combine({ total: r.count(), avg: r.avg("rating") }));
}

// ---------- PLAN-003 F-002/G/H/I/T: РµРґРёРЅС‹Р№ query contract ----------
// GET /resources?q=&type=&price=&sort=&page=&limit=
//   q     вЂ” РїРѕРґСЃС‚СЂРѕРєР° РїРѕ title, description Рё РёРјРµРЅРё РїСЂРѕРґР°РІС†Р° (ILIKE)
//   type  вЂ” RESOURCE TYPE enum (SCRIPT|MAP|MODEL|TEXTURE|SOUND|GAMEMODE)
//   price вЂ” free | paid
//   sort  вЂ” newest | rating | price_asc | price_desc | popular
// Р‘РµР· РїР°СЂР°РјРµС‚СЂРѕРІ РїРѕРІРµРґРµРЅРёРµ РїСЂРµР¶РЅРµРµ: published, РЅРѕРІС‹Рµ СЃРЅР°С‡Р°Р»Р° (U-003).

const RESOURCE_SORTS = ["newest", "rating", "price_asc", "price_desc", "popular"] as const;

/** Р Р°Р·СЂРµС€РµРЅРёРµ РїСЂРѕРґР°РІС†РѕРІ, С‡СЊС‘ РёРјСЏ/username СЃРѕРІРїР°РґР°РµС‚ СЃ РїРѕРёСЃРєРѕРІС‹Рј Р·Р°РїСЂРѕСЃРѕРј. */
async function resolveSellerIds(q: string): Promise<string[]> {
  const pattern = `%${q}%`;
  const [byUsername, byDisplay] = await Promise.all([
    db.orm.public.User.where((u: any) => u.username.ilike(pattern)).select("id").limit(50).all(),
    db.orm.public.User.where((u: any) => u.displayName.ilike(pattern)).select("id").limit(50).all(),
  ]);
  const ids = new Set<string>();
  for (const row of [...byUsername, ...byDisplay]) ids.add(row.id);
  return [...ids];
}

/**
 * F-002/F-006: РЅР°СЃС‚РѕСЏС‰РёР№ РїРѕРёСЃРє РїРѕ title/description/РёРјРµРЅРё РїСЂРѕРґР°РІС†Р°.
 * РЈ СѓСЃС‚Р°РЅРѕРІР»РµРЅРЅРѕР№ СЃР±РѕСЂРєРё ORM РЅРµС‚ OR-РєРѕРјР±РёРЅР°С‚РѕСЂР°, РїРѕСЌС‚РѕРјСѓ РІРµС‚РєРё РїРѕРёСЃРєР°
 * РѕР±СЉРµРґРёРЅСЏСЋС‚СЃСЏ РїРѕ id (РєР°Р¶РґР°СЏ РІРµС‚РєР° вЂ” ILIKE-Р·Р°РїСЂРѕСЃ СЃ Р»РёРјРёС‚РѕРј).
 */
async function resolveSearchIds(q: string): Promise<string[]> {
  const pattern = `%${q}%`;
  const [byTitle, byDescription, sellerIds] = await Promise.all([
    db.orm.public.Resource.where((r: any) => r.title.ilike(pattern)).select("id").limit(400).all(),
    db.orm.public.Resource.where((r: any) => r.description.ilike(pattern)).select("id").limit(400).all(),
    resolveSellerIds(q),
  ]);

  const ids = new Set<string>();
  for (const row of byTitle) ids.add(row.id);
  for (const row of byDescription) ids.add(row.id);

  if (sellerIds.length > 0) {
    const bySeller = await db.orm.public.Resource
      .where((r: any) => r.sellerId.in(sellerIds))
      .select("id")
      .limit(400)
      .all();
    for (const row of bySeller) ids.add(row.id);
  }

  return [...ids];
}

/**
 * I-004: РЅР°СЃС‚РѕСЏС‰РёР№ popularity signal вЂ” РєРѕР»РёС‡РµСЃС‚РІРѕ Р·Р°РІРµСЂС€С‘РЅРЅС‹С… РїРѕРєСѓРїРѕРє
 * (COMPLETED purchases), СЃРіСЂСѓРїРїРёСЂРѕРІР°РЅРЅС‹С… РїРѕ СЂРµСЃСѓСЂСЃСѓ. РќРёРєР°РєРѕРіРѕ fake ranking.
 */
async function loadPopularity(): Promise<Map<string, number>> {
  const rows = await db.orm.public.Purchase
    .where({ status: "COMPLETED" })
    .groupBy("resourceId")
    .aggregate((a: any) => ({ total: a.count() }));
  const map = new Map<string, number>();
  for (const row of rows as any[]) {
    map.set(row.resourceId, Number(row.total ?? 0));
  }
  return map;
}

// GET /resources - List all published resources
router.get(
  "/",
  standardRateLimit,
  validate(paginationSchema.merge(resourceFiltersSchema), "query"),
  async (req, res: Response) => {
    try {
      const { page, limit, q, type, price, sort } = req.query as any;
      const skip = (page - 1) * limit;
      const sortValue: string = RESOURCE_SORTS.includes(sort) ? sort : "newest";

      // Р‘Р°Р·РѕРІС‹Рµ РїСЂРµРґРёРєР°С‚С‹ СЃРѕР±РёСЂР°СЋС‚СЃСЏ С†РµРїРѕС‡РєРѕР№ where (AND-РєРѕРјРїРѕР·РёС†РёСЏ).
      // РљРѕР»Р»РµРєС†РёРё ORM РёРјРјСѓС‚Р°Р±РµР»СЊРЅС‹ вЂ” РєРѕРїРёСЏ СЃ С„РёР»СЊС‚СЂР°РјРё СЃС‚СЂРѕРёС‚СЃСЏ С„СѓРЅРєС†РёРµР№.
      const buildFiltered = () => {
        let q2: any = db.orm.public.Resource.where({ status: "PUBLISHED" });
        if (type) {
          q2 = q2.where({ type });
        }
        if (price === "free") {
          q2 = q2.where({ price: 0 });
        } else if (price === "paid") {
          q2 = q2.where((r: any) => r.price.gt(0));
        }
        return q2;
      };

      // F-002: РїРѕРёСЃРє вЂ” РѕР±СЉРµРґРёРЅСЏРµРј СЃРѕРІРїР°РІС€РёРµ id Рё С„РёР»СЊС‚СЂСѓРµРј РїРѕ РЅРёРј.
      let searchIds: string[] | null = null;
      if (q && typeof q === "string" && q.trim().length > 0) {
        const ids = await resolveSearchIds(q.trim());
        if (ids.length === 0) {
          res.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } });
          return;
        }
        searchIds = ids;
      }
      const filtered = () => {
        const q2 = buildFiltered();
        return searchIds ? q2.where((r: any) => r.id.in(searchIds!)) : q2;
      };

      const baseCount = await filtered().aggregate((agg: any) => ({ total: agg.count() }));
      const total = Number(baseCount.total);

      const respond = (cards: any[]) => {
        res.json({
          data: cards.map(withCardEnrichment),
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        });
      };

      // РџСЂРѕСЃС‚С‹Рµ СЃРѕСЂС‚РёСЂРѕРІРєРё РІС‹РїРѕР»РЅСЏСЋС‚СЃСЏ РІ Р‘Р”: СЃРЅР°С‡Р°Р»Р° id-СЃС‚СЂР°РЅРёС†Р°, Р·Р°С‚РµРј
      // РєР°СЂС‚РѕС‡РєРё РѕРґРЅРёРј Р·Р°РїСЂРѕСЃРѕРј (S-002: Р±РµР· N+1 enrichment).
      if (sortValue === "newest" || sortValue === "price_asc" || sortValue === "price_desc") {
        const orderBy =
          sortValue === "newest"
            ? [(m: any) => m.createdAt.desc()]
            : sortValue === "price_asc"
              ? [(m: any) => m.price.asc(), (m: any) => m.createdAt.desc()]
              : [(m: any) => m.price.desc(), (m: any) => m.createdAt.desc()];
        const idRows = await filtered().select("id").orderBy(orderBy).limit(limit).offset(skip).all();
        const pageIds = idRows.map((r: any) => r.id);
        if (pageIds.length === 0) {
          respond([]);
          return;
        }
        const cards = await cardsWithAggregates().where((r: any) => r.id.in(pageIds)).all();
        const byId = new Map(cards.map((c: any) => [c.id, c]));
        respond(pageIds.map((id: string) => byId.get(id)).filter(Boolean));
        return;
      }

      // rating / popular: РЅСѓР¶РЅС‹ Р°РіСЂРµРіР°С‚С‹ РѕС‚Р·С‹РІРѕРІ/РїРѕРєСѓРїРѕРє вЂ” Р±РµСЂС‘Рј
      // РѕС‚С„РёР»СЊС‚СЂРѕРІР°РЅРЅС‹Р№ РЅР°Р±РѕСЂ (РєР°Рї 1000) Рё СЃРѕСЂС‚РёСЂСѓРµРј РІ РїР°РјСЏС‚Рё.
      const rows = await filtered().select("id").limit(1000).all();
      const matchIds = rows.map((r: any) => r.id);
      if (matchIds.length === 0) {
        respond([]);
        return;
      }

      const cardRows = await cardsWithAggregates().where((r: any) => r.id.in(matchIds)).all();
      const aggRows = await db.orm.public.Review
        .groupBy("resourceId")
        .aggregate((a: any) => ({ total: a.count(), avg: a.avg("rating") }));
      const aggMap = new Map<string, { total: number; avg: number | null }>();
      for (const row of aggRows as any[]) {
        aggMap.set(row.resourceId, {
          total: Number(row.total ?? 0),
          avg: row.avg != null ? Number(row.avg) : null,
        });
      }

      let sorted = cardRows;
      if (sortValue === "rating") {
        sorted = cardRows.sort((a: any, b: any) => {
          const aggA = aggMap.get(a.id);
          const aggB = aggMap.get(b.id);
          const ar = Number(aggA?.total ?? 0) > 0 ? Number(aggA?.avg ?? 0) : -1;
          const br = Number(aggB?.total ?? 0) > 0 ? Number(aggB?.avg ?? 0) : -1;
          if (br !== ar) return br - ar;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      } else {
        const popularity = await loadPopularity();
        sorted = cardRows.sort((a: any, b: any) => {
          const pa = popularity.get(a.id) ?? 0;
          const pb = popularity.get(b.id) ?? 0;
          if (pb !== pa) return pb - pa;
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });
      }

      res.json({
        data: sorted.slice(skip, skip + limit).map(withCardEnrichment),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (error) {
      reqLog(req).error("resources_fetch_failed", { error });
      res.status(500).json({ error: "Failed to fetch resources" });
    }
  }
);

// PLAN-003 J-006: Р°РіСЂРµРіРёСЂРѕРІР°РЅРЅС‹Рµ РґР°РЅРЅС‹Рµ РґР»СЏ homepage вЂ” РѕРґРёРЅ Р·Р°РїСЂРѕСЃ РІРјРµСЃС‚Рѕ
// С‚СЂС‘С… РЅРµР·Р°РІРёСЃРёРјС‹С… РІС‹Р·РѕРІРѕРІ СЃ С„СЂРѕРЅС‚РµРЅРґР°. Р РµР°Р»СЊРЅС‹Рµ СЃРµРєС†РёРё: РЅРѕРІРёРЅРєРё (createdAt),
// РїРѕРїСѓР»СЏСЂРЅРѕРµ (Р·Р°РІРµСЂС€С‘РЅРЅС‹Рµ РїРѕРєСѓРїРєРё; fallback вЂ” СЂРµР№С‚РёРЅРі РѕС‚Р·С‹РІРѕРІ), Р±РµСЃРїР»Р°С‚РЅС‹Рµ.
router.get("/homepage", standardRateLimit, async (req, res: Response) => {
  try {
    const [newest, popularRows, free, popularity] = await Promise.all([
      cardsWithAggregates().orderBy((m: any) => m.createdAt.desc()).limit(8).all(),
      cardsWithAggregates().limit(200).all(),
      cardsWithAggregates()
        .where({ price: 0 })
        .orderBy((m: any) => m.createdAt.desc())
        .limit(8)
        .all(),
      loadPopularity(),
    ]);

    const withPurchases = [...popularRows]
      .filter((r: any) => (popularity.get(r.id) ?? 0) > 0)
      .sort((a: any, b: any) => {
        const pa = popularity.get(a.id) ?? 0;
        const pb = popularity.get(b.id) ?? 0;
        if (pb !== pa) return pb - pa;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 8);

    // Р•СЃР»Рё РїРѕРєСѓРїРѕРє РїРѕРєР° РЅРµС‚ вЂ” В«РїРѕРїСѓР»СЏСЂРЅРѕРµВ» РґРµРіСЂР°РґРёСЂСѓРµС‚ РІ РІС‹СЃРѕРєРёР№ СЂРµР№С‚РёРЅРі
    // (СЂРµР°Р»СЊРЅС‹Р№ СЃРёРіРЅР°Р» РѕС‚Р·С‹РІРѕРІ), Р±РµР· РІС‹РґСѓРјР°РЅРЅРѕРіРѕ ranking.
    const popular =
      withPurchases.length > 0
        ? withPurchases
        : popularRows
            .sort((a: any, b: any) => {
              const ra =
                Number(a.reviews?.total ?? 0) > 0 ? Number(a.reviews?.avg ?? 0) : -1;
              const rb =
                Number(b.reviews?.total ?? 0) > 0 ? Number(b.reviews?.avg ?? 0) : -1;
              if (rb !== ra) return rb - ra;
              return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            })
            .filter((r: any) => Number(r.reviews?.total ?? 0) > 0)
            .slice(0, 8);

    res.json({
      newest: newest.map(withCardEnrichment),
      popular: popular.map(withCardEnrichment),
      free: free.map(withCardEnrichment),
    });
  } catch (error) {
    reqLog(req).error("homepage_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch homepage data" });
  }
});

// GET /resources/my - Seller's own resources (PLAN M-002; must precede /:slug)
router.get("/my", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const resources = await db.orm.public.Resource.where({ sellerId: req.user!.userId })
      .orderBy((m) => m.createdAt.desc())
      .all();
    res.json({ data: resources, total: resources.length });
  } catch (error) {
    reqLog(req).error("resources_my_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch own resources" });
  }
});

// GET /resources/:slug/media вЂ” owner-only media state for editing (B-006):
// drafts are not publicly visible, but the seller must be able to manage
// their presentation before publication.
router.get(
  "/:slug/media",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const resource = await db.orm.public.Resource
        .where({ slug: req.params.slug as string })
        .first();
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }
      if (resource.sellerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }

      const screenshots = await db.orm.public.ResourceMedia
        .where({ resourceId: resource.id, kind: "SCREENSHOT" })
        .orderBy((m: any) => m.position.asc())
        .all();

      res.json({
        coverUrl: resource.coverUrl ?? null,
        screenshots: screenshots.map((m: any) => ({
          id: m.id,
          url: m.url,
          position: Number(m.position ?? 0),
        })),
        editable: mediaEditable(resource),
      });
    } catch (error) {
      reqLog(req).error("resource_media_fetch_failed", { error });
      res.status(500).json({ error: "Failed to fetch resource media" });
    }
  }
);

// GET /resources/:slug - Get resource by slug (with media, D-001/D-002)
// PLAN-010 B-001: honest page-view counter. Public (guests count too);
// no viewer identities are ever stored вЂ” resource Г— day Г— count only.
// Views are shown exclusively to the resource's seller (not a public metric).
router.post("/:slug/view", standardRateLimit, async (req, res: Response) => {
  try {
    const resource = await db.orm.public.Resource
      .where({ slug: req.params.slug as string })
      .select("id", "status")
      .first();
    if (!resource || resource.status !== "PUBLISHED") {
      res.status(404).json({ error: "Resource not found" });
      return;
    }
    const day = new Date().toISOString().slice(0, 10);
    const existing = await db.orm.public.ResourceViewDaily
      .where({ resourceId: resource.id, day })
      .first();
    if (existing) {
      await db.orm.public.ResourceViewDaily
        .where({ id: existing.id })
        .update({ views: existing.views + 1 });
    } else {
      await db.orm.public.ResourceViewDaily.create({
        resourceId: resource.id as string,
        day,
        views: 1,
      });
    }
    res.json({ ok: true });
  } catch (error) {
    reqLog(req).error("resource_view_failed", { error });
    res.status(500).json({ error: "Failed to count view" });
  }
});

router.get("/:slug", standardRateLimit, async (req, res: Response) => {
  try {
    const slug = req.params.slug as string;

    const resource = await cardsWithAggregates().where({ slug }).first();

    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    // Only show published resources to non-owners
    if (resource.status !== "PUBLISHED") {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    // PLAN-008: aggregate follower count only вЂ” lists never exposed (В§42).
    const followersAgg = await db.orm.public.ResourceFollow
      .where({ resourceId: resource.id })
      .aggregate((a: any) => ({ total: a.count() }));

    // Gallery data (D-002): screenshots ordered by their stable position.
    const screenshots = await db.orm.public.ResourceMedia
      .where({ resourceId: resource.id, kind: "SCREENSHOT" })
      .orderBy((m: any) => m.position.asc())
      .all();

    res.json({
      ...withCardEnrichment(resource),
      resourceFollowers: Number(followersAgg.total ?? 0),
      screenshots: screenshots.map((m: any) => ({
        id: m.id,
        url: m.url,
        position: Number(m.position ?? 0),
      })),
    });
  } catch (error) {
    reqLog(req).error("resource_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch resource" });
  }
});

// POST /resources - Create new resource (seller-gated, PLAN L-002)
router.post(
  "/",
  authenticate,
  standardRateLimit,
  validate(createResourceSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      // PLAN L-002: listing creation requires an APPROVED seller profile.
      if (!(await canCreateListings({ userId: req.user!.userId, role: req.user!.role as "USER" | "ADMIN" | "MODERATOR" }))) {
        res.status(403).json({ error: sellerGateMessage(), code: "seller_approval_required" });
        return;
      }

      const { title, description, type, price, slug } = req.body;

      // Check slug uniqueness
      const existing = await db.orm.public.Resource.where({ slug }).first();

      if (existing) {
        res.status(409).json({ error: "Slug already exists" });
        return;
      }

      const resource = await db.orm.public.Resource.create({
        sellerId: req.user!.userId,
        slug,
        title,
        description,
        type,
        price, // Already validated as non-negative int in kopecks
        status: "DRAFT",
      });

      res.status(201).json(resource);
    } catch (error) {
      reqLog(req).error("resource_create_failed", { error });
      res.status(500).json({ error: "Failed to create resource" });
    }
  }
);

// PATCH /resources/:slug - Update resource (authenticated, owner only)
router.patch("/:slug", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const slug = req.params.slug as string;
    const { title, description, price, status } = req.body;

    const resource = await db.orm.public.Resource.where({ slug }).first();

    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    if (resource.sellerId !== req.user!.userId) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    const updateData: any = {};
    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (price !== undefined) updateData.price = Math.round(price * 100);

    // TASK A-008: sellers may only submit (DRAFT -> PENDING_REVIEW) or
    // withdraw (PENDING_REVIEW -> DRAFT). Publishing, suspending, unsuspending
    // and unpublishing are moderation-only вЂ” transition matrix, not a blocklist
    // (the old allowlist let sellers "unsuspend" via SUSPENDED -> DRAFT).
    if (status) {
      if (!isResourceStatus(status)) {
        res.status(400).json({ error: `Invalid status. Allowed: DRAFT, PENDING_REVIEW` });
        return;
      }

      const from = resource.status as ResourceStatus;
      if (!isTransitionAllowed(from, status, "seller")) {
        reqLog(req).warn("resource_status_transition_denied", {
          user_id: req.user!.userId,
          from,
          to: status,
          resource_id: resource.id,
        });
        res.status(403).json({
          error: "Forbidden status transition",
          message: `Sellers may only submit (DRAFT -> PENDING_REVIEW) or withdraw (PENDING_REVIEW -> DRAFT). Current status: ${from}.`,
        });
        return;
      }

      updateData.status = status;
    }

    const updated = await db.orm.public.Resource.where({ id: resource.id }).update(updateData);

    res.json(updated);
  } catch (error) {
    reqLog(req).error("resource_update_failed", { error });
    res.status(500).json({ error: "Failed to update resource" });
  }
});

// DELETE /resources/:slug - Delete resource (authenticated, owner only)
router.delete(
  "/:slug",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const slug = req.params.slug as string;

      const resource = await db.orm.public.Resource.where({ slug }).first();

      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      if (resource.sellerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }

      if (resource.sellerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }

      // PLAN-003 A-004: РјРµРґРёР° РЅРµ РґРѕР»Р¶РЅРѕ РѕСЃС‚Р°РІР°С‚СЊСЃСЏ Р±РµСЃС…РѕР·РЅС‹Рј РїСЂРё СѓРґР°Р»РµРЅРёРё
      // СЂРµСЃСѓСЂСЃР° (rows СѓС…РѕРґСЏС‚ РїРѕ cascade вЂ” С„Р°Р№Р»С‹ СѓРґР°Р»СЏРµРј СЏРІРЅРѕ, best-effort).
      cleanupMediaUrl(resource.coverUrl);
      const mediaRows = await db.orm.public.ResourceMedia
        .where({ resourceId: resource.id })
        .all();
      for (const m of mediaRows as any[]) {
        cleanupMediaUrl(m.url);
      }

      await db.orm.public.Resource.where({ id: resource.id }).delete();

      res.json({ message: "Resource deleted successfully" });
    } catch (error) {
      reqLog(req).error("resource_delete_failed", { error });
      res.status(500).json({ error: "Failed to delete resource" });
    }
  }
);

export default router;
