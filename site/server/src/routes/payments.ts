// Payment routes (PLAN E-001..E-008).
// Routes talk to the neutral IPaymentProvider registry, never a provider SDK
// directly (E-002). Payment row mutations go through the state machine
// (E-003). Refunds are an independent lifecycle (E-008, INV-013).
import { Router, Request, Response } from "express";
import { db } from "../prisma/db.js";
import crypto from "crypto";
import { authenticate, requireRole, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { validateCuid } from "../middleware/validateCuid.js";
import { getClientIP } from "../lib/yookassaWebhook.js";
import { sendPurchaseEmail } from "../lib/email.js";
import { completeResourceOrderItem, markServicePurchasePaid, CommerceError } from "../lib/commerce.js";
import { affectedCount } from "../lib/ledger.js";
import { paymentProviders, type IPaymentProvider } from "../lib/paymentProvider.js";
// E-002: side-effect imports register the implementations (YooKassa is the
// canonical one; T-Bank/crypto adapters self-register when env-configured —
// PLAN-016 C3/C4; the TEST provider is a dev-only stub, P-007).
import "../lib/providers/payment-yookassa.js";
import "../lib/providers/payment-tbank.js";
import "../lib/providers/payment-crypto.js";
import "../lib/providers/payment-test.js";
import {
  assertTransition,
  type PaymentState,
} from "../lib/paymentStateMachine.js";
import { createRefund } from "../lib/refunds.js";
import { PaymentRefundError, PaymentStateError } from "../lib/paymentErrors.js";
import { reqLog } from "../middleware/requestId.js";
import { incPaymentSuccess } from "../lib/metrics.js";
import { withIdempotency, isIdempotencyError } from "../lib/idempotency.js";
import { isUniqueViolation } from "../lib/dbErrors.js";
import type {
  ParsedWebhook,
  ProviderConfirmation,
} from "../lib/paymentProvider.js";

const router: Router = Router();

/**
 * PLAN-016 P-001: neutral provider resolution. An explicit provider name
 * (from the checkout request) wins when it is enabled and supports
 * payment.create; otherwise the platform default (env
 * PAYMENTS_DEFAULT_PROVIDER, else the single enabled provider) applies.
 * Returns null when nothing is configured — endpoints stay honestly
 * disabled (A-010 rule).
 */
function resolveProvider(requested?: string): IPaymentProvider | null {
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
  // Multiple enabled providers without a default: fall back to the
  // canonical YooKassa when present (legacy behavior), else null.
  const yooKassa = paymentProviders.get("YUKASSA");
  return yooKassa && yooKassa.isEnabled() ? yooKassa : null;
}

/**
 * E-003: apply a state-machine transition to a Payment row. No-op when the
 * row is already in the target state; throws PaymentStateError on illegal
 * transitions (surfacing as 500 — a programming error, not a client one).
 *
 * PLAN-012 §6: the transition is a compare-and-set on the observed state —
 * parallel webhook deliveries (or two instances) cannot interleave two
 * different transitions; a loser re-reads and either acknowledges the
 * already-applied state or retries onto the new current state.
 */
async function transitionPaymentTo(providerPaymentId: string, to: PaymentState): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await db.orm.public.Payment.where({ providerPaymentId }).first();
    if (!row) return;
    const from = row.status as PaymentState;
    if (from === to) return;
    assertTransition(from, to);
    const updated = await db.orm.public.Payment
      .where({ id: row.id, status: from })
      .updateAndCount({
        status: to,
        ...(to === "SUCCEEDED" ? { succeededAt: new Date().toISOString() } : {}),
        ...(to === "FAILED" ? { failedAt: new Date().toISOString() } : {}),
      });
    if (affectedCount(updated) === 1) return;
    // Lost the CAS: another writer moved the row; loop re-reads and retries
    // against the fresh state.
  }
  const finalRow = await db.orm.public.Payment.where({ providerPaymentId }).first();
  if (finalRow?.status === to) return; // concurrent winner reached the target
  throw new PaymentStateError(
    `Payment ${providerPaymentId} did not reach ${to} after concurrent transitions`
  );
}

// GET /payments/providers — PLAN-016: public discovery of enabled payment
// providers. confirmation type derived from the payment.poll capability
// (invoice providers confirm by polling; redirect PSPs by redirecting).
const PAYMENT_DISPLAY_NAMES: Record<string, string> = {
  YUKASSA: "ЮKassa",
  TBANK: "T-Bank",
  CRYPTO: "Криптовалюта",
  STRIPE: "Stripe",
  TEST: "Тестовый (dev)",
};

