// PLAN-018 O: leak radar integration tests.
// Fingerprint upsert idempotency, family grouping, confidence bounds (≤0.9,
// never 1.0), scan endpoint with auto-open ≥ 0.6, audited case transitions.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { UPLOAD_DIR, resolveLocalUploadPath } from "@server/lib/upload";
import { resetTestEntities, createTestUser } from "@tests/tools/helpers/db-reset";
import { buildZip } from "@tests/tools/helpers/zip";
import {
  fingerprintArtifact,
  deriveFamilyKey,
  computeConfidence,
  entryNameJaccard,
} from "@server/lib/artifact/fingerprint";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655440060";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655440061";
const USER_ID = "550e8400-e29b-41d4-a716-446655440062";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655440063";
const SUFFIX = Date.now().toString(36);
const SLUG = `leak-test-${SUFFIX}`;
const ARTIFACT_NAME = `leak-artifact-${SUFFIX}.zip`;
const ENTRY_NAMES = ["pack/main.lua", "pack/models/car.obj", "pack/models/car_lod1.obj"];

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[leak-radar.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

const ARTIFACT = buildZip([
  { path: "pack/main.lua", content: "print('leak radar fixture')" },
  { path: "pack/models/car.obj", content: "v 0 0 0\nf 1 2 3\n" },
  { path: "pack/models/car_lod1.obj", content: "v 0 0 0\nf 1 2 3\n" },
]);

let adminToken = "";
let userToken = "";
let versionId = "";

async function cleanup(): Promise<void> {
  // Leak tables have no FKs — remove explicitly, then the shared reset.
  const cases = await db.orm.public.LeakCase.where({}).all();
  for (const c of cases) await db.orm.public.LeakCase.where({ id: c.id }).delete().catch(() => undefined);
  const fps = await db.orm.public.ArtifactFingerprint.where({}).all();
  for (const f of fps) await db.orm.public.ArtifactFingerprint.where({ id: f.id }).delete().catch(() => undefined);
  await resetTestEntities();
  const fixture = resolveLocalUploadPath(`/uploads/${ARTIFACT_NAME}`);
  if (fixture && fs.existsSync(fixture)) fs.unlinkSync(fixture);
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await cleanup();

  await createTestUser(SELLER_ID, `lseller_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(BUYER_ID, `lbuyer_${SUFFIX}`, "USER", generateAccessToken);
  userToken = await createTestUser(USER_ID, `luser_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `ladmin_${SUFFIX}`, "ADMIN", generateAccessToken);

  fs.writeFileSync(path.resolve(UPLOAD_DIR, ARTIFACT_NAME), ARTIFACT);

  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: SLUG,
    title: "Leak Test",
    description: "desc",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 1000,
  });
  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: "1.0.0",
    fileUrl: `/uploads/${ARTIFACT_NAME}`,
    fileSize: ARTIFACT.length,
    fileChecksum: "0ddba11".repeat(4),
  });
  versionId = version.id;

  // Installation evidence: a completed purchase + license on this version.
  const purchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    status: "COMPLETED",
    priceSnapshot: 1000,
    finalPrice: 1000,
    platformFee: 100,
    sellerRevenue: 900,
    completedAt: new Date().toISOString(),
  });
  await db.orm.public.License.create({
    purchaseId: purchase.id,
    versionId: version.id,
    status: "ACTIVE",
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await cleanup();
});

describe.skipIf(!dbAvailable)("fingerprint — upsert + family", () => {
  it("upsert is idempotent by artifactHash", async () => {
    const first = await fingerprintArtifact({
      artifactHash: `hash-${SUFFIX}-a`,
      sizeBytes: 100,
      entryNames: ENTRY_NAMES,
      fromVersionId: versionId,
    });
    const second = await fingerprintArtifact({
      artifactHash: `hash-${SUFFIX}-a`,
      sizeBytes: 100,
      entryNames: ENTRY_NAMES,
      fromVersionId: versionId,
    });
    expect(second.id).toBe(first.id);
    const rows = await db.orm.public.ArtifactFingerprint
      .where({ artifactHash: `hash-${SUFFIX}-a` })
      .all();
    expect(rows).toHaveLength(1);
  });

  it("same entry names → same family; different → different family", async () => {
    expect(deriveFamilyKey(ENTRY_NAMES)).toBe(deriveFamilyKey([...ENTRY_NAMES]));
    expect(deriveFamilyKey(ENTRY_NAMES)).not.toBe(deriveFamilyKey(["other/thing.lua"]));

    const f1 = await fingerprintArtifact({
      artifactHash: `hash-${SUFFIX}-f1`,
      entryNames: ENTRY_NAMES,
      fromVersionId: versionId,
    });
    const f2 = await fingerprintArtifact({
      artifactHash: `hash-${SUFFIX}-f2`,
      entryNames: ENTRY_NAMES,
      fromVersionId: versionId,
    });
    const f3 = await fingerprintArtifact({
      artifactHash: `hash-${SUFFIX}-f3`,
      entryNames: ["unrelated/file.txt"],
      fromVersionId: null,
    });
    expect(f1.family).toBeTruthy();
    expect(f2.family).toBe(f1.family);
    expect(f3.family).not.toBe(f1.family);
  });
});

