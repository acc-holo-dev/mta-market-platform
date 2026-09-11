// PLAN C-003, C-008, C-010, C-012: commerce checkout aggregate.
//
// Order     = checkout intent (C-012); OrderItem = immutable priced line
// (C-006); Purchase = completed RESOURCE purchase (kept compatible: payment
// webhooks are bound to purchaseId); ServicePurchase = service order state.
//
// Completion is atomic: purchase status transition (CAS), license creation,
// discount usage consumption (C-007) and the order status update run inside a
// single transaction. Ledger settlement follows after commit (money follows
// entitlement, never the reverse).
//
// Free/fully-discounted checkouts (C-003/C-008): finalTotal == 0 never
// creates a payment provider intent; completion happens immediately after
// checkout with the same atomic path.

import { db } from "../prisma/db.js";
import {
  consumeDiscount,
  calculateFinalPrice,
  validateDiscount,
  DiscountUnavailableError,
  affectedCount,
} from "./discount.js";
import { settlePurchaseRevenue } from "./ledger.js";
import { withKeyLock } from "./keyLock.js";
import { logger } from "./logger.js";
import { isUniqueViolation } from "./dbErrors.js";

const PLATFORM_FEE_RATE = 0.1; // 10% of the FINAL price (A-011 parity)

export class CommerceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "CommerceError";
  }
}

function splitFees(finalPrice: number): { platformFee: number; sellerNet: number } {
  const platformFee = Math.round(finalPrice * PLATFORM_FEE_RATE);
  return { platformFee, sellerNet: finalPrice - platformFee };
}

export interface CheckoutResult {
  orderId: string;
  orderItemId: string;
  purchaseId?: string; // resource line
  servicePurchaseId?: string; // service line
  status: "completed" | "pending";
  basePrice: number;
  discountAmount: number;
  finalPrice: number;
  licenseId?: string;
}

interface DiscountPlan {
  campaignId: string;
  code?: string;
  amount: number;
}

export interface ResourceCheckoutInput {
  userId: string;
  resourceSlug: string;
  discountCode?: string;
}

/** C-003/C-012: create a resource checkout (Order + OrderItem + Purchase). */
/**
 * PLAN-011 concurrency foundation: the already-owned check and the purchase
 * creation are a check-then-insert pair вЂ” parallel checkouts of the same
 * resource by the same buyer must be exactly-once. The key lock serializes
 * them within the backend process (single-instance deployment topology).
 * Cross-instance exactly-once needs a unique partial index (formal
 * migration path) вЂ” see documents/history/MIGRATION.md.
 */
/**
 * PLAN-012 В§4: checkout exactly-once is a DATABASE invariant. The in-process
 * key lock serializes same-buyer checkouts within one instance (cheap fast
 * path); the partial unique index purchase_buyer_resource_live_uq (at most
 * one PENDING|COMPLETED purchase per buyer+resource) is the hard guarantee вЂ”
 * two backend instances racing the same checkout converge on one purchase:
 * the loser re-presents the winner's checkout instead of creating a
 * duplicate (cross-instance correctness; see documents/history/MIGRATION.md).
 */
class CheckoutRaceLostError extends Error {
  constructor(
    public readonly winnerPurchaseId: string
  ) {
    super("A concurrent checkout of the same resource already created the purchase");
    this.name = "CheckoutRaceLostError";
  }
}

export async function createResourceCheckout(input: ResourceCheckoutInput): Promise<CheckoutResult> {
  const { userId, resourceSlug } = input;
  const resource = await db.orm.public.Resource.where({ slug: resourceSlug }).first();
  return withKeyLock(`checkout:${userId}:${resource?.id ?? resourceSlug}`, () =>
    createResourceCheckoutUnlocked(input)
  );
}

