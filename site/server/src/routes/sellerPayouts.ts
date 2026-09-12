// Seller payout requests (PLAN-018 A-007): request/list own payouts; admin
// review lives in adminFinance. Mounted at /seller (paths relative: /payouts).
//
// The available balance shown and validated here is the server-computed
// SellerBalance cache (derived from the ledger, lib/ledger.ts) — never a
// frontend-provided number. Payout eligibility mirrors the seller onboarding
// contract (PLAN L-001/L-003): only an APPROVED seller profile with
// platform-granted payoutEnabled can request a payout.
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import {
  requestPayout,
  listPayouts,
  getAvailableBalance,
  PayoutError,
} from "../lib/payouts.js";

const router: Router = Router();

/** Seller gate: payouts require an APPROVED seller profile with payoutEnabled. */
async function requirePayoutEligibleSeller(req: AuthRequest, res: Response): Promise<boolean> {
  const profile = await db.orm.public.SellerProfile
    .where({ userId: req.user!.userId })
    .first();
  if (!profile || profile.status !== "APPROVED" || !profile.payoutEnabled) {
    res.status(403).json({
      error: "Требуется одобренный профиль продавца с включёнными выплатами",
      code: "seller_payout_not_enabled",
    });
    return false;
  }
  return true;
}

function respondPayoutError(res: Response, error: unknown): boolean {
  if (error instanceof PayoutError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  return false;
}

// POST /seller/payouts {amountMinor, note?} — request a payout (A-007).
// 201 {payout} | 409 open-payout / insufficient balance (ru texts).
router.post(
  "/payouts",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      if (!(await requirePayoutEligibleSeller(req, res))) return;

      const { amountMinor, note } = req.body ?? {};
      if (amountMinor === undefined || amountMinor === null) {
        res.status(400).json({ error: "amountMinor is required", code: "invalid_amount" });
        return;
      }

      const payout = await requestPayout({
        sellerId: req.user!.userId,
        amountMinor,
        note: typeof note === "string" && note.trim() ? note.trim().slice(0, 500) : null,
        auditContext: { ip: req.ip, requestId: req.id },
      });

      reqLog(req).info("seller_payout_request_created", {
        user_id: req.user!.userId,
        payout_id: payout.id,
        amount_minor: payout.amountMinor,
      });
      res.status(201).json({ payout });
    } catch (error) {
      if (respondPayoutError(res, error)) return;
      reqLog(req).error("seller_payout_request_failed", { error });
      res.status(500).json({ error: "Failed to request payout" });
    }
  }
);

// GET /seller/payouts — own payouts (paginated, newest first).
router.get(
  "/payouts",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const limit = Math.min(
        Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20),
        100
      );
      const result = await listPayouts({ sellerId: req.user!.userId, page, limit });
      res.json({ payouts: result.data, total: result.total, page: result.page, limit: result.limit });
    } catch (error) {
      reqLog(req).error("seller_payout_list_failed", { error });
      res.status(500).json({ error: "Failed to fetch payouts" });
    }
  }
);

// GET /seller/payouts/balance — server-computed balance truth (A-007).
// Available comes from the SellerBalance cache derived from the ledger
// (lib/ledger.ts); inEscrow is reported as-is when present.
router.get(
  "/payouts/balance",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const available = await getAvailableBalance(req.user!.userId);
      const row = await db.orm.public.SellerBalance.where({ userId: req.user!.userId }).first();
      res.json({
        available,
        inEscrow: Number(row?.inEscrowAmount ?? 0),
        currency: "RUB",
      });
    } catch (error) {
      reqLog(req).error("seller_payout_balance_failed", { error });
      res.status(500).json({ error: "Failed to fetch balance" });
    }
  }
);

export default router;