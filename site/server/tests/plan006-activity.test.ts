// PLAN-006 Testing §17–§18: activity read-layer at the HTTP layer.
// Sources → items, window, dedup, deterministic ranking, publicity rules
// (E-001..E-006) and the dashboard "Сейчас / За ночь" summary (§20, I-001..).
// Fixtures are created directly through the contract ORM so the READ layer
// (the thing under test) is exercised against realistic rows.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";
import { redis } from "../src/lib/redis";

const app = request(createApp());

const OWNER_ID = "550e8400-e29b-41d4-a716-446655442001";
const PLAYER_ID = "550e8400-e29b-41d4-a716-446655442002";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655442003";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655442004";
const REVIEWER_ID = "550e8400-e29b-41d4-a716-446655442006";
const SUFFIX = Date.now().toString(36);

const H = 3600_000;
const D = 24 * H;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const TIE = iso(2 * H); // deterministic tie between types (D-004)

// Redis-cached read layer: bust between mutations or assertions lie.
async function bustCache(): Promise<void> {
  const keys = ["plan006:activity:live:v1"];
  for (const limit of [5, 20, 50]) keys.push(`plan006:activity:snapshot:v1:${limit}`);
  try {
    await redis.del(...keys);
  } catch {
    // fail-open: tests still exercise the compute path
  }
}

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan006-activity.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let ownerToken = "";
let playerToken = "";