async function createResourceCheckoutUnlocked(input: ResourceCheckoutInput): Promise<CheckoutResult> {
  const { userId, resourceSlug, discountCode } = input;

  const resource = await db.orm.public.Resource.where({ slug: resourceSlug }).first();
  if (!resource) {
    throw new CommerceError(404, "resource_not_found", "Resource not found");
  }
  if (resource.status !== "PUBLISHED") {
    throw new CommerceError(400, "resource_unavailable", "Resource is not available for purchase");
  }

  const versions = await db.orm.public.ResourceVersion.where({ resourceId: resource.id })
    .orderBy((m) => m.publishedAt.desc())
    .limit(1)
    .all();
  const version = versions[0];
  if (!version) {
    throw new CommerceError(404, "version_not_found", "No versions available for this resource");
  }

  // Idempotent checkout: an existing COMPLETED purchase means ownership.
  const existing = await db.orm.public.Purchase
    .where({ buyerId: userId, resourceId: resource.id })
    .first();
  if (existing?.status === "COMPLETED") {
    throw new CommerceError(409, "already_owned", "You already own this resource");
  }
  if (existing?.status === "PENDING") {
    if (existing.orderItemId) {
      // Same checkout re-presented: return it instead of creating a duplicate.
      const item = await db.orm.public.OrderItem.where({ id: existing.orderItemId }).first();
      if (item) {
        const order = await db.orm.public.Order.where({ id: item.orderId }).first();
        return {
          orderId: item.orderId,
          orderItemId: item.id,
          purchaseId: existing.id,
          status: order?.status === "COMPLETED" ? "completed" : "pending",
          basePrice: item.basePrice,
          discountAmount: item.discountAmount,
          finalPrice: item.finalPrice,
        };
      }
    }
    throw new CommerceError(
      409,
      "pending_purchase_exists",
      "A pending purchase already exists for this resource"
    );
  }

  const basePrice = resource.price;
  const currency = "RUB";

  let discount: DiscountPlan | undefined;
  if (discountCode && basePrice > 0) {
    const validation = await validateDiscount({
      code: discountCode,
      scope: "RESOURCE",
      resourceId: resource.id,
      sellerId: resource.sellerId,
      basePrice,
      currency,
      userId,
    });
    if (!validation.valid) {
      throw new CommerceError(400, "discount_invalid", validation.error);
    }
    discount = {
      campaignId: validation.discount.campaignId,
      code: discountCode,
      amount: validation.discount.discountAmount,
    };
  }

  const discountAmount = discount?.amount ?? 0;
  const finalPrice = calculateFinalPrice(basePrice, discountAmount);
  const { platformFee, sellerNet } = splitFees(finalPrice);

  // The checkout triple is created atomically; completion (free flow) is a
  // separate atomic step so that every entitlement grant shares one code path
  // with the webhook/simulate flows.
  let created: { orderId: string; orderItemId: string; purchaseId: string };
  try {
    created = await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      const order = await tx.orm.public.Order.create({
        buyerId: userId,
        status: "PENDING",
        currency,
        subtotal: basePrice,
        discountTotal: discountAmount,
        finalTotal: finalPrice,
      });

      const orderItem = await tx.orm.public.OrderItem.create({
        orderId: order.id,
        itemType: "RESOURCE",
        resourceId: resource.id,
        sellerId: resource.sellerId,
        titleSnapshot: resource.title,
        currency,
        basePrice,
        discountCampaignId: discount?.campaignId ?? null,
        discountCode: discount?.code ?? null,
        discountAmount,
        finalPrice,
        platformFee,
        sellerNet,
      });

      let purchaseId: string;
      try {
        const purchase = await tx.orm.public.Purchase.create({
          buyerId: userId,
          resourceId: resource.id,
          versionId: version.id,
          orderItemId: orderItem.id,
          status: "PENDING",
          priceSnapshot: basePrice,
          discountSnapshot: discountAmount,
          finalPrice,
          platformFee,
          sellerRevenue: sellerNet,
        });
        purchaseId = purchase.id;
      } catch (error) {
        if (isUniqueViolation(error, "purchase_buyer_resource_live_uq")) {
          // A concurrent checkout (other instance) created the live purchase
          // first. Aborting this transaction also discards our Order and
          // OrderItem rows; the winner's checkout is re-presented below.
          const winner = await tx.orm.public.Purchase
            .where({ buyerId: userId, resourceId: resource.id })
            .orderBy((m) => m.createdAt.desc())
            .first();
          throw new CheckoutRaceLostError(winner?.id ?? "");
        }
        throw error;
      }

      return { orderId: order.id, orderItemId: orderItem.id, purchaseId };
    });
  } catch (error) {
    if (error instanceof CheckoutRaceLostError) {
      if (error.winnerPurchaseId) {
        const represented = await representExistingCheckout(userId, resource.id);
        if (represented) {
          logger.info("resource_checkout_race_lost_rerepresented", {
            user_id: userId,
            resource_id: resource.id,
            purchase_id: represented.purchaseId,
          });
          return represented;
        }
      }
      throw new CommerceError(
        409,
        "pending_purchase_exists",
        "A pending purchase already exists for this resource"
      );
    }
    throw error;
  }

  logger.info("resource_checkout_created", {
    user_id: userId,
    order_id: created.orderId,
    order_item_id: created.orderItemId,
    purchase_id: created.purchaseId,
    base_price: basePrice,
    discount_amount: discountAmount,
    final_price: finalPrice,
  });

  if (finalPrice === 0) {
    // C-003/C-008: free acquisition вЂ” no payment provider call (INV-002).
    try {
      const completion = await completeResourceOrderItem(created.orderItemId);
      return {
        ...created,
        status: "completed",
        basePrice,
        discountAmount,
        finalPrice,
        licenseId: completion.licenseId,
      };
    } catch (error) {
      if (error instanceof DiscountUnavailableError) {
        throw new CommerceError(409, "discount_unavailable", error.message);
      }
      throw error;
    }
  }

  return {
    ...created,
    status: "pending",
    basePrice,
    discountAmount,
    finalPrice,
  };
}

