// TASK A-009: Artifact download authorization integration tests.
// Paid artifacts are only reachable through the authenticated,
// entitlement-checked download endpoint. Local storage mode streams the file
// (no public static route); S3 mode issues short-lived signed URLs.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { UPLOAD_DIR, resolveLocalUploadPath } from "../src/lib/upload";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655440030";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655440031";
const STRANGER_ID = "550e8400-e29b-41d4-a716-446655440032";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[download-auth.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

const ARTIFACT_CONTENT = "mta-market download auth test artifact payload";

let sellerToken = "";
let buyerToken = "";
let strangerToken = "";
let slug = "";
let version = "";
let localFilename = "";

async function cleanup(): Promise<void> {
  await resetTestEntities();
  // Remove the fixture file
  const fixture = resolveLocalUploadPath(`/uploads/artifact-${SUFFIX}.lua`);
  if (fixture && fs.existsSync(fixture)) fs.unlinkSync(fixture);
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await cleanup();

  sellerToken = await createTestUser(SELLER_ID, `seller_${SUFFIX}`, "USER", generateAccessToken);
  buyerToken = await createTestUser(BUYER_ID, `buyer_${SUFFIX}`, "USER", generateAccessToken);
  strangerToken = await createTestUser(STRANGER_ID, `stranger_${SUFFIX}`, "USER", generateAccessToken);

  // Real local artifact file
  localFilename = `artifact-${SUFFIX}.lua`;
  fs.writeFileSync(path.resolve(UPLOAD_DIR, localFilename), ARTIFACT_CONTENT);

  // Resource + version + completed purchase for the buyer
  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `dl-test-${SUFFIX}`,
    title: "Download Test",
    description: "desc",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 1000,
  });
  slug = resource.slug;

  const versionRow = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/${localFilename}`,
    fileSize: ARTIFACT_CONTENT.length,
    fileChecksum: "deadbeef",
  });
  version = versionRow.version;

  await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: versionRow.id,
    status: "COMPLETED",
    priceSnapshot: 1000,
    finalPrice: 1000,
    platformFee: 100,
    sellerRevenue: 900,
    completedAt: new Date().toISOString(),
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await cleanup();
});

describe.skipIf(!dbAvailable)("A-009: artifact download authorization", () => {
  it("anonymous cannot download (401)", async () => {
    const res = await app.get(`/resources/${slug}/versions/${version}/download`);
    expect(res.status).toBe(401);
  });

  it("authenticated non-buyer cannot download (403)", async () => {
    const res = await app
      .get(`/resources/${slug}/versions/${version}/download`)
      .set("Authorization", `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
  });

  it("buyer with a COMPLETED purchase downloads the artifact (200, streamed)", async () => {
    const res = await app
      .get(`/resources/${slug}/versions/${version}/download`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe(ARTIFACT_CONTENT);
  });

  it("buyer with a PENDING purchase cannot download (403)", async () => {
    // Downgrade the purchase to PENDING (e.g. payment not settled)
    const purchase = await db.orm.public.Purchase.where({ buyerId: BUYER_ID }).first();
    await db.orm.public.Purchase.where({ id: purchase!.id }).update({ status: "PENDING" });

    const res = await app
      .get(`/resources/${slug}/versions/${version}/download`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);

    // Restore
    await db.orm.public.Purchase.where({ id: purchase!.id }).update({ status: "COMPLETED" });
  });

  it("refunded entitlement cannot download (403)", async () => {
    const purchase = await db.orm.public.Purchase.where({ buyerId: BUYER_ID }).first();
    await db.orm.public.Purchase.where({ id: purchase!.id }).update({ status: "REFUNDED" });

    const res = await app
      .get(`/resources/${slug}/versions/${version}/download`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);

    await db.orm.public.Purchase.where({ id: purchase!.id }).update({ status: "COMPLETED" });
  });

  it("buyer cannot download a version they did not purchase (403)", async () => {
    // Create a second version the buyer does NOT own
    const resource = await db.orm.public.Resource.where({ slug }).first();
    await db.orm.public.ResourceVersion.create({
      resourceId: resource!.id,
      version: "2.0.0",
      fileUrl: `/uploads/${localFilename}`,
      fileSize: ARTIFACT_CONTENT.length,
      fileChecksum: "deadbeef",
    });

    const res = await app
      .get(`/resources/${slug}/versions/2.0.0/download`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Version not entitled");
  });
});

describe("A-009: local storage path confinement (unit)", () => {
  it("resolves a normal reference inside UPLOAD_DIR", () => {
    const p = resolveLocalUploadPath("/uploads/abc.lua");
    expect(p).toBeTruthy();
    expect(p!.startsWith(path.resolve(UPLOAD_DIR))).toBe(true);
  });

  it("rejects path traversal (../)", () => {
    expect(resolveLocalUploadPath("/uploads/../../secrets.env")).toBeNull();
  });

  it("rejects absolute paths outside UPLOAD_DIR", () => {
    expect(resolveLocalUploadPath("C:\\Windows\\system32\\config")).toBeNull();
    expect(resolveLocalUploadPath("/etc/passwd")).toBeNull();
  });
});