router.get("/providers", async (_req: Request, res: Response) => {
  const providers = paymentProviders.getEnabled().map((p) => ({
    provider: p.name,
    displayName: PAYMENT_DISPLAY_NAMES[p.name] ?? p.name,
    confirmation: (p.supportsCapability("payment.poll") ? "crypto_invoice" : "redirect") as
      | "redirect"
      | "crypto_invoice",
  }));
  res.json({ providers });
});

// POST /payments/create - Create payment (authenticated)
// Accepts { purchaseId } for resource lines (legacy) or { servicePurchaseId }
// for service lines (C-010). The provider amount is always the FINAL total.
// PLAN-012 §5: honored when the client sends an Idempotency-Key — a repeated
// request replays the stored response instead of creating a second payment.
router.post(
  "/create",
  authenticate,
  standardRateLimit,
  withIdempotency("payments.create", async (req: AuthRequest, res: Response) => {
    try {
      const { purchaseId, servicePurchaseId } = req.body;

    if (!purchaseId && !servicePurchaseId) {
      res.status(400).json({ error: "Missing purchaseId or servicePurchaseId" });
      return;
    }
    // PLAN-016 P-001: explicit provider selection from checkout; unknown or
    // disabled providers are rejected with a precise error (no silent
    // fallback that could surprise the buyer).
    const requestedProviderName =
      typeof req.body?.provider === "string" ? req.body.provider.toUpperCase() : undefined;
    if (requestedProviderName && !paymentProviders.get(requestedProviderName)) {
      res.status(400).json({ error: `Unknown payment provider: ${requestedProviderName}` });
      return;
    }
    // PLAN-016 §9: an explicitly requested known-but-disabled provider is a
    // conflict (409), not a server fault — the endpoint itself stays honest.
    if (requestedProviderName) {
      const registered = paymentProviders.get(requestedProviderName)!;
      if (!registered.isEnabled() || !registered.supportsCapability("payment.create")) {
        res
          .status(409)
          .json({ error: `Payment provider ${requestedProviderName} is disabled` });
        return;
      }
    }

    const provider = resolveProvider(requestedProviderName);
    const providerEnum = (provider?.name ?? "YUKASSA") as
      | "YUKASSA"
      | "TBANK"
      | "CRYPTO"
      | "STRIPE"
      | "TEST";

    // ---- Service payment (C-010) ----
    if (servicePurchaseId) {
      const servicePurchase = await db.orm.public.ServicePurchase
        .where({ id: servicePurchaseId })
        .first();
      if (!servicePurchase) {
        res.status(404).json({ error: "Service purchase not found" });
        return;
      }
      if (servicePurchase.buyerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }
      if (servicePurchase.status !== "PENDING") {
        res.status(400).json({ error: "Service purchase is not pending" });
        return;
      }
      const serviceOrderItem = await db.orm.public.ServiceOrderItem
        .where({ id: servicePurchase.serviceOrderItemId })
        .first();
      if (!serviceOrderItem?.orderItemId) {
        res.status(409).json({ error: "Service purchase has no checkout order item" });
        return;
      }

      if (!provider) {
        res.status(503).json({
          error: "Payment provider is not configured",
          servicePurchaseId: servicePurchase.id,
        });
        return;
      }

      const created = await provider.createPayment({
        amount: { value: servicePurchase.finalPrice, currency: "RUB" },
        description: "Заказ услуги",
        orderId: servicePurchase.id,
        returnUrl: `${process.env.FRONTEND_URL}/services/orders/${servicePurchase.id}`,
      });

      await db.orm.public.Payment.create({
        purchaseId: null,
        orderItemId: serviceOrderItem.orderItemId,
        provider: providerEnum,
        providerPaymentId: created.providerPaymentId,
        amount: servicePurchase.finalPrice,
        currency: "RUB",
        status: "PENDING",
      });

      res.json({
        paymentUrl: created.redirectUrl,
        paymentId: created.providerPaymentId,
        provider: providerEnum,
        confirmation: created.confirmation ?? null,
      });
      return;
    }

    // ---- Resource payment (legacy contract, kept compatible) ----
    const purchase = await db.orm.public.Purchase.where({ id: purchaseId }).first();

    if (!purchase) {
      res.status(404).json({ error: "Purchase not found" });
      return;
    }

    if (purchase.buyerId !== req.user!.userId) {
      res.status(403).json({ error: "Not authorized" });
      return;
    }

    if (purchase.status !== "PENDING") {
      res.status(400).json({ error: "Purchase is not pending" });
      return;
    }

    // Get resource info
    const resource = await db.orm.public.Resource.where({ id: purchase.resourceId }).first();

    if (!resource) {
      res.status(404).json({ error: "Resource not found" });
      return;
    }

    if (provider) {
      // TASK A-011: the provider amount must equal the order FINAL total
      // (after discounts) — never the pre-discount snapshot.
      const created = await provider.createPayment({
        amount: { value: purchase.finalPrice, currency: "RUB" },
        description: `Покупка ресурса: ${resource.title}`,
        orderId: purchase.id.toString(),
        returnUrl: `${process.env.FRONTEND_URL}/purchases/${purchase.id}`,
      });

      await db.orm.public.Payment.create({
        purchaseId: purchase.id,
        provider: providerEnum,
        providerPaymentId: created.providerPaymentId,
        amount: purchase.finalPrice,
        currency: "RUB",
        status: "PENDING",
      });

      res.json({
        paymentUrl: created.redirectUrl,
        paymentId: created.providerPaymentId,
        provider: providerEnum,
        confirmation: created.confirmation ?? null,
      });
    } else {
      // Development mode: simulate payment (or requested provider disabled)
      if (requestedProviderName) {
        res.status(503).json({ error: `Payment provider ${requestedProviderName} is not available` });
        return;
      }
      res.json({
        message: "Payment provider disabled - use /payments/:id/simulate for testing",
        purchaseId: purchase.id,
      });
    }
    } catch (error) {
      if (error instanceof CommerceError) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      if (
        isUniqueViolation(error, "payment_purchase_captured_uq") ||
        isUniqueViolation(error, "payment_orderitem_captured_uq")
      ) {
        // PLAN-012 §6: a parallel request already captured money for this
        // line — the database rejected the second capture.
        res.status(409).json({ error: "Payment for this order is already captured" });
        return;
      }
      if (isIdempotencyError(error)) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      reqLog(req).error("payment_create_failed", { error });
      res.status(500).json({ error: "Failed to create payment" });
    }
  })
);

