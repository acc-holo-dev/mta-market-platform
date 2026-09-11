// PLAN B-003: reconciliation scheduler integration tests.
// - the daily cycle runs payment/refund/payout/provider-event/internal-ledger
//   steps and persists alertable records (ReconciliationReport + mismatches);
// - YooKassa provider re-fetch is exercised through a mocked provider SDK:
//   matching amounts produce no mismatches, wrong amount/status produce
//   AMOUNT_MISMATCH/STATUS_MISMATCH, unknown provider payment produces
//   MISSING_PROVIDER;
// - the periodic scheduler executes cycles on an interval and stop() halts it.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("../src/lib/yookassa", () => ({
  YOOKASSA_ENABLED: true,
  YOOKASSA_SHOP_ID: "test-shop",
  createYooKassaPayment: vi.fn(),
  getYooKassaPayment: vi.fn(),
  YooKassaWebhook: {},
}));

import { db } from "../src/prisma/db";
import { getYooKassaPayment } from "../src/lib/yookassa";
import {
  runReconciliationCycle,
  startReconciliationScheduler,
} from "../src/jobs/reconciliation";
import { getReconciliationSummary } from "../src/lib/reconciliation/service";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const mockedGetPayment = vi.mocked(getYooKassaPayment);

const USER_ID = "550e8400-e29b-41d4-a716-446655446201";
const SUFFIX = Date.now().toString(36);

