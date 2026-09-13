// PLAN-020 F-004: cross-instance scheduler lock semantics.
//
// Invariants:
//  - two concurrent jobs with the SAME key: exactly one acquires, the other
//    skips its tick (schedulers are periodic — skipping is always safe);
//  - jobs with DIFFERENT keys never block each other;
//  - after the winner finishes, the lock is free again (transaction-scoped).
import { describe, it, expect } from "vitest";

import { db } from "@server/prisma/db";
import { runUnderSchedulerLock } from "@server/lib/schedulerLock";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[scheduler-lock.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

describe.skipIf(!dbAvailable)("worker scheduler lock (PLAN-020 F-004)", () => {
  it("serializes same-key jobs: the loser skips its tick", async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const winner = runUnderSchedulerLock("test:scheduler:shared", async () => {
      events.push("winner:start");
      await gate; // hold the transaction (and the lock) open
      events.push("winner:end");
    });

    // Let the winner acquire before the challenger attempts.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const loser = runUnderSchedulerLock("test:scheduler:shared", async () => {
      events.push("loser:start");
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    release();
    const [winnerOutcome, loserOutcome] = await Promise.all([winner, loser]);

    expect(winnerOutcome).toBe("acquired");
    expect(loserOutcome).toBe("skipped");
    expect(events).toEqual(["winner:start", "winner:end"]);
  });

  it("does not block different keys", async () => {
    const outcomes = await Promise.all([
      runUnderSchedulerLock("test:scheduler:a", async () => "a"),
      runUnderSchedulerLock("test:scheduler:b", async () => "b"),
    ]);
    expect(outcomes).toEqual(["acquired", "acquired"]);
  });

  it("releases the lock after the winner finishes", async () => {
    const first = await runUnderSchedulerLock("test:scheduler:reuse", async () => undefined);
    const second = await runUnderSchedulerLock("test:scheduler:reuse", async () => undefined);
    expect(first).toBe("acquired");
    expect(second).toBe("acquired");
  });
});
