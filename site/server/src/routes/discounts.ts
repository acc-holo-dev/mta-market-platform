// Seller discount campaign CRUD (PLAN-018 B-001/B-002). Mounted at /seller
// (paths relative: /discounts).
//
// Scope handling per lib/discount.ts + the DiscountCampaign model: a campaign
// is scoped to the seller's whole catalog (scope ALL) or to ONE resource
// (scope RESOURCE + scopeId) — the model has a single scopeId. A request with
// several resourceIds therefore creates one campaign per resource (an honest
// mapping of the plural API field onto the model; a promo code stays unique
// per seller and cannot be attached to more than one campaign).
//
// Backend-only validation mirrors lib/discount.ts checkout rules:
// percent 1..99, fixed ≤ the cheapest applicable product (kopecks), window
// sanity, usage limits (MVP: perUserLimit null or 1). Checkout-side enforcement
// stays authoritative — these validations only stop a seller from creating a
// campaign that could never apply cleanly.
import { Router, Response } from "express";
import { db } from "../prisma/db.js";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { validateCuid } from "../middleware/validateCuid.js";
import { reqLog } from "../middleware/requestId.js";
import { recordAudit } from "../lib/audit.js";
import { isUniqueViolation } from "../lib/dbErrors.js";

const router: Router = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CampaignRow = any;

function badRequest(res: Response, message: string, code?: string): void {
  res.status(400).json({ error: message, ...(code ? { code } : {}) });
}

/** Seller gate: discount CRUD requires an APPROVED seller profile. */
async function requireApprovedSeller(req: AuthRequest, res: Response): Promise<boolean> {
  const profile = await db.orm.public.SellerProfile
    .where({ userId: req.user!.userId })
    .first();
  if (!profile || profile.status !== "APPROVED") {
    res.status(403).json({
      error: "Требуется одобренный профиль продавца",
      code: "seller_not_approved",
    });
    return false;
  }
  return true;
}

function parseDate(value: unknown, field: string, res: Response): Date | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  const at = new Date(String(value));
  if (Number.isNaN(at.getTime())) {
    badRequest(res, `Некорректная дата: ${String(field)}`, "invalid_date");
    return "invalid";
  }
  return at;
}

/** Validate PERCENT/FIXED value ranges; FIXED is capped by the cheapest product. */
function validateValue(
  type: "PERCENT" | "FIXED",
  value: number,
  cheapestMinor: number | null
): string | null {
  if (type === "PERCENT") {
    if (!Number.isInteger(value) || value < 1 || value > 99) {
      return "Процент скидки должен быть целым числом от 1 до 99";
    }
    return null;
  }
  if (!Number.isInteger(value) || value < 1) {
    return "Фиксированная скидка должна быть положительным целым числом (в копейках)";
  }
  if (cheapestMinor != null && value > cheapestMinor) {
    return `Фиксированная скидка не может превышать цену самого дешёвого товара (${cheapestMinor} копеек)`;
  }
  return null;
}

/** Cheapest PUBLISHED price among the given resource ids (null when none).
 * Free (price 0) products are excluded: a fixed discount cannot meaningfully
 * apply to them, and they must not block the seller's fixed campaigns. */
