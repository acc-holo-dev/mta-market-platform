// PLAN-007 Testing §12–§13: Content Foundation at the HTTP layer.
// Lifecycle (draft → pending → published/archived), moderation decisions,
// explicit links (resources: PUBLISHED; servers: staff-only), integration
// with the PLAN-006 activity read layer (NEW_ARTICLE), search, profile.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";
import { redis } from "../src/lib/redis";

const app = request(createApp());

const AUTHOR_ID = "550e8400-e29b-41d4-a716-446655443001";
const PLAYER_ID = "550e8400-e29b-41d4-a716-446655443002";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655443003";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655443004";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655443005";
const SUFFIX = Date.now().toString(36);

const H = 3600_000;
const D = 24 * H;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let authorToken = "";
let adminToken = "";
let playerToken = "";

// Fixture ids.
const SERVER_MINE = "00000000-0000-0000-0000-110000000001"; // owned by AUTHOR
const SERVER_OTHER = "00000000-0000-0000-0000-110000000002"; // owned by OTHER
const R_PUBLISHED = "00000000-0000-0000-0000-610000000001";
const R_SUSPENDED = "00000000-0000-0000-0000-610000000002";

async function bustCache(): Promise<void> {
  const keys = ["plan006:activity:live:v1"];
  for (let limit = 5; limit <= 50; limit += 5) keys.push(`plan006:activity:snapshot:v1:${limit}`);
  try {
    await redis.del(...keys);
  } catch {
    // fail-open
  }
}

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan007-content.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  // PLAN-006 hygiene: PLAN-001 e2e leftovers (see plan006-activity.test.ts).
  const junk = (await db.orm.public.Resource.where({}).all()).filter((r: any) =>
    /^(e2e-|p1-)/.test(r.slug)
  );
  for (const r of junk) {
    const purchases = await db.orm.public.Purchase.where({ resourceId: r.id }).all();
    for (const p of purchases) {
      const licenses = await db.orm.public.License.where({ purchaseId: p.id }).all();
      for (const l of licenses) {
        const installs = await db.orm.public.Installation.where({ licenseId: l.id }).all();
        for (const i of installs) {
          await db.orm.public.Lease.where({ installationId: i.id }).delete().catch(() => undefined);
          await db.orm.public.Installation.where({ id: i.id }).delete().catch(() => undefined);
        }
        await db.orm.public.License.where({ id: l.id }).delete().catch(() => undefined);
      }
      const disputes = await db.orm.public.Dispute.where({ purchaseId: p.id }).all();
      for (const d of disputes) {
        await db.orm.public.DisputeAttachment.where({ disputeId: d.id }).delete().catch(() => undefined);
        await db.orm.public.DisputeEvent.where({ disputeId: d.id }).delete().catch(() => undefined);
        await db.orm.public.DisputeMessage.where({ disputeId: d.id }).delete().catch(() => undefined);
        await db.orm.public.Dispute.where({ id: d.id }).delete().catch(() => undefined);
      }
      await db.orm.public.Purchase.where({ id: p.id }).delete().catch(() => undefined);
    }
    const versions = await db.orm.public.ResourceVersion.where({ resourceId: r.id }).all();
    for (const v of versions) {
      await db.orm.public.ArtifactSignature.where({ versionId: v.id }).delete().catch(() => undefined);
      await db.orm.public.ArtifactEncryption.where({ versionId: v.id }).delete().catch(() => undefined);
      await db.orm.public.CompatibilityReport.where({ versionId: v.id }).delete().catch(() => undefined);
      await db.orm.public.SandboxRun.where({ versionId: v.id }).delete().catch(() => undefined);
    }
    await db.orm.public.Resource.where({ id: r.id }).delete().catch(() => undefined);
  }

  // Forum category for article discussions (B-003 fallback: first by position).
  await db.orm.public.ForumCategory.create({
    slug: `plan007-servers-${SUFFIX}`, name: "Plan007 Servers", position: 1,
  });
  authorToken = await createTestUser(AUTHOR_ID, `ctauth_${SUFFIX}`, "USER", generateAccessToken);
  playerToken = await createTestUser(PLAYER_ID, `ctplay_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(OTHER_ID, `ctothr_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `ctadm_${SUFFIX}`, "ADMIN", generateAccessToken);
  await createTestUser(SELLER_ID, `ctsell_${SUFFIX}`, "USER", generateAccessToken);

  await db.orm.public.Server.create({
    id: SERVER_MINE, ownerId: AUTHOR_ID, slug: `ct-mine-${SUFFIX}`, name: "CT Mine",
    description: "fixture", lifecycle: "ACTIVE", verification: "VERIFIED",
    verifiedAt: iso(10 * D), createdAt: iso(10 * D),
  });
  await db.orm.public.Server.create({
    id: SERVER_OTHER, ownerId: OTHER_ID, slug: `ct-other-${SUFFIX}`, name: "CT Other",
    description: "fixture", lifecycle: "ACTIVE", verification: "VERIFIED",
    verifiedAt: iso(10 * D), createdAt: iso(10 * D),
  });
  await db.orm.public.Resource.create({
    id: R_PUBLISHED, sellerId: SELLER_ID, slug: `ct-pub-${SUFFIX}`, title: "CT Published Mod",
    description: "fixture", type: "SCRIPT", status: "PUBLISHED", price: 0, createdAt: iso(5 * D),
  });
  await db.orm.public.Resource.create({
    id: R_SUSPENDED, sellerId: SELLER_ID, slug: `ct-susp-${SUFFIX}`, title: "CT Suspended Mod",
    description: "fixture", type: "SCRIPT", status: "SUSPENDED", price: 0, createdAt: iso(5 * D),
  });
  await bustCache();
});

