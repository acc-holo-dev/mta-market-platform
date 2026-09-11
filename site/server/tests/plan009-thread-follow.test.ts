// PLAN-009 Testing §9–§12: Thread Follow at the HTTP layer.
// Follow API, delivery (FORUM_REPLY to followers with dedup), privacy (§42),
// dashboard summary row (§12).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";
import { redis } from "../src/lib/redis";

const app = request(createApp());

const AUTHOR_ID = "550e8400-e29b-41d4-a716-446655445001";
const FAN_ID = "550e8400-e29b-41d4-a716-446655445002";
const REPLIER_ID = "550e8400-e29b-41d4-a716-446655445003";
const SUFFIX = Date.now().toString(36);

let authorToken = "";
let fanToken = "";
let replierToken = "";

const THREAD_ID = "00000000-0000-0000-0000-910000000001";
const CAT_ID = "00000000-0000-0000-0000-910000000009";

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
    console.warn("[plan009-thread-follow.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  authorToken = await createTestUser(AUTHOR_ID, `tfl_auth_${SUFFIX}`, "USER", generateAccessToken);
  fanToken = await createTestUser(FAN_ID, `tfl_fan_${SUFFIX}`, "USER", generateAccessToken);
  replierToken = await createTestUser(REPLIER_ID, `tfl_rep_${SUFFIX}`, "USER", generateAccessToken);

  await db.orm.public.ForumCategory.create({
    id: CAT_ID, slug: `plan009-general-${SUFFIX}`, name: "Plan009 General", position: 1,
  });
  await db.orm.public.ForumThread.create({
    id: THREAD_ID, categoryId: CAT_ID, authorId: AUTHOR_ID, title: "Тема для подписки",
    replyCount: 0, createdAt: new Date().toISOString(),
  });
  await db.orm.public.ForumPost.create({
    threadId: THREAD_ID, authorId: AUTHOR_ID, content: "Стартовый пост", position: 0,
  });
  await bustCache();
});

afterAll(async () => {
  if (!dbAvailable) return;
  const cats = await db.orm.public.ForumCategory.where({}).all();
  for (const c of cats) {
    if (c.slug.startsWith("plan009-")) {
      await db.orm.public.ForumCategory.where({ id: c.id }).delete().catch(() => undefined);
    }
  }
  await bustCache();
});

describe("PLAN-009 thread follow API (§9)", () => {
  it("requires authentication (§9)", async () => {
    if (!dbAvailable) return;
    await app.post(`/community/forum/thread/${THREAD_ID}/follow`).expect(401);
  });

  it("follow: 201 + aggregate count; dup 409; unknown thread 404 (§9)", async () => {
    if (!dbAvailable) return;
    const followed = (await app
      .post(`/community/forum/thread/${THREAD_ID}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(201)).body;
    expect(followed.following).toBe(true);
    expect(followed.followersCount).toBe(1);
    await app
      .post(`/community/forum/thread/${THREAD_ID}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(409);
    await app
      .post(`/community/forum/thread/00000000-0000-0000-0000-999999999901/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(404);
  });

  it("unfollow: 200 → repeat 404 (§9)", async () => {
    if (!dbAvailable) return;
    const unf = (await app
      .delete(`/community/forum/thread/${THREAD_ID}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(200)).body;
    expect(unf.following).toBe(false);
    expect(unf.followersCount).toBe(0);
    await app
      .delete(`/community/forum/thread/${THREAD_ID}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(404);
    // Follow again for the delivery test.
    await app
      .post(`/community/forum/thread/${THREAD_ID}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(201);
  });

  it("own follow list via /me/follows/threads (§9)", async () => {
    if (!dbAvailable) return;
    const mine = (await app
      .get("/me/follows/threads")
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(200)).body;
    expect(mine.data.some((t: any) => t.id === THREAD_ID)).toBe(true);
    // Other user's list is empty (privacy — own only).
    const other = (await app
      .get("/me/follows/threads")
      .set("Authorization", `Bearer ${replierToken}`)
      .expect(200)).body;
    expect(other.data.some((t: any) => t.id === THREAD_ID)).toBe(false);
  });

  it("thread page exposes the aggregate count, never the list (§11)", async () => {
    if (!dbAvailable) return;
    const page = (await app.get(`/community/threads/${THREAD_ID}`).expect(200)).body;
    expect(page.followersCount).toBe(1);
    const flat = JSON.stringify(page);
    expect(flat).not.toContain("followerIds");
    expect(flat).not.toContain(`tfl_fan_${SUFFIX}`);
  });
});

describe("PLAN-009 delivery (§10)", () => {
  it("reply → follower notified once; actor excluded; author + participant as before", async () => {
    if (!dbAvailable) return;
    // FAN replies first (becomes a participant AND stays a follower).
    await app
      .post(`/community/threads/${THREAD_ID}/posts`)
      .set("Authorization", `Bearer ${fanToken}`)
      .send({ content: "Ответ фаната-подписчика" })
      .expect(201);
    // REPLIER answers — both AUTHOR and FAN must be notified; FAN is both
    // participant and follower → exactly ONE notification (dedup).
    await app
      .post(`/community/threads/${THREAD_ID}/posts`)
      .set("Authorization", `Bearer ${replierToken}`)
      .send({ content: "Ответ реплайера по теме" })
      .expect(201);

    const fanNotifs = await db.orm.public.Notification.where({ recipientId: FAN_ID }).all();
    const fanReplyItems = fanNotifs.filter(
      (n: any) => n.type === "FORUM_REPLY" && n.entityId === THREAD_ID
    );
    expect(fanReplyItems.length).toBe(1); // dedup: participant + follower
    const authorNotifs = await db.orm.public.Notification.where({ recipientId: AUTHOR_ID }).all();
    expect(
      authorNotifs.some(
        (n: any) => n.type === "FORUM_REPLY" && n.entityId === THREAD_ID
      )
    ).toBe(true);
    // Actor (REPLIER) never notified about own reply.
    const replierNotifs = await db.orm.public.Notification.where({ recipientId: REPLIER_ID }).all();
    expect(replierNotifs.some((n: any) => n.entityId === THREAD_ID)).toBe(false);
  });

  it("dashboard now: followedThreadReplies counts since the visit (§12)", async () => {
    if (!dbAvailable) return;
    // FAN visits dashboard (baseline advances), then a reply arrives.
    await app.get("/dashboard/now").set("Authorization", `Bearer ${fanToken}`).expect(200);
    await app
      .post(`/community/threads/${THREAD_ID}/posts`)
      .set("Authorization", `Bearer ${replierToken}`)
      .send({ content: "Свежий ответ после визита" })
      .expect(201);
    const res = (await app
      .get("/dashboard/now")
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(200)).body;
    expect(res.followedThreadReplies.count).toBeGreaterThanOrEqual(1);
    expect(res.followedThreadReplies.items[0].threadTitle).toContain("подписки");
  });
});
