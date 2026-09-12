// Premium subscriptions (PLAN-018 J-004): lifecycle over real entitlements.
//
// A subscription is a PURCHASED, time-boxed entitlement window. The money
// side rides the existing commerce model (E-002 — one payment system): the
// checkout creates a normal Order (+ one priced OrderItem line), the provider
// payment is created through the canonical IPaymentProvider registry (the
// same path routes/payments.ts /payments/create uses) and the local Payment
// row is bound to the order line.
//
// Activation semantics (J-004):
//   - the frozen SubscriptionStatus enum has no PENDING value, so an unpaid
//     checkout is represented by its PENDING Order — the Subscription row is
//     born ACTIVE at the moment the payment is confirmed (activation);
//   - activation grants a real Entitlement (source PLAN_PURCHASE, expiresAt =
//     period end) via lib/entitlements.ts grantEntitlement — never a re-
//     implementation;
//   - renewals (a second paid activation while ACTIVE|GRACE_PERIOD|PAST_DUE)
//     extend the existing subscription's expiresAt instead of stacking rows;
//   - no recurring billing until provider contracts support it — autoRenew
//     only controls the grace window before expiry (renewal is explicit).
//
// WEBHOOK INTEGRATION POINT (documented deviation): routes/payments.ts
// handleProviderWebhook only dispatches Purchase/ServicePurchase references
// and is outside this wave's file ownership. Once the payments wave adds a
// subscription dispatch there (Payment.metadata.kind === "SUBSCRIPTION",
// orderRef = checkout Order id → activateSubscriptionPayment), this module is
// the single completion path to call. Until then the explicit paid-activation
// endpoint POST /subscriptions/:id/activate-payment (:id = checkout Order id;
// provider-verified when a battle provider is enabled, dev-simulate
// otherwise) is the wired capture path.
import { db } from "../prisma/db.js";
import { logger } from "./logger.js";
import { withKeyLock } from "./keyLock.js";
import { affectedCount, postLedgerEntries, LEDGER_ACCOUNT_CODES } from "./ledger.js";
import { grantEntitlement, revokeEntitlement, type EntitlementKind } from "./entitlements.js";
import { recordAudit } from "./audit.js";
import { logSystem } from "./systemLog.js";
import {
  paymentProviders,
  type IPaymentProvider,
  type ProviderConfirmation,
} from "./paymentProvider.js";

/** Audit/SystemLog actor for lifecycle actions that have no human actor. */
export const SYSTEM_ACTOR_ID = "system";

/**
 * Sentinel sellerId for platform-sold OrderItem lines (subscription periods,
 * advertising placements): OrderItem.sellerId is a plain string (not an FK)
 * and a platform line has no marketplace seller. A sentinel keeps seller
 * finance aggregates (keyed on real seller ids) untouched.
 */
export const PLATFORM_ORDER_SELLER_ID = "PLATFORM";

/** Courtesy window (days) after expiresAt for autoRenew subscriptions. */
export const GRACE_PERIOD_DAYS = 3;

export class SubscriptionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "SubscriptionError";
  }
}

// ---------------------------------------------------------------------------
// Plans (J-002/J-003 packages). Only plans backed by real entitlements are
// purchasable; the feature list is the plan's product contract.
// ---------------------------------------------------------------------------

export type SubscriptionPlanKind = "CREATOR_PREMIUM" | "SERVER_PREMIUM";

export interface SubscriptionPlanDef {
  kind: SubscriptionPlanKind;
  label: string;
  description: string;
  /** Kopecks for one period. */
  priceMinor: number;
  periodDays: number;
  features: string[];
}

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanKind, SubscriptionPlanDef> = {
  CREATOR_PREMIUM: {
    kind: "CREATOR_PREMIUM",
    label: "Премиум креатора",
    description: "Расширенные возможности кабинета автора: аналитика и продвижение публикаций.",
    priceMinor: 99000, // 990 ₽ / 30 дней
    periodDays: 30,
    features: [
      "Расширенная аналитика продаж и аудитории",
      "Приоритетное отображение публикаций",
      "Кастомизация витрины создателя",
    ],
  },
  SERVER_PREMIUM: {
    kind: "SERVER_PREMIUM",
    label: "Премиум сервера",
    description: "Расширенные возможности карточки и мониторинга игрового сервера.",
    priceMinor: 149000, // 1490 ₽ / 30 дней
    periodDays: 30,
    features: [
      "Расширенная аналитика сервера",
      "Выделенное оформление карточки сервера",
      "Приоритет в подборках серверов",
    ],
  },
};

/**
 * Catalog kinds that exist in the contract but have no consuming features yet
 * (honesty rule §50: never a UI-only badge). They are listed with
 * available: false and cannot be purchased.
 */
export const FUTURE_PLAN_KINDS: EntitlementKind[] = [
  "MARKETPLACE_PREMIUM",
  "ADVERTISING_PREMIUM",
  "ANALYTICS_PREMIUM",
];

export function isSubscriptionPlanKind(value: unknown): value is SubscriptionPlanKind {
  return value === "CREATOR_PREMIUM" || value === "SERVER_PREMIUM";
}

/** Resolve a plan kind from user input; 400 for unknown kinds. */
export function resolvePlan(kind: unknown): SubscriptionPlanDef {
  if (typeof kind !== "string" || !isSubscriptionPlanKind(kind)) {
    throw new SubscriptionError(400, "unknown_plan", "Unknown subscription plan");
  }
  return SUBSCRIPTION_PLANS[kind];
}

// ---------------------------------------------------------------------------
// Shared platform-checkout core (commerce reuse; also used by lib/adsBilling).
// ---------------------------------------------------------------------------

