// Concurrency foundation (PLAN-010 §12): checkout exactly-once semantics.
//
// Invariants under parallel load:
//  - the SAME buyer racing checkouts of one FREE resource gets exactly one
//    license (duplicate checkouts are rejected — "already_owned");
//  - a concurrent second buyer purchases independently (isolation).
//
// Priority: exactly-once effects, transaction integrity.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const BUYER1_ID = "550e8400-e29b-41d4-a716-44665544c101";
const BUYER2_ID = "550e8400-e29b-41d4-a716-44665544c102";
const SELLER_ID = "550e8400-e29b-41d4-a716-44665544c100";
const SUFFIX = Date.now().toString(36);
const FREE_SLUG = `ccy-free-${SUFFIX}`;

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[parallel-checkout.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let buyer1Token = "";
let buyer2Token = "";

async function mkFreeResource(slug: string, title: string) {
  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug,
    title,
    description: "fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 0,
  });
  await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/ccy-${slug}.zip`,
    fileSize: 100,
    fileChecksum: "x",
  });
  return resource;
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  await createTestUser(SELLER_ID, `ccy-s_${SUFFIX}`, "USER", generateAccessToken);
  buyer1Token = await createTestUser(BUYER1_ID, `ccy-b1_${SUFFIX}`, "USER", generateAccessToken);
  buyer2Token = await createTestUser(BUYER2_ID, `ccy-b2_${SUFFIX}`, "USER", generateAccessToken);
  await mkFreeResource(FREE_SLUG, "Concurrency free");
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("concurrency: parallel checkout (exactly-once)", () => {
  it("same buyer racing N checkouts -> exactly one purchase/license", async () => {
    const attempts = 5;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        app
          .post("/purchases")
          .set("Authorization", `Bearer ${buyer1Token}`)
          .send({ resourceSlug: FREE_SLUG })
      )
    );

    const created = results.filter((r) => r.status === 201);
    expect(created.length).toBe(1);

    const purchaseId = created[0].body.purchaseId;
    const purchase = await db.orm.public.Purchase.where({ id: purchaseId }).first();
    expect(purchase?.status).toBe("COMPLETED");

    const licenses = await db.orm.public.License.where({ purchaseId }).all();
    expect(licenses.length).toBe(1);

    const allForBuyer = await db.orm.public.Purchase.where({ buyerId: BUYER1_ID }).all();
    const forResource = allForBuyer.filter(
      (p) => (p as { resourceId: string }).resourceId !== undefined
    );
    // no second purchase row slipped through for this resource
    const duplicates = forResource.length - 1;
    expect(duplicates).toBe(0);
  });

  it("a second buyer purchases the same resource independently (isolation)", async () => {
    const res = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyer2Token}`)
      .send({ resourceSlug: FREE_SLUG });
    expect(res.status).toBe(201);

    const licenses = await db.orm.public.License.where({ purchaseId: res.body.purchaseId }).all();
    expect(licenses.length).toBe(1);
  });
});
