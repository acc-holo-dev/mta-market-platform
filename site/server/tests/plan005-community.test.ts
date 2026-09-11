// PLAN-005 Testing §36: COMMUNITY forum flows.
// Open community -> category -> create thread -> reply -> edit -> reaction ->
// notification -> report -> moderator action.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());

const AUTHOR_ID = "550e8400-e29b-41d4-a716-446655442001";
const REPLIER_ID = "550e8400-e29b-41d4-a716-446655442002";
const THIRD_ID = "550e8400-e29b-41d4-a716-446655442003";
const MOD_ID = "550e8400-e29b-41d4-a716-446655442004";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan005-community.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let authorToken = "";
let replierToken = "";
let thirdToken = "";
let modToken = "";
let categorySlug = "";
let threadId = "";
let replyPostId = "";

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  authorToken = await createTestUser(AUTHOR_ID, `fma_${SUFFIX}`, "USER", generateAccessToken);
  replierToken = await createTestUser(REPLIER_ID, `fmr_${SUFFIX}`, "USER", generateAccessToken);
  thirdToken = await createTestUser(THIRD_ID, `fmt_${SUFFIX}`, "USER", generateAccessToken);
  modToken = await createTestUser(MOD_ID, `fmmod_${SUFFIX}`, "MODERATOR", generateAccessToken);
  const cat = await db.orm.public.ForumCategory.create({
    slug: `plan005-general-${SUFFIX}`,
    name: "Test General",
    description: "category for tests",
    position: 99,
  });
  categorySlug = cat.slug;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("PLAN-005: community hub & categories (F-001/F-002)", () => {
  it("hub returns categories/latest/active/pinned/recentActivity", async () => {
    const res = await app.get("/community");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.categories)).toBe(true);
    expect(res.body.categories.some((c: any) => c.slug === categorySlug)).toBe(true);
  });

  it("categories endpoint lists the test category with thread count", async () => {
    const res = await app.get("/community/categories");
    const found = res.body.data.find((c: any) => c.slug === categorySlug);
    expect(found).toBeTruthy();
    expect(found.threadCount).toBe(0);
  });

  it("category listing 404s for unknown slugs", async () => {
    const res = await app.get("/community/categories/nope-404/threads");
    expect(res.status).toBe(404);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: threads & posts (F-003/F-004/F-005)", () => {
  it("guest cannot create a thread (registration required for posting)", async () => {
    const res = await app.post(`/community/categories/${categorySlug}/threads`).send({
      title: "Guest thread",
      content: "should fail",
    });
    expect(res.status).toBe(401);
  });

  it("author creates a thread with a first post", async () => {
    const res = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ title: `Тема ${SUFFIX}`, content: "Первое сообщение темы." });
    expect(res.status).toBe(201);
    expect(res.body.state).toBe("OPEN");
    expect(res.body.replyCount).toBe(0);
    threadId = res.body.id;
  });

  it("rejects short titles and short content", async () => {
    const res = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ title: "аб", content: "текст" });
    expect(res.status).toBe(400);
  });

  it("thread page shows the first post and counts real views", async () => {
    const first = await app.get(`/community/threads/${threadId}`);
    expect(first.status).toBe(200);
    expect(first.body.data.length).toBe(1);
    expect(first.body.thread.views).toBe(0);
    const second = await app.get(`/community/threads/${threadId}`);
    expect(second.body.thread.views).toBe(1);
  });

  it("another user replies; thread author receives FORUM_REPLY notification", async () => {
    const res = await app
      .post(`/community/threads/${threadId}/posts`)
      .set("Authorization", `Bearer ${replierToken}`)
      .send({ content: "Полезный ответ с деталями." });
    expect(res.status).toBe(201);
    replyPostId = res.body.id;

    const notifs = await db.orm.public.Notification.where({ recipientId: AUTHOR_ID }).all();
    expect(notifs.some((n: any) => n.type === "FORUM_REPLY")).toBe(true);
    const thread = await db.orm.public.ForumThread.where({ id: threadId }).first();
    expect(thread!.replyCount).toBe(1);
  });

  it("replies are position-ordered with pagination metadata", async () => {
    const res = await app.get(`/community/threads/${threadId}`);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.data[0].position).toBe(0);
    expect(res.body.data[1].position).toBe(1);
  });

  it("author edits own reply; edit timestamp is stored", async () => {
    const res = await app
      .patch(`/community/posts/${replyPostId}`)
      .set("Authorization", `Bearer ${replierToken}`)
      .send({ content: "Обновлённый текст ответа." });
    expect(res.status).toBe(200);
    expect(res.body.editedAt).toBeTruthy();
  });

  it("another user cannot edit someone else's post", async () => {
    const res = await app
      .patch(`/community/posts/${replyPostId}`)
      .set("Authorization", `Bearer ${thirdToken}`)
      .send({ content: "взлом" });
    expect(res.status).toBe(403);
  });

  it("reactions toggle on/off (F-004)", async () => {
    const on = await app
      .put(`/community/posts/${replyPostId}/reactions/LIKE`)
      .set("Authorization", `Bearer ${thirdToken}`);
    expect(on.status).toBe(201);
    const detail = await app
      .get(`/community/threads/${threadId}`)
      .set("Authorization", `Bearer ${thirdToken}`);
    const post = detail.body.data.find((p: any) => p.id === replyPostId);
    expect(post.reactionCount).toBe(1);
    expect(post.reactedByMe).toContain("LIKE");
    const off = await app
      .put(`/community/posts/${replyPostId}/reactions/LIKE`)
      .set("Authorization", `Bearer ${thirdToken}`);
    expect(off.body.reacted).toBe(false);
  });

  it("regular user cannot change thread state (moderation-only)", async () => {
    const res = await app
      .post(`/community/threads/${threadId}/state`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ state: "LOCKED" });
    expect(res.status).toBe(403);
  });

  it("moderator locks a thread with audit + author notification", async () => {
    const res = await app
      .post(`/community/threads/${threadId}/state`)
      .set("Authorization", `Bearer ${modToken}`)
      .send({ state: "LOCKED" });
    expect(res.status).toBe(200);
    expect(res.body.state).toBe("LOCKED");
    const audits = await db.orm.public.AuditLog
      .where({ targetType: "forumThread", targetId: threadId })
      .all();
    expect(audits.some((a: any) => a.action === "forum.thread.state")).toBe(true);
    const notifs = await db.orm.public.Notification.where({ recipientId: AUTHOR_ID }).all();
    expect(notifs.some((n: any) => n.type === "MODERATION")).toBe(true);
  });

  it("guest thread fetch exposes isModerator=false; platform moderator sees true", async () => {
    const guest = await app.get(`/community/threads/${threadId}`);
    expect(guest.body.caller.isModerator).toBe(false);
    const mod = await app
      .get(`/community/threads/${threadId}`)
      .set("Authorization", `Bearer ${modToken}`);
    expect(mod.body.caller.isModerator).toBe(true);
  });

  it("replying to a locked thread is rejected (F-005)", async () => {
    const res = await app
      .post(`/community/threads/${threadId}/posts`)
      .set("Authorization", `Bearer ${thirdToken}`)
      .send({ content: "поздно" });
    expect(res.status).toBe(409);
    // reopen for the next test
    await app
      .post(`/community/threads/${threadId}/state`)
      .set("Authorization", `Bearer ${modToken}`)
      .send({ state: "OPEN" });
  });

  it("author deletes own post softly; replyCount drops", async () => {
    const res = await app
      .delete(`/community/posts/${replyPostId}`)
      .set("Authorization", `Bearer ${replierToken}`);
    expect(res.status).toBe(200);
    const thread = await db.orm.public.ForumThread.where({ id: threadId }).first();
    expect(thread!.replyCount).toBe(0);
    const post = await db.orm.public.ForumPost.where({ id: replyPostId }).first();
    expect(post!.deletedAt).toBeTruthy();
    const detail = await app.get(`/community/threads/${threadId}`);
    expect(detail.body.data.find((p: any) => p.id === replyPostId).deleted).toBe(true);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: reports (R)", () => {
  it("user reports a thread; it lands in the moderation queue", async () => {
    const res = await app
      .post("/reports")
      .set("Authorization", `Bearer ${thirdToken}`)
      .send({ targetType: "THREAD", targetId: threadId, reason: "Спам в заголовке" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("OPEN");

    const modList = await app
      .get("/admin/reports?status=OPEN")
      .set("Authorization", `Bearer ${modToken}`);
    expect(modList.status).toBe(200);
    const found = modList.body.data.find((r: any) => r.id === res.body.id);
    expect(found).toBeTruthy();
  });

  it("rejects unknown targets and short reasons", async () => {
    const bad = await app
      .post("/reports")
      .set("Authorization", `Bearer ${thirdToken}`)
      .send({ targetType: "THREAD", targetId: "00000000-0000-0000-0000-000000000000", reason: "нет" });
    expect(bad.status).toBe(404);
    const short = await app
      .post("/reports")
      .set("Authorization", `Bearer ${thirdToken}`)
      .send({ targetType: "THREAD", targetId: threadId, reason: "х" });
    expect(short.status).toBe(400);
  });

  it("moderator resolves the report; reporter is notified", async () => {
    const list = await app
      .get("/admin/reports?status=OPEN")
      .set("Authorization", `Bearer ${modToken}`);
    const report = list.body.data[0];
    const res = await app
      .post(`/admin/reports/${report.id}/resolve`)
      .set("Authorization", `Bearer ${modToken}`)
      .send({ status: "DISMISSED", resolution: "нарушение не подтверждено" });
    expect(res.status).toBe(200);
    const notifs = await db.orm.public.Notification.where({ recipientId: THIRD_ID }).all();
    expect(notifs.some((n: any) => n.type === "MODERATION")).toBe(true);
  });

  it("guest cannot file reports", async () => {
    const res = await app.post("/reports").send({
      targetType: "THREAD",
      targetId: threadId,
      reason: "анонимная жалоба",
    });
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: server-linked discussions (G-004)", () => {
  it("only the server's own staff can link a thread to their server", async () => {
    // create + verify a server for the author
    const serverRes = await app
      .post("/servers")
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ name: `Forum Server ${SUFFIX}`, description: "forum" });
    const slug = serverRes.body.slug;
    const token = (
      await app.post(`/servers/${slug}/integration-token`).set("Authorization", `Bearer ${authorToken}`)
    ).body.token;
    await app.post("/integration/heartbeat").send({ token, players: 5, maxPlayers: 10 });

    const linked = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({
        title: `Серверная тема ${SUFFIX}`,
        content: "Обсуждение от лица сервера.",
        serverId: (await db.orm.public.Server.where({ slug }).first())!.id,
      });
    expect(linked.status).toBe(201);
    expect(linked.body.serverId).toBeTruthy();

    // someone else's server is forbidden
    const stranger = await app
      .post(`/community/categories/${categorySlug}/threads`)
      .set("Authorization", `Bearer ${replierToken}`)
      .send({
        title: `Чужая тема ${SUFFIX}`,
        content: "Попытка привязать чужой сервер.",
        serverId: (await db.orm.public.Server.where({ slug }).first())!.id,
      });
    expect(stranger.status).toBe(403);
  });
});