export interface PlatformCheckout {
  orderId: string;
  orderItemId: string;
  amountMinor: number;
  currency: "RUB";
  /** Enabled provider name; null when none is configured (dev simulate path). */
  provider: string | null;
  /** Provider-side payment id; null in simulate mode. */
  providerPaymentId: string | null;
  /** Local Payment row id; null in simulate mode. */
  localPaymentId: string | null;
  paymentUrl: string | null;
  confirmation: ProviderConfirmation | null;
  /** True when no payment provider is configured (capture via explicit activation). */
  simulate: boolean;
}

/**
 * Creates the checkout line for a platform-sold product (subscription period,
 * advertising placement): one Order + one immutable priced OrderItem. The
 * frozen OrderItemType enum only admits RESOURCE|SERVICE, so platform lines
 * use SERVICE with no serviceId (documented deviation — OrderItem rows are
 * only consumed by commerce/ledger paths that never run for platform lines).
 * platformFee carries the full amount: the platform is the seller of its own
 * products, sellerNet is 0 and no seller balance is ever touched.
 */
export async function createPlatformOrderLine(input: {
  buyerId: string;
  title: string;
  amountMinor: number;
}): Promise<{ orderId: string; orderItemId: string }> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new SubscriptionError(400, "invalid_amount", "amountMinor must be a positive integer");
  }
  const created = await db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
    const order = await tx.orm.public.Order.create({
      buyerId: input.buyerId,
      status: "PENDING",
      currency: "RUB",
      subtotal: input.amountMinor,
      discountTotal: 0,
      finalTotal: input.amountMinor,
    });
    const orderItem = await tx.orm.public.OrderItem.create({
      orderId: order.id,
      itemType: "SERVICE",
      sellerId: PLATFORM_ORDER_SELLER_ID,
      titleSnapshot: input.title,
      currency: "RUB",
      basePrice: input.amountMinor,
      discountAmount: 0,
      finalPrice: input.amountMinor,
      platformFee: input.amountMinor,
      sellerNet: 0,
    });
    return { orderId: order.id, orderItemId: orderItem.id };
  });
  logger.info("platform_checkout_created", {
    user_id: input.buyerId,
    order_id: created.orderId,
    order_item_id: created.orderItemId,
    amount_minor: input.amountMinor,
    title: input.title,
  });
  return created;
}

/**
 * PLAN-016 P-001 parity with routes/payments.ts: explicit provider name wins
 * when enabled + payment.create-capable, else PAYMENTS_DEFAULT_PROVIDER, else
 * the single enabled provider (YooKassa legacy fallback). Null when nothing
 * is configured — endpoints stay honestly disabled (A-010 rule).
 */
export function resolvePaymentProvider(requested?: string): IPaymentProvider | null {
  if (requested) {
    const name = requested.toUpperCase();
    const provider = paymentProviders.get(name);
    if (provider && provider.isEnabled() && provider.supportsCapability("payment.create")) {
      return provider;
    }
    return null;
  }
  const configured = (process.env.PAYMENTS_DEFAULT_PROVIDER || "").toUpperCase();
  if (configured) {
    const byEnv = paymentProviders.get(configured);
    if (byEnv && byEnv.isEnabled() && byEnv.supportsCapability("payment.create")) {
      return byEnv;
    }
  }
  const enabled = paymentProviders.getEnabled().filter((p) => p.supportsCapability("payment.create"));
  if (enabled.length === 1) return enabled[0];
  const yooKassa = paymentProviders.get("YUKASSA");
  return yooKassa && yooKassa.isEnabled() ? yooKassa : null;
}

/**
 * Creates the provider payment through the canonical registry and persists
 * the local Payment row bound to the checkout line. Returns simulate: true
 * when no provider is configured — the caller answers honestly instead of
 * inventing a gateway (A-010 rule).
 */
export async function createProviderPayment(input: {
  amountMinor: number;
  description: string;
  orderId: string;
  orderItemId: string;
  returnUrl: string;
  metadata: Record<string, string>;
}): Promise<
  Pick<PlatformCheckout, "provider" | "providerPaymentId" | "localPaymentId" | "paymentUrl" | "confirmation" | "simulate">
> {
  const provider = resolvePaymentProvider();
  if (!provider) {
    return {
      provider: null,
      providerPaymentId: null,
      localPaymentId: null,
      paymentUrl: null,
      confirmation: null,
      simulate: true,
    };
  }
  const created = await provider.createPayment({
    amount: { value: input.amountMinor, currency: "RUB" },
    description: input.description,
    orderId: input.orderId,
    returnUrl: input.returnUrl,
    metadata: input.metadata,
  });
  const row = (await db.orm.public.Payment.create({
    purchaseId: null,
    orderItemId: input.orderItemId,
    provider: provider.name as "YUKASSA" | "TBANK" | "CRYPTO" | "STRIPE" | "TEST",
    providerPaymentId: created.providerPaymentId,
    amount: input.amountMinor,
    currency: "RUB",
    status: "PENDING",
    metadata: input.metadata as never,
  })) as { id: string };
  return {
    provider: provider.name,
    providerPaymentId: created.providerPaymentId,
    localPaymentId: row.id,
    paymentUrl: created.redirectUrl ?? null,
    confirmation: created.confirmation ?? null,
    simulate: false,
  };
}

/**
 * True when at least one non-TEST (battle) payment provider is enabled —
 * the same honesty gate as the dev simulate endpoint (PLAN-016 P-007):
 * dev-simulate capture paths must not be usable once real money rails exist.
 */
export function battleProviderEnabled(): boolean {
  return paymentProviders.getEnabled().some((p) => p.name !== "TEST");
}

export interface PaymentRow {
  id: string;
  purchaseId: string | null;
  orderItemId: string | null;
  provider: string;
  providerPaymentId: string;
  status: string;
  amount: number;
  currency: string;
  metadata: unknown;
  [key: string]: unknown;
}

