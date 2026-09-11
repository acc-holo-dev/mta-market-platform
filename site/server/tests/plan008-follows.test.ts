// PLAN-008 Testing §11–§13: Follow Expansion at the HTTP layer.
// Follow API (creator/resource), delivery (release/version/article) with
// recipient dedup, buyer notification (§26), privacy (§42: no lists).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";
import { redis } from "../src/lib/redis";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655444001";
const FAN_ID = "550e8400-e29b-41d4-a716-446655444002";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655444003";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655444004";
const NONCREATOR_ID = "550e8400-e29b-41d4-a716-446655444005";
const SUFFIX = Date.now().toString(36);
const H = 3600_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

let sellerToken = "";
let fanToken = "";
let gateKey = "";
let buyerToken = "";
let adminToken = "";
let noncreatorToken = "";

const R1 = "00000000-0000-0000-0000-710000000001"; // published (release 1)
const R2 = "00000000-0000-0000-0000-710000000002"; // pending → published later
const V1_R1 = "00000000-0000-0000-0000-720000000001";
const V2_R1 = "00000000-0000-0000-0000-720000000002";

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
    console.warn("[plan008-follows.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  // PLAN-006 hygiene: PLAN-001 e2e leftovers (same as plan006/007 tests).
  const junk = (await db.orm.public.Resource.where({}).all()).filter((r: any) =>
    /^(e2e-|p1-)/.test(r.slug)
  );
  for (const r of junk) {
    const versions = await db.orm.public.ResourceVersion.where({ resourceId: r.id }).all();
    for (const v of versions) {
      await db.orm.public.ArtifactSignature.where({ versionId: v.id }).delete().catch(() => undefined);
      await db.orm.public.ArtifactEncryption.where({ versionId: v.id }).delete().catch(() => undefined);
      await db.orm.public.CompatibilityReport.where({ versionId: v.id }).delete().catch(() => undefined);
      await db.orm.public.SandboxRun.where({ versionId: v.id }).delete().catch(() => undefined);
    }
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
    await db.orm.public.Resource.where({ id: r.id }).delete().catch(() => undefined);
  }

  sellerToken = await createTestUser(SELLER_ID, `fl_seller_${SUFFIX}`, "USER", generateAccessToken);
  fanToken = await createTestUser(FAN_ID, `fl_fan_${SUFFIX}`, "USER", generateAccessToken);
  buyerToken = await createTestUser(BUYER_ID, `fl_buyer_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `fl_admin_${SUFFIX}`, "ADMIN", generateAccessToken);
  noncreatorToken = await createTestUser(NONCREATOR_ID, `fl_nonc_${SUFFIX}`, "USER", generateAccessToken);

  // Seller with APPROVED SellerProfile → followable creator.
  await db.orm.public.SellerProfile.create({
    userId: SELLER_ID, status: "APPROVED", displayName: "Fixture Creator",
  });

  // R1: already published with a released version (V1).
  await db.orm.public.Resource.create({
    id: R1, sellerId: SELLER_ID, slug: `fl-res1-${SUFFIX}`, title: "Follow Res One",
    description: "fixture", type: "SCRIPT", status: "PUBLISHED", price: 0, createdAt: iso(5 * H),
  });
  await db.orm.public.ModerationEvent.create({
    resourceId: R1, actorId: ADMIN_ID, fromStatus: "PENDING_REVIEW", toStatus: "PUBLISHED",
    createdAt: iso(4 * H),
  });
  await db.orm.public.ResourceVersion.create({
    id: V1_R1, resourceId: R1, version: "1.0.0", fileUrl: "a.zip", fileSize: 1,
    fileChecksum: "c", releaseStatus: "PUBLISHED", publishedAt: iso(4 * H),
  });
  // Publication gate: every version must be signed with an ACTIVE key.
  gateKey = await db.orm.public.PublisherKey.create({
    sellerId: SELLER_ID, keyType: "ED25519", publicKey: "dGVzdC1wdWJsaWMta2V5",
    algorithm: "EdDSA", status: "ACTIVE",
  });
  await db.orm.public.ArtifactSignature.create({
    versionId: V1_R1, keyId: gateKey.id, signature: "c2lnbmF0dXJl",
    algorithm: "EdDSA", manifestHash: "a".repeat(64), artifactHash: "c".repeat(64),
    manifest: { formatVersion: 1, files: [] },
  });
  // R2: draft → will be published later (tests CREATOR_RESOURCE).
  await db.orm.public.Resource.create({
    id: R2, sellerId: SELLER_ID, slug: `fl-res2-${SUFFIX}`, title: "Follow Res Two",
    description: "fixture", type: "SCRIPT", status: "PENDING_REVIEW", price: 0, createdAt: iso(1 * H),
  });
  await bustCache();
});

afterAll(async () => {
  if (!dbAvailable) return;
  await bustCache();
});

describe("PLAN-008 follow API (§11)", () => {
  it("creator follow: auth, target validation, dup 409, counts, unfollow", async () => {
    if (!dbAvailable) return;
    await app.post(`/creators/fl_seller_${SUFFIX}/follow`).expect(401);
    // Non-creator target.
    await app
      .post(`/creators/fl_nonc_${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(404);
    // Self-follow.
    await app
      .post(`/creators/fl_seller_${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(400);
    // Follow.
    const followed = (await app
      .post(`/creators/fl_seller_${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(201)).body;
    expect(followed.following).toBe(true);
    expect(followed.creatorFollowers).toBe(1);
    // Duplicate.
    await app
      .post(`/creators/fl_seller_${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(409);
    // Own follow list.
    const mine = (await app
      .get("/me/follows/creators")
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(200)).body;
    expect(mine.data.some((c: any) => c.username === `fl_seller_${SUFFIX}`)).toBe(true);
    // Unfollow; then 404 on repeat.
    const unf = (await app
      .delete(`/creators/fl_seller_${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(200)).body;
    expect(unf.following).toBe(false);
    await app
      .delete(`/creators/fl_seller_${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(404);
    // Follow again for the delivery tests.
    await app
      .post(`/creators/fl_seller_${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(201);
  });

  it("resource follow: only PUBLISHED, no self-follow, dup 409", async () => {
    if (!dbAvailable) return;
    // Seller cannot follow own resource.
    await app
      .post(`/resources/fl-res1-${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(400);
    // Fan follows the published resource.
    const followed = (await app
      .post(`/resources/fl-res1-${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(201)).body;
    expect(followed.resourceFollowers).toBe(1);
    await app
      .post(`/resources/fl-res1-${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(409);
    // PENDING resource is not followable.
    await app
      .post(`/resources/fl-res2-${SUFFIX}/follow`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .expect(404);
    // Resource page exposes the aggregate count.
    const page = (await app.get(`/resources/fl-res1-${SUFFIX}`).expect(200)).body;
    expect(page.resourceFollowers).toBe(1);
    expect(page.followerList).toBeUndefined();
  });

  it("privacy: storefront exposes the count, never the list (§13/§42)", async () => {
    if (!dbAvailable) return;
    const store = (await app.get(`/sellers/fl_seller_${SUFFIX}`).expect(200)).body;
    expect(typeof store.seller.creatorFollowers).toBe("number");
    expect(JSON.stringify(store)).not.toContain("followerId");
    expect(JSON.stringify(store)).not.toContain("followerIds");
  });
});

describe("PLAN-008 delivery (§12)", () => {
  it("resource release → CREATOR_RESOURCE to creator followers (D-001)", async () => {
    if (!dbAvailable) return;
    await bustCache();
    const approved = (await app
      .patch(`/admin/resources/${R2}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PUBLISHED" })
      .expect(200));
    void approved;
    const notifs = await db.orm.public.Notification.where({ recipientId: FAN_ID }).all();
    const item = notifs.find(
      (n: any) => n.type === "CREATOR_RESOURCE" && n.title.includes("Follow Res Two")
    );
    expect(item).toBeTruthy();
  });

  it("version release → buyer + resource follower + creator follower with dedup (D-002)", async () => {
    if (!dbAvailable) return;
    // BUYER purchases R1 (buyer relationship without follow, §26).
    await db.orm.public.Purchase.create({
      buyerId: BUYER_ID, resourceId: R1, versionId: V1_R1, status: "COMPLETED",
      priceSnapshot: 0, finalPrice: 0, platformFee: 0, sellerRevenue: 0,
      completedAt: iso(1 * H),
    });
    // New version on R1; the fan is BOTH resource follower and creator
    // follower → must receive exactly one notification.
    await db.orm.public.ResourceVersion.create({
      id: V2_R1, resourceId: R1, version: "1.1.0", changelog: "Правка дрифта",
      fileUrl: "a.zip", fileSize: 1, fileChecksum: "c", releaseStatus: "CANDIDATE",
      publishedAt: iso(0.2 * H),
    });
    // Publication gate (B-001): the new version must also be signed.
    await db.orm.public.ArtifactSignature.create({
      versionId: V2_R1, keyId: gateKey.id, signature: "c2lnbmF0dXJl",
      algorithm: "EdDSA", manifestHash: "b".repeat(64), artifactHash: "c".repeat(64),
      manifest: { formatVersion: 1, files: [] },
    });
    // Update release path: re-moderation of the published resource
    // (PENDING_REVIEW → PUBLISHED releases the new version).
    await db.orm.public.Resource.where({ id: R1 }).update({ status: "PENDING_REVIEW" });
    await bustCache();
    await app
      .patch(`/admin/resources/${R1}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PUBLISHED" })
      .expect(200);

    const fanNotifs = await db.orm.public.Notification.where({ recipientId: FAN_ID }).all();
    const updateItems = fanNotifs.filter(
      (n: any) => n.title.includes("Follow Res One — новая версия 1.1.0")
    );
    expect(updateItems.length).toBe(1); // dedup: one, not two
    const buyerNotifs = await db.orm.public.Notification.where({ recipientId: BUYER_ID }).all();
    expect(
      buyerNotifs.some(
        (n: any) => n.type === "RESOURCE_UPDATE" && n.title.includes("1.1.0")
      )
    ).toBe(true);
  });

  it("article by a creator → CREATOR_ARTICLE; by a non-creator → none (D-003)", async () => {
    if (!dbAvailable) return;
    const created = await app
      .post("/content")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        title: `Гайд создателя ${SUFFIX}`,
        content:
          "Разбор, который подписчики создателя должны получить уведомлением.\n\nВторой абзац для полноты контента статьи.",
        category: "GUIDES",
      })
      .expect(201);
    await app
      .post(`/content/${created.body.id}/submit`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .expect(200);
    await app
      .post(`/admin/content/${created.body.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const fanNotifs = await db.orm.public.Notification.where({ recipientId: FAN_ID }).all();
    expect(fanNotifs.some((n: any) => n.type === "CREATOR_ARTICLE")).toBe(true);

    // Non-creator author: no delivery to seller's followers.
    const before = (await db.orm.public.Notification.where({ recipientId: FAN_ID }).all()).length;
    const other = await app
      .post("/content")
      .set("Authorization", `Bearer ${noncreatorToken}`)
      .send({
        title: `Статья не-создателя ${SUFFIX}`,
        content:
          "Автор без одобренного профиля продавца.\n\nПодписчики создателя не должны получить уведомление.",
        category: "OPINION",
      })
      .expect(201);
    await app
      .post(`/content/${other.body.id}/submit`)
      .set("Authorization", `Bearer ${noncreatorToken}`)
      .expect(200);
    await app
      .post(`/admin/content/${other.body.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const after = (await db.orm.public.Notification.where({ recipientId: FAN_ID }).all()).length;
    expect(after).toBe(before);
  });

  it("dashboard now: creator and followed-resource update rows (E-003)", async () => {
    if (!dbAvailable) return;
    const res = (await app
      .get("/dashboard/now")
      .set("Authorization", `Bearer ${fanToken}`)
      .expect(200)).body;
    expect(res.creatorUpdates.count).toBeGreaterThanOrEqual(1);
    expect(res.creatorUpdates.items[0].resource.slug).toContain(`fl-res`);
    expect(res.followedResourceUpdates.count).toBeGreaterThanOrEqual(1);
  });
});