export interface ServiceCheckoutInput {
  userId: string;
  serviceSlug: string;
  buyerNotes?: string;
  discountCode?: string;
}

/**
 * PLAN-012 В§4: re-present the winning checkout of a lost create race (same
 * buyer + resource) instead of surfacing an error вЂ” the loser's HTTP answer
 * is the winner's checkout state, exactly as the in-process pending path
 * behaves. Null when the winner cannot be re-presented (caller rejects).
 */
async function representExistingCheckout(
  userId: string,
  resourceId: string
): Promise<CheckoutResult | null> {
  const purchase = await db.orm.public.Purchase
    .where({ buyerId: userId, resourceId })
    .orderBy((m) => m.createdAt.desc())
    .first();
  if (!purchase) return null;

  if (purchase.status === "COMPLETED") {
    return {
      orderId: "",
      orderItemId: purchase.orderItemId ?? "",
      purchaseId: purchase.id,
      status: "completed",
      basePrice: purchase.priceSnapshot,
      discountAmount: purchase.discountSnapshot,
      finalPrice: purchase.finalPrice,
    };
  }
  if (purchase.status !== "PENDING" || !purchase.orderItemId) return null;

  const item = await db.orm.public.OrderItem.where({ id: purchase.orderItemId }).first();
  if (!item) return null;
  const order = await db.orm.public.Order.where({ id: item.orderId }).first();

  return {
    orderId: item.orderId,
    orderItemId: item.id,
    purchaseId: purchase.id,
    status: order?.status === "COMPLETED" ? "completed" : "pending",
    basePrice: item.basePrice,
    discountAmount: item.discountAmount,
    finalPrice: item.finalPrice,
  };
}