const MONEY_STATES = ["SUCCEEDED", "SETTLEMENT_PENDING", "SETTLED", "REFUNDED", "PARTIALLY_REFUNDED"];

export function isMoneyState(status: string): boolean {
  return MONEY_STATES.includes(status);
}

/**
 * Confirms capture for a PENDING platform payment and CASes it to SUCCEEDED.
 * Provider discipline (A-010/A-011): a battle provider's payment is confirmed
 * by re-fetching provider truth (SUCCEEDED + paid + amount match) before the
 * local transition; the dev TEST provider / provider-less simulate rows are
 * accepted as-is (PLAN-016 P-007). Returns the fresh row and whether this
 * call performed the transition (false = already captured).
 */
export async function capturePlatformPayment(payment: PaymentRow): Promise<{
  payment: PaymentRow;
  captured: boolean;
}> {
  if (payment.status === "PENDING") {
    const provider = paymentProviders.get(payment.provider);
    const battle =
      provider &&
      provider.isEnabled() &&
      provider.name !== "TEST" &&
      provider.supportsCapability("payment.verification");
    if (battle) {
      const remote = await (provider as IPaymentProvider).getPayment(payment.providerPaymentId);
      if (remote.state !== "SUCCEEDED" || remote.paid !== true) {
        throw new SubscriptionError(409, "payment_not_captured", "Provider payment is not captured yet");
      }
      if (remote.amount.value !== payment.amount || remote.amount.currency !== payment.currency) {
        throw new SubscriptionError(409, "payment_amount_mismatch", "Provider payment amount mismatch");
      }
    }
    const cas = await db.orm.public.Payment
      .where({ id: payment.id, status: "PENDING" })
      .updateAndCount({ status: "SUCCEEDED", succeededAt: new Date().toISOString() } as any);
    if (affectedCount(cas) !== 1) {
      const current = (await db.orm.public.Payment.where({ id: payment.id }).first()) as PaymentRow | null;
      if (!current || !isMoneyState(current.status)) {
        throw new SubscriptionError(409, "payment_state_conflict", `Payment is ${current?.status ?? "unknown"}`);
      }
      return { payment: current, captured: false };
    }
    return { payment: { ...payment, status: "SUCCEEDED" }, captured: true };
  }
  if (!isMoneyState(payment.status)) {
    throw new SubscriptionError(409, "payment_not_capturable", `Payment in state ${payment.status} cannot be captured`);
  }
  return { payment, captured: false };
}

/** CAS the checkout Order PENDING → COMPLETED (concurrent activations converge). */
export async function completePendingOrder(orderId: string): Promise<{ completed: boolean; status: string }> {
  const cas = await db.orm.public.Order
    .where({ id: orderId, status: "PENDING" })
    .updateAndCount({ status: "COMPLETED", completedAt: new Date().toISOString() } as any);
  if (affectedCount(cas) === 1) return { completed: true, status: "COMPLETED" };
  const current = (await db.orm.public.Order.where({ id: orderId }).first()) as { status: string } | null;
  return { completed: false, status: current?.status ?? "unknown" };
}

/**
 * F-003 ledger settlement for a platform-sold line: the full amount is
 * platform revenue (no seller split). Idempotent through the deterministic
 * transaction id (`settle:<memoPrefix>:<orderId>`); the captured payment
 * rides to SETTLED afterwards (best-effort — retried by later activations).
 */
export async function settlePlatformOrderRevenue(
  order: { id: string; buyerId: string; finalTotal: number; currency: string },
  paymentId: string | null,
  memoPrefix: string
): Promise<void> {
  if (order.finalTotal > 0) {
    await postLedgerEntries(`${memoPrefix}:${order.id}`, [
      {
        account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_CASH, kind: "PLATFORM_CASH" },
        direction: "DEBIT",
        amount: order.finalTotal,
        currency: order.currency,
        orderId: order.id,
        paymentId: paymentId ?? undefined,
        userId: order.buyerId,
        memo: `${memoPrefix}:${order.id}`,
      },
      {
        account: { code: LEDGER_ACCOUNT_CODES.PLATFORM_REVENUE, kind: "PLATFORM_REVENUE" },
        direction: "CREDIT",
        amount: order.finalTotal,
        currency: order.currency,
        orderId: order.id,
        memo: `${memoPrefix}:${order.id}`,
      },
    ]);
  }
  if (paymentId) {
    try {
      await db.orm.public.Payment
        .where({ id: paymentId, status: "SUCCEEDED" } as any)
        .updateAndCount({ status: "SETTLED" } as any);
    } catch (error) {
      logger.warn("platform_payment_settle_failed", { payment_id: paymentId, error });
    }
  }
}

// ---------------------------------------------------------------------------
// Subscription checkout + activation (J-004).
// ---------------------------------------------------------------------------

/** The plan kind rides the immutable line title snapshot: "… [KIND]". */
function planLineTitle(plan: SubscriptionPlanDef): string {
  return `Подписка ${plan.label} [${plan.kind}]`;
}

function planKindFromLineTitle(title: string | null | undefined): SubscriptionPlanKind | null {
  if (!title) return null;
  const match = /\[([A-Z_]+)\]\s*$/.exec(title);
  if (!match) return null;
  return isSubscriptionPlanKind(match[1]) ? match[1] : null;
}

