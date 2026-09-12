// PLAN-019 H-002/H-005 integration tests: the transactional outbox lifecycle
// against the real database.
//   - emit inside db.transaction: commits with the domain action, and a
//     rolled-back action leaves NO event (nothing publishes before commit);
//   - emit -> claim (PENDING -> PROCESSING, attempts+1, payload preserved)
//     -> complete (PROCESSED);
//   - fail -> finite backoff (availableAt in the future, hidden from claim)
//     until maxAttempts, then FAILED dead-letter that is never claimed again;
//   - duplicate-claim guard: the CAS makes a second claim of a PROCESSING
//     row impossible (honest note: this proves the row-level guard; a true
//     two-worker race is not simulated here — see lib/events.ts).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@server/prisma/db";
import {
  emitOutbox,
  claimBatch,
  completeEvent,
  failEvent,
  DEFAULT_MAX_ATTEMPTS,
} from "@server/lib/events";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[outbox.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

const createdIds: string[] = [];
const suiteStartedAt = new Date();

/** Json codec may hand back a string — normalize before deep comparison. */
function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return (value ?? {}) as Record<string, unknown>;
}

/** Tag this suite's payloads so cleanup can identify its rows safely. */
function mark(payload: Record<string, unknown>): Record<string, unknown> {
  return { __outboxTest: true, ...payload };
}

/** Normalize the affected-row result of updateAndCount()-style returns. */
function affectedCount(result: unknown): number {
  if (typeof result === "number") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    for (const key of ["affectedCount", "count", "updated", "affected"]) {
      if (typeof r[key] === "number") return r[key];
    }
  }
  return 0;
}

beforeAll(async () => {
  if (!dbAvailable) return;
  // Full sweep (aligned with resetTestEntities' OutboxEvent cleanup): commerce
  // suites emit REAL PAYMENT_SUCCEEDED rows during checkout tests; leftovers
  // would be older than this suite's own rows and claimBatch's oldest-first
  // ordering would claim them first, breaking the lifecycle assertions.
  // The shared test DB is disposable — every row in it is test data.
  try {
    const stale = await db.orm.public.OutboxEvent.where({}).all();
    for (const row of stale) {
      await db.orm.public.OutboxEvent.where({ id: row.id }).delete().catch(() => undefined);
    }
  } catch {
    // best-effort
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  for (const id of createdIds) {
    await db.orm.public.OutboxEvent.where({ id }).delete().catch(() => undefined);
  }
  // Sweep anything this suite created that slipped the id tracking.
  try {
    const rows = await db.orm.public.OutboxEvent.where({}).all();
    for (const row of rows) {
      const payload = asObject(row.payload);
      if (payload.__outboxTest === true && new Date(row.createdAt) >= suiteStartedAt) {
        await db.orm.public.OutboxEvent.where({ id: row.id }).delete().catch(() => undefined);
      }
    }
  } catch {
    // best-effort
  }
});

describe.skipIf(!dbAvailable)("outbox: emit rides the caller's transaction", () => {
  it("rolls the emitted event back with the domain action (no publish before commit)", async () => {
    const before = (await db.orm.public.OutboxEvent.where({}).all()).length;
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.transaction(async (tx: any) => {
        await emitOutbox(tx, "PAYMENT_SUCCEEDED", mark({ probe: "rollback" }));
        throw new Error("domain action failed — event must vanish");
      })
    ).rejects.toThrow("domain action failed");
    const after = (await db.orm.public.OutboxEvent.where({}).all()).length;
    expect(after).toBe(before); // the insert died with the transaction
  });

  it("commits the emitted event when the domain transaction commits", async () => {
    let committedId = "";
    await db.transaction(async (tx: unknown) => {
      const result = await emitOutbox(tx, "PAYMENT_SUCCEEDED", mark({ probe: "committed" }));
      committedId = result.id;
      createdIds.push(committedId);
    });
    const row = await db.orm.public.OutboxEvent.where({ id: committedId }).first();
    expect(row).toBeTruthy();
    expect(row?.status).toBe("PENDING");
    expect(asObject(row?.payload)).toEqual({ __outboxTest: true, probe: "committed" });
    // Remove the row now: later suites in this file assert claim behavior
    // over due PENDING rows and a leftover would skew their candidate sets.
    await db.orm.public.OutboxEvent.where({ id: committedId }).delete();
    createdIds.splice(createdIds.indexOf(committedId), 1);
  });
});

