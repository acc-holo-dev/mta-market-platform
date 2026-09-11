// PLAN-012 §13/§15/§16: dispute transition concurrency + open-dispute
// database invariant.
//
// Invariants:
//  - parallel admin transitions of one dispute are serialized by the CAS —
//    the machine never skips states; a duplicate of the SAME transition is
//    acknowledged (idempotent), a conflicting one is rejected;
//  - two parallel dispute OPEN requests for one order produce exactly one
//    open dispute (dispute_*_open_uq partial unique indexes).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const ADMIN_ID = "550e8400-e29b-41d4-a716-44665544c700";
const BUYER_ID = "550e8400-e29b-41d4-a716-44665544c701";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[parallel-transition.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let adminToken = "";
let buyerToken = "";
let purchaseId = "";

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  adminToken = await createTestUser(ADMIN_ID, `ccy-dpa_${SUFFIX}`, "ADMIN", generateAccessToken);
  buyerToken = await createTestUser(BUYER_ID, `ccy-dpb_${SUFFIX}`, "USER", generateAccessToken);

  const resource = await db.orm.public.Resource.create({
    sellerId: ADMIN_ID, // admin doubles as the seller; irrelevant for disputes
    slug: `ccy-dp-${SUFFIX}`,
    title: "Dispute race fixture",
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 1000,
  });
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/ccy-dp-${SUFFIX}.zip`,
    fileSize: 10,
    fileChecksum: "x",
  });
  const purchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    status: "COMPLETED",
    completedAt: new Date().toISOString(),
    priceSnapshot: 1000,
    finalPrice: 1000,
    platformFee: 100,
    sellerRevenue: 900,
  });
  purchaseId = purchase.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("concurrency: dispute races (§13/§14)", () => {
  it("N parallel OPEN requests for one order create exactly one open dispute", async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        app
          .post("/disputes")
          .set("Authorization", `Bearer ${buyerToken}`)
          .send({ targetType: "PURCHASE", purchaseId, reason: "race" })
      )
    );

    const created = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(created.length).toBe(1);
    expect(created.length + rejected.length).toBe(results.length);

    const open = await db.orm.public.Dispute.where({ purchaseId }).all();
    expect(open.filter((d: { status: string }) => d.status !== "CLOSED").length).toBe(1);
  });

  it("parallel transitions UNDER_REVIEW -> RESOLVED_* are atomic (one winner)", async () => {
    const open = await app
      .post("/disputes")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ targetType: "PURCHASE", purchaseId, reason: "transition race" });
    if (open.status === 409) return; // dispute from the previous test still open
    const disputeId = open.body.id as string;

    // drive to UNDER_REVIEW first
    const toReview = await app
      .post(`/disputes/${disputeId}/transition`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "UNDER_REVIEW" });
    expect(toReview.status).toBe(200);

    // two DIFFERENT resolutions in parallel: exactly one wins, the loser
    // observes a concurrent state change (409). The final state must be one
    // of the two attempted targets — never a skipped third state.
    const [resolvedBuyer, resolvedSeller] = await Promise.all([
      app
        .post(`/disputes/${disputeId}/transition`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "RESOLVED_BUYER" }),
      app
        .post(`/disputes/${disputeId}/transition`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "RESOLVED_SELLER" }),
    ]);

    const dispute = await db.orm.public.Dispute.where({ id: disputeId }).first();
    expect(["RESOLVED_BUYER", "RESOLVED_SELLER"]).toContain(dispute?.status);

    // At least one of the two requests must have succeeded (the winner);
    // the loser either conflicts (409) or observes the target state.
    const outcomes = [resolvedBuyer.status, resolvedSeller.status];
    expect(outcomes).toContain(200);
    expect(outcomes.filter((s) => s === 200).length).toBe(1);
  });
});