/** Creates the PENDING checkout (Order + line + provider payment when configured). */
export async function createSubscriptionCheckout(
  userId: string,
  planKind: SubscriptionPlanKind
): Promise<{ plan: SubscriptionPlanDef; checkout: PlatformCheckout }> {
  const plan = SUBSCRIPTION_PLANS[planKind];
  return withKeyLock(`subscription-checkout:${userId}:${planKind}`, async () => {
    const line = await createPlatformOrderLine({
      buyerId: userId,
      title: planLineTitle(plan),
      amountMinor: plan.priceMinor,
    });
    const payment = await createProviderPayment({
      amountMinor: plan.priceMinor,
      description: `Подписка: ${plan.label}`,
      orderId: line.orderId,
      orderItemId: line.orderItemId,
      returnUrl: `${process.env.FRONTEND_URL ?? ""}/subscriptions`,
      metadata: { kind: "SUBSCRIPTION", orderId: line.orderId, plan: planKind },
    });
    return {
      plan,
      checkout: {
        orderId: line.orderId,
        orderItemId: line.orderItemId,
        amountMinor: plan.priceMinor,
        currency: "RUB",
        ...payment,
      },
    };
  });
}

export interface SubscriptionRow {
  id: string;
  userId: string;
  plan: EntitlementKind;
  status: "ACTIVE" | "PAST_DUE" | "GRACE_PERIOD" | "CANCELLED" | "EXPIRED";
  startedAt: string;
  expiresAt: string;
  graceUntil: string | null;
  autoRenew: boolean;
  cancelledAt: string | null;
  lastPaymentId: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

const SUBSCRIPTION_LIVE_STATUSES = ["ACTIVE", "GRACE_PERIOD", "PAST_DUE"];

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Upserts the subscription window for a paid activation: a fresh ACTIVE
 * subscription, or an extension of the existing one (renewal semantics —
 * the base is the current expiry when still in the future, otherwise now).
 */
async function upsertSubscriptionWindow(
  userId: string,
  planKind: SubscriptionPlanKind,
  paymentId: string | null
): Promise<SubscriptionRow> {
  return withKeyLock(`subscription-upsert:${userId}:${planKind}`, async () => {
    const plan = SUBSCRIPTION_PLANS[planKind];
    const now = new Date();
    const rows = (await db.orm.public.Subscription
      .where({ userId, plan: planKind } as any)
      .all()) as SubscriptionRow[];
    const live = rows
      .filter((s) => SUBSCRIPTION_LIVE_STATUSES.includes(s.status))
      .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime())[0];

    if (live) {
      const base = new Date(live.expiresAt).getTime() > now.getTime() ? new Date(live.expiresAt) : now;
      const expiresAt = addDays(base, plan.periodDays).toISOString();
      const cas = await db.orm.public.Subscription
        .where({ id: live.id, status: live.status } as any)
        .updateAndCount({
          status: "ACTIVE",
          expiresAt,
          graceUntil: null,
          cancelledAt: null,
          lastPaymentId: paymentId,
        } as any);
      if (affectedCount(cas) !== 1) {
        throw new SubscriptionError(409, "state_conflict", "Subscription state changed concurrently; retry");
      }
      return (await db.orm.public.Subscription.where({ id: live.id } as any).first()) as SubscriptionRow;
    }

    const created = (await db.orm.public.Subscription.create({
      userId,
      plan: planKind,
      status: "ACTIVE",
      startedAt: now.toISOString(),
      expiresAt: addDays(now, plan.periodDays).toISOString(),
      autoRenew: true,
      lastPaymentId: paymentId,
    } as any)) as unknown as SubscriptionRow;
    return created;
  });
}

/**
 * Grants (idempotently) the real plan entitlement with expiresAt = period end
 * and pushes an earlier expiry forward. A permanent admin-granted entitlement
 * (expiresAt null) is returned by grantEntitlement unchanged and left alone.
 */
async function grantPlanEntitlement(
  userId: string,
  planKind: SubscriptionPlanKind,
  expiresAt: string,
  grantedById: string | null
): Promise<string | null> {
  const { entitlement } = await grantEntitlement({
    subjectType: "USER",
    subjectId: userId,
    kind: planKind,
    source: "PLAN_PURCHASE",
    grantedById,
    note: "subscription purchase",
    expiresAt,
  });
  if (entitlement.expiresAt && new Date(entitlement.expiresAt).getTime() < new Date(expiresAt).getTime()) {
    await db.orm.public.Entitlement.where({ id: entitlement.id } as any).update({ expiresAt } as any);
  }
  return entitlement.id;
}

/** Push the active PLAN_PURCHASE entitlement's expiry forward (grace/renewal). */
async function extendPlanEntitlementExpiry(
  userId: string,
  planKind: EntitlementKind,
  expiresAt: string
): Promise<void> {
  const rows = (await db.orm.public.Entitlement
    .where({ subjectType: "USER", subjectId: userId, kind: planKind, source: "PLAN_PURCHASE", revokedAt: null } as any)
    .all()) as Array<{ id: string; expiresAt: string | null }>;
  for (const row of rows) {
    if (!row.expiresAt || new Date(row.expiresAt).getTime() < new Date(expiresAt).getTime()) {
      await db.orm.public.Entitlement.where({ id: row.id } as any).update({ expiresAt } as any);
    }
  }
}

/** Revoke every active PLAN_PURCHASE entitlement of this user+plan. */
export async function revokePlanEntitlements(
  userId: string,
  plan: EntitlementKind,
  revokedById: string,
  reason: string
): Promise<number> {
  const rows = (await db.orm.public.Entitlement
    .where({ subjectType: "USER", subjectId: userId, kind: plan, source: "PLAN_PURCHASE", revokedAt: null } as any)
    .all()) as Array<{ id: string }>;
  let revoked = 0;
  for (const row of rows) {
    const result = await revokeEntitlement(row.id, revokedById, reason);
    if (result.revoked) revoked += 1;
  }
  return revoked;
}

