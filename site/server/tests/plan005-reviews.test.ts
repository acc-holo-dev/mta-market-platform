// PLAN-005 Testing §37 + J: REVIEW tokens.
// Server -> generate token (integration) -> claim by player -> review ->
// verified interaction badge. Failure matrix: forged / wrong-server /
// replayed / expired / duplicate. Eligibility is enforced backend-side.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());

const OWNER_ID = "550e8400-e29b-41d4-a716-446655443001";
const PLAYER_A = "550e8400-e29b-41d4-a716-446655443002";
const PLAYER_B = "550e8400-e29b-41d4-a716-446655443003";
const PLAYER_C = "550e8400-e29b-41d4-a716-446655443004";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655443005";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan005-reviews.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let ownerToken = "";
let playerAToken = "";
let playerBToken = "";
let playerCToken = "";
let adminToken = "";
let serverSlug = "";
let otherServerSlug = "";
let integrationToken = "";
let validToken = "";

async function createVerifiedServer(
  name: string,
  bearer: string
): Promise<{ slug: string; token: string }> {
  const created = await app
    .post("/servers")
    .set("Authorization", `Bearer ${bearer}`)
    .send({ name, description: "review token tests" });
  const slug = created.body.slug;
  const token = (
    await app.post(`/servers/${slug}/integration-token`).set("Authorization", `Bearer ${bearer}`)
  ).body.token;
  await app.post("/integration/heartbeat").send({ token, players: 20, maxPlayers: 100 });
  return { slug, token };
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  ownerToken = await createTestUser(OWNER_ID, `rvown_${SUFFIX}`, "USER", generateAccessToken);
  playerAToken = await createTestUser(PLAYER_A, `rvpa_${SUFFIX}`, "USER", generateAccessToken);
  playerBToken = await createTestUser(PLAYER_B, `rpb_${SUFFIX}`, "USER", generateAccessToken);
  playerCToken = await createTestUser(PLAYER_C, `rvpc_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `rvadm_${SUFFIX}`, "ADMIN", generateAccessToken);

  const main = await createVerifiedServer(`Review Server ${SUFFIX}`, ownerToken);
  serverSlug = main.slug;
  integrationToken = main.token;

  const other = await createVerifiedServer(`Other Review Server ${SUFFIX}`, ownerToken);
  otherServerSlug = other.slug;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("PLAN-005: review eligibility (J-001)", () => {
  it("ineligible user cannot review and gets an explanation", async () => {
    const post = await app
      .post(`/servers/${serverSlug}/reviews`)
      .set("Authorization", `Bearer ${playerAToken}`)
      .send({ rating: 5, comment: "отлично" });
    expect(post.status).toBe(403);

    const eligibility = await app
      .get(`/servers/${serverSlug}/reviews/eligibility`)
      .set("Authorization", `Bearer ${playerAToken}`);
    expect(eligibility.status).toBe(200);
    expect(eligibility.body.eligible).toBe(false);
  });

  it("server owner cannot review their own server (self-review prevention)", async () => {
    const post = await app
      .post(`/servers/${serverSlug}/reviews`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ rating: 5, comment: "сам себя хвалю" });
    expect(post.status).toBe(403);
  });

  it("owner cannot claim a review token for their own server", async () => {
    const issue = await app.post("/integration/review-tokens").send({ token: integrationToken });
    const claim = await app
      .post(`/servers/${serverSlug}/review-token/claim`)
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ token: issue.body.reviewToken });
    expect(claim.status).toBe(403);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: review token failure matrix (J-002)", () => {
  it("forged token fails (unknown hash)", async () => {
    const res = await app
      .post(`/servers/${serverSlug}/review-token/claim`)
      .set("Authorization", `Bearer ${playerAToken}`)
      .send({ token: "rtk_" + "f".repeat(48) });
    expect(res.status).toBe(400);
  });

  it("wrong-server token fails and the token stays bound to its server", async () => {
    const issue = await app.post("/integration/review-tokens").send({ token: integrationToken });
    const token = issue.body.reviewToken;

    const wrong = await app
      .post(`/servers/${otherServerSlug}/review-token/claim`)
      .set("Authorization", `Bearer ${playerAToken}`)
      .send({ token });
    expect(wrong.status).toBe(400);

    // Still ACTIVE in the DB (wrong-server attempt must not burn the token).
    const row = await db.orm.public.ServerReviewToken
      .where({ tokenHash: (await import("../src/lib/serverIntegration")).sha256Hex(token) })
      .first();
    expect(row!.status).toBe("ACTIVE");

    // The legitimate claim on the right server succeeds.
    const right = await app
      .post(`/servers/${serverSlug}/review-token/claim`)
      .set("Authorization", `Bearer ${playerAToken}`)
      .send({ token });
    expect(right.status).toBe(201);
  });

  it("replay of a consumed token is rejected (replay protection)", async () => {
    const issue = await app.post("/integration/review-tokens").send({ token: integrationToken });
    const token = issue.body.reviewToken;

    const first = await app
      .post(`/servers/${serverSlug}/review-token/claim`)
      .set("Authorization", `Bearer ${playerBToken}`)
      .send({ token });
    expect(first.status).toBe(201);

    const replay = await app
      .post(`/servers/${serverSlug}/review-token/claim`)
      .set("Authorization", `Bearer ${playerBToken}`)
      .send({ token });
    expect(replay.status).toBe(409);
  });

  it("expired token is rejected (409 replay family)", async () => {
    const issue = await app
      .post("/integration/review-tokens")
      .send({ token: integrationToken, ttlMinutes: 5 });
    const token = issue.body.reviewToken;
    const row = await db.orm.public.ServerReviewToken
      .where({ tokenHash: (await import("../src/lib/serverIntegration")).sha256Hex(token) })
      .first();
    // Backdate expiry beyond the claim-time re-check.
    await db.orm.public.ServerReviewToken.where({ id: row!.id }).update({
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      status: "EXPIRED",
    });
    const claim = await app
      .post(`/servers/${serverSlug}/review-token/claim`)
      .set("Authorization", `Bearer ${playerCToken}`)
      .send({ token });
    expect(claim.status).toBe(409);
  });

  it("claim grants verified-review eligibility", async () => {
    const eligibility = await app
      .get(`/servers/${serverSlug}/reviews/eligibility`)
      .set("Authorization", `Bearer ${playerAToken}`);
    expect(eligibility.body.eligible).toBe(true);
    expect(eligibility.body.verifiedInteraction).toBe(true);
  });
});

describe.skipIf(!dbAvailable)("PLAN-005: review creation & moderation (J-003..J-005)", () => {
  it("eligible player creates a review with Verified Interaction", async () => {
    const res = await app
      .post(`/servers/${serverSlug}/reviews`)
      .set("Authorization", `Bearer ${playerAToken}`)
      .send({ rating: 5, comment: "Проверенный отзыв через токен." });
    expect(res.status).toBe(201);
    expect(res.body.verifiedInteraction).toBe(true);
  });

  it("duplicate review per user is rejected (one voice per server)", async () => {
    const res = await app
      .post(`/servers/${serverSlug}/reviews`)
      .set("Authorization", `Bearer ${playerAToken}`)
      .send({ rating: 1, comment: "второй отзыв" });
    expect(res.status).toBe(409);
  });

  it("owner receives a REVIEW_EVENT notification", async () => {
    const notifs = await db.orm.public.Notification.where({ recipientId: OWNER_ID }).all();
    expect(notifs.some((n: any) => n.type === "REVIEW_EVENT")).toBe(true);
  });

  it("public reviews list shows VISIBLE ones with stats and author", async () => {
    const res = await app.get(`/servers/${serverSlug}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.stats.total).toBe(1);
    expect(res.body.data[0].author.username).toBeTruthy();
    expect(res.body.data[0].verifiedInteraction).toBe(true);
  });

  it("review without eligibility is impossible even with a valid-format token", async () => {
    const post = await app
      .post(`/servers/${serverSlug}/reviews`)
      .set("Authorization", `Bearer ${playerCToken}`)
      .send({ rating: 3, comment: "без токена" });
    expect(post.status).toBe(403);
  });

  it("author can withdraw own review", async () => {
    const res = await app
      .delete(`/servers/${serverSlug}/reviews`)
      .set("Authorization", `Bearer ${playerAToken}`);
    expect(res.status).toBe(200);
    const after = await app.get(`/servers/${serverSlug}/reviews`);
    expect(after.body.stats.total).toBe(0);
  });

  it("moderation hides a review with audit + notification", async () => {
    // player B claims a token and reviews
    const issue = await app.post("/integration/review-tokens").send({ token: integrationToken });
    await app
      .post(`/servers/${serverSlug}/review-token/claim`)
      .set("Authorization", `Bearer ${playerBToken}`)
      .send({ token: issue.body.reviewToken });
    await app
      .post(`/servers/${serverSlug}/reviews`)
      .set("Authorization", `Bearer ${playerBToken}`)
      .send({ rating: 2, comment: "скрытый отзыв" });

    const serverId = (await db.orm.public.Server.where({ slug: serverSlug }).first())!.id;
    const review = (await db.orm.public.ServerReview.where({ serverId }).all()).find(
      (r: any) => r.userId === PLAYER_B
    );
    const res = await app
      .patch(`/admin/server-reviews/${review!.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "HIDDEN", reason: "тест модерации" });
    expect(res.status).toBe(200);
    const after = await app.get(`/servers/${serverSlug}/reviews`);
    expect(after.body.stats.total).toBe(0);
    const notifs = await db.orm.public.Notification.where({ recipientId: PLAYER_B }).all();
    expect(notifs.some((n: any) => n.type === "MODERATION")).toBe(true);
  });
});