describe.skipIf(!dbAvailable)("outbox: emit -> claim -> complete lifecycle", () => {
  it("claims due PENDING events: PROCESSING, attempts+1, payload preserved", async () => {
    const id = await (async () => {
      const { id } = await emitOutbox(db, "PAYMENT_SUCCEEDED", mark({
        probe: "lifecycle",
        purchaseId: "p-lifecycle",
      }));
      createdIds.push(id);
      return id;
    })();

    const claimed = await claimBatch(db, { limit: 10 });
    const mine = claimed.find((e) => e.id === id);
    expect(mine).toBeTruthy();
    expect(mine?.eventType).toBe("PAYMENT_SUCCEEDED");
    expect(mine?.attempts).toBe(1);
    expect(mine?.payload).toEqual({ __outboxTest: true, probe: "lifecycle", purchaseId: "p-lifecycle" });

    const row = await db.orm.public.OutboxEvent.where({ id }).first();
    expect(row?.status).toBe("PROCESSING");
    expect(Number(row?.attempts)).toBe(1);

    await completeEvent(id);
    const done = await db.orm.public.OutboxEvent.where({ id }).first();
    expect(done?.status).toBe("PROCESSED");
    expect(done?.processedAt).toBeTruthy();

    // A completed event is never claimed again.
    const second = await claimBatch(db, { limit: 10 });
    expect(second.find((e) => e.id === id)).toBeUndefined();
  });

  it("respects the claim limit and oldest-first ordering", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { id } = await emitOutbox(db, "DISPUTE_OPENED", mark({ probe: "limit", n: i }));
      createdIds.push(id);
      ids.push(id);
    }
    const claimed = await claimBatch(db, { limit: 2 });
    const claimedIds = claimed.map((e) => e.id).filter((id) => ids.includes(id));
    expect(claimedIds).toEqual(ids.slice(0, 2)); // oldest two, in order

    const remaining = await db.orm.public.OutboxEvent.where({ id: ids[2] }).first();
    expect(remaining?.status).toBe("PENDING"); // third stayed claimable
    await completeEvent(claimedIds[0]).catch(() => undefined);
    await completeEvent(claimedIds[1]).catch(() => undefined);
    // Remove the unclaimed row now so later suites in this file see an
    // empty due-PENDING candidate set.
    await db.orm.public.OutboxEvent.where({ id: ids[2] }).delete();
    createdIds.splice(createdIds.indexOf(ids[2]), 1);
  });
});