export interface ActivatePaymentInput {
  /** The checkout Order id (the pending subscription artifact). */
  orderId: string;
  /** Local Payment row id (or provider payment id) when one exists. */
  paymentId?: string | null;
  actorId: string;
  isOrderOwner: boolean;
}

export interface ActivationResult {
  orderId: string;
  subscription: SubscriptionRow;
  entitlementId: string | null;
  alreadyActive: boolean;
  paymentCaptured: boolean;
}

/**
 * Explicit paid activation (the wired capture path; see module header):
 * resolves the order line + payment attempt, confirms capture (provider-
 * verified for battle providers, dev-simulate otherwise), CASes the order to
 * COMPLETED and activates/extends the subscription + its real entitlement.
 * Idempotent: replaying an already-completed checkout re-presents the live
 * subscription instead of creating a second one.
 */
export async function activateSubscriptionPayment(input: ActivatePaymentInput): Promise<ActivationResult> {
  const order = (await db.orm.public.Order.where({ id: input.orderId }).first()) as
    | { id: string; buyerId: string; status: string; finalTotal: number; currency: string }
    | null;
  if (!order) {
    throw new SubscriptionError(404, "order_not_found", "Checkout order not found");
  }
  if (!input.isOrderOwner) {
    throw new SubscriptionError(403, "not_authorized", "Not authorized");
  }
  const item = (await db.orm.public.OrderItem.where({ orderId: order.id }).first()) as
    | { id: string; titleSnapshot: string }
    | null;
  if (!item) {
    throw new SubscriptionError(409, "order_without_line", "Checkout order has no priced line");
  }
  const planKind = planKindFromLineTitle(item.titleSnapshot);
  if (!planKind) {
    throw new SubscriptionError(409, "not_a_subscription_line", "Order line is not a subscription checkout");
  }

  return withKeyLock(`subscription-activate:${order.id}`, async () => {
    // Idempotent replay: re-present the live subscription.
    if (order.status === "COMPLETED") {
      const active = await findLiveSubscription(order.buyerId, planKind);
      if (!active) {
        throw new SubscriptionError(409, "subscription_missing", "Checkout completed but no live subscription exists");
      }
      const entitlement = (await db.orm.public.Entitlement
        .where({ subjectType: "USER", subjectId: order.buyerId, kind: planKind, source: "PLAN_PURCHASE", revokedAt: null } as any)
        .first()) as { id: string } | null;
      return {
        orderId: order.id,
        subscription: active,
        entitlementId: entitlement?.id ?? null,
        alreadyActive: true,
        paymentCaptured: false,
      };
    }
    if (order.status !== "PENDING") {
      throw new SubscriptionError(409, "invalid_order_state", `Order is ${order.status}`);
    }

    // Resolve the payment attempt: explicit id, else the pending attempt bound
    // to this line, else a captured one, else simulate mode (no Payment row).
    let payment: PaymentRow | null = null;
    if (input.paymentId) {
      payment = ((await db.orm.public.Payment.where({ id: input.paymentId }).first()) ??
        (await db.orm.public.Payment.where({ providerPaymentId: input.paymentId }).first())) as PaymentRow | null;
      if (!payment) {
        throw new SubscriptionError(404, "payment_not_found", "Payment not found");
      }
      if (payment.orderItemId !== item.id) {
        throw new SubscriptionError(409, "payment_reference_mismatch", "Payment is not bound to this checkout line");
      }
    } else {
      const attempts = (await db.orm.public.Payment.where({ orderItemId: item.id } as any)
        .orderBy((p: any) => p.createdAt.desc())
        .all()) as PaymentRow[];
      payment = attempts.find((p) => p.status === "PENDING") ?? attempts.find((p) => isMoneyState(p.status)) ?? null;
    }
    if (payment && (payment.status === "FAILED" || payment.status === "CANCELED")) {
      throw new SubscriptionError(409, "payment_failed", `Payment is ${payment.status}`);
    }

    let paymentCaptured = false;
    if (payment) {
      const outcome = await capturePlatformPayment(payment);
      payment = outcome.payment;
      paymentCaptured = outcome.captured;
    } else if (battleProviderEnabled()) {
      // Simulate-mode activation is only honest while no battle provider is
      // configured — the same rule as the dev simulate endpoint (P-007).
      throw new SubscriptionError(409, "payment_required", "A captured payment is required to activate this checkout");
    }

    const completion = await completePendingOrder(order.id);
    if (!completion.completed && completion.status !== "COMPLETED") {
      throw new SubscriptionError(409, "invalid_order_state", `Order is ${completion.status}`);
    }

    const subscription = await upsertSubscriptionWindow(order.buyerId, planKind, payment?.id ?? null);
    const entitlementId = await grantPlanEntitlement(order.buyerId, planKind, subscription.expiresAt, input.actorId);
    await settlePlatformOrderRevenue(order, payment?.id ?? null, "settle:subscription");

    await recordAudit({
      actorId: input.actorId,
      action: "subscription_activated",
      targetType: "subscription",
      targetId: subscription.id,
      before: null,
      after: {
        orderId: order.id,
        plan: planKind,
        status: subscription.status,
        expiresAt: subscription.expiresAt,
        paymentId: payment?.id ?? null,
      },
    });
    await logSystem({
      level: "INFO",
      service: "api",
      message: "subscription_activated",
      meta: {
        subscriptionId: subscription.id,
        orderId: order.id,
        userId: order.buyerId,
        plan: planKind,
        actorId: input.actorId,
      },
    });
    logger.info("subscription_activated", {
      user_id: order.buyerId,
      subscription_id: subscription.id,
      order_id: order.id,
      plan: planKind,
    });

    return {
      orderId: order.id,
      subscription,
      entitlementId,
      alreadyActive: !completion.completed,
      paymentCaptured,
    };
  });
}