describe.skipIf(!dbAvailable)("confidence — bounds and weighting", () => {
  it("never exceeds 0.9 and is 0 without signals", async () => {
    expect(computeConfidence({ familyCount: 99, installationCount: 99, sizeMatch: true, jaccard: 1 })).toBe(0.9);
    expect(computeConfidence({ familyCount: 0, installationCount: 0, sizeMatch: false, jaccard: 0 })).toBe(0);
    expect(computeConfidence({ familyCount: 2, installationCount: 1, sizeMatch: true, jaccard: 0.9 })).toBe(0.9);
    expect(computeConfidence({ familyCount: 2, installationCount: 1, sizeMatch: false, jaccard: 0.3 })).toBe(0.7);
  });

  it("jaccard helper behaves as set similarity", () => {
    expect(entryNameJaccard(["a.lua", "b.lua"], ["a.lua", "b.lua"])).toBe(1);
    expect(entryNameJaccard(["a.lua"], ["b.lua"])).toBe(0);
    expect(entryNameJaccard(null, null)).toBe(0);
  });
});

describe.skipIf(!dbAvailable)("leak radar — authorization", () => {
  it("non-admin cannot access the queue (403)", async () => {
    const res = await app.get("/admin/leak-cases").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it("unauthenticated scan → 401", async () => {
    const res = await app.post(`/admin/leak-cases/scan/${versionId}`);
    expect(res.status).toBe(401);
  });
});

describe.skipIf(!dbAvailable)("leak radar — scan, cases, transitions", () => {
  it("scan computes a fingerprint for the version's artifact", async () => {
    const res = await app
      .post(`/admin/leak-cases/scan/${versionId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.fingerprint.artifactHash).toBeTruthy();
    expect(res.body.fingerprint.family).toBeTruthy();
    // installation evidence ≥1 → confidence includes the 0.3 weight, bounded
    expect(res.body.confidence).toBeGreaterThanOrEqual(0.3);
    expect(res.body.confidence).toBeLessThanOrEqual(0.9);
  });

  it("scan auto-opens a case at confidence ≥ 0.6 (family + installation overlap)", async () => {
    // Two more family peers (same entry names, different hashes) → familyCount 2 → 0.4
    await fingerprintArtifact({ artifactHash: `hash-${SUFFIX}-p1`, entryNames: ENTRY_NAMES });
    await fingerprintArtifact({ artifactHash: `hash-${SUFFIX}-p2`, entryNames: ENTRY_NAMES });

    const res = await app
      .post(`/admin/leak-cases/scan/${versionId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.confidence).toBeGreaterThanOrEqual(0.6); // 0.4 family + 0.3 install, capped 0.9
    expect(res.body.confidence).toBeLessThanOrEqual(0.9);
    expect(res.body.openedCaseId).toBeTruthy();
  });

  it("scan does not duplicate the auto-opened case", async () => {
    const res = await app
      .post(`/admin/leak-cases/scan/${versionId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const openCases = await db.orm.public.LeakCase
      .where({ fingerprintId: res.body.fingerprint.id, status: "OPEN" })
      .all();
    expect(openCases).toHaveLength(1);
  });

  it("queue returns cases with fingerprint + confidence + evidence", async () => {
    const res = await app.get("/admin/leak-cases").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = res.body.data.find((c: { fingerprintId?: string }) => c.fingerprintId ?? true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(row.fingerprint).toBeTruthy();
    expect(row.fingerprint.family).toBeTruthy();
    expect(row.confidence).toBeLessThanOrEqual(0.9);
    expect(row.evidenceCount).toBeGreaterThanOrEqual(1);
  });

  it("manual case open → 201 OPEN with computed evidence", async () => {
    const fp = await fingerprintArtifact({
      artifactHash: `hash-${SUFFIX}-manual`,
      entryNames: ["solo/file.lua"],
      fromVersionId: null,
    });
    const res = await app
      .post("/admin/leak-cases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fingerprintId: fp.id, notes: "Reported on forum" });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("OPEN");
    expect(typeof res.body.confidence).toBe("number");
  });

  it("transitions are audited (confirm, then resolve)", async () => {
    const queue = await app.get("/admin/leak-cases?status=OPEN").set("Authorization", `Bearer ${adminToken}`);
    const caseId = queue.body.data[0].id;

    const confirm = await app
      .post(`/admin/leak-cases/${caseId}/transition`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "confirm", resolutionNote: "Verified against source" });
    expect(confirm.status).toBe(200);
    expect(confirm.body.status).toBe("CONFIRMED");
    expect(confirm.body.resolvedAt).toBeTruthy();

    const audit = await db.orm.public.AuditLog
      .where({ action: "leak_case_transitioned", targetId: caseId })
      .first();
    expect(audit).toBeTruthy();
    expect(audit!.actorId).toBe(ADMIN_ID);
    expect(audit!.after).toContain("CONFIRMED");
  });

  it("mark_false_positive and dismiss map to their statuses", async () => {
    const fp = await fingerprintArtifact({
      artifactHash: `hash-${SUFFIX}-fp2`,
      entryNames: ["solo2/file.lua"],
      fromVersionId: null,
    });
    const opened = await app
      .post("/admin/leak-cases")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fingerprintId: fp.id });

    const fpRes = await app
      .post(`/admin/leak-cases/${opened.body.id}/transition`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "mark_false_positive" });
    expect(fpRes.status).toBe(200);
    expect(fpRes.body.status).toBe("FALSE_POSITIVE");

    const dismissed = await app
      .post(`/admin/leak-cases/${opened.body.id}/transition`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "dismiss", resolutionNote: "Not a leak" });
    expect(dismissed.status).toBe(200);
    expect(dismissed.body.status).toBe("DISMISSED");
  });

  it("invalid transition action → 400; unknown case → 404", async () => {
    const invalid = await app
      .post("/admin/leak-cases/00000000-0000-0000-0000-000000000000/transition")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "nuke" });
    expect(invalid.status).toBe(400);

    const missing = await app
      .post("/admin/leak-cases/00000000-0000-0000-0000-000000000000/transition")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "confirm" });
    expect(missing.status).toBe(404);
  });
});