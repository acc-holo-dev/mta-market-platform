// Advertising billing (PLAN-018 K-004/K-005): a seller-facing campaign
// purchase rides the EXISTING commerce model — the campaign is booked through
// a normal Order/Payment (the same platform-checkout core as subscriptions,
// lib/subscriptions.ts), never a second payment system. The campaign is
// linked to its order via AdCampaign.orderId (CAS) and the billing status is
// derived from the linked order + payment state.
//
// Placement pricing (documented, minor units = kopecks):
//   HOME_HERO            500000  (5 000 ₽)
//   HOME_RAIL_SECONDARY  200000  (2 000 ₽)
//   MARKET_FEATURED      300000  (3 000 ₽)
//   SERVER_FEATURED      250000  (2 500 ₽)
//   COMMUNITY_FEATURED   150000  (1 500 ₽)
//
// WEBHOOK INTEGRATION POINT: identical to subscriptions — routes/payments.ts
// (outside this wave's ownership) must dispatch Payment.metadata.kind ===
// "AD_CAMPAIGN" (orderRef = checkout Order id) to completeCampaignPayment
// after provider confirmation. Until then the explicit paid-activation
// endpoint POST /advertising/campaigns/:id/activate-payment is the wired
// capture path (provider-verified / dev-simulate, same honesty rules).
import { db } from "../prisma/db.js";
import { withKeyLock } from "./keyLock.js";
import { affectedCount } from "./ledger.js";
import { recordAudit } from "./audit.js";
import { AD_PLACEMENTS } from "./advertising.js";
import {
  createPlatformOrderLine,
  createProviderPayment,
  capturePlatformPayment,
  completePendingOrder,
  settlePlatformOrderRevenue,
  battleProviderEnabled,
  isMoneyState,
  type PaymentRow,
  type PlatformCheckout,
} from "./subscriptions.js";

export class AdsBillingError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AdsBillingError";
  }
}

/** Placement price table (kopecks per booking). */
export const AD_PLACEMENT_PRICING: Record<(typeof AD_PLACEMENTS)[number], number> = {
  HOME_HERO: 500000,
  HOME_RAIL_SECONDARY: 200000,
  MARKET_FEATURED: 300000,
  SERVER_FEATURED: 250000,
  COMMUNITY_FEATURED: 150000,
};

export function placementPriceMinor(placement: string): number | null {
  return (AD_PLACEMENT_PRICING as Record<string, number | undefined>)[placement] ?? null;
}