async function findLiveSubscription(userId: string, planKind: SubscriptionPlanKind): Promise<SubscriptionRow | null> {
  const rows = (await db.orm.public.Subscription
    .where({ userId, plan: planKind } as any)
    .all()) as SubscriptionRow[];
  return rows
    .filter((s) => SUBSCRIPTION_LIVE_STATUSES.includes(s.status))
    .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime())[0] ?? null;
}

// ---------------------------------------------------------------------------
// Lifecycle: sweep, cancel, resume, auto-renew.
// ---------------------------------------------------------------------------

export interface SweepResult {
  grace: number;
  expired: number;
}

/**
 * Lifecycle sweep (J-004):
 *   ACTIVE + expiresAt <= now:
 *     autoRenew  -> GRACE_PERIOD until graceUntil (= expiresAt + grace days);
 *                   the entitlement's expiry is extended with it (the
 *                   capability stays alive while the renewal window is open);
 *     !autoRenew -> EXPIRED + revoke.
 *   GRACE_PERIOD + graceUntil <= now -> EXPIRED + revoke.
 *   CANCELLED + expiresAt <= now     -> EXPIRED + revoke (cancel takes effect
 *                   at period end; access is kept until then).
 * Never throws; safe to call opportunistically on read paths (30s in-process
 * guard, same shape as the advertising expiry sweep; a worker cron should own
 * it in production).
 */
const SWEEP_INTERVAL_MS = 30_000;
let lastSweepAt = 0;

/** Test hook: clears the sweep guard so a test can force a run. */
export function resetSubscriptionSweepGuardForTests(): void {
  lastSweepAt = 0;
}

export async function expireSweep(now: Date = new Date()): Promise<{ grace: number; expired: number }> {
  const nowMs = now.getTime();
  if (nowMs - lastSweepAt < SWEEP_INTERVAL_MS) return { grace: 0, expired: 0 };
  lastSweepAt = nowMs;
  const nowIso = now.toISOString();
  let grace = 0;
  let expired = 0;

  try {
    // 1. ACTIVE past expiry: autoRenew -> grace, else expire.
    const active = (await db.orm.public.Subscription
      .where({ status: "ACTIVE" } as any)
      .where((s: any) => s.expiresAt.lte(nowIso))
      .all()) as SubscriptionRow[];
    for (const sub of active) {
      if (sub.autoRenew) {
        const graceUntil = addDays(new Date(sub.expiresAt), GRACE_PERIOD_DAYS).toISOString();
        const cas = await db.orm.public.Subscription
          .where({ id: sub.id, status: "ACTIVE" } as any)
          .updateAndCount({ status: "GRACE_PERIOD", graceUntil } as any);
        if (affectedCount(cas) === 1) {
          grace += 1;
          await extendPlanEntitlementExpiry(sub.userId, sub.plan, graceUntil);
          await logSystem({
            level: "INFO",
            service: "api",
            message: "subscription_grace_entered",
            meta: { subscriptionId: sub.id, userId: sub.userId, plan: sub.plan, graceUntil },
          });
        }
      } else {
        const cas = await db.orm.public.Subscription
          .where({ id: sub.id, status: "ACTIVE" } as any)
          .updateAndCount({ status: "EXPIRED" } as any);
        if (affectedCount(cas) === 1) {
          expired += 1;
          await revokePlanEntitlements(sub.userId, sub.plan, SYSTEM_ACTOR_ID, "subscription_expired");
        }
      }
    }

    // 2. GRACE_PERIOD past graceUntil -> EXPIRED + revoke.
    const inGrace = (await db.orm.public.Subscription
      .where({ status: "GRACE_PERIOD" } as any)
      .where((s: any) => s.graceUntil.lte(nowIso))
      .all()) as SubscriptionRow[];
    for (const sub of inGrace) {
      const cas = await db.orm.public.Subscription
        .where({ id: sub.id, status: "GRACE_PERIOD" } as any)
        .updateAndCount({ status: "EXPIRED" } as any);
      if (affectedCount(cas) === 1) {
        expired += 1;
        await revokePlanEntitlements(sub.userId, sub.plan, SYSTEM_ACTOR_ID, "subscription_grace_ended");
      }
    }

    // 3. CANCELLED past the paid period -> EXPIRED + revoke (period end).
    const cancelled = (await db.orm.public.Subscription
      .where({ status: "CANCELLED" } as any)
      .where((s: any) => s.expiresAt.lte(nowIso))
      .all()) as SubscriptionRow[];
    for (const sub of cancelled) {
      const cas = await db.orm.public.Subscription
        .where({ id: sub.id, status: "CANCELLED" } as any)
        .updateAndCount({ status: "EXPIRED" } as any);
      if (affectedCount(cas) === 1) {
        expired += 1;
        await revokePlanEntitlements(sub.userId, sub.plan, SYSTEM_ACTOR_ID, "subscription_cancelled_period_ended");
      }
    }
  } catch (error) {
    logger.error("subscription_expire_sweep_failed", { error });
    return { grace, expired };
  }

  if (grace + expired > 0) {
    logger.info("subscription_expire_sweep", { grace, expired });
  }
  return { grace, expired };
}

