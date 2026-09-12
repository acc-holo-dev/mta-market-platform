// PLAN-018 G-001: resource-linked official discussion threads.
// Owner (seller) creates the one official thread, duplicates → 409,
// strangers → 403, platform admin/moderator allowed, resource label on the
// detail/list surfaces.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const OWNER_ID = "550e8400-e29b-41d4-a716-446655446101";
const STRANGER_ID = "550e8400-e29b-41d4-a716-446655446102";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655446103";
const MOD_ID = "550e8400-e29b-41d4-a716-446655446104";
const SUFFIX = Date.now().toString(36);

// R1: owner's PUBLISHED resource (the official thread target).
const R1 = "00000000-0000-0000-0000-730000000001";
// R2: another owner resource — used for the admin-created thread.
const R2 = "00000000-0000-0000-0000-730000000002";
// R3: DRAFT — must not be linkable.
const R3 = "00000000-0000-0000-0000-730000000003";
// R4: published — used for the moderator-created thread.
const R4 = "00000000-0000-0000-0000-730000000004";

let ownerToken = "";
let strangerToken = "";
let adminToken = "";
let modToken = "";
let categorySlug = "";
let categoryId = "";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan018-resource-threads.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  ownerToken = await createTestUser(OWNER_ID, `rt_owner_${SUFFIX}`, "USER", generateAccessToken);
  strangerToken = await createTestUser(STRANGER_ID, `rt_stranger_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `rt_admin_${SUFFIX}`, "ADMIN", generateAccessToken);
  modToken = await createTestUser(MOD_ID, `rt_mod_${SUFFIX}`, "MODERATOR", generateAccessToken);

  await db.orm.public.Resource.create({
    id: R1, sellerId: OWNER_ID, slug: `rt-res1-${SUFFIX}`, title: "Resource One",
    description: "fixture", type: "SCRIPT", status: "PUBLISHED", price: 10000,
  });
  await db.orm.public.Resource.create({
    id: R2, sellerId: OWNER_ID, slug: `rt-res2-${SUFFIX}`, title: "Resource Two",
    description: "fixture", type: "SCRIPT", status: "PUBLISHED", price: 0,
  });
  await db.orm.public.Resource.create({
    id: R3, sellerId: OWNER_ID, slug: `rt-res3-${SUFFIX}`, title: "Resource Draft",
    description: "fixture", type: "SCRIPT", status: "DRAFT", price: 0,
  });
  await db.orm.public.Resource.create({
    id: R4, sellerId: OWNER_ID, slug: `rt-res4-${SUFFIX}`, title: "Resource Four",
    description: "fixture", type: "SCRIPT", status: "PUBLISHED", price: 5000,
  });
  const category = await db.orm.public.ForumCategory.create({
    slug: `plan005-plan018-rt-${SUFFIX}`,
    name: "Test Resource Threads",
    description: "category for G-001 tests",
    position: 99,
  });
  categorySlug = category.slug;
  categoryId = category.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  // Category deletion cascades threads+posts (schema onDelete: Cascade).
  await db.orm.public.ForumCategory.where({ id: categoryId }).delete().catch(() => undefined);
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("resource-linked threads (G-001)", () => {
  it("guest cannot create a resource thread", async () => {
    const res = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .send({ title: "Гостевая тема", content: "не должен создаться", resourceId: R1 });
    expect(res.status).toBe(401);
  });

  it("owner creates the official thread; detail and lists expose the resource label", async () => {
    const created = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: `Официальная тема ${SUFFIX}`, content: "Обсуждение ресурса.", resourceId: R1 });
    expect(created.status).toBe(201);
    expect(created.body.resourceId).toBe(R1);
    const threadId = created.body.id;

    // Detail label.
    const detail = await app.get(`/community/threads/${threadId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.resource).toBeTruthy();
    expect(detail.body.resource.slug).toBe(`rt-res1-${SUFFIX}`);
    expect(detail.body.resource.title).toBe("Resource One");

    // Category listing label (batched).
    const list = await app.get(`/community/categories/${categorySlug}/threads`);
    const card = list.body.data.find((t: any) => t.id === threadId);
    expect(card.resource?.slug).toBe(`rt-res1-${SUFFIX}`);

    // Hub card label.
    const hub = await app.get("/community");
    const hubCard = hub.body.latest.find((t: any) => t.id === threadId);
    expect(hubCard.resource?.title).toBe("Resource One");
  });

  it("a second thread for the same resource is rejected (409)", async () => {
    const res = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: `Дубль темы ${SUFFIX}`, content: "Второй тред для того же ресурса.", resourceId: R1 });
    expect(res.status).toBe(409);
  });

  it("a non-owner cannot link someone else's resource (403)", async () => {
    const res = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${strangerToken}`)
      .send({ title: `Чужая тема ${SUFFIX}`, content: "Попытка привязать чужой ресурс.", resourceId: R2 });
    expect(res.status).toBe(403);
  });

  it("platform admin may create the official thread; moderator too", async () => {
    const byAdmin = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: `Тема от админа ${SUFFIX}`, content: "Модерация оформила официальную тему.", resourceId: R2 });
    expect(byAdmin.status).toBe(201);
    expect(byAdmin.body.resourceId).toBe(R2);

    const byMod = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${modToken}`)
      .send({ title: `Тема от модератора ${SUFFIX}`, content: "Модератор оформил тему.", resourceId: R4 });
    expect(byMod.status).toBe(201);
    expect(byMod.body.resourceId).toBe(R4);
  });

  it("unknown and non-published resources are not linkable (404)", async () => {
    const unknown = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({
        title: `Нет ресурса ${SUFFIX}`,
        content: "Ссылка на несуществующий ресурс.",
        resourceId: "00000000-0000-0000-0000-000000000000",
      });
    expect(unknown.status).toBe(404);

    // R3 is DRAFT at seed time — never published, never linkable.
    const draft = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: `Черновик ${SUFFIX}`, content: "Ссылка на неопубликованный ресурс.", resourceId: R3 });
    expect(draft.status).toBe(404);
  });

  it("regular threads without resourceId keep working (regression)", async () => {
    const res = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${strangerToken}`)
      .send({ title: `Обычная тема ${SUFFIX}`, content: "Без привязки к ресурсу." });
    expect(res.status).toBe(201);
    expect(res.body.resourceId).toBeNull();
  });
});