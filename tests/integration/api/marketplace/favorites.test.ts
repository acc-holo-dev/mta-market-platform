// PLAN-018 I-002: favorites across the four surfaces (resource / server /
// creator / forum discussion). Idempotent toggles, grouped /me/favorites
// with subject cards, 404 on unknown targets, 401 for guests.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const USER_ID = "550e8400-e29b-41d4-a716-446655446301";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655446302";
const NONCREATOR_ID = "550e8400-e29b-41d4-a716-446655446304";
const SUFFIX = Date.now().toString(36);

const R1 = "00000000-0000-0000-0000-740000000001";
const S1 = "00000000-0000-0000-0000-740000000101";
const T1 = "00000000-0000-0000-0000-740000000201";

let userToken = "";
let sellerToken = "";
let categorySlug = "";
let categoryId = "";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan018-favorites.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  userToken = await createTestUser(USER_ID, `fv_user_${SUFFIX}`, "USER", generateAccessToken);
  sellerToken = await createTestUser(SELLER_ID, `fv_seller_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(NONCREATOR_ID, `fv_plain_${SUFFIX}`, "USER", generateAccessToken);

  // Creator with an APPROVED SellerProfile (follows.ts precedent).
  await db.orm.public.SellerProfile.create({
    userId: SELLER_ID, status: "APPROVED", displayName: "Favorite Seller",
  });
  // Published resource (favoritable).
  await db.orm.public.Resource.create({
    id: R1, sellerId: SELLER_ID, slug: `fv-res1-${SUFFIX}`, title: "Favorite Resource",
    description: "fixture", type: "SCRIPT", status: "PUBLISHED", price: 30000,
  });
  // Publicly visible server (lifecycle ACTIVE).
  await db.orm.public.Server.create({
    id: S1, ownerId: SELLER_ID, slug: `fv-srv-${SUFFIX}`, name: "Favorite Server",
    description: "fixture", lifecycle: "ACTIVE",
  });
  // Category + thread for the DISCUSSION favorite.
  const category = await db.orm.public.ForumCategory.create({
    slug: `plan005-plan018-fv-${SUFFIX}`,
    name: "Test Favorites",
    description: "category for I-002 tests",
    position: 99,
  });
  categorySlug = category.slug;
  await db.orm.public.ForumThread.create({
    id: T1, categoryId: category.id, authorId: SELLER_ID, title: "Favorite Thread", state: "OPEN",
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.orm.public.ForumCategory.where({ slug: categorySlug }).delete().catch(() => undefined);
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("favorites (I-002)", () => {
  it("guests cannot favorite", async () => {
    await app.put(`/resources/whatever/favorite`).expect(401);
    await app.get("/me/favorites").expect(401);
  });

  it("toggles all four target types idempotently", async () => {
    // RESOURCE
    const on1 = (await app
      .put(`/resources/fv-res1-${SUFFIX}/favorite`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200)).body;
    expect(on1.favorited).toBe(true);
    // Repeat PUT keeps the single row (no 409, no duplicate).
    await app
      .put(`/resources/fv-res1-${SUFFIX}/favorite`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(
      (await db.orm.public.Favorite.where({ userId: USER_ID, targetType: "RESOURCE" }).all()).length
    ).toBe(1);

    // SERVER
    await app
      .put(`/servers/fv-srv-${SUFFIX}/favorite`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    // CREATOR (storefront username → seller userId as targetId)
    const onCreator = (await app
      .put(`/sellers/fv_seller_${SUFFIX}/favorite`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200)).body;
    expect(onCreator.favorited).toBe(true);
    expect(onCreator.targetId).toBe(SELLER_ID);
    // DISCUSSION (forum thread id)
    const onThread = (await app
      .put(`/community/forum/thread/${T1}/favorite`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200)).body;
    expect(onThread.favorited).toBe(true);
    expect(
      (await db.orm.public.Favorite.where({ userId: USER_ID }).all()).length
    ).toBe(4);

    // Unfavorite: idempotent DELETE.
    const off = (await app
      .delete(`/resources/fv-res1-${SUFFIX}/favorite`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200)).body;
    expect(off.favorited).toBe(false);
    await app
      .delete(`/resources/fv-res1-${SUFFIX}/favorite`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    expect(
      (await db.orm.public.Favorite.where({ userId: USER_ID, targetType: "RESOURCE" }).all()).length
    ).toBe(0);
  });

  it("list groups favorites with subject cards and honors the type filter", async () => {
    // Re-favorite the resource, then list everything.
    await app
      .put(`/resources/fv-res1-${SUFFIX}/favorite`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200);
    const all = (await app
      .get("/me/favorites")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200)).body;
    expect(all.data.RESOURCE).toHaveLength(1);
    expect(all.data.RESOURCE[0].subject.title).toBe("Favorite Resource");
    expect(all.data.SERVER[0].subject.name).toBe("Favorite Server");
    expect(all.data.CREATOR[0].subject.username).toBe(`fv_seller_${SUFFIX}`);
    expect(all.data.DISCUSSION[0].subject.title).toBe("Favorite Thread");

    const filtered = (await app
      .get("/me/favorites?type=SERVER")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(200)).body;
    expect(filtered.data.SERVER).toHaveLength(1);
    expect(filtered.data.RESOURCE).toHaveLength(0);
    expect(filtered.data.CREATOR).toHaveLength(0);
    expect(filtered.data.DISCUSSION).toHaveLength(0);

    // Unknown type filter is a 400.
    await app
      .get("/me/favorites?type=NOPE")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(400);
  });

  it("unknown targets 404 for both PUT and DELETE", async () => {
    await app
      .put("/resources/fv-missing-404/favorite")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(404);
    await app
      .delete("/resources/fv-missing-404/favorite")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(404);
    await app
      .put("/servers/fv-missing-404/favorite")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(404);
    await app
      .put("/sellers/fv_missing_404/favorite")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(404);
    await app
      .put("/community/forum/thread/00000000-0000-0000-0000-000000000000/favorite")
      .set("Authorization", `Bearer ${userToken}`)
      .expect(404);
    // A non-creator user is not a favoritable CREATOR target.
    await app
      .put(`/sellers/fv_plain_${SUFFIX}/favorite`)
      .set("Authorization", `Bearer ${userToken}`)
      .expect(404);
  });
});