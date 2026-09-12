// PLAN-018 Workstream D: versioning/update system.
// D-004 channel metadata (list filter + create), D-002 pipeline response
// field, D-003 rollback (artifact reuse + audit + moderation guards) and
// D-005 Update Center (installed vs latest, changelog cursor).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { UPLOAD_DIR, resolveLocalUploadPath } from "@server/lib/upload";
import { buildZip } from "@tests/tools/helpers/zip";
import { generatePlatformSigningKeypair } from "@server/lib/artifact/signing";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655440170";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655440171";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440172";
const SUFFIX = `uc${Date.now().toString(36)}`;

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[update-center.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let sellerToken = "";
let buyerToken = "";
let adminToken = "";

function iso(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

const fixtureZip = buildZip([{ path: "resource/main.lua", content: "-- update center fixture" }]);
const FIXTURE_NAME = `uc-${SUFFIX}.zip`;

let ucResourceId = "";
let ucSlug = "";
let v100Id = "";
let v110Id = "";
let vBetaId = "";

// Rollback-flow resource (created through the API).
let rbSlug = "";
const rbArtifactIds: string[] = [];

async function cleanupFiles(): Promise<void> {
  const p = resolveLocalUploadPath(`/uploads/${FIXTURE_NAME}`);
  if (p && fs.existsSync(p)) fs.unlinkSync(p);
}

beforeAll(async () => {
  if (!dbAvailable) return;
  process.env.ARTIFACT_SIGNING_PRIVATE_KEY = generatePlatformSigningKeypair().privateKey;
  await resetTestEntities();
  await cleanupFiles();

  sellerToken = await createTestUser(SELLER_ID, `ucs_${SUFFIX}`, "USER", generateAccessToken);
  buyerToken = await createTestUser(BUYER_ID, `ucb_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `uca_${SUFFIX}`, "ADMIN", generateAccessToken);
  await db.orm.public.SellerProfile.create({
    userId: SELLER_ID,
    status: "APPROVED",
    payoutEnabled: true,
  }).catch(() => undefined);

  // Fixture artifact in local storage.
  fs.writeFileSync(path.resolve(UPLOAD_DIR, FIXTURE_NAME), fixtureZip);

  // D-005 fixture: a published resource with a STABLE 1.0.0 (installed),
  // STABLE 1.1.0 (latest) and a BETA 2.0.0 (must NOT become "latest").
  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `uc-${SUFFIX}`,
    title: "Update Center Fixture",
    description: "installed vs latest fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 100,
  });
  ucResourceId = resource.id;
  ucSlug = resource.slug;
  const v100 = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    changelog: "first",
    fileUrl: `/uploads/${FIXTURE_NAME}`,
    fileSize: fixtureZip.length,
    fileChecksum: "chk-100",
    releaseStatus: "PUBLISHED",
    publishedAt: iso(60),
  });
  const v110 = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.1.0",
    changelog: "second",
    fileUrl: `/uploads/${FIXTURE_NAME}`,
    fileSize: fixtureZip.length,
    fileChecksum: "chk-110",
    releaseStatus: "PUBLISHED",
    publishedAt: iso(30),
  });
  const vBeta = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "2.0.0-beta",
    changelog: "beta",
    fileUrl: `/uploads/${FIXTURE_NAME}`,
    fileSize: fixtureZip.length,
    fileChecksum: "chk-200",
    releaseStatus: "PUBLISHED",
    channel: "BETA",
    publishedAt: iso(0),
  });
  v100Id = v100.id;
  v110Id = v110.id;
  vBetaId = vBeta.id;

  const purchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: v100.id,
    status: "COMPLETED",
    priceSnapshot: 100,
    finalPrice: 100,
    platformFee: 10,
    sellerRevenue: 90,
  });
  await db.orm.public.License.create({
    purchaseId: purchase.id,
    versionId: v100.id,
    status: "ACTIVE",
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  await cleanupFiles();
});

describe.skipIf(!dbAvailable)("update center (D-005)", () => {
  it("lists installed vs latest (STABLE preferred over BETA) with update metadata", async () => {
    const res = await app.get("/me/updates").set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    const row = res.body.data.find((r: any) => r.slug === ucSlug);
    expect(row).toBeTruthy();
    expect(row.installedVersion).toBe("1.0.0");
    expect(row.latestVersion).toBe("1.1.0"); // STABLE wins over newer BETA
    expect(row.latestChannel).toBe("STABLE");
    expect(row.updateAvailable).toBe(true);
    expect(row.actions.canUpdate).toBe(true);
    expect(row.actions.canRollback).toBe(false); // buyers never roll back
    expect(row.actions.changelogUrl).toBe(`/me/updates/changelog/${ucResourceId}`);
    expect(row.health).toBeTruthy();
    expect(row.health.score).toBeGreaterThanOrEqual(0);
    expect(row.health.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(row.health.factors)).toBe(true);
  });

  it("reports updateAvailable=false when installed equals latest", async () => {
    // Buyer installs 1.1.0 (upgrade fixture): installed == latest STABLE.
    const purchase = await db.orm.public.Purchase.create({
      buyerId: ADMIN_ID,
      resourceId: ucResourceId,
      versionId: v110Id,
      status: "COMPLETED",
      priceSnapshot: 100,
      finalPrice: 100,
      platformFee: 10,
      sellerRevenue: 90,
    });
    await db.orm.public.License.create({
      purchaseId: purchase.id,
      versionId: v110Id,
      status: "ACTIVE",
    });
    const res = await app.get("/me/updates").set("Authorization", `Bearer ${adminToken}`);
    const row = res.body.data.find((r: any) => r.slug === ucSlug);
    expect(row.installedVersion).toBe("1.1.0");
    expect(row.latestVersion).toBe("1.1.0");
    expect(row.updateAvailable).toBe(false);
  });

  it("requires authentication", async () => {
    expect((await app.get("/me/updates")).status).toBe(401);
  });

  it("changelog lists published versions newest-first with a cursor", async () => {
    const res = await app
      .get(`/me/updates/changelog/${ucResourceId}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((v: any) => v.version)).toEqual(["2.0.0-beta", "1.1.0", "1.0.0"]);
    expect(res.body.data.every((v: any) => typeof v.changelog === "string" || v.changelog === null)).toBe(true);
    expect(res.body.nextCursor).toBeNull();

    const paged = await app
      .get(`/me/updates/changelog/${ucResourceId}?from=${vBetaId}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(paged.status).toBe(200);
    expect(paged.body.data.map((v: any) => v.version)).toEqual(["1.1.0", "1.0.0"]);

    expect(
      (await app
        .get(`/me/updates/changelog/${ucResourceId}?from=not-a-uuid`)
        .set("Authorization", `Bearer ${buyerToken}`)).status
    ).toBe(400);
    expect(
      (await app
        .get("/me/updates/changelog/550e8400-e29b-41d4-a716-446655449999")
        .set("Authorization", `Bearer ${buyerToken}`)).status
    ).toBe(404);
  });
});

describe.skipIf(!dbAvailable)("version channels (D-004)", () => {
  it("filters the version list by channel and rejects invalid channels", async () => {
    const beta = await app.get(`/resources/${ucSlug}/versions?channel=BETA`);
    expect(beta.status).toBe(200);
    expect(beta.body.map((v: any) => v.version)).toEqual(["2.0.0-beta"]);

    const stable = await app.get(`/resources/${ucSlug}/versions?channel=STABLE`);
    expect(stable.body.map((v: any) => v.version)).toEqual(["1.1.0", "1.0.0"]);

    const all = await app.get(`/resources/${ucSlug}/versions`);
    expect(all.body.map((v: any) => v.version)).toEqual(["2.0.0-beta", "1.1.0", "1.0.0"]);

    const invalid = await app.get(`/resources/${ucSlug}/versions?channel=NOPE`);
    expect(invalid.status).toBe(400);
  });

  it("creates a version with an explicit channel (default STABLE)", async () => {
    // Rollback-flow resource is created through the API in the next describe;
    // channel-on-create is verified there (single artifact pipeline run).
    expect(true).toBe(true);
  });
});

describe.skipIf(!dbAvailable)("rollback (D-003) + pipeline response (D-002)", () => {
  beforeAll(async () => {
    if (!dbAvailable) return;
    // Real API journey: draft resource → artifact upload → versions → publish.
    const created = await app
      .post("/resources")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        title: "Rollback Fixture",
        description: "rollback journey",
        type: "SCRIPT",
        price: 100,
        slug: `rb-${SUFFIX}`,
      });
    expect(created.status).toBe(201);
    rbSlug = created.body.slug;

    const upload = await app
      .post("/upload/resource")
      .set("Authorization", `Bearer ${sellerToken}`)
      .attach("file", path.resolve(UPLOAD_DIR, FIXTURE_NAME));
    expect(upload.status).toBe(201);

    const v1 = await app
      .post(`/resources/${rbSlug}/versions`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        version: "3.0.0",
        changelog: "initial",
        fileUrl: upload.body.fileUrl,
        fileSize: upload.body.fileSize,
        fileChecksum: upload.body.fileChecksum,
      });
    expect(v1.status).toBe(201);
    // D-002: explicit pipeline state in the CREATE RESPONSE.
    expect(v1.body.pipeline).toBe("SIGNED");
    expect(v1.body.channel).toBe("STABLE"); // default channel
    expect(v1.body.releaseStatus).toBe("CANDIDATE");
    rbArtifactIds.push(v1.body.id);

    const v2 = await app
      .post(`/resources/${rbSlug}/versions`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        version: "3.1.0-beta",
        channel: "BETA",
        fileUrl: upload.body.fileUrl,
        fileSize: upload.body.fileSize,
        fileChecksum: upload.body.fileChecksum,
      });
    expect(v2.status).toBe(201);
    expect(v2.body.channel).toBe("BETA");
    rbArtifactIds.push(v2.body.id);

    // Publish through moderation (seller cannot publish).
    const submit = await app
      .patch(`/resources/${rbSlug}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "PENDING_REVIEW" });
    expect(submit.status).toBe(200);
    const approve = await app
      .patch(`/admin/resources/${created.body.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PUBLISHED" });
    expect(approve.status).toBe(200);
  });

  it("creates a new version reusing the target artifact, signed, published and audited", async () => {
    const target = await db.orm.public.ResourceVersion.where({ id: rbArtifactIds[0] }).first();
    const res = await app
      .post(`/resources/${rbSlug}/rollback`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ toVersionId: rbArtifactIds[0] });

    expect(res.status).toBe(201);
    expect(res.body.version).toBe("3.0.0-rollback.1");
    expect(res.body.changelog).toBe("Rollback to 3.0.0");
    expect(res.body.pipeline).toBe("PUBLISHED");
    expect(res.body.releaseStatus).toBe("PUBLISHED");
    expect(res.body.rollbackOf).toEqual({ id: target!.id, version: "3.0.0" });
    // J-003 artifact immutability: exact same artifact reference.
    expect(res.body.fileUrl).toBe(target!.fileUrl);
    expect(res.body.fileSize).toBe(target!.fileSize);
    expect(res.body.fileChecksum).toBe(target!.fileChecksum);

    const newSignature = await db.orm.public.ArtifactSignature.where({ versionId: res.body.id }).first();
    const targetSignature = await db.orm.public.ArtifactSignature.where({ versionId: target!.id }).first();
    expect(newSignature).toBeTruthy();
    expect(newSignature!.artifactHash).toBe(targetSignature!.artifactHash);

    const audit = await db.orm.public.AuditLog
      .where({ action: "resource_rollback", targetId: res.body.resourceId })
      .first();
    expect(audit).toBeTruthy();
    expect(audit!.actorId).toBe(SELLER_ID);

    // A second rollback increments the suffix (uniqueness fallback).
    const res2 = await app
      .post(`/resources/${rbSlug}/rollback`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ toVersionId: rbArtifactIds[0] });
    expect(res2.status).toBe(201);
    expect(res2.body.version).toBe("3.0.0-rollback.2");
  });

  it("refuses rollback for non-owners and unpublished targets", async () => {
    // Buyer is not the owner.
    const forbidden = await app
      .post(`/resources/${rbSlug}/rollback`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ toVersionId: rbArtifactIds[0] });
    expect(forbidden.status).toBe(403);

    // Unknown target id.
    const missing = await app
      .post(`/resources/${rbSlug}/rollback`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ toVersionId: "550e8400-e29b-41d4-a716-446655449998" });
    expect(missing.status).toBe(404);

    // A CANDIDATE version was never released by moderation.
    const resource = await db.orm.public.Resource.where({ slug: rbSlug }).first();
    const candidate = await db.orm.public.ResourceVersion.create({
      resourceId: resource!.id,
      version: "9.9.9-candidate",
      fileUrl: `/uploads/${FIXTURE_NAME}`,
      fileSize: fixtureZip.length,
      fileChecksum: "chk",
    });
    const notPublished = await app
      .post(`/resources/${rbSlug}/rollback`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ toVersionId: candidate.id });
    expect(notPublished.status).toBe(409);
    await db.orm.public.ResourceVersion.where({ id: candidate.id }).delete();
  });

  it("validates the toVersionId body field", async () => {
    const bad = await app
      .post(`/resources/${rbSlug}/rollback`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ toVersionId: "garbage" });
    expect(bad.status).toBe(400);
  });
});
