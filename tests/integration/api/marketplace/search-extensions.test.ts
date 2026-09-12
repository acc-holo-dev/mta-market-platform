// PLAN-018 Workstream H: search extensions.
// H-001 new groups (services/creators/news) alongside the existing
// resources/servers/threads/articles (unchanged item shapes), H-002 filters,
// H-003 ranking sanity. The documented formula is asserted via ordering, not
// exact numbers (activity/recency depend on row timestamps).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655440180";
const BUYER1_ID = "550e8400-e29b-41d4-a716-446655440181";
const BUYER2_ID = "550e8400-e29b-41d4-a716-446655440182";
const CREATOR_ID = "550e8400-e29b-41d4-a716-446655440183";
const PENDING_CREATOR_ID = "550e8400-e29b-41d4-a716-446655440184";
const SUFFIX = `se${Date.now().toString(36)}`;
const Q = `zq${SUFFIX}`; // unique lowercase token, ILIKE-wildcard-free

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[search-extensions.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let sellerToken = "";

let resourceRatedId = "";
let resourceFreeId = "";
let resourceOldId = "";
let serviceTitleMatchId = "";
let serviceDescMatchId = "";
let creatorId = "";
let pendingCreatorId = "";
let verifiedServerId = "";
let pendingServerId = "";

function oldIso(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  sellerToken = await createTestUser(SELLER_ID, `ses_${SUFFIX}`, "USER", generateAccessToken);
  for (const [id, name] of [
    [BUYER1_ID, `seb1_${SUFFIX}`],
    [BUYER2_ID, `seb2_${SUFFIX}`],
  ] as const) {
    await db.orm.public.User.create({
      id,
      email: `${name}@test.local`,
      username: name,
      role: "USER",
      status: "ACTIVE",
    });
  }

  // --- resources -----------------------------------------------------------
  const rated = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `se-rated-${SUFFIX}`,
    title: `Rated ${Q} Resource`,
    description: "well reviewed tool",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 5000,
  });
  resourceRatedId = rated.id;
  await db.orm.public.Review.create({
    resourceId: rated.id,
    buyerId: BUYER1_ID,
    rating: 5,
    comment: "great",
  });

  const free = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `se-free-${SUFFIX}`,
    title: `Free ${Q} Tool`,
    description: "free map",
    type: "MAP",
    status: "PUBLISHED",
    price: 0,
  });
  resourceFreeId = free.id;

  const stale = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `se-stale-${SUFFIX}`,
    title: `Stale ${Q}`,
    description: "old description",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 1000,
  });
  resourceOldId = stale.id;
  // Freeze the row in the past (rating 2 review + 40d old update).
  await db.orm.public.Resource.where({ id: stale.id }).update({ updatedAt: oldIso(40) });
  await db.orm.public.Review.create({
    resourceId: stale.id,
    buyerId: BUYER2_ID,
    rating: 2,
    comment: "meh",
  });

  // --- services (H-001) -----------------------------------------------------
  const s1 = await db.orm.public.Service.create({
    sellerId: SELLER_ID,
    slug: `se-svc-title-${SUFFIX}`,
    title: `Anticheat ${Q} Setup`,
    description: "full server configuration",
    type: "CONFIGURATION",
    status: "PUBLISHED",
    price: 10000,
    deliveryDays: 3,
  });
  serviceTitleMatchId = s1.id;
  await db.orm.public.ServiceOrderItem.create({
    orderId: `se-order-${SUFFIX}`,
    serviceId: s1.id,
    priceSnapshot: 10000,
    finalPrice: 10000,
  });
  await db.orm.public.ServiceOrderItem.create({
    orderId: `se-order-${SUFFIX}`,
    serviceId: s1.id,
    priceSnapshot: 10000,
    finalPrice: 10000,
  });
  const s2 = await db.orm.public.Service.create({
    sellerId: SELLER_ID,
    slug: `se-svc-desc-${SUFFIX}`,
    title: "Consultation Package",
    description: `covers ${Q} topics`,
    type: "CONSULTATION",
    status: "PUBLISHED",
    price: 5000,
    deliveryDays: 1,
  });
  serviceDescMatchId = s2.id;

  // --- creators (H-001) -----------------------------------------------------
  await db.orm.public.User.create({
    id: CREATOR_ID,
    email: `sec_${SUFFIX}@test.local`,
    username: `secreator${SUFFIX}`,
    role: "SELLER",
    status: "ACTIVE",
  });
  await db.orm.public.SellerProfile.create({
    userId: CREATOR_ID,
    status: "APPROVED",
    displayName: `Studio ${Q}`,
  });
  await db.orm.public.SellerFollow.create({ followerId: BUYER1_ID, sellerUserId: CREATOR_ID });
  await db.orm.public.SellerFollow.create({ followerId: BUYER2_ID, sellerUserId: CREATOR_ID });

  await db.orm.public.User.create({
    id: PENDING_CREATOR_ID,
    email: `sep_${SUFFIX}@test.local`,
    username: `sepcreator${SUFFIX}`,
    role: "USER",
    status: "ACTIVE",
  });
  await db.orm.public.SellerProfile.create({
    userId: PENDING_CREATOR_ID,
    status: "PENDING",
    displayName: `Pending ${Q} Studio`,
  });
  pendingCreatorId = PENDING_CREATOR_ID;
  creatorId = CREATOR_ID;

  // --- servers + news (H-001) ------------------------------------------------
  const server = await db.orm.public.Server.create({
    ownerId: SELLER_ID,
    slug: `se-srv-${SUFFIX}`,
    name: `Verified ${Q} Server`,
    description: "a live server",
    lifecycle: "ACTIVE",
    verification: "VERIFIED",
  });
  verifiedServerId = server.id;
  const pendingServer = await db.orm.public.Server.create({
    ownerId: SELLER_ID,
    slug: `se-srv2-${SUFFIX}`,
    name: `Unverified ${Q} Server`,
    description: "pending verification",
    lifecycle: "PENDING_VERIFICATION",
    verification: "PENDING",
  });
  pendingServerId = pendingServer.id;

  await db.orm.public.ServerNews.create({
    serverId: server.id,
    authorId: SELLER_ID,
    title: `Winter ${Q} News`,
    content: "the update landed",
    status: "PUBLISHED",
  });

  // --- threads + articles (existing groups) ----------------------------------
  const category = await db.orm.public.ForumCategory.create({
    slug: `plan005-${SUFFIX}`,
    name: "search fixture",
  });
  await db.orm.public.ForumThread.create({
    categoryId: category.id,
    authorId: SELLER_ID,
    title: `Thread about ${Q}`,
    replyCount: 5,
  });
  await db.orm.public.Article.create({
    authorId: SELLER_ID,
    slug: `se-art-${SUFFIX}`,
    title: `Guide to ${Q}`,
    content: "long content",
    excerpt: `Guide ${Q}`,
    status: "PUBLISHED",
    publishedAt: new Date().toISOString(),
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("search extensions (H)", () => {
  it("keeps existing group shapes and adds services/creators/news", async () => {
    const res = await app.get(`/search?q=${Q}&limit=10`);
    expect(res.status).toBe(200);
    for (const key of ["resources", "servers", "threads", "articles", "services", "creators", "news"]) {
      expect(res.body[key], `group ${key}`).toBeTruthy();
      expect(typeof res.body[key].count).toBe("number");
      expect(Array.isArray(res.body[key].data)).toBe(true);
    }
    // Existing shapes untouched (GlobalSearch contract).
    const resource = res.body.resources.data[0];
    expect(Object.keys(resource).sort()).toEqual(["coverUrl", "id", "price", "slug", "title", "type"]);
    const server = res.body.servers.data[0];
    expect(Object.keys(server).sort()).toEqual([
      "id", "logoUrl", "monitoring", "name", "playerCount", "slug", "verification",
    ]);
    const thread = res.body.threads.data[0];
    expect(Object.keys(thread).sort()).toEqual(["id", "lastPostAt", "replyCount", "state", "title"]);
    const article = res.body.articles.data[0];
    expect(Object.keys(article).sort()).toEqual(["category", "excerpt", "id", "publishedAt", "slug", "title"]);

    // New group shapes.
    const service = res.body.services.data[0];
    expect(Object.keys(service).sort()).toEqual(["deliveryDays", "id", "price", "slug", "title", "type"]);
    const creator = res.body.creators.data[0];
    expect(Object.keys(creator).sort()).toEqual(["avatar", "displayName", "followers", "id", "username"]);
    const news = res.body.news.data[0];
    expect(Object.keys(news).sort()).toEqual(["coverUrl", "excerpt", "id", "publishedAt", "server", "title"]);
    expect(news.server.slug).toBeTruthy();
  });

  it("filters: type, price, category, rating_min, updated_within, verified", async () => {
    const typeOnly = await app.get(`/search?q=${Q}&type=services`);
    expect(typeOnly.status).toBe(200);
    expect(typeOnly.body.services).toBeTruthy();
    expect(typeOnly.body.resources).toBeUndefined();
    expect(typeOnly.body.servers).toBeUndefined();

    const free = await app.get(`/search?q=${Q}&price=free&limit=10`);
    const freeIds = free.body.resources.data.map((r: any) => r.id);
    expect(freeIds).toContain(resourceFreeId);
    expect(freeIds).not.toContain(resourceRatedId);

    const script = await app.get(`/search?q=${Q}&category=SCRIPT&limit=10`);
    const scriptRows = script.body.resources.data;
    expect(scriptRows.every((r: any) => r.type === "SCRIPT")).toBe(true);
    expect(scriptRows.map((r: any) => r.id)).not.toContain(resourceFreeId); // MAP

    const rated = await app.get(`/search?q=${Q}&rating_min=4&limit=10`);
    const ratedIds = rated.body.resources.data.map((r: any) => r.id);
    expect(ratedIds).toContain(resourceRatedId); // avg 5
    expect(ratedIds).not.toContain(resourceOldId); // avg 2

    const fresh = await app.get(`/search?q=${Q}&updated_within=30d&limit=10`);
    const freshIds = fresh.body.resources.data.map((r: any) => r.id);
    expect(freshIds).toContain(resourceRatedId);
    expect(freshIds).not.toContain(resourceOldId); // updatedAt 40d ago

    const verified = await app.get(`/search?q=${Q}&verified=true&limit=10`);
    const serverIds = verified.body.servers.data.map((s: any) => s.id);
    expect(serverIds).toContain(verifiedServerId);
    expect(serverIds).not.toContain(pendingServerId);
    const creatorNames = verified.body.creators.data.map((c: any) => c.id);
    expect(creatorNames).toContain(creatorId); // APPROVED profile
    expect(creatorNames).not.toContain(pendingCreatorId); // PENDING profile
  });

  it("ranks title matches with activity above description-only matches (H-003)", async () => {
    const res = await app.get(`/search?q=${Q}&type=services&limit=10`);
    const ids = res.body.services.data.map((s: any) => s.id);
    // Title match (3) + 2 orders + recency + trust beats description-only (1).
    expect(ids[0]).toBe(serviceTitleMatchId);
    expect(ids).toContain(serviceDescMatchId);
  });

  it("ranks well-reviewed resources above stale low-rated ones (H-003)", async () => {
    const res = await app.get(`/search?q=${Q}&limit=10`);
    const ids = res.body.resources.data.map((r: any) => r.id);
    expect(ids.indexOf(resourceRatedId)).toBeLessThan(ids.indexOf(resourceOldId));
  });

  it("keeps the short-query guard", async () => {
    expect((await app.get("/search?q=a")).status).toBe(400);
  });
});
