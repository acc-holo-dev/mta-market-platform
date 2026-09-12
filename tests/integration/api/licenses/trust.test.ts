// PLAN-018 Workstream C: trust read models (C-001..C-004).
// Verifies that verification/health scores are EXPLAINABLE (factor breakdown
// sums to the score) and DETERMINISTIC (same rows → same response), and that
// the seller score is bounded 0..100 with honest nulls for absent data.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655440160";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655440161";
const SUFFIX = `tw${Date.now().toString(36)}`;

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[trust.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let sellerToken = "";

function iso(offsetMinutes: number): string {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString();
}

let verifiedSlug = "";
let bareSlug = "";

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  sellerToken = await createTestUser(SELLER_ID, `ttrust_${SUFFIX}`, "USER", generateAccessToken);
  await db.orm.public.User.create({
    id: BUYER_ID,
    email: `tbuyer_${SUFFIX}@test.local`,
    username: `tbuyer_${SUFFIX}`,
    role: "USER",
    status: "ACTIVE",
  });

  // --- Resource with a full, exactly known evidence set ---------------------
  // installation = 1 license / (1 license + 1 FAILED sandbox run) = 0.5 → 12.5
  // refunds      = 1 - 1 REFUNDED / (1 COMPLETED + 1 REFUNDED) = 0.5 → 12.5
  // compatibility= VERIFIED report → 1 → 25
  // cadence      = 1 release in 90d / target 4 = 0.25 → 6.25
  // score        = 56.25
  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `trust-ok-${SUFFIX}`,
    title: "Trust Fixture",
    description: "known evidence set",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 100,
  });
  verifiedSlug = resource.slug;
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    changelog: "initial",
    fileUrl: "/uploads/trust-fixture.zip",
    fileSize: 10,
    fileChecksum: "chk",
    releaseStatus: "PUBLISHED",
    publishedAt: iso(0),
  });
  await db.orm.public.SandboxRun.create({
    versionId: version.id,
    status: "FAILED",
    stderr: "fixture failure",
  });
  const purchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    status: "COMPLETED",
    priceSnapshot: 100,
    finalPrice: 100,
    platformFee: 10,
    sellerRevenue: 90,
  });
  await db.orm.public.License.create({
    purchaseId: purchase.id,
    versionId: version.id,
    status: "ACTIVE",
  });
  await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    status: "REFUNDED",
    priceSnapshot: 100,
    finalPrice: 100,
    platformFee: 10,
    sellerRevenue: 90,
  });
  await db.orm.public.CompatibilityReport.create({
    versionId: version.id,
    status: "VERIFIED",
    mtaVersion: "1.6",
    os: "windows-x64",
    architecture: "x64",
    verifiedBy: "fixture",
  });

  // --- Published resource with NO evidence (all-null factors) ---------------
  const bare = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `trust-bare-${SUFFIX}`,
    title: "Bare Fixture",
    description: "no evidence",
    type: "MAP",
    status: "PUBLISHED",
    price: 0,
  });
  bareSlug = bare.slug;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

function factorSum(factors: { contribution: number }[]): number {
  return Math.round(factors.reduce((s, f) => s + f.contribution, 0) * 100) / 100;
}

describe.skipIf(!dbAvailable)("trust read models", () => {
  it("resource verification + health are deterministic and explainable", async () => {
    const res1 = await app.get(`/trust/resource/${verifiedSlug}`);
    const res2 = await app.get(`/trust/resource/${verifiedSlug}`);
    expect(res1.status).toBe(200);
    expect(res1.body).toEqual(res2.body); // same rows → byte-identical response

    // C-001: moderated (PUBLISHED) + VERIFIED report → VERIFIED, factors show it.
    expect(res1.body.verification.state).toBe("VERIFIED");
    expect(res1.body.verification.factors).toEqual([
      { name: "moderation", value: 1, weight: 50, contribution: 50, note: "PUBLISHED — approved by moderation" },
      { name: "compatibility", value: 1, weight: 50, contribution: 50, note: "latest report: VERIFIED" },
    ]);

    // C-002: compatibility surfaces the real report fields.
    expect(res1.body.compatibility.result).toBe("VERIFIED");
    expect(res1.body.compatibility.mtaVersion).toBe("1.6");
    expect(res1.body.compatibility.os).toBe("windows-x64");
    expect(res1.body.compatibility.arch).toBe("x64");
    expect(Array.isArray(res1.body.compatibility.dependencies)).toBe(true);

    // C-003: documented formula → score 56.25, factors sum to the score.
    expect(res1.body.health.score).toBe(56.25);
    const names = res1.body.health.factors.map((f: any) => f.name);
    expect(names).toEqual(["installation", "refunds", "compatibility", "cadence"]);
    const byName = Object.fromEntries(res1.body.health.factors.map((f: any) => [f.name, f]));
    expect(byName.installation.value).toBe(0.5);
    expect(byName.refunds.value).toBe(0.5);
    expect(byName.compatibility.value).toBe(1);
    expect(byName.cadence.value).toBe(0.25);
    expect(factorSum(res1.body.health.factors)).toBe(res1.body.health.score);
  });

  it("an evidence-free resource is UNVERIFIED with honest null factors", async () => {
    const res = await app.get(`/trust/resource/${bareSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.verification.state).toBe("UNVERIFIED");
    expect(res.body.health.score).toBe(0);
    for (const f of res.body.health.factors) {
      if (f.name === "cadence") {
        expect(f.value).toBe(0); // count query ran: zero releases is real data
      } else {
        expect(f.value).toBeNull(); // no evidence — never invented
        expect(f.contribution).toBe(0);
      }
    }
  });

  it("seller score is bounded, explainable and null-safe", async () => {
    const seller = await db.orm.public.User.where({ id: SELLER_ID }).first();
    const res = await app.get(`/trust/seller/${seller!.username}`);
    expect(res.status).toBe(200);
    // installation 12.5 + refunds 12.5 + cadence 6.25 (1 release / target
    // 2 per resource × 2 resources) + compat 15 + support null = 46.25
    expect(res.body.score).toBe(46.25);
    expect(res.body.score).toBeGreaterThanOrEqual(0);
    expect(res.body.score).toBeLessThanOrEqual(100);
    expect(res.body.factors).toHaveLength(5);
    const support = res.body.factors.find((f: any) => f.name === "support");
    expect(support.value).toBeNull(); // honest null: no dispute data exists
    expect(support.note).toContain("no dispute data");
    expect(factorSum(res.body.factors)).toBe(res.body.score);
  });

  it("404s are honest for unknown slugs and usernames", async () => {
    expect((await app.get("/trust/resource/no-such-resource")).status).toBe(404);
    expect((await app.get("/trust/seller/no-such-user-xyz")).status).toBe(404);
  });
});