export interface AdCampaignRow {
  id: string;
  advertiserId: string;
  name: string;
  placement: string;
  title: string;
  body: string;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  status: string;
  reviewStatus: string;
  reviewNote: string | null;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

/**
 * Creates the checkout (Order + priced line) for one campaign placement
 * booking and creates the provider payment when a provider is configured.
 * The line title carries the campaign id so capture can resolve it.
 */
export async function createCampaignCheckout(input: {
  advertiserId: string;
  campaignId: string;
  campaignName: string;
  placement: string;
}): Promise<{ checkout: PlatformCheckout; amountMinor: number }> {
  const amountMinor = placementPriceMinor(input.placement);
  if (!amountMinor) {
    throw new AdsBillingError(400, "unknown_placement", "Unknown advertising placement");
  }
  return withKeyLock(`ads-checkout:${input.campaignId}`, async () => {
    const line = await createPlatformOrderLine({
      buyerId: input.advertiserId,
      title: `Рекламное размещение ${input.placement} — ${input.campaignName} [${input.campaignId}]`,
      amountMinor,
    });
    const payment = await createProviderPayment({
      amountMinor,
      description: `Реклама: размещение ${input.placement}`,
      orderId: line.orderId,
      orderItemId: line.orderItemId,
      returnUrl: `${process.env.FRONTEND_URL ?? ""}/advertising/campaigns/${input.campaignId}`,
      metadata: { kind: "AD_CAMPAIGN", orderId: line.orderId, campaignId: input.campaignId },
    });
    return {
      amountMinor,
      checkout: {
        orderId: line.orderId,
        orderItemId: line.orderItemId,
        amountMinor,
        currency: "RUB",
        ...payment,
      },
    };
  });
}

export interface LinkResult {
  linked: boolean;
  alreadyLinked: boolean;
  campaign: AdCampaignRow;
}

/**
 * CAS link of a campaign to its checkout Order (K-004). Idempotent: linking
 * the same order again is a no-op; a campaign already bound to a DIFFERENT
 * order is a conflict (an order line is money once captured — it must never
 * be silently re-pointed).
 */
export async function linkCampaignToOrder(campaignId: string, orderId: string): Promise<LinkResult> {
  const campaign = (await db.orm.public.AdCampaign.where({ id: campaignId }).first()) as AdCampaignRow | null;
  if (!campaign) {
    throw new AdsBillingError(404, "campaign_not_found", "Campaign not found");
  }
  if (campaign.orderId === orderId) {
    return { linked: false, alreadyLinked: true, campaign };
  }
  if (campaign.orderId) {
    throw new AdsBillingError(409, "campaign_already_linked", `Campaign is already linked to order ${campaign.orderId}`);
  }
  const cas = await db.orm.public.AdCampaign
    .where({ id: campaignId, orderId: null } as any)
    .updateAndCount({ orderId } as any);
  if (affectedCount(cas) !== 1) {
    const current = (await db.orm.public.AdCampaign.where({ id: campaignId }).first()) as AdCampaignRow;
    if (current.orderId === orderId) {
      return { linked: false, alreadyLinked: true, campaign: current };
    }
    throw new AdsBillingError(409, "campaign_link_conflict", "Campaign state changed concurrently; retry");
  }
  return { linked: true, alreadyLinked: false, campaign: { ...campaign, orderId } };
}

export interface CampaignBillingStatus {
  linked: boolean;
  orderId: string | null;
  orderStatus: string | null;
  amountMinor: number | null;
  currency: string;
  /** True when a captured (money-state) payment exists for the linked order. */
  paid: boolean;
  paymentId: string | null;
  paymentStatus: string | null;
  paidAt: string | null;
}

/** Billing status derived from the linked order + its bound payment attempts. */
export async function campaignBillingStatus(campaign: AdCampaignRow): Promise<CampaignBillingStatus> {
  if (!campaign.orderId) {
    return {
      linked: false,
      orderId: null,
      orderStatus: null,
      amountMinor: placementPriceMinor(campaign.placement),
      currency: "RUB",
      paid: false,
      paymentId: null,
      paymentStatus: null,
      paidAt: null,
    };
  }
  const order = (await db.orm.public.Order.where({ id: campaign.orderId }).first()) as
    | { id: string; status: string; finalTotal: number; currency: string }
    | null;
  if (!order) {
    return {
      linked: true,
      orderId: campaign.orderId,
      orderStatus: "missing",
      amountMinor: null,
      currency: "RUB",
      paid: false,
      paymentId: null,
      paymentStatus: null,
      paidAt: null,
    };
  }
  const item = (await db.orm.public.OrderItem.where({ orderId: order.id }).first()) as { id: string } | null;
  const payments = item
    ? ((await db.orm.public.Payment.where({ orderItemId: item.id } as any)
        .orderBy((p: any) => p.createdAt.desc())
        .all()) as PaymentRow[])
    : [];
  const captured = payments.find((p) => isMoneyState(p.status)) ?? null;
  const paidAtRaw = captured ? (captured.succeededAt as string | null | undefined) : null;
  // A COMPLETED platform order means the money was captured (the only
  // completion path is a captured payment or an explicit paid activation),
  // so simulate-mode bookings (no provider payment row) are honestly paid.
  return {
    linked: true,
    orderId: order.id,
    orderStatus: order.status,
    amountMinor: order.finalTotal,
    currency: order.currency,
    paid: Boolean(captured) || order.status === "COMPLETED",
    paymentId: captured?.id ?? payments[0]?.id ?? null,
    paymentStatus: captured?.status ?? payments[0]?.status ?? null,
    paidAt: paidAtRaw ?? null,
  };
}

/**
 * Completes a paid campaign booking (the wired capture path until the
 * payments webhook learns about AD_CAMPAIGN metadata): resolves the checkout
 * order from the campaign link, confirms capture (provider-verified for battle
 * providers, dev-simulate otherwise), CASes the order to COMPLETED and settles
 * the platform revenue into the ledger. Idempotent on replays.
 */
export async function completeCampaignPayment(input: {
  orderId: string;
  paymentId?: string | null;
  actorId: string;
  isOwner: boolean;
}): Promise<{ orderId: string; billing: CampaignBillingStatus; campaignId: string; alreadyCompleted: boolean }> {
  if (!input.isOwner) {
    throw new AdsBillingError(403, "not_authorized", "Not authorized");
  }
  const campaign = (await db.orm.public.AdCampaign.where({ orderId: input.orderId }).first()) as AdCampaignRow | null;
  if (!campaign) {
    throw new AdsBillingError(404, "campaign_not_found", "No campaign is linked to this checkout order");
  }
  const order = (await db.orm.public.Order.where({ id: input.orderId }).first()) as
    | { id: string; buyerId: string; status: string; finalTotal: number; currency: string }
    | null;
  if (!order) {
    throw new AdsBillingError(404, "order_not_found", "Checkout order not found");
  }
  const item = (await db.orm.public.OrderItem.where({ orderId: order.id }).first()) as { id: string } | null;
  if (!item) {
    throw new AdsBillingError(409, "order_without_line", "Checkout order has no priced line");
  }

  return withKeyLock(`ads-capture:${order.id}`, async () => {
    let payment: PaymentRow | null = null;
    if (input.paymentId) {
      payment = ((await db.orm.public.Payment.where({ id: input.paymentId }).first()) ??
        (await db.orm.public.Payment.where({ providerPaymentId: input.paymentId }).first())) as PaymentRow | null;
      if (!payment) {
        throw new AdsBillingError(404, "payment_not_found", "Payment not found");
      }
      if (payment.orderItemId !== item.id) {
        throw new AdsBillingError(409, "payment_reference_mismatch", "Payment is not bound to this checkout line");
      }
    } else {
      const attempts = (await db.orm.public.Payment.where({ orderItemId: item.id } as any)
        .orderBy((p: any) => p.createdAt.desc())
        .all()) as PaymentRow[];
      payment = attempts.find((p) => p.status === "PENDING") ?? attempts.find((p) => isMoneyState(p.status)) ?? null;
    }
    if (payment && (payment.status === "FAILED" || payment.status === "CANCELED")) {
      throw new AdsBillingError(409, "payment_failed", `Payment is ${payment.status}`);
    }

    let captured = false;
    if (payment) {
      const outcome = await capturePlatformPayment(payment);
      payment = outcome.payment;
      captured = outcome.captured;
    } else if (battleProviderEnabled()) {
      throw new AdsBillingError(409, "payment_required", "A captured payment is required to complete this booking");
    }

    if (order.status === "PENDING") {
      const completion = await completePendingOrder(order.id);
      if (!completion.completed && completion.status !== "COMPLETED") {
        throw new AdsBillingError(409, "invalid_order_state", `Order is ${completion.status}`);
      }
    } else if (order.status !== "COMPLETED") {
      throw new AdsBillingError(409, "invalid_order_state", `Order is ${order.status}`);
    }

    await settlePlatformOrderRevenue(
      { id: order.id, buyerId: order.buyerId, finalTotal: order.finalTotal, currency: order.currency },
      payment?.id ?? null,
      "settle:ad-campaign"
    );

    await recordAudit({
      actorId: input.actorId,
      action: "ad_campaign_payment_captured",
      targetType: "adCampaign",
      targetId: campaign.id,
      before: null,
      after: {
        orderId: order.id,
        amountMinor: order.finalTotal,
        paymentId: payment?.id ?? null,
      },
    });

    const fresh = (await db.orm.public.AdCampaign.where({ id: campaign.id }).first()) as AdCampaignRow;
    return {
      orderId: order.id,
      campaignId: campaign.id,
      alreadyCompleted: !captured && order.status === "COMPLETED",
      billing: await campaignBillingStatus(fresh),
    };
  });
}