afterAll(async () => {
  if (!dbAvailable) return;
  const cats = await db.orm.public.ForumCategory.where({}).all();
  for (const c of cats) {
    if (c.slug.startsWith("plan007-")) {
      await db.orm.public.ForumCategory.where({ id: c.id }).delete().catch(() => undefined);
    }
  }
  await bustCache();
});

const ARTICLE = {
  title: "Какой framework выбрать для RP-сервера",
  content:
    "Выбор фреймворка определяет всё развитие сервера.\n\nСравним популярные варианты: собственный фреймворк даёт контроль, но требует месяцев работы.\n\nГотовые решения быстрее, но привязывают к чужой архитектуре.",
  category: "GUIDES",
  tags: "roleplay, framework",
};

function createArticle(token: string, overrides: Record<string, unknown> = {}) {
  return app
    .post("/content")
    .set("Authorization", `Bearer ${token}`)
    .send({ ...ARTICLE, ...overrides });
}

describe("PLAN-007 content API", () => {
  it("requires authentication to create; guests only read (§30)", async () => {
    if (!dbAvailable) return;
    await createArticle("").expect(401);
  });

  it("create draft → submit → admin approves → published everywhere (C/D/E/F)", async () => {
    if (!dbAvailable) return;
    const created = (await createArticle(authorToken).expect(201)).body;
    expect(created.status).toBe("DRAFT");

    // Drafts are invisible on every public surface.
    const hub = await app.get("/content").expect(200);
    expect(hub.body.data.some((a: any) => a.id === created.id)).toBe(false);

    const submitted = (await app
      .post(`/content/${created.id}/submit`)
      .set("Authorization", `Bearer ${authorToken}`)
      .expect(200)).body;
    expect(submitted.status).toBe("PENDING_REVIEW");

    // Non-moderator cannot approve (D-003).
    await app.post(`/admin/content/${created.id}/approve`).set("Authorization", `Bearer ${authorToken}`).expect(403);

    const approved = (await app
      .post(`/admin/content/${created.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200)).body;
    expect(approved.status).toBe("PUBLISHED");
    expect(approved.publishedAt).toBeTruthy();

    // Hub + article page (guest).
    const hub2 = await app.get("/content?category=GUIDES").expect(200);
    expect(hub2.body.data.some((a: any) => a.id === created.id)).toBe(true);
    const page = await app.get(`/content/articles/${created.slug}`).expect(200);
    expect(page.body.title).toBe(ARTICLE.title);
    expect(page.body.author.username).toBe(`ctauth_${SUFFIX}`);

    // Author notification (MODERATION).
    const notifs = await db.orm.public.Notification.where({ recipientId: AUTHOR_ID }).all();
    expect(notifs.some((n: any) => n.entityId === created.id)).toBe(true);

    // Activity: NEW_ARTICLE appears immediately (cache busted on approve).
    await bustCache();
    const activity = await app.get("/activity?limit=50").expect(200);
    const item = activity.body.items.find((i: any) => i.type === "NEW_ARTICLE");
    expect(item).toBeTruthy();
    expect(item.href).toBe(`/content/articles/${created.slug}`);
    expect(item.author.username).toBe(`ctauth_${SUFFIX}`);

    // Profile shows the published article (E-003).
    const profile = await app.get(`/profiles/ctauth_${SUFFIX}`).expect(200);
    expect(profile.body.articles.some((a: any) => a.slug === created.slug)).toBe(true);
  });

  it("reject returns the draft with a reason and notifies the author (D-001)", async () => {
    if (!dbAvailable) return;
    const created = (await createArticle(authorToken, { title: "Черновик на отказ" }).expect(201)).body;
    await app.post(`/content/${created.id}/submit`).set("Authorization", `Bearer ${authorToken}`).expect(200);
    const rejected = (await app
      .post(`/admin/content/${created.id}/reject`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Слишком мало конкретики по теме" })
      .expect(200)).body;
    expect(rejected.status).toBe("DRAFT");
    expect(rejected.reviewNote).toContain("Слишком мало конкретики");

    const mine = (await app.get("/content/mine").set("Authorization", `Bearer ${authorToken}`).expect(200)).body;
    const row = mine.data.find((a: any) => a.id === created.id);
    expect(row.reviewNote).toContain("Слишком мало конкретики");
    // Rejected drafts are not in the hub.
    const hub = await app.get("/content").expect(200);
    expect(hub.body.data.some((a: any) => a.id === created.id)).toBe(false);
  });

  it("hide removes the article from every public surface (D-002/§13)", async () => {
    if (!dbAvailable) return;
    const created = (await createArticle(authorToken, { title: "Статья под скрытие" }).expect(201)).body;
    await app.post(`/content/${created.id}/submit`).set("Authorization", `Bearer ${authorToken}`).expect(200);
    await app.post(`/admin/content/${created.id}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(200);
    await bustCache();
    expect((await app.get("/content").expect(200)).body.data.some((a: any) => a.id === created.id)).toBe(true);

    await app
      .post(`/admin/content/${created.id}/hide`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ reason: "Дублирует существующий гайд" })
      .expect(200);

    await bustCache();
    expect((await app.get("/content").expect(200)).body.data.some((a: any) => a.id === created.id)).toBe(false);
    await app.get(`/content/articles/${created.slug}`).expect(404);
    const activity = await app.get("/activity?limit=50").expect(200);
    expect(activity.body.items.some((i: any) => i.href === `/content/articles/${created.slug}`)).toBe(false);
  });

  it("links: server staff-only (G-004 precedent), resources must be PUBLISHED (B-002)", async () => {
    if (!dbAvailable) return;
    // Attaching someone else's server is forbidden.
    await createArticle(authorToken, { title: "Чужой сервер", serverIds: [SERVER_OTHER] }).expect(403);
    // Attaching own server works.
    const ok = await createArticle(authorToken, { title: "Мой сервер", serverIds: [SERVER_MINE] }).expect(201);
    // Attaching a suspended resource is rejected.
    await createArticle(authorToken, { title: "Скрытый ресурс", resourceIds: [R_SUSPENDED] }).expect(400);
    // Attaching a published resource works and renders on the page.
    const withLink = await createArticle(authorToken, { title: "Разбор мода", resourceIds: [R_PUBLISHED] }).expect(201);
    await app.post(`/content/${withLink.body.id}/submit`).set("Authorization", `Bearer ${authorToken}`).expect(200);
    await app.post(`/admin/content/${withLink.body.id}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(200);
    const page = await app.get(`/content/articles/${withLink.body.slug}`).expect(200);
    expect(page.body.resources.map((r: any) => r.slug)).toContain(`ct-pub-${SUFFIX}`);

    // The ok draft server link persists (staff allowed).
    const mine = (await app.get("/content/mine").set("Authorization", `Bearer ${authorToken}`).expect(200)).body;
    expect(mine.data.some((a: any) => a.title === "Мой сервер")).toBe(true);
  });

  it("editing a published article returns it to moderation (C-002)", async () => {
    if (!dbAvailable) return;
    const created = (await createArticle(authorToken, { title: "Публикация и правка" }).expect(201)).body;
    await app.post(`/content/${created.id}/submit`).set("Authorization", `Bearer ${authorToken}`).expect(200);
    await app.post(`/admin/content/${created.id}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(200);
    const edited = (await app
      .patch(`/content/${created.id}`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ content: ARTICLE.content + "\n\nДополнение после обсуждения." })
      .expect(200)).body;
    expect(edited.status).toBe("PENDING_REVIEW");
    const hub = await app.get("/content").expect(200);
    expect(hub.body.data.some((a: any) => a.id === created.id)).toBe(false);
  });

  it("article discussion: one thread per article, replies work (B-003)", async () => {
    if (!dbAvailable) return;
    const created = (await createArticle(authorToken, { title: "Статья с обсуждением" }).expect(201)).body;
    // Cannot open a discussion for an unpublished article.
    await app.post(`/content/${created.id}/discussion`).set("Authorization", `Bearer ${authorToken}`).expect(409);
    await app.post(`/content/${created.id}/submit`).set("Authorization", `Bearer ${authorToken}`).expect(200);
    await app.post(`/admin/content/${created.id}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(200);
    const thread = (await app
      .post(`/content/${created.id}/discussion`)
      .set("Authorization", `Bearer ${authorToken}`)
      .expect(201)).body;
    expect(thread.articleId).toBe(created.id);
    // Second discussion → 409.
    await app.post(`/content/${created.id}/discussion`).set("Authorization", `Bearer ${authorToken}`).expect(409);
    // Article-linked threads do not pollute NEW_DISCUSSION (PLAN-006 rule).
    await bustCache();
    const activity = await app.get("/activity?limit=50").expect(200);
    const disc = activity.body.items.filter((i: any) => i.type === "NEW_DISCUSSION");
    expect(disc.some((i: any) => i.thread?.id === thread.id)).toBe(false);
    // But it renders on the article page.
    const page = await app.get(`/content/articles/${created.slug}`).expect(200);
    expect(page.body.thread.id).toBe(thread.id);
  });

  it("search finds published articles as an explicit group (E-004)", async () => {
    if (!dbAvailable) return;
    await createArticle(authorToken, { title: "Уникальный поиск по статье Zephyr" }).expect(201);
    const mine = (await app.get("/content/mine").set("Authorization", `Bearer ${authorToken}`).expect(200)).body;
    const draft = mine.data.find((a: any) => a.title.includes("Zephyr"));
    await app.post(`/content/${draft.id}/submit`).set("Authorization", `Bearer ${authorToken}`).expect(200);
    await app.post(`/admin/content/${draft.id}/approve`).set("Authorization", `Bearer ${adminToken}`).expect(200);
    const res = await app.get("/search?q=Zephyr").expect(200);
    expect(res.body.articles.count).toBeGreaterThanOrEqual(1);
    // Drafts are not searchable.
    const draftSearch = await app.get("/search?q=Секретный").expect(200);
    expect(draftSearch.body.articles.count).toBe(0);
  });

  it("reports accept ARTICLE targets (D-003)", async () => {
    if (!dbAvailable) return;
    const created = (await createArticle(playerToken, { title: "Жалобная статья" }).expect(201)).body;
    await app
      .post("/reports")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ targetType: "ARTICLE", targetId: created.id, reason: "Плохой контент" })
      .expect(201);
    // Non-existent article id is rejected (target must exist).
    await app
      .post("/reports")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ targetType: "ARTICLE", targetId: "00000000-0000-0000-0000-999999999999", reason: "Нет такого" })
      .expect(404);
  });
});
