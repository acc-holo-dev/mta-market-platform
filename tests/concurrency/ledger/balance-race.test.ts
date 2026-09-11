// PLAN-012 §15/§16: ledger balance race + interrupted transaction recovery.
//
// Invariants:
//  - parallel balance mutations compose additively (the SQL UPDATE ... +
//    delta never overwrites a concurrent mutation);
//  - a settlement interrupted mid-transaction leaves no partial state: the
//    balance rolls back with the transaction (recoverable state).
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { db } from "@server/prisma/db";
import { applySellerBalanceDelta } from "@server/lib/ledger";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const SELLER_ID = "550e8400-e29b-41d4-a716-44665544b100";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[balance-race.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  await createTestUser(SELLER_ID, `ccy-bal_${SUFFIX}`, "USER", () => "unused");
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("concurrency: balance mutation atomicity (§8)", () => {
  it("N parallel balance deltas compose additively (no lost update)", async () => {
    const N = 20;
    const DELTA = 137;

    await Promise.all(
      Array.from({ length: N }, () => applySellerBalanceDelta(SELLER_ID, DELTA, DELTA))
    );

    const balance = await db.orm.public.SellerBalance.where({ userId: SELLER_ID }).first();
    expect(balance?.availableAmount).toBe(N * DELTA);
    expect(balance?.totalEarned).toBe(N * DELTA);
  });

  it("a transaction rolled back mid-settlement leaves no partial balance", async () => {
    await applySellerBalanceDelta(SELLER_ID, 1000, 1000);
    const before = await db.orm.public.SellerBalance.where({ userId: SELLER_ID }).first();
    const beforeAmount = before?.availableAmount ?? 0;

    await expect(
      db.transaction(async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
        await applySellerBalanceDelta(SELLER_ID, 500, 500, tx);
        throw new Error("simulated crash mid-settlement");
      })
    ).rejects.toThrow("simulated crash");

    const after = await db.orm.public.SellerBalance.where({ userId: SELLER_ID }).first();
    expect(after?.availableAmount ?? 0).toBe(beforeAmount);
  });
});
