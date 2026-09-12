// Admin finance center (PLAN-018 A-003/A-006/A-007, B-003): reconciliation
// status, payouts review, discount inspection. Mounted at /admin/finance.
//
// Guards follow the PLAN-017 permission catalog: reads require
// finance.view, payout transitions require finance.payout
// (lib/permissions.ts requirePermission, mounted after authenticate).
// Error responses keep the legacy {error: string} shape used across routes.
import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { validateCuid } from "../middleware/validateCuid.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { requirePermission } from "../lib/permissions.js";
import { logUnhandled } from "../lib/systemLog.js";
import { getReconciliationSummary } from "../lib/reconciliation/service.js";
import {
  listPayouts,
  transitionPayout,
  PayoutError,
  type PayoutStatus,
} from "../lib/payouts.js";

const router: Router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

function parsePage(query: Record<string, unknown>, fallbackLimit: number, maxLimit: number) {
  const page = Math.max(parseInt(String(query.page ?? "1"), 10) || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(String(query.limit ?? String(fallbackLimit)), 10) || fallbackLimit, 1),
    maxLimit
  );
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * A-003: report.status → the four admin-facing reconciliation states.
 *   PENDING / IN_PROGRESS → PENDING (cycle has not produced a verdict yet)
 *   COMPLETED with mismatches unresolved → MISMATCH; all resolved → RESOLVED
 *   COMPLETED clean → MATCHED
 *   FAILED → PENDING (the cycle crashed; honest "no verdict yet", the error
 *   message is surfaced alongside so the failure is not masked).
 */
function mapReconciliationStatus(
  report: { status: string; mismatchCount: number } | null,
  mismatches: { resolved: boolean }[]
): "MATCHED" | "MISMATCH" | "PENDING" | "RESOLVED" {
  if (!report) return "PENDING";
  if (report.status === "PENDING" || report.status === "IN_PROGRESS" || report.status === "FAILED") {
    return "PENDING";
  }
  if (report.mismatchCount <= 0) return "MATCHED";
  const unresolved = mismatches.some((m) => !m.resolved);
  return unresolved ? "MISMATCH" : "RESOLVED";
}

const PAYOUT_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED", "CANCELLED"] as const;
const TX_TYPES = [
  "PAYMENT_RECEIVED",
  "PLATFORM_FEE",
  "SELLER_REVENUE",
  "SELLER_PAYOUT",
  "REFUND_TO_BUYER",
  "REFUND_FROM_SELLER",
  "ADJUSTMENT",
] as const;