// POST /payments/webhook/:provider — PLAN-016 P-002: per-provider webhook
// entry. POST /payments/webhook remains as a backward-compatible alias for
// the platform default provider (existing YooKassa settings keep working).
// Transport authenticity is delegated to the provider implementation (E-006:
// IP allowlist / Basic auth / HMAC signature over raw bytes); business
// verification always re-fetches the payment from the provider API
// (A-010/A-011). The event is persisted before any business effect
// (E-004/E-005); repeated deliveries are safe (unique [provider,
// providerEventId, eventType]).
async function handleProviderWebhook(
  req: Request,
  res: Response,
  provider: IPaymentProvider
): Promise<void> {
  const providerEnum = provider.name as "YUKASSA" | "TBANK" | "CRYPTO" | "STRIPE" | "TEST";

  try {
    // TASK A-010 rule (kept): this function is only reached with a resolved,
    // enabled provider; otherwise the route responds 503 (disabled, not open).

    // Transport verification: IP allowlist / Basic auth / signature (E-006).
    const ctx = {
      req,
      body: req.body,
      rawBody: (req as { rawBody?: Buffer }).rawBody,
      sourceIp: getClientIP(req),
    };
    const clientIP = ctx.sourceIp;
    const verification = provider.verifyWebhook(ctx);
    if (!verification.ok) {
      if (verification.reason === "ip") {
        reqLog(req).warn("webhook_rejected_ip_not_whitelisted", { client_ip: clientIP });
        res.status(403).json({ error: "Forbidden: Invalid source IP" });
      } else if (verification.reason === "signature") {
        reqLog(req).warn("webhook_rejected_invalid_signature", { provider: provider.name });
        res.status(400).json({ error: "Invalid webhook signature" });
      } else {
        reqLog(req).warn("webhook_rejected_invalid_auth", { provider: provider.name });
        res.status(401).json({ error: "Unauthorized: Invalid credentials" });
      }
      return;
    }

    // PLAN-016 P-002: provider wire format → neutral event shape.
    const parsed = provider.parseWebhook(ctx);
    if (!parsed) {
      res.status(400).json({ error: "Invalid webhook payload" });
      return;
    }

    const eventType = parsed.eventType;
    const ppId = parsed.providerPaymentId;
    const payloadHash = crypto
      .createHash("sha256")
      .update((req as { rawBody?: Buffer }).rawBody ?? JSON.stringify(req.body))
      .digest("hex");

    // Persist event before applying business effects. Repeated deliveries are safe.
    const existingEvent = await db.orm.public.PaymentProviderEvent.where({
      provider: providerEnum,
      providerEventId: parsed.providerEventId,
      eventType,
    }).first();

    if (existingEvent?.status === "PROCESSED") {
      res.status(200).json({ message: "Event already processed" });
      return;
    }

    let eventRecord = existingEvent;
    if (!eventRecord) {
      try {
        eventRecord = await db.orm.public.PaymentProviderEvent.create({
          provider: providerEnum,
          providerEventId: parsed.providerEventId,
          objectId: ppId,
          eventType,
          objectType: "payment",
          payloadHash,
          payload: req.body,
          status: "PROCESSING",
          attempts: 1,
        });
      } catch (error) {
        if (
          isUniqueViolation(
            error,
            "paymentProviderEvent_provider_providerEventId_eventType_key"
          )
        ) {
          // PLAN-012 §7: a parallel delivery (other instance) persisted the
          // same event first — adopt its record instead of failing.
          eventRecord = await db.orm.public.PaymentProviderEvent.where({
            provider: providerEnum,
            providerEventId: parsed.providerEventId,
            eventType,
          }).first();
          if (eventRecord?.status === "PROCESSED") {
            res.status(200).json({ message: "Event already processed" });
            return;
          }
          if (!eventRecord) {
            res.status(500).json({ error: "Failed to process webhook" });
            return;
          }
        } else {
          throw error;
        }
      }
    }
    if (!eventRecord) {
      // Unreachable in practice (create throws or returns a row); kept for
      // the type checker after the race path.
      res.status(500).json({ error: "Failed to process webhook" });
      return;
    } else {
      await db.orm.public.PaymentProviderEvent.where({ id: eventRecord.id }).update({
        status: "PROCESSING",
        attempts: eventRecord.attempts + 1,
        lastError: null,
      });
    }

    if (eventType !== "payment.succeeded" && eventType !== "payment.canceled") {
      await db.orm.public.PaymentProviderEvent.where({ id: eventRecord.id }).update({
        status: "PROCESSED",
        processedAt: new Date().toISOString(),
      });
      res.status(200).json({ message: "Event acknowledged" });
      return;
    }

    // PLAN-004 D-004 (audit GAP-1): real cancellation lifecycle. A
    // `payment.canceled` event closes the local PENDING payment/purchase so
    // it does not hang forever, and — critically — when the provider reports
    // a *succeeded* payment while the local state is already CANCELED, provider
    // truth wins: the transition is repaired to SUCCEEDED instead of throwing
    // forever on an illegal transition.
    const localPayment = await db.orm.public.Payment.where({
      providerPaymentId: ppId,
    }).first();
    if (eventType === "payment.canceled") {
      if (localPayment && localPayment.status === "PENDING") {
        await transitionPaymentTo(ppId, "CANCELED");
        await db.orm.public.Payment.where({ providerPaymentId: ppId }).update({
          status: "CANCELED",
        });
      }
      const cancelOrderRef = parsed.orderRef;
      if (cancelOrderRef) {
        // CAS: only a still-PENDING purchase is closed; a completed one is
        // money already captured (handled by the succeeded flow / refund).
        // PurchaseStatus has no CANCELED — FAILED is the terminal "no
        // entitlement" state (the provider-side cancel is reflected on the
        // Payment row, which does have CANCELED).
        await db.orm.public.Purchase.where({ id: cancelOrderRef, status: "PENDING" }).update({
          status: "FAILED",
          completedAt: new Date().toISOString(),
        });
      }
      await db.orm.public.PaymentProviderEvent.where({ id: eventRecord.id }).update({
        status: "PROCESSED",
        processedAt: new Date().toISOString(),
      });
      res.status(200).json({ message: "Event acknowledged" });
      return;
    }
    if (localPayment && localPayment.status === "CANCELED") {
      // Provider says SUCCEEDED after a local cancel: repair the state
      // (provider truth wins) and fall through to the normal succeeded flow
      // below — the buyer paid, the entitlement must be granted.
      const repaired = await db.orm.public.Payment
        .where({ providerPaymentId: ppId, status: "CANCELED" })
        .updateAndCount({ status: "PENDING" });
      if (affectedCount(repaired) === 1) {
        reqLog(req).warn("payment_canceled_then_succeeded_repaired", {
          provider_payment_id: ppId,
        });
      }
    }

    const orderRef = parsed.orderRef;
    if (!orderRef) {
      await db.orm.public.PaymentProviderEvent.where({ id: eventRecord.id }).update({
        status: "FAILED",
        lastError: "Missing order reference",
      });
      res.status(400).json({ error: "Missing order reference" });
      return;
    }

    // The reference is either a resource Purchase id (legacy + current
    // resource checkouts) or a ServicePurchase id (C-010 service orders).
    const purchase = await db.orm.public.Purchase.where({ id: orderRef }).first();
    const servicePurchase = purchase
      ? null
      : await db.orm.public.ServicePurchase.where({ id: orderRef }).first();

    if (!purchase && !servicePurchase) {
      await db.orm.public.PaymentProviderEvent.where({ id: eventRecord.id }).update({
        status: "FAILED",
        lastError: `Order not found: ${orderRef}`,
      });
      res.status(404).json({ error: "Order not found" });
      return;
    }

    // Do not trust webhook body alone. Confirm current provider state and amount.
    // TASK A-010/A-011: provider re-fetch + amount/currency/reference invariants.
    const providerPayment = await provider.getPayment(ppId);
    const expectedEntity = purchase ?? servicePurchase!;
    if (providerPayment.state !== "SUCCEEDED" || providerPayment.paid !== true) {
      await db.orm.public.PaymentProviderEvent.where({ id: eventRecord.id }).update({
        status: "FAILED",
        lastError: "Provider payment is not succeeded",
      });
      res.status(409).json({ error: "Provider payment is not succeeded" });
      return;
    }
    if (
      providerPayment.amount.value !== expectedEntity.finalPrice ||
      providerPayment.amount.currency !== "RUB"
    ) {
      // TASK A-011: amount/currency mismatch -> quarantine, no entitlement.
      // (Crypto adapters normalize overpay→accept inside their state mapper;
      // underpay never reaches SUCCEEDED.)
      await db.orm.public.PaymentProviderEvent.where({ id: eventRecord.id }).update({
        status: "FAILED",
        lastError: `Amount mismatch: provider ${providerPayment.amount.value} ${providerPayment.amount.currency}, expected ${expectedEntity.finalPrice} RUB`,
      });
      reqLog(req).error("payment_quarantined_amount_mismatch", {
        provider: provider.name,
        provider_payment_id: ppId,
        provider_amount: providerPayment.amount.value,
        provider_currency: providerPayment.amount.currency,
        expected_amount: expectedEntity.finalPrice,
        order_ref: orderRef,
      });
      res.status(409).json({ error: "Provider payment amount mismatch" });
      return;
    }

    // TASK A-011: the provider payment reference must belong to THIS order.
    const existingPayment = await db.orm.public.Payment.where({
      providerPaymentId: ppId,
    }).first();
    if (existingPayment) {
      const boundRef = existingPayment.purchaseId ?? existingPayment.orderItemId;
      const belongsHere =
        (purchase && existingPayment.purchaseId === purchase.id) ||
        (servicePurchase &&
          existingPayment.orderItemId != null &&
          (await db.orm.public.ServiceOrderItem.where({
            id: servicePurchase.serviceOrderItemId,
          }).first())?.orderItemId === existingPayment.orderItemId);
      if (!belongsHere) {
        await db.orm.public.PaymentProviderEvent.where({ id: eventRecord.id }).update({
          status: "FAILED",
          lastError: `Payment ${ppId} is bound to order ${String(boundRef)}, webhook claims ${orderRef}`,
        });
        reqLog(req).error("payment_quarantined_reference_mismatch", {
          provider: provider.name,
          provider_payment_id: ppId,
          bound_order_ref: String(boundRef),
          claimed_order_ref: orderRef,
        });
        res.status(409).json({ error: "Payment reference mismatch" });
        return;
      }
    }

    // E-003: provider confirmed capture -> SUCCEEDED (before settlement).
    if (existingPayment) {
      await transitionPaymentTo(ppId, "SUCCEEDED");
    }

    if (purchase) {
      // ---- Resource completion (atomic; INV-001/INV-006) ----
      if (!purchase.orderItemId) {
        await db.orm.public.PaymentProviderEvent.where({ id: eventRecord.id }).update({
          status: "FAILED",
          lastError: `Purchase ${purchase.id} has no checkout order item`,
        });
        res.status(409).json({ error: "Purchase has no checkout order item" });
        return;
      }

      // PLAN-004 D-004 (audit GAP-1): provider truth wins. If a
      // payment.canceled event was processed first (out-of-order delivery)
      // and closed this purchase as FAILED, a now-confirmed captured payment
      // reopens it for completion instead of throwing an illegal-transition
      // 500 forever with money captured but no entitlement.
      if (purchase.status === "FAILED") {
        const repaired = await db.orm.public.Purchase
          .where({ id: purchase.id, status: "FAILED" })
          .updateAndCount({ status: "PENDING", completedAt: null });
        if (affectedCount(repaired) === 1) {
          reqLog(req).warn("purchase_canceled_then_succeeded_repaired", {
            purchase_id: purchase.id,
            provider_payment_id: ppId,
          });
        }
      }

      const completion = await completeResourceOrderItem(purchase.orderItemId);

      if (existingPayment) {
        await db.orm.public.Payment.where({ providerPaymentId: ppId }).update({
          status: "SUCCEEDED",
          succeededAt: new Date().toISOString(),
        });
      } else {
        // Provider-confirmed payment without a local record (e.g. created via
        // the provider dashboard): persist it bound to this purchase.
        await db.orm.public.Payment.create({
          purchaseId: purchase.id,
          provider: providerEnum,
          providerPaymentId: ppId,
          amount: purchase.finalPrice,
          currency: "RUB",
          status: "SUCCEEDED",
          succeededAt: new Date().toISOString(),
        });
      }

      // E-003: entitlement granted + ledger settled -> SETTLED.
      await transitionPaymentTo(ppId, "SETTLED");
      incPaymentSuccess();

      const user = await db.orm.public.User.where({ id: purchase.buyerId }).first();
      const resource = await db.orm.public.Resource.where({ id: purchase.resourceId }).first();
      if (
        !completion.alreadyCompleted &&
        user &&
        resource &&
        user.email &&
        completion.licenseId
      ) {
        sendPurchaseEmail(user.email, resource.title, completion.licenseId).catch((err) =>
          reqLog(req).error("purchase_email_send_failed", { purchase_id: purchase.id, error: err })
        );
      }
    } else if (servicePurchase) {
      // ---- Service completion: PENDING -> IN_PROGRESS (C-009/C-010) ----
      await markServicePurchasePaid(servicePurchase.id);

      if (existingPayment) {
        await db.orm.public.Payment.where({ providerPaymentId: ppId }).update({
          status: "SUCCEEDED",
          succeededAt: new Date().toISOString(),
        });
      } else {
        const serviceOrderItem = await db.orm.public.ServiceOrderItem
          .where({ id: servicePurchase.serviceOrderItemId })
          .first();
        await db.orm.public.Payment.create({
          purchaseId: null,
          orderItemId: serviceOrderItem?.orderItemId ?? null,
          provider: providerEnum,
          providerPaymentId: ppId,
          amount: servicePurchase.finalPrice,
          currency: "RUB",
          status: "SUCCEEDED",
          succeededAt: new Date().toISOString(),
        });
      }

      await transitionPaymentTo(ppId, "SETTLED");
      incPaymentSuccess();
    }

    await db.orm.public.PaymentProviderEvent.where({ id: eventRecord.id }).update({
      status: "PROCESSED",
      processedAt: new Date().toISOString(),
    });

    res.status(200).json({ message: "Webhook processed successfully" });
  } catch (error) {
    if (error instanceof CommerceError) {
      reqLog(req).warn("webhook_completion_rejected", { code: error.code, status: error.status });
      res.status(error.status).json({ error: error.message });
      return;
    }
    reqLog(req).error("webhook_processing_failed", { error });
    res.status(500).json({ error: "Failed to process webhook" });
  }
}

