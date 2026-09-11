// TASK A-008: Seller moderation authorization integration tests.
// Sellers manage content (edit, submit, withdraw); moderators manage the
// lifecycle (publish, suspend, unsuspend, unpublish). Every transition is
// exercised over real HTTP.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655440020";
const OTHER_SELLER_ID = "550e8400-e29b-41d4-a716-446655440021";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440022";
const MODERATOR_ID = "550e8400-e29b-41d4-a716-446655440023";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[moderation.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let sellerToken = "";
let otherSellerToken = "";
let adminToken = "";
let moderatorToken = "";
let resourceSlug = "";

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  sellerToken = await createTestUser(SELLER_ID, `seller_${SUFFIX}`, "USER", generateAccessToken);
  otherSellerToken = await createTestUser(OTHER_SELLER_ID, `other_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `admin_${SUFFIX}`, "ADMIN", generateAccessToken);
  moderatorToken = await createTestUser(MODERATOR_ID, `mod_${SUFFIX}`, "MODERATOR", generateAccessToken);

  // PLAN L-002: API listing creation requires an APPROVED seller profile.
    await db.orm.public.SellerProfile.create({
    userId: SELLER_ID,
    status: "APPROVED",
    payoutEnabled: true,
  }).catch(() => undefined);
  await db.orm.public.SellerProfile.create({
    userId: OTHER_SELLER_ID,
    status: "APPROVED",
    payoutEnabled: true,
  }).catch(() => undefined);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("A-008: seller moderation authorization", () => {
  let slug = "";

  beforeAll(async () => {
    slug = `mod-test-${SUFFIX}`;
    const res = await app
      .post("/resources")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Moderation Test", description: "moderation test resource", type: "SCRIPT", price: 100, slug });
    expect(res.status).toBe(201);
    resourceSlug = slug;
  });

  it("seller submits own draft: DRAFT -> PENDING_REVIEW (allowed)", async () => {
    const res = await app
      .patch(`/resources/${slug}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "PENDING_REVIEW" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PENDING_REVIEW");
  });

  it("seller withdraws submission: PENDING_REVIEW -> DRAFT (allowed)", async () => {
    const res = await app
      .patch(`/resources/${slug}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "DRAFT" });
    expect(res.status).toBe(200);
  });

  it("seller cannot publish own resource (DRAFT -> PUBLISHED, 403)", async () => {
    const res = await app
      .patch(`/resources/${slug}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "PUBLISHED" });
    expect(res.status).toBe(403);
  });

  it("seller cannot suspend (DRAFT -> SUSPENDED, 403)", async () => {
    const res = await app
      .patch(`/resources/${slug}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "SUSPENDED" });
    expect(res.status).toBe(403);
  });

  it("seller cannot unsuspend via SUSPENDED -> DRAFT (403)", async () => {
    // Force the resource into SUSPENDED directly (simulating a moderator action)
    const resource = await db.orm.public.Resource.where({ slug }).first();
    await db.orm.public.Resource.where({ id: resource!.id }).update({ status: "SUSPENDED" });

    const res = await app
      .patch(`/resources/${slug}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "DRAFT" });
    expect(res.status).toBe(403);

    // The resource must remain SUSPENDED
    const after = await db.orm.public.Resource.where({ slug }).first();
    expect(after!.status).toBe("SUSPENDED");
  });

  it("seller cannot unpublish via PUBLISHED -> DRAFT (403)", async () => {
    await db.orm.public.Resource.where({ slug }).update({ status: "PUBLISHED" });
    const res = await app
      .patch(`/resources/${slug}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "DRAFT" });
    expect(res.status).toBe(403);
    const after = await db.orm.public.Resource.where({ slug }).first();
    expect(after!.status).toBe("PUBLISHED");
  });

  it("seller cannot set a garbage status (400)", async () => {
    const res = await app
      .patch(`/resources/${slug}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "SUPER_PUBLISHED" });
    expect(res.status).toBe(400);
  });

  it("non-owner seller cannot edit the resource (403)", async () => {
    const res = await app
      .patch(`/resources/${slug}`)
      .set("Authorization", `Bearer ${otherSellerToken}`)
      .send({ title: "hijacked" });
    expect(res.status).toBe(403);
  });

  it("anonymous cannot edit (401)", async () => {
    const res = await app.patch(`/resources/${slug}`).send({ title: "anon" });
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!dbAvailable)("A-008: moderator lifecycle transitions", () => {
  let slug = "";

  beforeAll(async () => {
    slug = `mod-lifecycle-${SUFFIX}`;
    await app
      .post("/resources")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Lifecycle Test", description: "lifecycle test resource", type: "SCRIPT", price: 100, slug });
    // Submit for review
    await db.orm.public.Resource.where({ slug }).update({ status: "PENDING_REVIEW" });
  });

  it("moderator approves: PENDING_REVIEW -> PUBLISHED", async () => {
    const res = await app
      .patch(`/admin/resources/${(await db.orm.public.Resource.where({ slug }).first())!.id}/status`)
      .set("Authorization", `Bearer ${moderatorToken}`)
      .send({ status: "PUBLISHED", reason: "ok" });
    expect(res.status).toBe(200);
  });

  it("moderator suspends: PUBLISHED -> SUSPENDED", async () => {
    const resource = await db.orm.public.Resource.where({ slug }).first();
    const res = await app
      .patch(`/admin/resources/${resource!.id}/status`)
      .set("Authorization", `Bearer ${moderatorToken}`)
      .send({ status: "SUSPENDED", reason: "policy" });
    expect(res.status).toBe(200);
  });

  it("moderator unsuspends into review: SUSPENDED -> PENDING_REVIEW", async () => {
    const resource = await db.orm.public.Resource.where({ slug }).first();
    const res = await app
      .patch(`/admin/resources/${resource!.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PENDING_REVIEW" });
    expect(res.status).toBe(200);
  });

  it("invalid moderator transition is rejected: PUBLISHED -> PENDING_REVIEW (400)", async () => {
    const resource = await db.orm.public.Resource.where({ slug }).first();
    await db.orm.public.Resource.where({ id: resource!.id }).update({ status: "PUBLISHED" });
    const res = await app
      .patch(`/admin/resources/${resource!.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PENDING_REVIEW" });
    expect(res.status).toBe(400);
  });

  it("garbage status value is rejected (400)", async () => {
    const resource = await db.orm.public.Resource.where({ slug }).first();
    const res = await app
      .patch(`/admin/resources/${resource!.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "NOT_A_STATUS" });
    expect(res.status).toBe(400);
  });

  it("seller cannot use the admin moderation endpoint (403)", async () => {
    const resource = await db.orm.public.Resource.where({ slug }).first();
    const res = await app
      .patch(`/admin/resources/${resource!.id}/status`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "PUBLISHED" });
    expect(res.status).toBe(403);
  });
});