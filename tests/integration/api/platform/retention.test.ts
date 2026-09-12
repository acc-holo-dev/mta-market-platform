// PLAN-020 E-005 integration test: outbox retention actually prunes.
//   - PROCESSED events older than processedDays are deleted;
//   - recent PROCESSED events survive;
//   - FAILED (dead-letter) rows get their own, longer window;
//   - PENDING/PROCESSING rows are never touched.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/prisma/db";
import { pruneFinishedOutboxEvents } from "@server/lib/events";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[retention.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

const createdIds: string[] = [];

async function seedEvent(
  status: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED",
  ageDays: number
): Promise<string> {
  const createdAt = new Date(Date.now() - ageDays * 86_400_000).toISOString();
  const row = await db.orm.public.OutboxEvent.create({
    eventType: "PAYMENT_SUCCEEDED",
    payload: { __retentionTest: true } as never,
    status,
    createdAt,
    processedAt: status === "PROCESSED" ? createdAt : null,
  } as never);
  createdIds.push(row.id);
  return row.id;
}

describe.skipIf(!dbAvailable)("outbox retention (PLAN-020 E-005)", () => {
  let oldProcessedId = "";
  let freshProcessedId = "";
  let oldFailedId = "";
  let pendingId = "";
  let processingId = "";

  beforeAll(async () => {
    oldProcessedId = await seedEvent("PROCESSED", 20);
    freshProcessedId = await seedEvent("PROCESSED", 1);
    oldFailedId = await seedEvent("FAILED", 20);
    pendingId = await seedEvent("PENDING", 20);
    processingId = await seedEvent("PROCESSING", 20);
  });

  afterAll(async () => {
    // Remove whatever the prune did not (the survivors are asserted to stay).
    for (const id of createdIds) {
      await db.orm.public.OutboxEvent.where({ id }).delete().catch(() => undefined);
    }
  });

  it("prunes old PROCESSED rows, keeps fresh ones and honors the FAILED window", async () => {
    const result = await pruneFinishedOutboxEvents({ processedDays: 14, failedDays: 30 });
    expect(result.processed).toBeGreaterThanOrEqual(1);

    expect(await db.orm.public.OutboxEvent.where({ id: oldProcessedId }).first()).toBeNull();
    expect(await db.orm.public.OutboxEvent.where({ id: freshProcessedId }).first()).not.toBeNull();
    // FAILED window (30d) keeps a 20-day-old dead-letter.
    expect(await db.orm.public.OutboxEvent.where({ id: oldFailedId }).first()).not.toBeNull();
    // In-flight states are never pruned regardless of age.
    expect(await db.orm.public.OutboxEvent.where({ id: pendingId }).first()).not.toBeNull();
    expect(await db.orm.public.OutboxEvent.where({ id: processingId }).first()).not.toBeNull();
  });

  it("prunes dead-letter rows once their (longer) window passes", async () => {
    const result = await pruneFinishedOutboxEvents({ processedDays: 14, failedDays: 10 });
    expect(result.failed).toBeGreaterThanOrEqual(1);
    expect(await db.orm.public.OutboxEvent.where({ id: oldFailedId }).first()).toBeNull();
  });
});