// Legacy alias: providers configured against POST /payments/webhook keep
// working — resolves the default provider (env PAYMENTS_DEFAULT_PROVIDER or
// the single enabled one).
router.post("/webhook", async (req: Request, res: Response) => {
  const provider = resolveProvider();
  if (!provider) {
    res.status(503).json({ error: "Payment provider is not configured" });
    return;
  }
  await handleProviderWebhook(req, res, provider);
});

// PLAN-016 P-002: per-provider webhook endpoint.
router.post("/webhook/:provider", async (req: Request, res: Response) => {
  const requested = String(req.params.provider).toUpperCase();
  const provider = paymentProviders.get(requested);
  if (!provider || !provider.isEnabled()) {
    res.status(503).json({ error: "Payment provider is not configured" });
    return;
  }
  await handleProviderWebhook(req, res, provider);
});

// POST /payments/cancel - cancel a PENDING payment at the provider
// (authenticated owner; E-001 cancelPayment capability, E-003 CANCELED state)
router.post(
  "/cancel",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const { paymentId } = req.body ?? {};
      if (!paymentId) {
        res.status(400).json({ error: "Missing paymentId" });
        return;
      }
      const payment = await db.orm.public.Payment.where({ id: paymentId }).first();
      if (!payment) {
        res.status(404).json({ error: "Payment not found" });
        return;
      }
      const paymentRow = payment;
      // Only the payer (or an admin) cancels.
      if (paymentRow.purchaseId) {
        const purchase = await db.orm.public.Purchase
          .where({ id: paymentRow.purchaseId })
          .first();
        if (purchase && purchase.buyerId !== req.user!.userId && req.user!.role !== "ADMIN") {
          res.status(403).json({ error: "Not authorized" });
          return;
        }
      }

      // PLAN-016 P-001: cancel at the payment's OWN provider, not the default.
      const provider = paymentProviders.get(paymentRow.provider);
      if (!provider || !provider.isEnabled() || !provider.supportsCapability("payment.cancel")) {
        res.status(503).json({ error: "Provider cancellation is not available" });
        return;
      }
      if (paymentRow.status !== "PENDING") {
        res.status(409).json({ error: `Payment in state ${paymentRow.status} cannot be canceled` });
        return;
      }

      await provider.cancelPayment(paymentRow.providerPaymentId);
      await transitionPaymentTo(paymentRow.providerPaymentId, "CANCELED");
      reqLog(req).info("payment_canceled", {
        payment_id: paymentRow.id,
        actor_id: req.user!.userId,
      });
      res.json({ status: "CANCELED" });
    } catch (error) {
      if (error instanceof CommerceError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      reqLog(req).error("payment_cancel_failed", { error });
      res.status(500).json({ error: "Failed to cancel payment" });
    }
  }
);