/** User-facing cancel: takes effect at period end (access kept until then). */
export async function cancelSubscription(
  id: string,
  actorId: string,
  reason?: string | null
): Promise<SubscriptionRow> {
  const sub = (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow | null;
  if (!sub) throw new SubscriptionError(404, "subscription_not_found", "Subscription not found");
  if (!SUBSCRIPTION_LIVE_STATUSES.includes(sub.status)) {
    throw new SubscriptionError(409, "invalid_state", `Only live subscriptions can be cancelled (now ${sub.status})`);
  }
  const cas = await db.orm.public.Subscription
    .where({ id, status: sub.status } as any)
    .updateAndCount({ status: "CANCELLED", cancelledAt: new Date().toISOString() } as any);
  if (affectedCount(cas) !== 1) {
    throw new SubscriptionError(409, "state_conflict", "Subscription state changed concurrently; retry");
  }
  await recordAudit({
    actorId,
    action: "subscription_cancelled",
    targetType: "subscription",
    targetId: id,
    before: { status: sub.status },
    after: { status: "CANCELLED", reason: reason ?? null },
  });
  return (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow;
}

/** Resume a period-end cancellation while the paid window is still open. */
export async function resumeSubscription(id: string, actorId: string): Promise<SubscriptionRow> {
  const sub = (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow | null;
  if (!sub) throw new SubscriptionError(404, "subscription_not_found", "Subscription not found");
  if (sub.status !== "CANCELLED") {
    throw new SubscriptionError(409, "invalid_state", `Only CANCELLED subscriptions can be resumed (now ${sub.status})`);
  }
  if (new Date(sub.expiresAt).getTime() <= Date.now()) {
    throw new SubscriptionError(409, "period_ended", "The paid period already ended; purchase a new period");
  }
  const cas = await db.orm.public.Subscription
    .where({ id, status: "CANCELLED" } as any)
    .updateAndCount({ status: "ACTIVE", cancelledAt: null } as any);
  if (affectedCount(cas) !== 1) {
    throw new SubscriptionError(409, "state_conflict", "Subscription state changed concurrently; retry");
  }
  await recordAudit({
    actorId,
    action: "subscription_resumed",
    targetType: "subscription",
    targetId: id,
    before: { status: "CANCELLED" },
    after: { status: "ACTIVE" },
  });
  return (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow;
}

export async function setSubscriptionAutoRenew(
  id: string,
  autoRenew: boolean,
  actorId: string
): Promise<SubscriptionRow> {
  const sub = (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow | null;
  if (!sub) throw new SubscriptionError(404, "subscription_not_found", "Subscription not found");
  if (sub.status === "EXPIRED") {
    throw new SubscriptionError(409, "invalid_state", "Expired subscriptions cannot change auto-renew");
  }
  const cas = await db.orm.public.Subscription
    .where({ id, autoRenew: sub.autoRenew } as any)
    .updateAndCount({ autoRenew } as any);
  if (affectedCount(cas) !== 1) {
    throw new SubscriptionError(409, "state_conflict", "Subscription state changed concurrently; retry");
  }
  await recordAudit({
    actorId,
    action: "subscription_auto_renew_changed",
    targetType: "subscription",
    targetId: id,
    before: { autoRenew: sub.autoRenew },
    after: { autoRenew },
  });
  return (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow;
}

// ---------------------------------------------------------------------------
// Admin surface (audited overrides).
// ---------------------------------------------------------------------------

export type AdminSubscriptionAction = "activate" | "grant_grace" | "expire" | "cancel";

/**
 * Admin transition overrides — every action is audited + SystemLog-logged.
 *   activate:    comp a fresh period from now (any non-ACTIVE status) and
 *                (re)grant the plan entitlement. The comped period rides the
 *                subscription's own PLAN_PURCHASE entitlement so the lifecycle
 *                sweep stays symmetric; the audit records the acting admin.
 *   grant_grace: ACTIVE|PAST_DUE|GRACE_PERIOD -> GRACE_PERIOD with graceUntil
 *                = max(now, expiresAt) + graceDays (courtesy, 1..30).
 *   expire:      force-expire now + revoke the plan entitlement.
 *   cancel:      immediate cancel + revoke (admin cancel is immediate, unlike
 *                the user-facing period-end cancel).
 */
export async function adminTransitionSubscription(
  id: string,
  action: AdminSubscriptionAction,
  actorId: string,
  opts: { graceDays?: number; reason?: string | null } = {}
): Promise<SubscriptionRow> {
  const sub = (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow | null;
  if (!sub) throw new SubscriptionError(404, "subscription_not_found", "Subscription not found");
  const now = new Date();
  let updated: SubscriptionRow;

  if (action === "activate") {
    if (sub.status === "ACTIVE") {
      throw new SubscriptionError(409, "invalid_state", "Subscription is already ACTIVE");
    }
    if (!isSubscriptionPlanKind(sub.plan)) {
      throw new SubscriptionError(409, "plan_not_purchasable", "Subscription plan is not a purchasable plan");
    }
    const plan = SUBSCRIPTION_PLANS[sub.plan];
    const expiresAt = addDays(now, plan.periodDays).toISOString();
    const cas = await db.orm.public.Subscription
      .where({ id, status: sub.status } as any)
      .updateAndCount({
        status: "ACTIVE",
        startedAt: now.toISOString(),
        expiresAt,
        graceUntil: null,
        cancelledAt: null,
      } as any);
    if (affectedCount(cas) !== 1) {
      throw new SubscriptionError(409, "state_conflict", "Subscription state changed concurrently; retry");
    }
    await grantPlanEntitlement(sub.userId, sub.plan, expiresAt, actorId);
    updated = (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow;
  } else if (action === "grant_grace") {
    if (!["ACTIVE", "PAST_DUE", "GRACE_PERIOD"].includes(sub.status)) {
      throw new SubscriptionError(409, "invalid_state", `grant_grace requires a live subscription (now ${sub.status})`);
    }
    const graceDays = Math.min(Math.max(Math.trunc(opts.graceDays ?? GRACE_PERIOD_DAYS), 1), 30);
    const base = Math.max(now.getTime(), new Date(sub.expiresAt).getTime());
    const graceUntil = new Date(base + graceDays * 24 * 60 * 60 * 1000).toISOString();
    const cas = await db.orm.public.Subscription
      .where({ id, status: sub.status } as any)
      .updateAndCount({ status: "GRACE_PERIOD", graceUntil } as any);
    if (affectedCount(cas) !== 1) {
      throw new SubscriptionError(409, "state_conflict", "Subscription state changed concurrently; retry");
    }
    await extendPlanEntitlementExpiry(sub.userId, sub.plan, graceUntil);
    updated = (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow;
  } else if (action === "expire") {
    if (sub.status === "EXPIRED") {
      throw new SubscriptionError(409, "invalid_state", "Subscription is already EXPIRED");
    }
    const cas = await db.orm.public.Subscription
      .where({ id, status: sub.status } as any)
      .updateAndCount({ status: "EXPIRED" } as any);
    if (affectedCount(cas) !== 1) {
      throw new SubscriptionError(409, "state_conflict", "Subscription state changed concurrently; retry");
    }
    await revokePlanEntitlements(sub.userId, sub.plan, actorId, "admin_force_expire");
    updated = (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow;
  } else {
    // cancel: immediate (admin override).
    if (!SUBSCRIPTION_LIVE_STATUSES.includes(sub.status)) {
      throw new SubscriptionError(409, "invalid_state", `cancel requires a live subscription (now ${sub.status})`);
    }
    const cas = await db.orm.public.Subscription
      .where({ id, status: sub.status } as any)
      .updateAndCount({ status: "CANCELLED", cancelledAt: now.toISOString() } as any);
    if (affectedCount(cas) !== 1) {
      throw new SubscriptionError(409, "state_conflict", "Subscription state changed concurrently; retry");
    }
    await revokePlanEntitlements(sub.userId, sub.plan, actorId, opts.reason ?? "admin_cancelled");
    updated = (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow;
  }

  await recordAudit({
    actorId,
    action: "subscription_admin_transition",
    targetType: "subscription",
    targetId: id,
    before: { status: sub.status, expiresAt: sub.expiresAt },
    after: { status: updated.status, action, graceUntil: updated.graceUntil ?? null, reason: opts.reason ?? null },
  });
  await logSystem({
    level: "INFO",
    service: "api",
    message: "subscription_admin_transition",
    meta: { subscriptionId: id, action, from: sub.status, to: updated.status, actorId },
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

export async function getSubscription(id: string): Promise<SubscriptionRow | null> {
  return (await db.orm.public.Subscription.where({ id } as any).first()) as SubscriptionRow | null;
}

export interface SubscriptionWithEntitlement extends SubscriptionRow {
  entitlement: { id: string; expiresAt: string | null; revokedAt: string | null } | null;
}

/** Own subscriptions with their linked real entitlements attached. */
export async function listForUser(userId: string): Promise<SubscriptionWithEntitlement[]> {
  const rows = (await db.orm.public.Subscription
    .where({ userId } as any)
    .orderBy((s: any) => s.createdAt.desc())
    .all()) as SubscriptionRow[];
  const entitlements = (await db.orm.public.Entitlement
    .where({ subjectType: "USER", subjectId: userId, source: "PLAN_PURCHASE" } as any)
    .all()) as Array<{
    id: string;
    kind: string;
    expiresAt: string | null;
    revokedAt: string | null;
  }>;
  return rows.map((sub) => {
    const entitlement = entitlements.find((e) => e.kind === sub.plan) ?? null;
    return {
      ...sub,
      entitlement: entitlement
        ? { id: entitlement.id, expiresAt: entitlement.expiresAt, revokedAt: entitlement.revokedAt }
        : null,
    };
  });
}

export interface ListForAdminFilters {
  status?: string;
  plan?: string;
}

export interface ListForAdminResult {
  data: Array<SubscriptionWithEntitlement & { planLabel: string; username: string | null }>;
  pagination: { page: number; limit: number; total: number; pages: number };
}

/** Paginated admin list with plan labels + usernames (batched, no N+1). */
export async function listForAdmin(
  filters: ListForAdminFilters,
  page = 1,
  limit = 20
): Promise<ListForAdminResult> {
  const safePage = Math.max(page, 1);
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.plan) where.plan = filters.plan;

  const scoped = db.orm.public.Subscription.where(where as any);
  const agg = await scoped.aggregate((a: any) => ({ total: a.count() }));
  const total = Number(agg.total ?? 0);
  const rows = (await scoped
    .orderBy((s: any) => s.createdAt.desc())
    .limit(safeLimit)
    .offset((safePage - 1) * safeLimit)
    .all()) as SubscriptionRow[];

  const userIds = Array.from(new Set(rows.map((r) => r.userId)));
  const entitlementRows = rows.length
    ? ((await db.orm.public.Entitlement
        .where((e: any) => e.subjectId.in(rows.map((r) => r.userId)))
        .where({ source: "PLAN_PURCHASE", revokedAt: null } as any)
        .all()) as Array<{ id: string; subjectId: string; kind: string; expiresAt: string | null }>)
    : [];
  const users = userIds.length
    ? ((await db.orm.public.User.where((u: any) => u.id.in(userIds)).select("id", "username").all()) as any[])
    : [];
  const userById = new Map(users.map((u) => [u.id as string, u as { id: string; username?: string }]));

  return {
    data: rows.map((sub) => {
      const entitlement = entitlementRows.find((e) => e.kind === sub.plan && e.subjectId === sub.userId) ?? null;
      return {
        ...sub,
        planLabel: isSubscriptionPlanKind(sub.plan) ? SUBSCRIPTION_PLANS[sub.plan].label : sub.plan,
        username: userById.get(sub.userId)?.username ?? null,
        entitlement: entitlement
          ? { id: entitlement.id, expiresAt: entitlement.expiresAt, revokedAt: null }
          : null,
      };
    }),
    pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
  };
}
