// PLAN-005 Testing: NEWS/UPDATES (H/I) + NOTIFICATIONS (M).
// Owner create -> preview (draft) -> publish; follower notifications;
// global feed; update publishing; notification center read state.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());

const OWNER_ID = "550e8400-e29b-41d4-a716-446655444001";
const FOLLOWER_ID = "550e8400-e29b-41d4-a716-446655444002";
const STRANGER_ID = "550e8400-e29b-41d4-a716-446655444003";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan005-news.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let ownerToken = "";
let followerToken = "";
let followerId2 = "";
let otherToken = "";
let serverSlug = "";
let integrationToken = "";
let newsId = "";
let draftId = "";

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  ownerToken = await createTestUser(OWNER_ID, `nwown_${SUFFIX}`, "USER", generateAccessToken);
  followerToken = await createTestUser(FOLLOWER_ID, `nwflw_${SUFFIX}`, "USER", generateAccessToken);
  otherToken = await createTestUser(STRANGER_ID, `nwoth_${SUFFIX}`, "USER", generateAccessToken);

  // A category is needed for optional news discussions (H-004 fallback uses
  // the "Servers" category or the first one by position).
  await db.orm.public.ForumCategory.create({
    slug: `plan005-servers-${SUFFIX}`,
    name: "Test Servers",
    description: "discussion category for tests",
    position: 98,
  }).catch(() => undefined);

  const created = await app
    .post("/servers")
    .set("Authorization", `Bearer ${ownerToken}`)
    .send({ name: `News Server ${SUFFIX}`, description: "news tests" });
  serverSlug = created.body.slug;
  integrationToken = (
    await app.post(`/servers/${serverSlug}/integration-token`).set("Authorization", `Bearer ${ownerToken}`)
  ).body.token;
  await app.post("/integration/heartbeat").send({ token: integrationToken, players: 30, maxPlayers: 100 });

  // follower subscribes
  await app.post(`/servers/${serverSlug}/follow`).set("Authorization", `Bearer ${followerToken}`);
  const follower = await db.orm.public.User.where({ id: FOLLOWER_ID }).first();
  followerId2 = follower!.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("PLAN-005: server news (H)", () => {
  it("guest cannot create news", async () => {
    const res = await app.post(`/servers/${serverSlug}/news`).send({
      title: "Анонимная новость",
      content: "не должно пройти",
    });
    expect(res.status).toBe(401);
  });

  it("owner creates a draft (Create -> Preview)", async () => {
    const res = await app
      .post(`/servers/${serverSlug}/news`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: `Новость ${SUFFIX}`, content: "Содержание будущей новости." });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("DRAFT");
    draftId = res.body.id;
  });

  it("draft is invisible publicly; staff sees it in the list", async () => {
    const anon = await app.get(`/servers/${serverSlug}/news`);
    expect(anon.body.data.every((n: any) => n.status === "PUBLISHED")).toBe(true);

    const staff = await app
      .get(`/servers/${serverSlug}/news`)
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(staff.body.data.some((n: any) => n.id === draftId)).toBe(true);
  });

  it("publishing a draft notifies followers (SERVER_NEWS, L-003)", async () => {
    const res = await app
      .post(`/servers/${serverSlug}/news/${draftId}/publish`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ createDiscussion: false });
    expect(res.status).toBe(200);
    expect(res.body.news.status).toBe("PUBLISHED");
    expect(res.body.news.publishedAt).toBeTruthy();
    newsId = res.body.news.id;

    const notifs = await db.orm.public.Notification.where({ recipientId: FOLLOWER_ID }).all();
    expect(notifs.some((n: any) => n.type === "SERVER_NEWS" && n.entityId === newsId)).toBe(true);
  });

  it("published news is visible on the public server page feed", async () => {
    const res = await app.get(`/servers/${serverSlug}/news`);
    expect(res.body.data.some((n: any) => n.id === newsId)).toBe(true);
  });

  it("news detail endpoint returns author + server context", async () => {
    const res = await app.get(`/servers/${serverSlug}/news/${newsId}`);
    expect(res.status).toBe(200);
    expect(res.body.author.username).toBeTruthy();
    expect(res.body.server.slug).toBe(serverSlug);
  });

  it("non-staff cannot create news", async () => {
    const res = await app
      .post(`/servers/${serverSlug}/news`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ title: "Взлом новости", content: "не должно пройти" });
    expect(res.status).toBe(403);
  });

  it("publish with createDiscussion opens a linked thread (H-004)", async () => {
    const created = await app
      .post(`/servers/${serverSlug}/news`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ title: `Новость с обсуждением ${SUFFIX}`, content: "Текст новости для обсуждения." });
    const res = await app
      .post(`/servers/${serverSlug}/news/${created.body.id}/publish`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ createDiscussion: true });
    expect(res.status).toBe(200);
    expect(res.body.thread).toBeTruthy();
    expect(res.body.thread.title).toContain(SUFFIX);
    const thread = await db.orm.public.ForumThread.where({ id: res.body.thread.id }).first();
    expect(thread!.newsId).toBeTruthy();
    expect(thread!.serverId).toBeTruthy();
  });

  it("global news feed includes the published item", async () => {
    const res = await app.get("/news");
    expect(res.body.data.some((i: any) => i.kind === "NEWS" && i.id === newsId)).toBe(true);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: server updates (I)", () => {
  it("publishes an update (version + changelog) and notifies followers", async () => {
    const res = await app
      .post(`/servers/${serverSlug}/updates`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ version: "1.0.0", title: "Первое обновление", changelog: "Список изменений." });
    expect(res.status).toBe(201);

    const notifs = await db.orm.public.Notification.where({ recipientId: FOLLOWER_ID }).all();
    expect(notifs.some((n: any) => n.type === "SERVER_UPDATE")).toBe(true);

    const list = await app.get(`/servers/${serverSlug}/updates`);
    expect(list.body.data.some((u: any) => u.version === "1.0.0")).toBe(true);
  });

  it("rejects a duplicate version for the same server", async () => {
    const res = await app
      .post(`/servers/${serverSlug}/updates`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ version: "1.0.0", title: "Дубликат", changelog: "повтор" });
    expect(res.status).toBe(409);
  });

  it("non-staff cannot publish updates", async () => {
    const res = await app
      .post(`/servers/${serverSlug}/updates`)
      .set("Authorization", `Bearer ${otherToken}`)
      .send({ version: "9.9.9", title: "Взлом", changelog: "нет" });
    expect(res.status).toBe(403);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: notification center (M-003/M-004)", () => {
  it("unread filter + unreadCount work", async () => {
    const res = await app
      .get("/notifications?filter=unread")
      .set("Authorization", `Bearer ${followerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBeGreaterThan(0);
    expect(res.body.data.every((n: any) => n.readAt === null)).toBe(true);
  });

  it("mark read + mark all read", async () => {
    const list = await app.get("/notifications?filter=unread").set("Authorization", `Bearer ${followerToken}`);
    const first = list.body.data[0];
    const read = await app.post(`/notifications/${first.id}/read`).set("Authorization", `Bearer ${followerToken}`);
    expect(read.status).toBe(200);
    const all = await app.post("/notifications/read-all").set("Authorization", `Bearer ${followerToken}`);
    expect(all.status).toBe(200);
    const after = await app.get("/notifications?filter=unread").set("Authorization", `Bearer ${followerToken}`);
    expect(after.body.unreadCount).toBe(0);
    expect(after.body.data.length).toBe(0);
  });

  it("another user's notifications are not accessible", async () => {
    const list = await app.get("/notifications").set("Authorization", `Bearer ${ownerToken}`);
    expect(list.body.data.every((n: any) => n.recipientId === OWNER_ID)).toBe(true);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: dashboard community widgets (N)", () => {
  it("owner sees owned servers; follower sees followed + activity", async () => {
    const owned = await app
      .get("/dashboard/community")
      .set("Authorization", `Bearer ${ownerToken}`);
    expect(owned.status).toBe(200);
    expect(owned.body.ownedServers.some((s: any) => s.slug === serverSlug)).toBe(true);

    const follower = await app
      .get("/dashboard/community")
      .set("Authorization", `Bearer ${followerToken}`);
    expect(follower.body.following.some((s: any) => s.slug === serverSlug)).toBe(true);
    expect(follower.body.unreadNotifications).toBe(0); // marked all read above
    expect(Array.isArray(follower.body.discussions)).toBe(true);
  });
});