// POST /payments/refunds - create a refund (ADMIN only, E-008)
// INV-013: the refunded total can never exceed the captured amount (the
// per-payment advisory lock + transaction in the refund service hold the
// ceiling across instances). PLAN-012 §5: honored when the client sends an
// Idempotency-Key.
router.post(
  "/refunds",
  authenticate,
  requireRole("ADMIN"),
  standardRateLimit,
  withIdempotency("payments.refunds", async (req: AuthRequest, res: Response) => {
    try {
      const { paymentId, amount, reason } = req.body ?? {};
      if (!paymentId) {
        res.status(400).json({ error: "Missing paymentId" });
        return;
      }
      const result = await createRefund({
        actorId: req.user!.userId,
        paymentId,
        amount: amount ?? undefined,
        reason,
      });
      reqLog(req).info("refund_created", {
        refund_id: result.refundId,
        payment_id: paymentId,
        amount: result.amount,
        actor_id: req.user!.userId,
      });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof PaymentRefundError) {
        reqLog(req).warn("refund_rejected", { code: error.code, status: error.status });
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      if (isIdempotencyError(error)) {
        res.status(error.status).json({ error: error.message, code: error.code });
        return;
      }
      reqLog(req).error("refund_create_failed", { error });
      res.status(500).json({ error: "Failed to create refund" });
    }
  })
);

