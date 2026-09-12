// PLAN-018 G-004: @username mentions in forum replies.
// Mention → notification with the "упомянули" wording; self-mentions,
// thread-author mentions, repeated tokens and unknown usernames never
// produce extra notifications; participant+mention dedups to exactly one.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const AUTHOR_ID = "550e8400-e29b-41d4-a716-446655446201";
const TARGET_ID = "550e8400-e29b-41d4-a716-446655446202";
const REPLIER_ID = "550e8400-e29b-41d4-a716-446655446203";
const SUFFIX = Date.now().toString(36);
const TARGET_NAME = `mn_target_${SUFFIX}`;
const AUTHOR_NAME = `mn_author_${SUFFIX}`;

let authorToken = "";
let targetToken = "";
let replierToken = "";
let categoryId = "";
let threadId = "";

async function notificationCount(userId: string): Promise<number> {
  const agg = await db.orm.public.Notification.where({ recipientId: userId }).aggregate(
    (a: any) => ({ total: a.count() })
  );
  return Number(agg.total ?? 0);
}

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan018-mentions.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  authorToken = await createTestUser(AUTHOR_ID, AUTHOR_NAME, "USER", generateAccessToken);
  targetToken = await createTestUser(TARGET_ID, TARGET_NAME, "USER", generateAccessToken);
  replierToken = await createTestUser(REPLIER_ID, `mn_replier_${SUFFIX}`, "USER", generateAccessToken);
  const category = await db.orm.public.ForumCategory.create({
    slug: `plan005-plan018-mn-${SUFFIX}`,
    name: "Test Mentions",
    description: "category for G-004 tests",
    position: 99,
  });
  categoryId = category.id;
  const thread = await app
    .post(`/community/categories/${category.slug}/threads`)
    .set("Authorization", `Bearer ${authorToken}`)
    .send({ title: `Тема с упоминаниями ${SUFFIX}`, content: "Стартовое сообщение." });
  threadId = thread.body.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await db.orm.public.ForumCategory.where({ id: categoryId }).delete().catch(() => undefined);
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("@mentions (G-004)", () => {
  it("mention notifies the target with the mention wording; thread author is not duplicated", async () => {
    const authorBefore = await notificationCount(AUTHOR_ID);
    const res = await app
      .post(`/community/threads/${threadId}/posts`)
      .set("Authorization", `Bearer ${replierToken}`)
      .send({
        content: `Глянь, пожалуйста, @${TARGET_NAME} и @${AUTHOR_NAME}, а также @no_such_user_777.`,
      });
    expect(res.status).toBe(201);

    const notifs = await db.orm.public.Notification.where({ recipientId: TARGET_ID }).all();
    const mention = notifs.find((n: any) => n.title.includes("Вас упомянули"));
    expect(mention).toBeTruthy();
    expect(mention!.type).toBe("FORUM_REPLY");
    expect(mention!.entityType).toBe("forumThread");
    expect(mention!.entityId).toBe(threadId);

    // The thread author is a participant: exactly ONE generic FORUM_REPLY —
    // the author mention must not add a duplicate.
    expect(await notificationCount(AUTHOR_ID)).toBe(authorBefore + 1);
    const authorNotifs = await db.orm.public.Notification.where({ recipientId: AUTHOR_ID }).all();
    expect(authorNotifs.filter((n: any) => n.entityId === threadId).length).toBe(1);
    // Unknown token resolved to nobody; the actor never notifies self.
    expect(await notificationCount(REPLIER_ID)).toBe(0);
  });

  it("self-mention never notifies the actor", async () => {
    const before = await notificationCount(AUTHOR_ID);
    const res = await app
      .post(`/community/threads/${threadId}/posts`)
      .set("Authorization", `Bearer ${authorToken}`)
      .send({ content: `Сам себя упомянул @${AUTHOR_NAME} — тишина.` });
    expect(res.status).toBe(201);
    expect(await notificationCount(AUTHOR_ID)).toBe(before);
  });

  it("unknown username is silently ignored", async () => {
    const targetBefore = await notificationCount(TARGET_ID);
    const authorBefore = await notificationCount(AUTHOR_ID);
    const res = await app
      .post(`/community/threads/${threadId}/posts`)
      .set("Authorization", `Bearer ${replierToken}`)
      .send({ content: "Вызов несуществующего пользователя @definitely_absent_42." });
    expect(res.status).toBe(201);
    // The unknown token resolves to nobody; only the regular participant
    // fanout happens (thread author +1), the target hears nothing.
    expect(await notificationCount(TARGET_ID)).toBe(targetBefore);
    expect(await notificationCount(AUTHOR_ID)).toBe(authorBefore + 1);
  });

  it("a participant who is also mentioned receives exactly one notification with the mention wording", async () => {
    // The target speaks (becomes a participant), then the replier mentions
    // them twice in one post.
    const targetPost = await app
      .post(`/community/threads/${threadId}/posts`)
      .set("Authorization", `Bearer ${targetToken}`)
      .send({ content: "Я здесь." });
    expect(targetPost.status).toBe(201);

    const targetBefore = await notificationCount(TARGET_ID);
    const replierBefore = await notificationCount(REPLIER_ID);
    const res = await app
      .post(`/community/threads/${threadId}/posts`)
      .set("Authorization", `Bearer ${replierToken}`)
      .send({ content: `Дубль-чек @${TARGET_NAME} @${TARGET_NAME}` });
    expect(res.status).toBe(201);

    // participant FORUM_REPLY + mention → dedup to exactly one row for this
    // reply, and the wording is the mention title (first-wins).
    expect(await notificationCount(TARGET_ID)).toBe(targetBefore + 1);
    const targetNotifs = await db.orm.public.Notification.where({ recipientId: TARGET_ID }).all();
    const forThread = targetNotifs
      .filter((n: any) => n.entityId === threadId)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    expect(forThread[0].title).toContain("Вас упомянули");
    // The actor never receives a notification, even when mentioned by name
    // inside their own post content context.
    expect(await notificationCount(REPLIER_ID)).toBe(replierBefore);
  });
});