const payoutsQuerySchema = z.object({
  status: z.enum(PAYOUT_STATUSES).optional(),
  sellerId: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const transitionSchema = z.object({
  action: z.enum(["approve", "process", "complete", "fail", "cancel"]),
  reason: z.string().max(1000).optional(),
  ledgerTxnId: z.string().max(200).optional(),
  payoutRef: z.string().max(200).optional(),
});

const transactionsQuerySchema = z.object({
  userId: z.string().max(100).optional(),
  type: z.enum(TX_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const discountsQuerySchema = z.object({
  active: z.enum(["true", "false", "all"]).default("all"),
  sellerId: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ---------------------------------------------------------------------------
// GET /admin/finance/reconciliation — A-003: latest report + mismatches
// ---------------------------------------------------------------------------
router.get(
  "/reconciliation",
  authenticate,
  requirePermission("finance.view"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const summary = await getReconciliationSummary();
      const report = await db.orm.public.ReconciliationReport
        .where({})
        .orderBy((m: any) => m.createdAt.desc())
        .limit(1)
        .first();

      // Recent mismatches of the latest report (bounded), oldest-first for
      // a stable reading order.
      const mismatches = report
        ? await db.orm.public.ReconciliationMismatch
            .where({ reportId: report.id })
            .orderBy((m: any) => m.createdAt.asc())
            .limit(50)
            .all()
        : [];

      res.json({
        status: mapReconciliationStatus(
          report ? { status: report.status as string, mismatchCount: Number(report.mismatchCount) } : null,
          mismatches as { resolved: boolean }[]
        ),
        summary,
        report: report ?? null,
        mismatches,
      });
    } catch (error) {
      reqLog(req).error("admin_finance_reconciliation_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch reconciliation status" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /admin/finance/payouts?status=&sellerId= — payout review list (A-007)
// ---------------------------------------------------------------------------
router.get(
  "/payouts",
  authenticate,
  requirePermission("finance.view"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = payoutsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Validation failed");
        return;
      }
      const { status, sellerId, page, limit } = parsed.data;
      const result = await listPayouts({ status: (status ?? null) as PayoutStatus | null, sellerId, page, limit });
      res.json({
        payouts: result.data,
        total: result.total,
        page: result.page,
        limit: result.limit,
      });
    } catch (error) {
      reqLog(req).error("admin_finance_payouts_fetch_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch payouts" });
    }
  }
);

// ---------------------------------------------------------------------------
// POST /admin/finance/payouts/:id/transition — approve/process/complete/fail/cancel
// ---------------------------------------------------------------------------
router.post(
  "/payouts/:id/transition",
  authenticate,
  requirePermission("finance.payout"),
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = transitionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        badRequest(res, "Validation failed");
        return;
      }
      const payout = await transitionPayout({
        payoutId: req.params.id as string,
        action: parsed.data.action,
        actorId: req.user!.userId,
        reason: parsed.data.reason ?? null,
        ledgerTxnId: parsed.data.ledgerTxnId ?? null,
        payoutRef: parsed.data.payoutRef ?? null,
        auditContext: { ip: req.ip, requestId: req.id },
      });
      reqLog(req).info("admin_payout_transitioned", {
        payout_id: payout.id,
        action: parsed.data.action,
        status: payout.status,
        admin_id: req.user!.userId,
      });
      res.json({ payout });
    } catch (error) {
      if (error instanceof PayoutError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      reqLog(req).error("admin_payout_transition_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to transition payout" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /admin/finance/transactions?userId=&type= — unified money list (A-006)
// FinancialTransaction rows cover both buyer-side (REFUND_TO_BUYER) and
// seller-side (SELLER_REVENUE / SELLER_PAYOUT) movements; bounded pagination.
// ---------------------------------------------------------------------------
router.get(
  "/transactions",
  authenticate,
  requirePermission("finance.view"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = transactionsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Validation failed");
        return;
      }
      const { userId, type, page, limit } = parsed.data;
      const skip = (page - 1) * limit;

      const base = () => {
        let q = db.orm.public.FinancialTransaction.where({});
        if (userId) q = q.where({ userId });
        if (type) q = q.where({ type });
        return q;
      };

      const [rows, totalAgg] = await Promise.all([
        base().orderBy((t: any) => t.createdAt.desc()).limit(limit).offset(skip).all(),
        base().aggregate((a: any) => ({ total: a.count() })),
      ]);
      const total = Number((totalAgg as { total?: number }).total ?? 0);

      // Bounded user projection for the page rows only (no N+1 across pages).
      const userIds = Array.from(new Set(rows.map((r: any) => r.userId as string)));
      const users = userIds.length
        ? await db.orm.public.User.where((u: any) => u.id.in(userIds))
            .select("id", "email", "username")
            .all()
        : [];
      const userById = new Map(users.map((u: any) => [u.id as string, u]));

      res.json({
        transactions: rows.map((t: any) => ({
          ...t,
          user: userById.get(t.userId)
            ? {
                id: (userById.get(t.userId) as any).id,
                email: (userById.get(t.userId) as any).email,
                username: (userById.get(t.userId) as any).username,
              }
            : null,
        })),
        total,
        page,
        limit,
      });
    } catch (error) {
      reqLog(req).error("admin_finance_transactions_fetch_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  }
);

// ---------------------------------------------------------------------------
// GET /admin/finance/discounts?active= — B-003 campaign inspection
// ---------------------------------------------------------------------------
router.get(
  "/discounts",
  authenticate,
  requirePermission("finance.view"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = discountsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Validation failed");
        return;
      }
      const { active, sellerId, page, limit } = parsed.data;
      const skip = (page - 1) * limit;

      const base = () => {
        let q = db.orm.public.DiscountCampaign.where({});
        if (active !== "all") q = q.where({ isActive: active === "true" });
        if (sellerId) q = q.where({ sellerId });
        return q;
      };

      const [rows, totalAgg] = await Promise.all([
        base().orderBy((c: any) => c.createdAt.desc()).limit(limit).offset(skip).all(),
        base().aggregate((a: any) => ({ total: a.count() })),
      ]);
      const total = Number((totalAgg as any).total ?? 0);

      // Honest usage counts: the authoritative DiscountUsage rows grouped by
      // campaign (usedCount is the CAS counter; this cross-checks it). The
      // groupBy chain is loosened exactly like routes/adminPlatform.ts
      // countBy() (verified against a live DB).
      const ids = rows.map((r: any) => r.id as string);
      const usageByCampaign = new Map<string, number>();
      if (ids.length > 0) {
        const usageRows = await (
          db.orm.public.DiscountUsage.where((u: any) => u.campaignId.in(ids)) as unknown as {
            groupBy: (cols: string[]) => {
              aggregate: (
                fn: (agg: Record<string, (...args: unknown[]) => unknown>) => Record<string, unknown>
              ) => Promise<Array<Record<string, unknown>>>;
            };
          }
        )
          .groupBy(["campaignId"])
          .aggregate((agg) => ({ n: agg.count() }));
        for (const row of usageRows as unknown as Array<{ campaignId: string; n: number }>) {
          usageByCampaign.set(String(row.campaignId), Number(row.n));
        }
      }

      const sellerIds = Array.from(new Set(rows.map((r: any) => r.sellerId as string)));
      const sellers = sellerIds.length
        ? await db.orm.public.User.where((u: any) => u.id.in(sellerIds))
            .select("id", "email", "username")
            .all()
        : [];
      const sellerById = new Map(sellers.map((u: any) => [u.id as string, u]));

      res.json({
        discounts: rows.map((c: any) => ({
          ...c,
          usageCount: usageByCampaign.get(c.id as string) ?? 0,
          seller: sellerById.get(c.sellerId)
            ? {
                id: (sellerById.get(c.sellerId) as any).id,
                email: (sellerById.get(c.sellerId) as any).email,
                username: (sellerById.get(c.sellerId) as any).username,
              }
            : null,
        })),
        total,
        page,
        limit,
      });
    } catch (error) {
      reqLog(req).error("admin_finance_discounts_fetch_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch discounts" });
    }
  }
);

export default router;