const A = "00000000-0000-0000-0000-100000000001"; // activity-night (public)
const B = "00000000-0000-0000-0000-100000000002"; // showStats=false
const C = "00000000-0000-0000-0000-100000000003"; // suspended
const E = "00000000-0000-0000-0000-100000000005"; // new server
const F = "00000000-0000-0000-0000-100000000006"; // showCommunity=false
const NEWS_ID = "00000000-0000-0000-0000-200000000001";
const DRAFT_NEWS_ID = "00000000-0000-0000-0000-200000000002";
const UPDATE_ID = "00000000-0000-0000-0000-300000000001";
const OLD_UPDATE_ID = "00000000-0000-0000-0000-300000000002";
const TIE_UPDATE_ID = "00000000-0000-0000-0000-300000000003";
const T1 = "00000000-0000-0000-0000-400000000001"; // old thread, 3 replies
const T2 = "00000000-0000-0000-0000-400000000002"; // new thread
const T3 = "00000000-0000-0000-0000-400000000003"; // showCommunity=false
const T4 = "00000000-0000-0000-0000-400000000004"; // news-linked
const CAT_GENERAL = "00000000-0000-0000-0000-500000000001";
const CAT_HELP = "00000000-0000-0000-0000-500000000002";
const R1 = "00000000-0000-0000-0000-600000000001"; // published resource
const R2 = "00000000-0000-0000-0000-600000000002"; // suspended resource
const V1 = "00000000-0000-0000-0000-700000000001";
const V_OLD = "00000000-0000-0000-0000-700000000002";
const V_CAND = "00000000-0000-0000-0000-700000000003";
const SR_VISIBLE = "00000000-0000-0000-0000-800000000001";
const SR_HIDDEN = "00000000-0000-0000-0000-800000000002";
const RR1 = "00000000-0000-0000-0000-800000000003"; // resource review

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  // Test-DB hygiene: PLAN-001 e2e leftovers (sellers outside the fixed test
  // range) accumulate freshly published resources on every full-suite run
  // and legitimately occupy the freshest activity pages, which would make
  // the fixture assertions below flaky. The artifacts are reproducible test
  // junk — removing them (FK-safe, deepest children first) keeps the window
  // queries deterministic.
  const junk = (await db.orm.public.Resource.where({}).all()).filter((r: any) =>
    /^(e2e-|p1-)/.test(r.slug)
  );
  for (const r of junk) {
    const versions = await db.orm.public.ResourceVersion.where({ resourceId: r.id }).all();
    const versionIds = versions.map((v: any) => v.id as string);
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
    for (const vid of versionIds) {
      await db.orm.public.ArtifactSignature.where({ versionId: vid }).delete().catch(() => undefined);
      await db.orm.public.ArtifactEncryption.where({ versionId: vid }).delete().catch(() => undefined);
      await db.orm.public.CompatibilityReport.where({ versionId: vid }).delete().catch(() => undefined);
      await db.orm.public.SandboxRun.where({ versionId: vid }).delete().catch(() => undefined);
    }
    await db.orm.public.Resource.where({ id: r.id }).delete().catch(() => undefined);
  }
  ownerToken = await createTestUser(OWNER_ID, `actown_${SUFFIX}`, "USER", generateAccessToken);
  playerToken = await createTestUser(PLAYER_ID, `actply_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(OTHER_ID, `actoth_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(SELLER_ID, `actsel_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(REVIEWER_ID, `actrev_${SUFFIX}`, "USER", generateAccessToken);

  await db.orm.public.ForumCategory.create({
    id: CAT_GENERAL, slug: `plan006-general-${SUFFIX}`, name: "Plan006 General", position: 1,
  });
  await db.orm.public.ForumCategory.create({
    id: CAT_HELP, slug: `plan006-help-${SUFFIX}`, name: "Plan006 Help", position: 2,
  });

  const serverBase = (id: string, slug: string, name: string, extra: Record<string, unknown>) => ({
    id, ownerId: OWNER_ID, slug, name, description: `${name} — activity fixture`, ...extra,
  });
  await db.orm.public.Server.create(serverBase(A, `activity-night-${SUFFIX}`, "Activity Night", {
    lifecycle: "ACTIVE", verification: "VERIFIED", monitoring: "ONLINE",
    showStats: true, showCommunity: true, playerCount: 42, maxPlayers: 100,
    verifiedAt: iso(30 * D), createdAt: iso(30 * D), lastSeenAt: iso(0),
  }));
  await db.orm.public.Server.create(serverBase(B, `activity-priv-${SUFFIX}`, "Private Stats", {
    lifecycle: "ACTIVE", verification: "VERIFIED", monitoring: "ONLINE",
    showStats: false, playerCount: 77, maxPlayers: 200,
    verifiedAt: iso(20 * D), createdAt: iso(30 * D), lastSeenAt: iso(0),
  }));
  await db.orm.public.Server.create(serverBase(C, `activity-susp-${SUFFIX}`, "Suspended One", {
    lifecycle: "SUSPENDED", verification: "VERIFIED", monitoring: "ONLINE", playerCount: 55,
  }));
  await db.orm.public.Server.create(serverBase(E, `activity-fresh-${SUFFIX}`, "Fresh Server", {
    lifecycle: "VERIFIED", verification: "VERIFIED", monitoring: "ONLINE",
    playerCount: 5, maxPlayers: 50, verifiedAt: iso(1 * H), createdAt: iso(2 * H), lastSeenAt: iso(0),
  }));
  await db.orm.public.Server.create(serverBase(F, `activity-closed-${SUFFIX}`, "Closed Community", {
    lifecycle: "ACTIVE", verification: "VERIFIED", monitoring: "ONLINE",
    showCommunity: false, playerCount: 10, maxPlayers: 60,
    verifiedAt: iso(15 * D), createdAt: iso(30 * D), lastSeenAt: iso(0),
  }));

  // SERVER_ONLINE transition: OFFLINE before the window, ONLINE inside it.
  await db.orm.public.ServerStatusSample.create({
    serverId: A, state: "OFFLINE", players: 0, sampledAt: iso(8 * D),
  });
  await db.orm.public.ServerStatusSample.create({
    serverId: A, state: "ONLINE", players: 42, maxPlayers: 100, sampledAt: iso(0.5 * H),
  });

  await db.orm.public.ServerNews.create({
    id: NEWS_ID, serverId: A, authorId: OWNER_ID, title: "Ночной ивент",
    content: "Анонс ивента выходного дня.", status: "PUBLISHED", publishedAt: iso(3 * H),
  });
  await db.orm.public.ServerNews.create({
    id: DRAFT_NEWS_ID, serverId: A, authorId: OWNER_ID,
    title: "Секретный черновик", content: "Никто не должен это видеть.",
  });
  await db.orm.public.ServerUpdate.create({
    id: UPDATE_ID, serverId: A, authorId: OWNER_ID, version: "2.5.0",
    title: "Весенний патч", changelog: "Банды и территории.", publishedAt: iso(1 * H),
  });
  await db.orm.public.ServerUpdate.create({
    id: OLD_UPDATE_ID, serverId: A, authorId: OWNER_ID, version: "1.0.0",
    title: "Древний релиз", changelog: "Давно.", publishedAt: iso(10 * D),
  });
  await db.orm.public.ServerUpdate.create({
    id: TIE_UPDATE_ID, serverId: A, authorId: OWNER_ID, version: "2.6.0",
    title: "Одновременный релиз", changelog: "Тест приоритета.", publishedAt: TIE,
  });

  await db.orm.public.ForumThread.create({
    id: T1, categoryId: CAT_GENERAL, authorId: PLAYER_ID, title: "Какой framework выбрать?",
    replyCount: 3, views: 40, lastPostAt: iso(1 * H), createdAt: iso(10 * D),
  });
  await db.orm.public.ForumPost.create({
    threadId: T1, authorId: PLAYER_ID, content: "Стартовый пост", position: 0, createdAt: iso(10 * D),
  });
  for (const [i, author] of [[1, OTHER_ID], [2, PLAYER_ID], [3, OTHER_ID]] as const) {
    await db.orm.public.ForumPost.create({
      threadId: T1, authorId: author, content: `Ответ ${i}`, position: i,
      createdAt: iso((3 - i + 1) * H), // 3H / 2H / 1H
    });
  }
  await db.orm.public.ForumThread.create({
    id: T2, categoryId: CAT_HELP, authorId: PLAYER_ID, title: "Новая тема про Lua",
    replyCount: 1, views: 2, lastPostAt: iso(0.4 * H), createdAt: iso(0.5 * H),
  });
  await db.orm.public.ForumPost.create({
    threadId: T2, authorId: OTHER_ID, content: "Первый ответ", position: 1, createdAt: iso(0.4 * H),
  });
  await db.orm.public.ForumThread.create({
    id: T3, categoryId: CAT_GENERAL, authorId: PLAYER_ID, serverId: F,
    title: "Внутренняя тема закрытого сообщества", createdAt: iso(6 * D), lastPostAt: iso(0.3 * H),
  });
  await db.orm.public.ForumPost.create({
    threadId: T3, authorId: OTHER_ID, content: "Скрытый ответ", position: 1, createdAt: iso(0.3 * H),
  });
  await db.orm.public.ForumThread.create({
    id: T4, categoryId: CAT_GENERAL, authorId: PLAYER_ID, newsId: NEWS_ID,
    title: "Обсуждение новости", createdAt: iso(2 * H),
  });

  await db.orm.public.Resource.create({
    id: R1, sellerId: SELLER_ID, slug: `activity-mod-${SUFFIX}`, title: "Advanced Activity Mod",
    description: "Тестовый ресурс.", type: "SCRIPT", status: "PUBLISHED", price: 0,
    createdAt: iso(30 * D),
  });
  await db.orm.public.Resource.create({
    id: R2, sellerId: SELLER_ID, slug: `activity-susp-mod-${SUFFIX}`, title: "Suspended Mod",
    description: "Снят с публикации.", type: "SCRIPT", status: "SUSPENDED", price: 0,
    createdAt: iso(30 * D),
  });
  await db.orm.public.ModerationEvent.create({
    resourceId: R1, actorId: OWNER_ID, fromStatus: "PENDING_REVIEW", toStatus: "PUBLISHED",
    createdAt: iso(4 * H),
  });
  await db.orm.public.ModerationEvent.create({
    resourceId: R2, actorId: OWNER_ID, fromStatus: "PENDING_REVIEW", toStatus: "PUBLISHED",
    createdAt: iso(3 * H),
  });
  await db.orm.public.ResourceVersion.create({
    id: V1, resourceId: R1, version: "1.4.0", fileUrl: "artifact.zip", fileSize: 1,
    fileChecksum: "chk", releaseStatus: "PUBLISHED", publishedAt: TIE,
  });
  await db.orm.public.ResourceVersion.create({
    id: V_OLD, resourceId: R1, version: "0.9.0", fileUrl: "artifact.zip", fileSize: 1,
    fileChecksum: "chk", releaseStatus: "PUBLISHED", publishedAt: iso(10 * D),
  });
  await db.orm.public.ResourceVersion.create({
    id: V_CAND, resourceId: R1, version: "1.5.0-rc", fileUrl: "artifact.zip", fileSize: 1,
    fileChecksum: "chk", releaseStatus: "CANDIDATE", publishedAt: iso(1 * H),
  });

  await db.orm.public.ServerReview.create({
    id: SR_VISIBLE, serverId: A, userId: REVIEWER_ID, rating: 5,
    comment: "Отличный сервер", verifiedInteraction: true, status: "VISIBLE", createdAt: TIE,
  });
  await db.orm.public.ServerReview.create({
    id: SR_HIDDEN, serverId: A, userId: OTHER_ID, rating: 1,
    comment: "Скрытый отзыв", status: "HIDDEN", createdAt: iso(0.2 * H),
  });
  await db.orm.public.Review.create({
    id: RR1, resourceId: R1, buyerId: PLAYER_ID, rating: 4,
    comment: "Хороший мод", createdAt: iso(80 * 60_000),
  });

  // Private purchase (§41): must never leak into activity.
  await db.orm.public.Purchase.create({
    buyerId: PLAYER_ID, resourceId: R1, versionId: V1, status: "COMPLETED",
    priceSnapshot: 0, finalPrice: 0, platformFee: 0, sellerRevenue: 0, completedAt: iso(0.5 * H),
  });
  await db.orm.public.ServerFollow.create({ serverId: A, userId: PLAYER_ID });
  await db.orm.public.Notification.create({
    recipientId: PLAYER_ID, type: "SERVER_UPDATE",
    title: "Activity Night выпустил обновление 2.5.0",
  });
  await bustCache();
});

afterAll(async () => {
  if (!dbAvailable) return;
  const cats = await db.orm.public.ForumCategory.where({}).all();
  for (const c of cats) {
    if (c.slug.startsWith("plan006-")) {
      await db.orm.public.ForumCategory.where({ id: c.id }).delete().catch(() => undefined);
    }
  }
  await bustCache();
});

async function getSnapshot(limit = 50) {
  const res = await app.get(`/activity?limit=${limit}`).expect(200);
  return res.body;
}

describe("PLAN-006 activity read-layer", () => {
  it("public snapshot works without authentication (§29)", async () => {
    if (!dbAvailable) return;
    await bustCache();
    const res = await app.get("/activity?limit=20").expect(200);
    expect(res.body.items).toBeInstanceOf(Array);
    expect(res.body.live).toHaveProperty("playersOnline");
    expect(res.body.generatedAt).toBeTruthy();
  });

  it("live aggregates count only public, online, stats-visible servers (B-002/E-004)", async () => {
    if (!dbAvailable) return;
    await bustCache();
    const res = await app.get("/activity/live").expect(200);
    // A(42) + E(5) + F(10); B(77, showStats=false), C(suspended), D(unknown) excluded.
    expect(res.body.serversOnline).toBe(3);
    expect(res.body.playersOnline).toBe(57);
  });

  it("snapshot contains all expected high-value items with deep links (D-001)", async () => {
    if (!dbAvailable) return;
    const body = await getSnapshot();
    const types = new Set(body.items.map((i: any) => i.type));
    for (const expected of [
      "SERVER_UPDATE", "SERVER_NEWS", "NEW_SERVER", "SERVER_ONLINE",
      "RESOURCE_RELEASE", "RESOURCE_UPDATE", "NEW_DISCUSSION", "DISCUSSION_REPLY", "NEW_REVIEW",
    ]) {
      expect(types.has(expected), `missing ${expected}`).toBe(true);
    }
    const byType = (t: string) => body.items.filter((i: any) => i.type === t);
    expect(byType("SERVER_UPDATE").some((i: any) => i.version === "2.5.0")).toBe(true);
    expect(byType("SERVER_NEWS")[0].href).toContain("/news/");
    expect(byType("NEW_SERVER")[0].href).toContain("activity-fresh");
    expect(byType("SERVER_ONLINE")[0].server.slug).toContain("activity-night");
    expect(byType("RESOURCE_RELEASE")[0].href).toContain("/resources/");
    expect(byType("RESOURCE_UPDATE").some((i: any) => i.version === "1.4.0")).toBe(true);
    // Leftovers from other suites (non-test-range owners) may add reviews;
    // assert MY visible reviews only — the hidden one must stay out.
    const nightReviews = byType("NEW_REVIEW").filter((i: any) => i.href.includes("activity-night"));
    const modReviews = byType("NEW_REVIEW").filter((i: any) => i.href.includes("activity-mod"));
    expect(nightReviews).toHaveLength(1);
    expect(nightReviews[0].review.verified).toBe(true);
    expect(modReviews).toHaveLength(1);
  });

  it("excludes drafts, hidden content, suspended entities and private-community threads (E-001..E-004)", async () => {
    if (!dbAvailable) return;
    const body = await getSnapshot();
    const flat = JSON.stringify(body.items);
    expect(flat).not.toContain("Секретный черновик");
    expect(flat).not.toContain("Скрытый отзыв");
    expect(flat).not.toContain("Suspended Mod");
    expect(flat).not.toContain("1.5.0-rc");
    expect(flat).not.toContain("Внутренняя тема закрытого сообщества");
    expect(flat).not.toContain("Обсуждение новости"); // news-linked thread folded into the news item
    expect(body.items.some((i: any) => i.href?.includes("activity-susp"))).toBe(false);
  });

  it("dedups one discussion item per thread with reply counts (D-005)", async () => {
    if (!dbAvailable) return;
    const body = await getSnapshot();
    const disc = body.items.filter(
      (i: any) => i.type === "NEW_DISCUSSION" || i.type === "DISCUSSION_REPLY"
    );
    const ids = disc.map((i: any) => i.thread.id);
    expect(new Set(ids).size).toBe(ids.length);
    const t1 = disc.find((i: any) => i.thread.title.includes("framework"));
    expect(t1.type).toBe("DISCUSSION_REPLY");
    expect(t1.count).toBe(3);
    const t2 = disc.find((i: any) => i.thread.title.includes("Lua"));
    expect(t2.type).toBe("NEW_DISCUSSION");
  });

  it("ranks chronologically and breaks ties by type priority (D-004)", async () => {
    if (!dbAvailable) return;
    const body = await getSnapshot();
    const ats = body.items.map((i: any) => Date.parse(i.at));
    for (let i = 1; i < ats.length; i++) {
      expect(ats[i - 1]).toBeGreaterThanOrEqual(ats[i]);
    }
    // Tie at TIE (compared as instants — the ORM returns "YYYY-MM-DD HH:MM:SS.ms+00"
    // strings, not ISO): SERVER_UPDATE (6) above RESOURCE_UPDATE (4) above NEW_REVIEW (2).
    const atTie = body.items.filter(
      (i: any) => Math.abs(Date.parse(i.at) - Date.parse(TIE)) < 1000
    );
    expect(atTie.length).toBeGreaterThanOrEqual(3);
    const tieTypes = atTie.map((i: any) => i.type);
    expect(tieTypes[0]).toBe("SERVER_UPDATE");
    expect(tieTypes.indexOf("NEW_REVIEW")).toBeGreaterThan(tieTypes.indexOf("RESOURCE_UPDATE"));
  });

  it("keeps the fixed activity window (§ C-002)", async () => {
    if (!dbAvailable) return;
    const body = await getSnapshot();
    const flat = JSON.stringify(body.items);
    expect(flat).not.toContain("Древний релиз");
    expect(flat).not.toContain("0.9.0");
  });

  it("never turns private purchases into activity items (§41/E-005)", async () => {
    if (!dbAvailable) return;
    const body = await getSnapshot();
    expect(body.items.some((i: any) => i.href?.includes("/purchases"))).toBe(false);
    expect(body.items.every((i: any) => i.type !== "PURCHASE")).toBe(true);
    // The buyer authored a public review (public act) — but no item exposes
    // purchase state: no item carries a purchase/version-license payload.
    expect(JSON.stringify(body.items)).not.toContain("priceSnapshot");
  });

  it("honors the requested limit", async () => {
    if (!dbAvailable) return;
    const body = await getSnapshot(5);
    expect(body.items.length).toBe(5);
  });

  it("popular blocks use real metrics only (H-001..H-004)", async () => {
    if (!dbAvailable) return;
    const body = await getSnapshot();
    const slugs = body.popular.servers.map((s: any) => s.slug);
    expect(slugs).toContain(`activity-night-${SUFFIX}`);
    expect(slugs).not.toContain(`activity-priv-${SUFFIX}`);
    expect(body.popular.servers[0].playerCount).toBeGreaterThanOrEqual(
      body.popular.servers[body.popular.servers.length - 1].playerCount
    );
    expect(body.popular.discussions.some((d: any) => d.title.includes("framework"))).toBe(true);
    expect(body.popular.discussions.some((d: any) => d.title.includes("закрытого сообщества"))).toBe(false);
  });
});

describe("PLAN-006 dashboard «Сейчас / За ночь» (§20)", () => {
  it("first visit uses a 24h baseline and later visits measure from it (I-001/I-002)", async () => {
    if (!dbAvailable) return;
    const first = await app.get("/dashboard/now").set("Authorization", `Bearer ${playerToken}`).expect(200);
    expect(first.body.firstVisit).toBe(true);
    expect(first.body.unreadNotifications).toBeGreaterThanOrEqual(1);
    // Fixture updates 2.5.0 (1h) and 2.6.0 (2h) are both within the first-visit window.
    expect(first.body.serverUpdates.count).toBe(2);
    expect(first.body.serverUpdates.items[0].version).toBe("2.5.0");

    // Everything below happens AFTER the visit — only these may appear next.
    await db.orm.public.ServerUpdate.create({
      serverId: A, authorId: OWNER_ID, version: "2.6.0", title: "Ночной патч",
      changelog: "После визита.", publishedAt: new Date().toISOString(),
    });
    await db.orm.public.ForumPost.create({
      threadId: T1, authorId: OTHER_ID, content: "Свежий ответ после визита",
      position: 4, createdAt: new Date().toISOString(),
    });
    await db.orm.public.ResourceVersion.create({
      resourceId: R1, version: "1.5.0", fileUrl: "artifact.zip", fileSize: 1,
      fileChecksum: "chk", releaseStatus: "PUBLISHED", publishedAt: new Date().toISOString(),
    });
    await db.orm.public.Notification.create({
      recipientId: PLAYER_ID, type: "SERVER_NEWS", title: "Новость после визита",
    });

    const second = await app.get("/dashboard/now").set("Authorization", `Bearer ${playerToken}`).expect(200);
    expect(second.body.firstVisit).toBe(false);
    expect(second.body.serverUpdates.count).toBe(1);
    expect(second.body.serverUpdates.items[0].version).toBe("2.6.0");
    expect(second.body.discussionReplies.count).toBe(1);
    expect(second.body.discussionReplies.items[0].threadTitle).toContain("framework");
    expect(second.body.purchasedUpdates.count).toBe(1);
    expect(second.body.purchasedUpdates.items[0].version).toBe("1.5.0");
    expect(second.body.unreadNotifications).toBe(2);
  });

  it("requires authentication", async () => {
    if (!dbAvailable) return;
    await app.get("/dashboard/now").expect(401);
  });
});