/** C-010/C-012: create a service checkout (Order + OrderItem + ServicePurchase). */
export async function createServiceCheckout(input: ServiceCheckoutInput): Promise<CheckoutResult> {
  const { userId, serviceSlug, buyerNotes, discountCode } = input;

  const service = await db.orm.public.Service.where({ slug: serviceSlug }).first();
  if (!service) {
    throw new CommerceError(404, "service_not_found", "Service not found");
  }
  if (service.status !== "PUBLISHED") {
    throw new CommerceError(400, "service_unavailable", "Service is not available for ordering");
  }
  if (service.sellerId === userId) {
    throw new CommerceError(400, "self_order", "You cannot order your own service");
  }

  const basePrice = service.price;
  const currency = "RUB";

  let discount: DiscountPlan | undefined;
  if (discountCode && basePrice > 0) {
    const validation = await validateDiscount({
      code: discountCode,
      scope: "SERVICE",
      serviceId: service.id,
      sellerId: service.sellerId,
      basePrice,
      currency,
      userId,
    });
    if (!validation.valid) {
      throw new CommerceError(400, "discount_invalid", validation.error);
    }
    discount = {
      campaignId: validation.discount.campaignId,
      code: discountCode,
      amount: validation.discount.discountAmount,
    };
  }

  const discountAmount = discount?.amount ?? 0;
  const finalPrice = calculateFinalPrice(basePrice, discountAmount);
  const { platformFee, sellerNet } = splitFees(finalPrice);

  // INV-015: a free/paid service order never creates a DRM license.
  const deliveryDeadline = new Date(Date.now() + service.deliveryDays * 24 * 60 * 60 * 1000);

  const created = await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    const order = await tx.orm.public.Order.create({
      buyerId: userId,
      status: "PENDING",
      currency,
      subtotal: basePrice,
      discountTotal: discountAmount,
      finalTotal: finalPrice,
    });

    const orderItem = await tx.orm.public.OrderItem.create({
      orderId: order.id,
      itemType: "SERVICE",
      serviceId: service.id,
      sellerId: service.sellerId,
      titleSnapshot: service.title,
      currency,
      basePrice,
      discountCampaignId: discount?.campaignId ?? null,
      discountCode: discount?.code ?? null,
      discountAmount,
      finalPrice,
      platformFee,
      sellerNet,
    });

    const serviceOrderItem = await tx.orm.public.ServiceOrderItem.create({
      orderId: order.id,
      orderItemId: orderItem.id,
      serviceId: service.id,
      quantity: 1,
      priceSnapshot: basePrice,
      discountId: discount?.campaignId ?? null,
      discountSnapshot: discountAmount,
      finalPrice,
      buyerNotes: buyerNotes ?? null,
    });

    const servicePurchase = await tx.orm.public.ServicePurchase.create({
      serviceOrderItemId: serviceOrderItem.id,
      buyerId: userId,
      serviceId: service.id,
      // Free service orders start immediately; paid ones wait for the payment.
      status: finalPrice === 0 ? "IN_PROGRESS" : "PENDING",
      priceSnapshot: basePrice,
      discountSnapshot: discountAmount,
      finalPrice,
      platformFee,
      sellerRevenue: sellerNet,
      deliveryDeadline: deliveryDeadline.toISOString(),
    });

    return {
      orderId: order.id,
      orderItemId: orderItem.id,
      servicePurchaseId: servicePurchase.id,
    };
  });

  logger.info("service_checkout_created", {
    user_id: userId,
    order_id: created.orderId,
    order_item_id: created.orderItemId,
    service_purchase_id: created.servicePurchaseId,
    final_price: finalPrice,
  });

  return {
    ...created,
    status: finalPrice === 0 ? "completed" : "pending",
    basePrice,
    discountAmount,
    finalPrice,
  };
}

export interface CompletionResult {
  alreadyCompleted: boolean;
  purchaseId: string;
  licenseId?: string;
}

/**
 * Atomic resource order-item completion (C-003, INV-006, INV-014):
 * - CAS on Purchase status PENDING -> COMPLETED makes concurrent completions
 *   (webhook retries, simulate, free flow) safe;
 * - license is created iff missing (unique purchaseId);
 * - discount usage is consumed inside the same transaction (C-007);
 * - the order is marked COMPLETED when its (single-item MVP) line completes.
 * Ledger settlement happens after the transaction commits.
 */