async function cheapestOfResources(resourceIds: string[]): Promise<number | null> {
  if (resourceIds.length === 0) return null;
  const rows = await db.orm.public.Resource
    .where((r: any) => r.id.in(resourceIds))
    .select("price")
    .all();
  const prices = rows
    .map((r: any) => Number(r.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  return prices.length ? Math.min(...prices) : null;
}

/**
 * Honest usage counts for the given campaigns, from the authoritative
 * DiscountUsage rows (cross-checks the CAS counter usedCount). The groupBy
 * chain is loosened here exactly like routes/adminPlatform.ts countBy()
 * (verified against a live DB — the static ORM typing models groupBy rows as
 * full table rows).
 */
async function usageCountsByCampaign(campaignIds: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (campaignIds.length === 0) return map;
  const rows = await (
    db.orm.public.DiscountUsage.where((u: any) => u.campaignId.in(campaignIds)) as unknown as {
      groupBy: (cols: string[]) => {
        aggregate: (
          fn: (agg: Record<string, (...args: unknown[]) => unknown>) => Record<string, unknown>
        ) => Promise<Array<Record<string, unknown>>>;
      };
    }
  )
    .groupBy(["campaignId"])
    .aggregate((agg) => ({ n: agg.count() }));
  for (const row of rows as unknown as Array<{ campaignId: string; n: number }>) {
    map.set(String(row.campaignId), Number(row.n));
  }
  return map;
}

/** Cheapest PUBLISHED price across a seller's catalog (null when none).
 * Free (price 0) products are excluded (see cheapestOfResources). */
async function cheapestOfSeller(sellerId: string): Promise<number | null> {
  const rows = await db.orm.public.Resource
    .where((r: any) => r.price.gt(0))
    .where({ sellerId, status: "PUBLISHED" })
    .select("price")
    .all();
  const prices = rows
    .map((r: any) => Number(r.price))
    .filter((p) => Number.isFinite(p) && p > 0);
  return prices.length ? Math.min(...prices) : null;
}

interface DiscountWindow {
  startsAt: Date | null;
  endsAt: Date | null;
}

/** Window sanity: parseable dates, endsAt after startsAt, window not already over. */
function validateWindow(startsAt: Date | null, endsAt: Date | null): string | null {
  if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return "Дата окончания должна быть позже даты начала";
  }
  if (endsAt && endsAt.getTime() < Date.now()) {
    return "Дата окончания скидки уже в прошлом";
  }
  return null;
}

function deriveName(type: "PERCENT" | "FIXED", value: number, code: string | null): string {
  if (code) return code;
  return type === "PERCENT" ? `Скидка ${value}%` : `Скидка ${(value / 100).toFixed(2)} ₽`;
}

// ---------------------------------------------------------------------------
// POST /seller/discounts — create campaign(s)
// ---------------------------------------------------------------------------
router.post(
  "/discounts",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!(await requireApprovedSeller(req, res))) return;
      const sellerId = req.user!.userId;
      const body = req.body ?? {};

      const type = body.type as "PERCENT" | "FIXED" | undefined;
      if (type !== "PERCENT" && type !== "FIXED") {
        badRequest(res, "Тип скидки должен быть PERCENT или FIXED", "invalid_type");
        return;
      }
      const value = Number(body.value);
      if (!Number.isFinite(value)) {
        badRequest(res, "Не указано значение скидки", "invalid_value");
        return;
      }

      // Scope resolution: resourceIds | allSellerResources | catalog-wide ALL.
      const resourceIds: string[] = Array.isArray(body.resourceIds)
        ? body.resourceIds.map((id: unknown) => String(id))
        : [];
      const allSellerResources = Boolean(body.allSellerResources);
      if (allSellerResources && resourceIds.length > 0) {
        badRequest(res, "Укажите либо resourceIds, либо allSellerResources, но не оба", "ambiguous_scope");
        return;
      }

      // Window.
      const startsAt = parseDate(body.startsAt, "startsAt", res);
      if (startsAt === "invalid") return;
      const endsAt = parseDate(body.endsAt, "endsAt", res);
      if (endsAt === "invalid") return;
      const windowError = validateWindow(startsAt as Date | null, endsAt as Date | null);
      if (windowError) {
        badRequest(res, windowError, "invalid_window");
        return;
      }

      // Limits (mirror lib/discount.ts: perUserLimit MVP is null or 1).
      const usageLimit =
        body.usageLimit === undefined || body.usageLimit === null
          ? null
          : Number(body.usageLimit);
      if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) {
        badRequest(res, "Лимит использований должен быть целым числом ≥ 1", "invalid_usage_limit");
        return;
      }
      const perUserLimit =
        body.perUserLimit === undefined || body.perUserLimit === null
          ? null
          : Number(body.perUserLimit);
      if (perUserLimit !== null && (!Number.isInteger(perUserLimit) || perUserLimit < 1 || perUserLimit > 1)) {
        badRequest(res, "Лимит на пользователя поддерживается только как 1 или без лимита", "invalid_per_user_limit");
        return;
      }
      const minOrderMinor =
        body.minOrderMinor === undefined || body.minOrderMinor === null
          ? null
          : Number(body.minOrderMinor);
      if (minOrderMinor !== null && (!Number.isInteger(minOrderMinor) || minOrderMinor < 0)) {
        badRequest(res, "Минимальная сумма заказа должна быть неотрицательным целым (в копейках)", "invalid_min_order");
        return;
      }

      const code =
        typeof body.code === "string" && body.code.trim()
          ? body.code.trim().slice(0, 64)
          : null;

      // Value vs the cheapest applicable product (FIXED only).
      let cheapest: number | null = null;
      if (!allSellerResources && resourceIds.length > 0) {
        const owned = await db.orm.public.Resource
          .where((r: any) => r.id.in(resourceIds))
          .where({ sellerId })
          .select("id")
          .all();
        if (owned.length !== new Set(resourceIds).size) {
          badRequest(res, "Указан товар, не принадлежащий вам", "resource_not_owned");
          return;
        }
        cheapest = await cheapestOfResources(resourceIds);
        if (type === "FIXED" && cheapest == null) {
          badRequest(res, "У указанных товаров нет цены", "invalid_value");
          return;
        }
      } else {
        cheapest = await cheapestOfSeller(sellerId);
        if (type === "FIXED" && cheapest == null) {
          badRequest(res, "Нет опубликованных товаров для применения фиксированной скидки", "invalid_value");
          return;
        }
      }
      const valueError = validateValue(type, value, cheapest);
      if (valueError) {
        badRequest(res, valueError, "invalid_value");
        return;
      }

      // A promo code can belong to only one campaign: >1 scoped resources with
      // a code is contradictory (unique [sellerId, code] would collide).
      if (code && !allSellerResources && resourceIds.length > 1) {
        badRequest(res, "Промокод может применяться только к одной кампании", "code_scope_conflict");
        return;
      }

      const name =
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim().slice(0, 120)
          : deriveName(type, value, code);

      const startsAtIso = startsAt ? (startsAt as Date).toISOString() : null;
      const endsAtIso = endsAt ? (endsAt as Date).toISOString() : null;

      const targets: { scope: "ALL" | "RESOURCE"; scopeId: string | null }[] = allSellerResources
        ? [{ scope: "ALL", scopeId: null }]
        : resourceIds.length > 0
          ? resourceIds.map((id) => ({ scope: "RESOURCE" as const, scopeId: id }))
          : [{ scope: "ALL", scopeId: null }];

      const campaigns: CampaignRow[] = [];
      for (const target of targets) {
        try {
          const campaign = await db.orm.public.DiscountCampaign.create({
            sellerId,
            name,
            code,
            type,
            value,
            currency: "RUB",
            scope: target.scope,
            scopeId: target.scopeId,
            startsAt: startsAtIso,
            endsAt: endsAtIso,
            isActive: true,
            usageLimit,
            perUserLimit,
            minOrderAmount: minOrderMinor,
            usedCount: 0,
          });
          campaigns.push(campaign);
        } catch (error) {
          // The only unique constraint on this table is [sellerId, code]:
          // any 23505 here is a duplicate promo code.
          if (isUniqueViolation(error)) {
            res.status(409).json({
              error: "Промокод с таким именем уже существует",
              code: "code_already_exists",
            });
            return;
          }
          throw error;
        }
      }

      await recordAuditSafe({
        actorId: sellerId,
        action: "discount_created",
        targetType: "discount_campaign",
        targetId: campaigns[0].id,
        after: {
          count: campaigns.length,
          type,
          value,
          scope: campaigns.length > 1 ? "RESOURCE[]" : campaigns[0].scope,
          code,
        },
        ip: req.ip,
        requestId: req.id,
      });

      reqLog(req).info("seller_discount_created", {
        user_id: sellerId,
        campaigns: campaigns.length,
        type,
        value,
      });
      res.status(201).json({ campaigns });
    } catch (error) {
      reqLog(req).error("seller_discount_create_failed", { error });
      res.status(500).json({ error: "Failed to create discount campaign" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /seller/discounts — own campaigns with honest usage counts
// ---------------------------------------------------------------------------
router.get(
  "/discounts",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const limit = Math.min(
        Math.max(1, parseInt(String(req.query.limit ?? "50"), 10) || 50),
        100
      );
      const base = () => db.orm.public.DiscountCampaign.where({ sellerId: req.user!.userId });
      const [rows, totalAgg] = await Promise.all([
        base()
          .orderBy((c: any) => c.createdAt.desc())
          .limit(limit)
          .offset((page - 1) * limit)
          .all(),
        base().aggregate((a: any) => ({ total: a.count() })),
      ]);
      const total = Number((totalAgg as { total?: number }).total ?? 0);

      const ids = rows.map((r: any) => r.id as string);
      const usageByCampaign = await usageCountsByCampaign(ids);

      res.json({
        discounts: rows.map((c: any) => ({ ...c, usageCount: usageByCampaign.get(c.id) ?? 0 })),
        total,
        page,
        limit,
      });
    } catch (error) {
      reqLog(req).error("seller_discount_list_failed", { error });
      res.status(500).json({ error: "Failed to fetch discount campaigns" });
    }
  }
);

// ---------------------------------------------------------------------------
// PATCH /seller/discounts/:id — edit own campaign (only while inactive)
// ---------------------------------------------------------------------------
router.patch(
  "/discounts/:id",
  authenticate,
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const campaign = await db.orm.public.DiscountCampaign
        .where({ id: req.params.id as string, sellerId: req.user!.userId })
        .first();
      if (!campaign) {
        res.status(404).json({ error: "Кампания не найдена", code: "campaign_not_found" });
        return;
      }
      if (campaign.isActive) {
        res.status(409).json({
          error: "Деактивируйте кампанию перед редактированием",
          code: "campaign_active",
        });
        return;
      }

      const body = req.body ?? {};
      const type = (body.type ?? campaign.type) as "PERCENT" | "FIXED";
      if (type !== "PERCENT" && type !== "FIXED") {
        badRequest(res, "Тип скидки должен быть PERCENT или FIXED", "invalid_type");
        return;
      }
      const value = body.value === undefined ? Number(campaign.value) : Number(body.value);

      // Merged window sanity (partial updates merge with stored values).
      const startsAtRaw = body.startsAt !== undefined ? body.startsAt : campaign.startsAt;
      const endsAtRaw = body.endsAt !== undefined ? body.endsAt : campaign.endsAt;
      const startsAt = parseDate(startsAtRaw, "startsAt", res);
      if (startsAt === "invalid") return;
      const endsAt = parseDate(endsAtRaw, "endsAt", res);
      if (endsAt === "invalid") return;
      const windowError = validateWindow(startsAt as Date | null, endsAt as Date | null);
      if (windowError) {
        badRequest(res, windowError, "invalid_window");
        return;
      }

      // FIXED stays capped by the cheapest applicable product.
      let cheapest: number | null = null;
      if (type === "FIXED") {
        cheapest =
          campaign.scope === "RESOURCE" && campaign.scopeId
            ? await cheapestOfResources([campaign.scopeId as string])
            : await cheapestOfSeller(req.user!.userId);
      }
      const valueError = validateValue(type, value, cheapest);
      if (valueError) {
        badRequest(res, valueError, "invalid_value");
        return;
      }

      const usageLimit =
        body.usageLimit === undefined ? campaign.usageLimit : Number(body.usageLimit);
      if (usageLimit !== null && (!Number.isInteger(usageLimit) || usageLimit < 1)) {
        badRequest(res, "Лимит использований должен быть целым числом ≥ 1", "invalid_usage_limit");
        return;
      }
      if (usageLimit !== null && Number(campaign.usedCount) > usageLimit) {
        res.status(409).json({
          error: "Лимит использований не может быть меньше уже израсходованного числа",
          code: "usage_limit_below_used",
        });
        return;
      }

      const perUserLimit =
        body.perUserLimit === undefined
          ? campaign.perUserLimit
          : body.perUserLimit === null
            ? null
            : Number(body.perUserLimit);
      if (perUserLimit !== null && (!Number.isInteger(perUserLimit) || perUserLimit < 1 || perUserLimit > 1)) {
        badRequest(res, "Лимит на пользователя поддерживается только как 1 или без лимита", "invalid_per_user_limit");
        return;
      }

      const minOrderMinor =
        body.minOrderMinor === undefined
          ? campaign.minOrderAmount
          : body.minOrderMinor === null
            ? null
            : Number(body.minOrderMinor);
      if (minOrderMinor !== null && (!Number.isInteger(minOrderMinor) || minOrderMinor < 0)) {
        badRequest(res, "Минимальная сумма заказа должна быть неотрицательным целым", "invalid_min_order");
        return;
      }

      const updates: Record<string, unknown> = {};
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) {
          badRequest(res, "Название кампании не может быть пустым", "invalid_name");
          return;
        }
        updates.name = name.slice(0, 120);
      }
      if (body.code !== undefined) {
        const code = body.code === null ? null : String(body.code).trim().slice(0, 64) || null;
        if (code) {
          const clash = await db.orm.public.DiscountCampaign
            .where({ sellerId: req.user!.userId, code })
            .first();
          if (clash && clash.id !== campaign.id) {
            res.status(409).json({
              error: "Промокод с таким именем уже существует",
              code: "code_already_exists",
            });
            return;
          }
        }
        updates.code = code;
      }
      if (body.value !== undefined) updates.value = value;
      if (body.startsAt !== undefined) updates.startsAt = startsAt ? (startsAt as Date).toISOString() : null;
      if (body.endsAt !== undefined) updates.endsAt = endsAt ? (endsAt as Date).toISOString() : null;
      if (body.usageLimit !== undefined) updates.usageLimit = usageLimit;
      if (body.perUserLimit !== undefined) updates.perUserLimit = perUserLimit;
      if (body.minOrderMinor !== undefined) updates.minOrderAmount = minOrderMinor;

      if (Object.keys(updates).length === 0) {
        badRequest(res, "Нет полей для обновления", "no_fields");
        return;
      }

      const updated = await db.orm.public.DiscountCampaign
        .where({ id: campaign.id })
        .update(updates);

      await recordAuditSafe({
        actorId: req.user!.userId,
        action: "discount_updated",
        targetType: "discount_campaign",
        targetId: campaign.id,
        before: { name: campaign.name, value: campaign.value, usageLimit: campaign.usageLimit },
        after: updates,
        ip: req.ip,
        requestId: req.id,
      });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("seller_discount_update_failed", { error });
      res.status(500).json({ error: "Failed to update discount campaign" });
    }
  }
);