// GET /payments/transactions/mine — buyer transaction history (PLAN-018 A-005).
// Unified, honest view of the buyer's own money movements: payment attempts
// (amount, provider, status, createdAt), refunds (independent lifecycle) and
// purchase references they belong to. Bounded to the 50 most recent of each
// surface; no pagination beyond that by design (history is queried in the
// dashboard, this endpoint is the API surface for it).
router.get(
  "/transactions/mine",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const buyerId = req.user!.userId;
      const BOUND = 50;

      // Purchases reference what was bought (resource + state); payments and
      // refunds hang off them (service purchases are out of scope here: their
      // Payment rows carry orderItemId, not purchaseId, and the buyer service
      // history lives on the service surface).
      const purchases = await db.orm.public.Purchase
        .where({ buyerId })
        .orderBy((m) => m.createdAt.desc())
        .limit(BOUND)
        .all();
      const purchaseIds = purchases.map((p: { id: string }) => p.id);

      const payments = purchaseIds.length
        ? await db.orm.public.Payment
            .where((p: any) => p.purchaseId.in(purchaseIds))
            .orderBy((m) => m.createdAt.desc())
            .limit(BOUND)
            .all()
        : [];
      const paymentIds = payments.map((p: { id: string }) => p.id);

      const refunds = paymentIds.length
        ? await db.orm.public.Refund
            .where((r: any) => r.paymentId.in(paymentIds))
            .orderBy((m) => m.createdAt.desc())
            .limit(BOUND)
            .all()
        : [];

      res.json({
        payments: payments.map((p: any) => ({
          id: p.id,
          purchaseId: p.purchaseId,
          provider: p.provider,
          amount: p.amount,
          currency: p.currency,
          status: p.status,
          createdAt: p.createdAt,
          succeededAt: p.succeededAt,
        })),
        refunds: refunds.map((r: any) => ({
          id: r.id,
          paymentId: r.paymentId,
          amount: r.amount,
          currency: r.currency,
          status: r.status,
          reason: r.reason,
          createdAt: r.createdAt,
          processedAt: r.processedAt,
        })),
        purchases: purchases.map((p: any) => ({
          id: p.id,
          resourceId: p.resourceId,
          status: p.status,
          finalPrice: p.finalPrice,
          createdAt: p.createdAt,
          completedAt: p.completedAt,
        })),
        totals: { payments: payments.length, refunds: refunds.length, purchases: purchases.length },
      });
    } catch (error) {
      reqLog(req).error("buyer_transactions_fetch_failed", { error });
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  }
);