export async function completeResourceOrderItem(orderItemId: string): Promise<CompletionResult> {
  const item = await db.orm.public.OrderItem.where({ id: orderItemId }).first();
  if (!item) {
    throw new CommerceError(404, "order_item_not_found", "Order item not found");
  }
  if (item.itemType !== "RESOURCE" || !item.resourceId) {
    throw new CommerceError(400, "not_a_resource_item", "Order item is not a resource line");
  }

  const purchase = await db.orm.public.Purchase.where({ orderItemId }).first();
  if (!purchase) {
    throw new CommerceError(404, "purchase_not_found", "Purchase not found for order item");
  }

  const outcome = await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    // CAS first: concurrent completions serialize here. updateAndCount()
    // applies the full predicate (plain update() ignores non-key where
    // fields in this ORM) and returns the affected row count.
    const transitioned = await tx.orm.public.Purchase
      .where({ id: purchase.id, status: "PENDING" })
      .updateAndCount({ status: "COMPLETED", completedAt: new Date().toISOString() });

    if (affectedCount(transitioned) !== 1) {
      const current = await tx.orm.public.Purchase.where({ id: purchase.id }).first();
      if (current?.status === "COMPLETED") {
        // Idempotent retry: repair a possibly missing license and acknowledge.
        let license = await tx.orm.public.License.where({ purchaseId: purchase.id }).first();
        if (!license) {
          license = await tx.orm.public.License.create({
            purchaseId: purchase.id,
            versionId: purchase.versionId,
            status: "ACTIVE",
          });
        }
        return { alreadyCompleted: true as const, licenseId: license.id };
      }
      throw new CommerceError(
        409,
        "invalid_purchase_state",
        `Purchase is ${current?.status ?? "unknown"}, cannot complete`
      );
    }

    // Duplicate-ownership defense: another COMPLETED purchase for the same
    // buyer+resource must not coexist with this completion.
    const owned = await tx.orm.public.Purchase
      .where({ buyerId: purchase.buyerId, resourceId: purchase.resourceId, status: "COMPLETED" })
      .all();
    if (owned.some((p: { id: string }) => p.id !== purchase.id)) {
      throw new CommerceError(
        409,
        "already_owned",
        "Another completed purchase already grants this resource"
      );
    }

    // C-007: consume discount usage atomically with the entitlement grant.
    if (item.discountCampaignId) {
      try {
        await consumeDiscount(tx, {
          campaignId: item.discountCampaignId,
          userId: purchase.buyerId,
          orderId: item.orderId,
          orderItemId: item.id,
          amount: item.discountAmount,
        });
      } catch (error) {
        if (error instanceof DiscountUnavailableError) {
          // The discount can no longer be honored: the order must NOT
          // complete at a different price (INV-004). Transaction aborts.
          throw new CommerceError(409, "discount_unavailable", error.message);
        }
        throw error;
      }
    }

    let license = await tx.orm.public.License.where({ purchaseId: purchase.id }).first();
    if (!license) {
      license = await tx.orm.public.License.create({
        purchaseId: purchase.id,
        versionId: purchase.versionId,
        status: "ACTIVE",
      });
    }

    await tx.orm.public.Order.where({ id: item.orderId }).update({
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
    });

    return { alreadyCompleted: false as const, licenseId: license.id };
  });

  if (!outcome.alreadyCompleted) {
    // Ledger settlement after commit: money follows entitlement (INV-001).
    await settlePurchaseRevenue(purchase);
    logger.info("resource_order_item_completed", {
      order_id: item.orderId,
      order_item_id: item.id,
      purchase_id: purchase.id,
      final_price: purchase.finalPrice,
    });
  } else {
    // PLAN-004 D-006/E-003 (audit GAP-2): repair the settlement crash window.
    // If the process died between purchase completion and ledger settlement,
    // a webhook retry lands here with `alreadyCompleted` вЂ” previously the
    // settlement never ran and the gap was only a WARNING log. Settlement is
    // now idempotent (deterministic ledger transaction id
    // `settle:purchase:<id>`), so re-running it is always safe.
    await settlePurchaseRevenue(purchase);
    logger.warn("resource_order_item_settlement_repaired", {
      order_id: item.orderId,
      purchase_id: purchase.id,
    });
  }

  return {
    alreadyCompleted: outcome.alreadyCompleted,
    purchaseId: purchase.id,
    licenseId: outcome.licenseId,
  };
}

/**
 * C-009: service order completion on payment success.
 * PENDING -> IN_PROGRESS (CAS); the delivery lifecycle continues from there.
 */
export async function markServicePurchasePaid(servicePurchaseId: string): Promise<{
  alreadyPaid: boolean;
}> {
  const transitioned = await db.orm.public.ServicePurchase
    .where({ id: servicePurchaseId, status: "PENDING" })
    .updateAndCount({ status: "IN_PROGRESS" });

  if (affectedCount(transitioned) !== 1) {
    const current = await db.orm.public.ServicePurchase.where({ id: servicePurchaseId }).first();
    if (current?.status && ["IN_PROGRESS", "DELIVERED", "ACCEPTED", "CLOSED"].includes(current.status)) {
      return { alreadyPaid: true };
    }
    throw new CommerceError(
      409,
      "invalid_service_state",
      `Service purchase is ${current?.status ?? "unknown"}, cannot mark paid`
    );
  }

  logger.info("service_purchase_paid", { service_purchase_id: servicePurchaseId });
  return { alreadyPaid: false };
}
