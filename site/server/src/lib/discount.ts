// PLAN C-004..C-008: discount campaigns — backend-only validation,
// calculation and ATOMIC usage consumption.
// The frontend price is never trusted: every amount is recomputed here from
// the immutable base price. Usage is consumed inside the order-completion
// transaction (C-007): a failed order never permanently increments usage
// (INV-014), and a single-use coupon survives concurrent completions via a
// compare-and-set update on DiscountCampaign.usedCount.

import { db } from "../prisma/db";
import { logger } from "./logger";

/** Minimal transaction handle type (db or a db.transaction() callback). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbOrTx = any;

export interface DiscountValidationInput {
  code?: string;
  campaignId?: string;
  /** Kind of line being purchased — must match the campaign scope (C-004). */
  scope: "RESOURCE" | "SERVICE";
  resourceId?: string;
  serviceId?: string;
  /** Restrict to campaigns of this seller (marketplace checkout). */
  sellerId?: string;
  basePrice: number; // kopecks
  currency: string;
  userId?: string; // for per-user limit prechecks
}

export type ValidatedDiscount = {
  valid: true;
  discount: {
    campaignId: string;
    name: string;
    type: "PERCENT" | "FIXED";
    value: number;
    discountAmount: number; // kopecks, clamped to [0, basePrice]
  };
};

export type InvalidDiscount = {
  valid: false;
  error: string;
};

/**
 * Validate a discount against a priced line and compute the discount amount.
 * Read-only (no usage side effects). Authoritative consumption happens in
 * consumeDiscount() at order completion.
 */
export async function validateDiscount(
  input: DiscountValidationInput
): Promise<ValidatedDiscount | InvalidDiscount> {
  if (!input.code && !input.campaignId) {
    return { valid: false, error: "No discount code provided" };
  }

  const where: Record<string, unknown> = { isActive: true };
  if (input.code) {
    where.code = input.code;
    if (input.sellerId) where.sellerId = input.sellerId;
  } else {
    where.id = input.campaignId;
  }

  const campaign = await db.orm.public.DiscountCampaign.where(where).first();
  if (!campaign) {
    return { valid: false, error: "Discount code not found or inactive" };
  }

  const now = new Date();
  if (campaign.startsAt && new Date(campaign.startsAt) > now) {
    return { valid: false, error: "Discount campaign has not started yet" };
  }
  if (campaign.endsAt && new Date(campaign.endsAt) < now) {
    return { valid: false, error: "Discount campaign has expired" };
  }

  if (campaign.scope !== "ALL") {
    const scopeMatches =
      campaign.scope === input.scope &&
      (!campaign.scopeId ||
        (input.scope === "RESOURCE" && campaign.scopeId === input.resourceId) ||
        (input.scope === "SERVICE" && campaign.scopeId === input.serviceId));
    if (!scopeMatches) {
      return { valid: false, error: "Discount does not apply to this item" };
    }
  }

  if (campaign.minOrderAmount != null && input.basePrice < campaign.minOrderAmount) {
    return {
      valid: false,
      error: `Order amount is below the minimum for this discount (min ${campaign.minOrderAmount} kopecks)`,
    };
  }

  if (campaign.perUserLimit != null && campaign.perUserLimit > 1) {
    // MVP: only unlimited (null) or single-use per user are supported.
    return { valid: false, error: "This discount campaign is not available" };
  }

  if (campaign.perUserLimit != null && input.userId) {
    const priorUsages = await db.orm.public.DiscountUsage.where({
      campaignId: campaign.id,
      userId: input.userId,
    }).all();
    if (priorUsages.length >= campaign.perUserLimit) {
      return { valid: false, error: "You have already used this discount" };
    }
  }

  if (campaign.usageLimit != null && campaign.usedCount >= campaign.usageLimit) {
    return { valid: false, error: "Discount usage limit reached" };
  }

  let discountAmount: number;
  if (campaign.type === "PERCENT") {
    discountAmount = Math.floor((input.basePrice * campaign.value) / 100);
  } else {
    if (campaign.currency !== input.currency) {
      return { valid: false, error: "Discount currency does not match" };
    }
    discountAmount = campaign.value;
  }
  discountAmount = Math.max(0, Math.min(discountAmount, input.basePrice));

  if (discountAmount <= 0 && input.basePrice > 0) {
    return { valid: false, error: "Discount does not reduce the price" };
  }

  return {
    valid: true,
    discount: {
      campaignId: campaign.id,
      name: campaign.name,
      type: campaign.type,
      value: campaign.value,
      discountAmount,
    },
  };
}