describe.skipIf(!dbAvailable)("outbox: fail -> backoff -> dead-letter (H-005)", () => {
  it("requeues a failed event with a FUTURE availableAt and lastError", async () => {
    const { id } = await emitOutbox(db, "LICENSE_EXPIRING", mark({ probe: "backoff", licenseId: "l1" }));
    createdIds.push(id);

    const firstClaim = await claimBatch(db, { limit: 10 });
    expect(firstClaim.find((e) => e.id === id)).toBeTruthy();

    const before = Date.now();
    const outcome = await failEvent(id, new Error("boom"));
    expect(outcome).toBe("RETRY");

    const row = await db.orm.public.OutboxEvent.where({ id }).first();
    expect(row?.status).toBe("PENDING");
    expect(Number(row?.attempts)).toBe(1);
    expect(row?.lastError).toContain("boom");
    const availableAt = new Date(row?.availableAt as string).getTime();
    // attempts=1 -> backoff 2^1 * 30s = 60s (small clock slack tolerated)
    expect(availableAt).toBeGreaterThanOrEqual(before + 59_000);
    expect(availableAt).toBeGreaterThan(Date.now());

    // The future availableAt hides the row from the claim until it is due.
    const notYet = await claimBatch(db, { limit: 10 });
    expect(notYet.find((e) => e.id === id)).toBeUndefined();

    // Once due, the retry is claimable with the incremented attempt count.
    await db.orm.public.OutboxEvent
      .where({ id, status: "PENDING" })
      .update({ availableAt: new Date(Date.now() - 1000).toISOString() });
    const dueClaim = await claimBatch(db, { limit: 10 });
    const retried = dueClaim.find((e) => e.id === id);
    expect(retried).toBeTruthy();
    expect(retried?.attempts).toBe(2);
    await failEvent(id, new Error("boom again"));
    const afterRetry = await db.orm.public.OutboxEvent.where({ id }).first();
    expect(afterRetry?.status).toBe("PENDING");
    expect(Number(afterRetry?.attempts)).toBe(2);
    expect(afterRetry?.lastError).toContain("boom");
  });

  it("dead-letters after maxAttempts and never claims the row again", async () => {
    const { id } = await emitOutbox(db, "SECURITY_ALERT", mark({ probe: "dead-letter" }));
    createdIds.push(id);

    for (let attempt = 1; attempt <= DEFAULT_MAX_ATTEMPTS; attempt++) {
      const claimed = await claimBatch(db, { limit: 10 });
      expect(claimed.find((e) => e.id === id)).toBeTruthy();
      const outcome = await failEvent(id, new Error(`fail ${attempt}`));
      expect(outcome).toBe(attempt < DEFAULT_MAX_ATTEMPTS ? "RETRY" : "DEAD_LETTER");
      if (outcome === "RETRY") {
        // Make the backoff window elapse instantly for the next attempt.
        await db.orm.public.OutboxEvent
          .where({ id, status: "PENDING" })
          .update({ availableAt: new Date(Date.now() - 1000).toISOString() });
      }
    }

    const row = await db.orm.public.OutboxEvent.where({ id }).first();
    expect(row?.status).toBe("FAILED");
    expect(Number(row?.attempts)).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(row?.lastError).toContain(`fail ${DEFAULT_MAX_ATTEMPTS}`);

    // Dead-letter: claimBatch skips FAILED rows forever...
    expect((await claimBatch(db, { limit: 10 })).find((e) => e.id === id)).toBeUndefined();
    // ...and a stale PROCESSING->PROCESSED ack cannot resurrect it.
    expect(await completeEvent(id)).toBe(false);
  });
});

describe.skipIf(!dbAvailable)("outbox: duplicate-claim guard (CAS)", () => {
  it("a second claim misses a row already PROCESSING, attempts stay at 1", async () => {
    const { id } = await emitOutbox(db, "DISPUTE_OPENED", mark({ probe: "cas", disputeId: "d-cas" }));
    createdIds.push(id);

    const first = await claimBatch(db, { limit: 10 });
    expect(first.find((e) => e.id === id)).toBeTruthy();

    // "Second worker" claims the same candidates: the row is no longer
    // PENDING, so it must not come back and attempts must not increment.
    const second = await claimBatch(db, { limit: 10 });
    expect(second.find((e) => e.id === id)).toBeUndefined();
    const row = await db.orm.public.OutboxEvent.where({ id }).first();
    expect(Number(row?.attempts)).toBe(1);
    expect(row?.status).toBe("PROCESSING");

    // Row-level CAS guard, documented: a stale claimant whose where clause
    // still says PENDING updates zero rows (same mechanism discount/commerce
    // CAS rely on — plain update() ignores non-key where fields, so only
    // updateAndCount() is authoritative here).
    const lostRace = await db.orm.public.OutboxEvent
      .where({ id, status: "PENDING" })
      .updateAndCount({ status: "PROCESSING", attempts: 99 });
    expect(affectedCount(lostRace)).toBe(0);
    const untouched = await db.orm.public.OutboxEvent.where({ id }).first();
    expect(Number(untouched?.attempts)).toBe(1);
  });
});