// GET /payments/:paymentId/refunds - list refunds for a payment (ADMIN only)
router.get(
  "/:paymentId/refunds",
  authenticate,
  requireRole("ADMIN"),
  validateCuid("paymentId"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const refunds = await db.orm.public.Refund.where({ paymentId: req.params.paymentId as string })
        .orderBy((m) => m.createdAt.desc())
        .all();
      res.json({ data: refunds, total: refunds.length });
    } catch (error) {
      reqLog(req).error("refunds_fetch_failed", { error });
      res.status(500).json({ error: "Failed to fetch refunds" });
    }
  }
);

// POST /payments/:id/simulate - Simulate payment (development only)
// This route is ONLY compiled in non-production environments.
// PLAN-012 §5: honored when the client sends an Idempotency-Key (the
// underlying completion is already CAS-idempotent; the key replays the
// stored response).
if (process.env.NODE_ENV !== 'production') {
  router.post(
    "/:id/simulate",
    authenticate,
    validateCuid('id'),
    standardRateLimit,
    withIdempotency("payments.simulate", async (req: AuthRequest, res: Response) => {
      try {
        // PLAN-016 P-007: simulate stays a dev-only path — blocked whenever a
        // battle (non-TEST) provider is enabled. The TEST dev stub is not a
        // battle provider: its invoices are completed exactly by simulate.
        if (paymentProviders.getEnabled().some((p) => p.name !== "TEST")) {
          res.status(403).json({ error: "Cannot simulate in production" });
          return;
        }

        const purchaseId = req.params.id as string;

        const purchase = await db.orm.public.Purchase.where({ id: purchaseId }).first();

        if (!purchase) {
          res.status(404).json({ error: "Purchase not found" });
          return;
        }

        if (purchase.buyerId !== req.user!.userId) {
          res.status(403).json({ error: "Not authorized" });
          return;
        }

        if (purchase.status !== "PENDING") {
          res.status(400).json({ error: "Purchase is not pending" });
          return;
        }

        if (!purchase.orderItemId) {
          res.status(409).json({ error: "Purchase has no checkout order item" });
          return;
        }

        // Atomic completion through the shared commerce path (C-003/C-012).
        const completion = await completeResourceOrderItem(purchase.orderItemId);

        res.json({
          message: "Payment simulated successfully",
          purchaseId: purchase.id,
          licenseId: completion.licenseId,
        });
      } catch (error) {
        if (error instanceof CommerceError) {
          reqLog(req).warn("payment_simulation_rejected", { code: error.code, status: error.status });
          res.status(error.status).json({ error: error.message, code: error.code });
          return;
        }
        if (isIdempotencyError(error)) {
          res.status(error.status).json({ error: error.message, code: error.code });
          return;
        }
        reqLog(req).error("payment_simulation_failed", { error });
        res.status(500).json({ error: "Failed to simulate payment" });
      }
    })
  );
}

export default router;
