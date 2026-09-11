// PLAN B-001/B-002: Publication pipeline integration tests.
// version upload -> static validation (sandbox) -> artifact signing ->
// publish gate. A malicious fixture cannot publish; an unsigned version
// cannot be published; the signed happy path works end to end.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { UPLOAD_DIR, resolveLocalUploadPath } from "../src/lib/upload";
import { buildZip } from "./helpers/zip";
import { signVersionArtifact, generatePlatformSigningKeypair } from "../src/lib/artifact/signing";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655440050";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440051";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[publication-pipeline.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let sellerToken = "";
let adminToken = "";
let sellerId = "";

// Signing key for the pipeline (platform key, env-driven)
const TEST_SIGNING_KEY = generatePlatformSigningKeypair().privateKey;

const goodZip = buildZip([{ path: "resource/main.lua", content: "-- good resource" }]);
const evilZip = buildZip([{ path: "../escaped.lua", content: "malicious" }]);

const createdResources: string[] = [];

async function cleanup(): Promise<void> {
  await resetTestEntities();
  for (const name of [`good-${SUFFIX}.zip`, `evil-${SUFFIX}.zip`]) {
    const p = resolveLocalUploadPath(`/uploads/${name}`);
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  }
}

beforeAll(async () => {
  if (!dbAvailable) return;
  process.env.ARTIFACT_SIGNING_PRIVATE_KEY = TEST_SIGNING_KEY;
  await cleanup();

  sellerToken = await createTestUser(SELLER_ID, `ps_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `pa_${SUFFIX}`, "ADMIN", generateAccessToken);

  // PLAN L-002: API listing creation requires an APPROVED seller profile.
    await db.orm.public.SellerProfile.create({
    userId: SELLER_ID,
    status: "APPROVED",
    payoutEnabled: true,
  }).catch(() => undefined);
  sellerId = SELLER_ID;

  // Real fixture files in local storage
  fs.writeFileSync(path.resolve(UPLOAD_DIR, `good-${SUFFIX}.zip`), goodZip);
  fs.writeFileSync(path.resolve(UPLOAD_DIR, `evil-${SUFFIX}.zip`), evilZip);
});

afterAll(async () => {
  if (!dbAvailable) return;
  await cleanup();
});

describe.skipIf(!dbAvailable)("B-001/B-002: publication pipeline", () => {
  it("creates a version from a stored artifact: validates, signs, records sandbox run", async () => {
    const createRes = await app
      .post("/resources")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ title: "Pipeline Resource", description: "publication pipeline test", type: "SCRIPT", price: 100, slug: `pipe-${SUFFIX}` });
    expect(createRes.status).toBe(201);
    createdResources.push(createRes.body.id);

    const res = await app
      .post(`/resources/pipe-${SUFFIX}/versions`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        version: "1.0.0",
        fileUrl: `/uploads/good-${SUFFIX}.zip`,
        fileSize: goodZip.length,
        fileChecksum: "x",
      });

    expect(res.status).toBe(201);
    expect(res.body.signed).toBe(true);
    expect(res.body.artifactHash).toBeTruthy();

    const versionId = res.body.id;
    const signature = await db.orm.public.ArtifactSignature.where({ versionId }).first();
    expect(signature).toBeTruthy();
    const run = await db.orm.public.SandboxRun.where({ versionId }).first();
    expect(run).toBeTruthy();
    expect(["PENDING", "SUCCESS"]).toContain(run!.status); // PENDING = no Docker locally
  });

  it("rejects a malicious fixture (path traversal) and does NOT create the version", async () => {
    const res = await app
      .post(`/resources/pipe-${SUFFIX}/versions`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        version: "2.0.0-evil",
        fileUrl: `/uploads/evil-${SUFFIX}.zip`,
        fileSize: evilZip.length,
        fileChecksum: "x",
      });

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("traversal");

    // Version rolled back (the FAILED SandboxRun row cascades away with it —
    // the 422 response carries the validation evidence to the uploader)
    const versions = await db.orm.public.ResourceVersion.where({ version: "2.0.0-evil" }).all();
    expect(versions.length).toBe(0);
  });

  it("rejects external artifact URLs (cannot be validated or signed)", async () => {
    const res = await app
      .post(`/resources/pipe-${SUFFIX}/versions`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        version: "3.0.0",
        fileUrl: "https://cdn.example.com/artifact.zip",
        fileSize: 100,
        fileChecksum: "x",
      });
    expect(res.status).toBe(400);
  });

  it("publish gate blocks an unsigned version (409)", async () => {
    // Insert a version directly (bypassing the signing pipeline)
    const resource = await db.orm.public.Resource.where({ slug: `pipe-${SUFFIX}` }).first();
    const unsigned = await db.orm.public.ResourceVersion.create({
      resourceId: resource!.id,
      version: "9.9.9-unsigned",
      fileUrl: `/uploads/good-${SUFFIX}.zip`,
      fileSize: goodZip.length,
      fileChecksum: "x",
    });

    // Submit for review first (DRAFT -> PUBLISHED is not an admin transition)
    await db.orm.public.Resource.where({ id: resource!.id }).update({ status: "PENDING_REVIEW" });

    const res = await app
      .patch(`/admin/resources/${resource!.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PUBLISHED" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Version is not signed");

    // Sign it through the library (the same implementation the API uses)
    await signVersionArtifact(unsigned.id, goodZip);

    const res2 = await app
      .patch(`/admin/resources/${resource!.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PUBLISHED" });
    expect(res2.status).toBe(200);
  });

  it("publish gate blocks a version with FAILED validation (409)", async () => {
    const resource = await db.orm.public.Resource.where({ slug: `pipe-${SUFFIX}` }).first();
    const version = await db.orm.public.ResourceVersion.create({
      resourceId: resource!.id,
      version: "8.8.8-failed",
      fileUrl: `/uploads/good-${SUFFIX}.zip`,
      fileSize: goodZip.length,
      fileChecksum: "x",
    });
    await db.orm.public.SandboxRun.create({
      versionId: version.id,
      status: "FAILED",
      stderr: "simulated failed validation",
    });
    await signVersionArtifact(version.id, goodZip);

    // First move to PENDING_REVIEW (publish gate only applies to PUBLISHED)
    await db.orm.public.Resource.where({ id: resource!.id }).update({ status: "PENDING_REVIEW" });

    const res = await app
      .patch(`/admin/resources/${resource!.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PUBLISHED" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Version failed validation");
  });
});