// PLAN Block 8 tests:
// - O-001: /metrics exposition + counters recorded;
// - O-002: /live and /ready probes;
// - O-006: DRM protocol contract pinning (cross-repo compat anchor);
// - Q-001: security headers;
// - Q-004: audit log rows for sensitive actions;
// - R-002: heartbeat shouldUpdate for newer published versions.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";
import {
  DRM_PROTOCOL_VERSION,
  LEASE_DURATION_SECONDS,
  CLOCK_SKEW_SECONDS,
  NONCE_HEX_LENGTH,
  DEK_ALGORITHM,
} from "../src/lib/drm/protocol";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655446901";
const BUYER_ID = "550e8400-e29b-41d4-a716-446655446902";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655446903";
const SUFFIX = Date.now().toString(36);

let adminToken = "";
let buyerToken = "";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[o-block8.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  await createTestUser(SELLER_ID, `o8seller_${SUFFIX}`, "USER", generateAccessToken);
  buyerToken = await createTestUser(BUYER_ID, `o8buyer_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `o8admin_${SUFFIX}`, "ADMIN", generateAccessToken);
  await db.orm.public.SellerProfile.create({
    userId: SELLER_ID,
    status: "APPROVED",
    payoutEnabled: true,
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("O-002: health endpoints", () => {
  it("/live responds 200 without dependencies", async () => {
    const res = await app.get("/live");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("live");
  });

  it("/ready checks the database", async () => {
    const res = await app.get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe("ok");
  });
});

describe.skipIf(!dbAvailable)("O-001: metrics", () => {
  it("exposes Prometheus text format with request counters after traffic", async () => {
    await app.get("/resources?limit=1");
    const res = await app.get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    expect(res.text).toContain("# TYPE http_requests_total counter");
    expect(res.text).toMatch(/http_requests_total\{.*route="\/resources".*\} \d+/);
    expect(res.text).toContain("# TYPE http_latency_ms summary");
  });
});

describe.skipIf(!dbAvailable)("Q-001: security headers", () => {
  it("sets nosniff, frame-deny, referrer policy and CSP", async () => {
    const res = await app.get("/resources?limit=1");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });
});

describe.skipIf(!dbAvailable)("O-006: protocol contract pinning", () => {
  it("freezes the DRM v2 contract values the module depends on", () => {
    expect(DRM_PROTOCOL_VERSION).toBe(2);
    expect(LEASE_DURATION_SECONDS).toBe(7 * 24 * 60 * 60);
    expect(CLOCK_SKEW_SECONDS).toBe(90);
    expect(NONCE_HEX_LENGTH).toBe(64);
    expect(DEK_ALGORITHM).toBe("aes-256-gcm");
  });
});

describe.skipIf(!dbAvailable)("Q-004: audit log", () => {
  it("records an audit row for seller approval (actor, target, after-state)", async () => {
    const apply = await app
      .post("/seller/apply")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ displayName: "Audit seller" });
    expect(apply.status).toBe(201);

    const approve = await app
      .post(`/seller/${BUYER_ID}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(approve.status).toBe(200);

    const rows = (await db.orm.public.AuditLog.where({
      action: "seller.approve",
      targetType: "seller_profile",
    }).all()).filter((r: { actorId: string }) => r.actorId === ADMIN_ID);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[rows.length - 1];
    expect(row.actorId).toBe(ADMIN_ID);
    expect(row.after).toContain("APPROVED");
  });
});

describe.skipIf(!dbAvailable)("R-002: heartbeat shouldUpdate", () => {
  it("advises an update when a newer PUBLISHED version exists", async () => {
    const resource = await db.orm.public.Resource.create({
      sellerId: SELLER_ID,
      slug: `o8-upd-${SUFFIX}`,
      title: "Update flow",
      description: "update fixture",
      type: "SCRIPT",
      status: "PUBLISHED",
      price: 100,
    });
    const v1 = await db.orm.public.ResourceVersion.create({
      resourceId: resource.id,
      version: `1.0.0-${SUFFIX}`,
      fileUrl: `/uploads/o8-v1.zip`,
      fileSize: 100,
      fileChecksum: "x",
      releaseStatus: "PUBLISHED",
    });
    // Installation + lease bound to v1
    const license = await db.orm.public.License.create({
      purchaseId: (
        await db.orm.public.Purchase.create({
          buyerId: BUYER_ID,
          resourceId: resource.id,
          versionId: v1.id,
          status: "COMPLETED",
          priceSnapshot: 100,
          finalPrice: 100,
          platformFee: 10,
          sellerRevenue: 90,
          completedAt: new Date().toISOString(),
        })
      ).id,
      versionId: v1.id,
      status: "ACTIVE",
    });
    const { createServerSigningKey } = await import("../src/lib/drm/service");
    const existingKeys = await db.orm.public.ServerSigningKey
      .where({ status: "ACTIVE" })
      .all();
    for (const k of existingKeys) {
      await db.orm.public.ServerSigningKey.where({ id: k.id }).update({ status: "REVOKED" });
    }
    const serverKey = await createServerSigningKey();
    const installation = await db.orm.public.Installation.create({
      licenseId: license.id,
      publicKey: `pub-${SUFFIX}-${Math.random().toString(36).slice(2, 8)}`,
      status: "ACTIVE",
      verifiedAt: new Date().toISOString(),
    });
    await db.orm.public.Lease.create({
      installationId: installation.id,
      licenseId: license.id,
      resourceId: resource.id,
      resourceVersionId: v1.id,
      artifactHash: "x".repeat(64),
      nonce: "a".repeat(64),
      protocolVersion: 2,
      serverKeyId: serverKey.keyId,
      signature: "s",
      capabilities: ["run"],
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    });

    // v1 is the newest PUBLISHED version -> no update advised
    const hb1 = await app.post("/drm/v2/heartbeat").send({
      installationId: installation.id,
      resourceId: resource.id,
      uptime: 10,
    });
    expect(hb1.status).toBe(200);
    expect(hb1.body.shouldUpdate).toBe(false);

    // publish v2 -> heartbeat must advise updating to v2
    const v2 = await db.orm.public.ResourceVersion.create({
      resourceId: resource.id,
      version: `2.0.0-${SUFFIX}`,
      fileUrl: `/uploads/o8-v2.zip`,
      fileSize: 100,
      fileChecksum: "y",
      releaseStatus: "PUBLISHED",
      publishedAt: new Date().toISOString(),
    });
    const hb2 = await app.post("/drm/v2/heartbeat").send({
      installationId: installation.id,
      resourceId: resource.id,
      uptime: 20,
    });
    expect(hb2.status).toBe(200);
    expect(hb2.body.shouldUpdate).toBe(true);
    expect(hb2.body.updateVersionId).toBe(v2.id);
  });
});