// ---------------------------------------------------------------------------
// DELETE /seller/discounts/:id — delete own inactive campaign
// ---------------------------------------------------------------------------
router.delete(
  "/discounts/:id",
  authenticate,
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const campaign = await db.orm.public.DiscountCampaign
        .where({ id: req.params.id as string, sellerId: req.user!.userId })
        .first();
      if (!campaign) {
        res.status(404).json({ error: "Кампания не найдена", code: "campaign_not_found" });
        return;
      }
      if (campaign.isActive) {
        res.status(409).json({
          error: "Деактивируйте кампанию перед удалением",
          code: "campaign_active",
        });
        return;
      }
      await db.orm.public.DiscountCampaign.where({ id: campaign.id }).delete();
      await recordAuditSafe({
        actorId: req.user!.userId,
        action: "discount_deleted",
        targetType: "discount_campaign",
        targetId: campaign.id,
        before: { name: campaign.name, type: campaign.type, value: campaign.value },
      });
      res.json({ deleted: true });
    } catch (error) {
      reqLog(req).error("seller_discount_delete_failed", { error });
      res.status(500).json({ error: "Failed to delete discount campaign" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /seller/discounts/:id/activate | deactivate — own state transitions
// ---------------------------------------------------------------------------
router.post(
  "/discounts/:id/activate",
  authenticate,
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const campaign = await db.orm.public.DiscountCampaign
        .where({ id: req.params.id as string, sellerId: req.user!.userId })
        .first();
      if (!campaign) {
        res.status(404).json({ error: "Кампания не найдена", code: "campaign_not_found" });
        return;
      }
      if (campaign.endsAt && new Date(campaign.endsAt).getTime() < Date.now()) {
        res.status(409).json({
          error: "Нельзя активировать кампанию с истёкшим сроком",
          code: "campaign_expired",
        });
        return;
      }
      const updated = await db.orm.public.DiscountCampaign
        .where({ id: campaign.id })
        .update({ isActive: true });
      await recordAuditSafe({
        actorId: req.user!.userId,
        action: "discount_activated",
        targetType: "discount_campaign",
        targetId: campaign.id,
        after: { isActive: true },
      });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("seller_discount_activate_failed", { error });
      res.status(500).json({ error: "Failed to activate discount campaign" });
    }
  }
);

router.post(
  "/discounts/:id/deactivate",
  authenticate,
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const campaign = await db.orm.public.DiscountCampaign
        .where({ id: req.params.id as string, sellerId: req.user!.userId })
        .first();
      if (!campaign) {
        res.status(404).json({ error: "Кампания не найдена", code: "campaign_not_found" });
        return;
      }
      const updated = await db.orm.public.DiscountCampaign
        .where({ id: campaign.id })
        .update({ isActive: false });
      await recordAuditSafe({
        actorId: req.user!.userId,
        action: "discount_deactivated",
        targetType: "discount_campaign",
        targetId: campaign.id,
        after: { isActive: false },
      });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("seller_discount_deactivate_failed", { error });
      res.status(500).json({ error: "Failed to deactivate discount campaign" });
    }
  }
);

/** Audit is fire-and-forget by contract (lib/audit.ts never throws). */
function recordAuditSafe(input: {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requestId?: string | null;
}): void {
  void recordAudit(input);
}

export default router;