/** Thrown by consumeDiscount when the discount cannot be honored. */
export class DiscountUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiscountUnavailableError";
  }
}

/**
 * Normalize the affected-row result of updateAndCount() (returns the raw
 * affected count number in the current contract ORM).
 */
export function affectedCount(result: unknown): number {
  if (typeof result === "number") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    for (const key of ["affectedCount", "count", "updated", "affected"]) {
      if (typeof r[key] === "number") return r[key];
    }
  }
  return 0;
}

/**
 * C-007: consume one usage of a campaign INSIDE the completion transaction.
 *
 * - Idempotent per order item (unique [campaignId, orderItemId]): a retry of
 *   the same completion does not double-count.
 * - usageLimit is enforced with a compare-and-set on usedCount: concurrent
 *   completions can never exceed the limit.
 * - perUserLimit (MVP: 1) is enforced by counting the user's usage rows; on
 *   breach the compare-and-set is reverted so no phantom usage remains.
 */
export async function consumeDiscount(
  tx: DbOrTx,
  params: {
    campaignId: string;
    userId: string;
    orderId: string;
    orderItemId: string;
    amount: number;
  }
): Promise<void> {
  const { campaignId, userId, orderId, orderItemId, amount } = params;

  // Idempotency: this order item already consumed the campaign.
  const existingUsage = await tx.orm.public.DiscountUsage
    .where({ campaignId, orderItemId })
    .first();
  if (existingUsage) {
    return;
  }

  const campaign = await tx.orm.public.DiscountCampaign.where({ id: campaignId }).first();
  if (!campaign || !campaign.isActive) {
    throw new DiscountUnavailableError("Discount campaign is no longer available");
  }

  const usedCount = Number(campaign.usedCount ?? 0);
  if (campaign.usageLimit != null && usedCount >= campaign.usageLimit) {
    throw new DiscountUnavailableError("Discount usage limit reached");
  }

  // Compare-and-set: only one concurrent completion can transition
  // usedCount -> usedCount + 1. updateAndCount() applies the FULL where
  // predicate and returns the affected row count: 0 means another
  // completion consumed the limit first.
  // NOTE: plain update() ignores non-key where fields in this ORM and MUST
  // NOT be used for conditional transitions.
  const nextCount = usedCount + 1;
  const cas = await tx.orm.public.DiscountCampaign
    .where({ id: campaignId, usedCount })
    .updateAndCount({ usedCount: nextCount });

  if (affectedCount(cas) !== 1) {
    // Lost the race — the authoritative limit has been consumed elsewhere.
    throw new DiscountUnavailableError("Discount usage limit reached");
  }

  // Per-user limit (MVP: 1). Revert the counter when the user already used
  // their share, so the failed completion leaves no phantom usage.
  if (campaign.perUserLimit != null) {
    const userUsages = await tx.orm.public.DiscountUsage
      .where({ campaignId, userId })
      .all();
    if (userUsages.length >= campaign.perUserLimit) {
      await tx.orm.public.DiscountCampaign
        .where({ id: campaignId, usedCount: nextCount })
        .updateAndCount({ usedCount });
      throw new DiscountUnavailableError("You have already used this discount");
    }
  }

  await tx.orm.public.DiscountUsage.create({
    campaignId,
    userId,
    orderId,
    orderItemId,
    amount,
  });

  logger.info("discount_usage_consumed", {
    campaign_id: campaignId,
    user_id: userId,
    order_item_id: orderItemId,
    amount,
    used_count: nextCount,
  });
}

/**
 * Calculate final price after discount. Pure function.
 */
export function calculateFinalPrice(originalPrice: number, discountAmount: number): number {
  const finalPrice = originalPrice - discountAmount;
  return Math.max(0, finalPrice); // Cannot be negative
}

/**
 * Check if user can create discount (admin or resource seller).
 * Pure policy helper retained from the Phase C bridge.
 */
export function canCreateDiscount(userId: string, sellerId: string, isAdmin: boolean): boolean {
  return isAdmin || userId === sellerId;
}