const OK_REF = `pay-ok-${SUFFIX}`;
const BAD_REF = `pay-bad-${SUFFIX}`;
const GONE_REF = `pay-gone-${SUFFIX}`;
const REF_REF = `pay-ref-${SUFFIX}`;

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[reconciliation.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

const paymentIds: string[] = [];
const eventIds: string[] = [];
const reportIdsToClean: string[] = [];
let testStartedAt: Date;

function ykPayment(ref: string, status: string, rub: string): Record<string, any> {
  return {
    id: ref,
    status,
    paid: true,
    amount: { value: rub, currency: "RUB" },
    confirmation: { type: "redirect", confirmation_url: "https://yk.test" },
    created_at: new Date().toISOString(),
    description: "recon test",
    metadata: { order_id: "n/a" },
  };
}

async function seedPayment(providerPaymentId: string, status: string, amount: number, extra: Record<string, unknown> = {}) {
  const payment = await db.orm.public.Payment.create({
    purchaseId: `recon-purchase-${providerPaymentId}`,
    provider: "YUKASSA",
    providerPaymentId,
    amount,
    currency: "RUB",
    status: status as "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED",
    ...extra,
  });
  paymentIds.push(payment.id);
  return payment;
}

async function countReports(): Promise<number> {
  const rows = await db.orm.public.ReconciliationReport.where({}).all();
  return rows.length;
}

beforeAll(async () => {
  if (!dbAvailable) return;
  testStartedAt = new Date();
  await resetTestEntities();
  await createTestUser(USER_ID, `recon_${SUFFIX}`, "USER", () => "not-a-jwt");

  mockedGetPayment.mockImplementation(async (paymentId: string) => {
    if (paymentId === OK_REF) return ykPayment(OK_REF, "succeeded", "50.00") as any;
    if (paymentId === BAD_REF) return ykPayment(BAD_REF, "succeeded", "60.00") as any;
    // Definitive "unknown payment" (HTTP 404) — mirrors lib/yookassa errors.
    throw new Error("YooKassa API error (HTTP 404): Not found");
  });

  await seedPayment(OK_REF, "SUCCEEDED", 5000); // matches provider -> clean
  await seedPayment(BAD_REF, "PENDING", 7000); // provider says succeeded 60.00
  await seedPayment(GONE_REF, "SUCCEEDED", 1000); // provider 404
  await seedPayment(REF_REF, "REFUNDED", 2000, { succeededAt: new Date().toISOString() });

  await db.orm.public.FinancialTransaction.create({
    userId: USER_ID,
    type: "SELLER_PAYOUT",
    amount: 3000,
    balanceAfter: 3000,
  });

  const okPayment = await db.orm.public.Payment.where({ providerPaymentId: OK_REF }).first();
  const failedEvent = await db.orm.public.PaymentProviderEvent.create({
    provider: "YUKASSA",
    providerEventId: `evt-failed-${SUFFIX}`,
    objectId: okPayment!.id,
    eventType: "payment.succeeded",
    objectType: "payment",
    payloadHash: "x",
    status: "FAILED",
    attempts: 3,
    lastError: "processing exploded",
  });
  eventIds.push(failedEvent.id);
  const ghostEvent = await db.orm.public.PaymentProviderEvent.create({
    provider: "YUKASSA",
    providerEventId: `evt-ghost-${SUFFIX}`,
    objectId: `ghost-payment-${SUFFIX}`,
    eventType: "payment.succeeded",
    objectType: "payment",
    payloadHash: "x",
  });
  eventIds.push(ghostEvent.id);
});

afterAll(async () => {
  if (!dbAvailable) return;

  for (const id of eventIds) {
    await db.orm.public.PaymentProviderEvent.where({ id }).delete().catch(() => undefined);
  }
  for (const id of paymentIds) {
    await db.orm.public.Payment.where({ id }).delete().catch(() => undefined);
  }
  await db.orm.public.FinancialTransaction.where({ userId: USER_ID }).delete().catch(() => undefined);

  // Reports created by this suite (mismatches cascade with their report)
  try {
    const reports = await db.orm.public.ReconciliationReport.where({}).all();
    for (const r of reports) {
      if (reportIdsToClean.includes(r.id) || new Date(r.createdAt) >= testStartedAt) {
        await db.orm.public.ReconciliationReport.where({ id: r.id }).delete().catch(() => undefined);
      }
    }
  } catch {
    // best-effort cleanup
  }

  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("B-003: reconciliation cycle", () => {
  it("runs all five steps and persists reports", async () => {
    const now = new Date();
    const cycle = await runReconciliationCycle(now, {
      periodStart: new Date(now.getTime() - 5 * 60 * 1000),
      periodEnd: now,
    });

    reportIdsToClean.push(
      ...cycle.steps.map((s) => s.reportId).filter((id): id is string => Boolean(id))
    );

    expect(cycle.steps.map((s) => s.step)).toEqual([
      "payment_reconciliation",
      "refund_reconciliation",
      "payout_reconciliation",
      "provider_event_mismatch",
      "internal_ledger_check",
    ]);
    // A failing step must not crash the cycle
    expect(cycle.steps.every((s) => s.status !== "failed")).toBe(true);
    expect(cycle.steps.find((s) => s.step === "payment_reconciliation")?.status).toBe("mismatches_found");
    expect(cycle.steps.find((s) => s.step === "provider_event_mismatch")?.status).toBe("mismatches_found");
    // Refund/payout provider sources are not implemented yet (Phase E/F):
    // the reports must be completed WITHOUT fabricated mismatches.
    const refundStep = cycle.steps.find((s) => s.step === "refund_reconciliation");
    expect(refundStep?.status).toBe("completed");
    expect(refundStep?.mismatchCount).toBe(0);
    const payoutStep = cycle.steps.find((s) => s.step === "payout_reconciliation");
    expect(payoutStep?.status).toBe("completed");
    expect(payoutStep?.mismatchCount).toBe(0);
    expect(payoutStep?.internalCount).toBeGreaterThanOrEqual(1);
  });

  it("detects amount/status/missing-provider mismatches via provider re-fetch", async () => {
    const now = new Date();
    const cycle = await runReconciliationCycle(now, {
      periodStart: new Date(now.getTime() - 5 * 60 * 1000),
      periodEnd: now,
    });
    reportIdsToClean.push(
      ...cycle.steps.map((s) => s.reportId).filter((id): id is string => Boolean(id))
    );
    const paymentStep = cycle.steps.find((s) => s.step === "payment_reconciliation")!;
    expect(paymentStep.reportId).toBeTruthy();

    const mismatches = await db.orm.public.ReconciliationMismatch.where({
      reportId: paymentStep.reportId!,
    }).all();

    const byRef = (ref: string) => mismatches.filter((m) => m.providerId === ref);
    expect(byRef(OK_REF)).toHaveLength(0); // matched amount + status -> clean
    expect(byRef(BAD_REF).map((m) => m.type)).toEqual(
      expect.arrayContaining(["AMOUNT_MISMATCH", "STATUS_MISMATCH"])
    );
    expect(byRef(GONE_REF).map((m) => m.type)).toContain("MISSING_PROVIDER");

    const report = await db.orm.public.ReconciliationReport.where({ id: paymentStep.reportId! }).first();
    expect(report?.status).toBe("COMPLETED");
    expect(Number(report?.mismatchCount)).toBe(mismatches.length);
  });

  it("flags provider events without internal payment or with FAILED processing", async () => {
    const now = new Date();
    const cycle = await runReconciliationCycle(now, {
      periodStart: new Date(now.getTime() - 5 * 60 * 1000),
      periodEnd: now,
    });
    reportIdsToClean.push(
      ...cycle.steps.map((s) => s.reportId).filter((id): id is string => Boolean(id))
    );
    const step = cycle.steps.find((s) => s.step === "provider_event_mismatch")!;
    const mismatches = await db.orm.public.ReconciliationMismatch.where({ reportId: step.reportId! }).all();

    const ghost = mismatches.find((m) => m.providerId === `evt-ghost-${SUFFIX}`);
    expect(ghost?.type).toBe("MISSING_INTERNAL");
    const failed = mismatches.find((m) => m.providerId === `evt-failed-${SUFFIX}`);
    expect(failed?.type).toBe("STATUS_MISMATCH");
  });

  it("summary is readable after runs", async () => {
    const summary = await getReconciliationSummary();
    expect(summary.totalReports).toBeGreaterThanOrEqual(3);
  });
});

describe.skipIf(!dbAvailable)("B-003: periodic scheduler", () => {
  it("is a no-op in test environment", () => {
    const handle = startReconciliationScheduler();
    expect(typeof handle.stop).toBe("function");
    expect(() => handle.stop()).not.toThrow();
  });

  it("executes cycles on an interval and stops cleanly", async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const before = await countReports();
      const handle = startReconciliationScheduler({ intervalMs: 60_000, initialDelayMs: 30 });

      await new Promise((r) => setTimeout(r, 700));
      const during = await countReports();
      expect(during).toBeGreaterThan(before); // first tick ran a full cycle

      handle.stop();
      await new Promise((r) => setTimeout(r, 250));
      const after = await countReports();
      expect(after).toBe(during); // no more cycles after stop()
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
  }, 10_000);
});
