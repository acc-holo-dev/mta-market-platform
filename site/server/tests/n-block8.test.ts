// PLAN Block 8 tests:
// - N-003: E2E free purchase flow (catalog -> instant checkout -> license ->
//   authorized artifact download; zero Payment rows, INV-002);
// - N-006: consolidated authorization matrix (resource edit/submit, purchase
//   detail, refunds, admin status routes — anonymous / non-owner / seller /
//   non-admin / moderator);
// - N-007: DRM security additions (malformed nonce, YANKED version refusal,
//   expired stored lease, lease signed by an untrusted server key, heartbeat
//   for an unknown installation);
// - N-005 additions: out-of-order webhooks (canceled before succeeded),
//   INV-013 after a full refund, late/duplicate simulate on a completed
//   purchase.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import fs from "fs";
import path from "path";

// The provider SDK module is mocked BEFORE the app is imported (webhook
// harness pattern from payments-webhook.test.ts). The enabled flag mirrors
// the real env switch: webhooks need the provider enabled, the dev simulate
// endpoint requires it disabled — tests flip the live binding as needed.
vi.mock("../src/lib/yookassa", () => ({
  YOOKASSA_ENABLED: false,
  YOOKASSA_SHOP_ID: "test-shop",
  createYooKassaPayment: vi.fn(),
  getYooKassaPayment: vi.fn(),
  createYooKassaRefund: vi.fn(),
  YooKassaWebhook: {},
}));

import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { getYooKassaPayment } from "../src/lib/yookassa";
import * as yookassaModule from "../src/lib/yookassa";
import { UPLOAD_DIR } from "../src/lib/upload";
import { createServerSigningKey, getTrustedServerKeys } from "../src/lib/drm/service";
import {
  generateInstallationKeypair,
  signChallenge,
  generateNonce,
  verifyLeaseSignature,
  signLease,
} from "../src/lib/drm/crypto";
import type { LeasePayload } from "../src/lib/drm/types";
import { CLOCK_SKEW_SECONDS } from "../src/lib/drm/protocol";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());
const mockedGetPayment = vi.mocked(getYooKassaPayment);

const BUYER_ID = "550e8400-e29b-41d4-a716-446655448001";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655448002";
const OTHER_ID = "550e8400-e29b-41d4-a716-446655448003";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655448004";
const MOD_ID = "550e8400-e29b-41d4-a716-446655448005";
const SUFFIX = Date.now().toString(36);

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[n-block8.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

// YooKassa allowlisted IP (185.71.76.0/27) sent through the trusted proxy
// header; Basic auth = shopId:notificationPassword (set in beforeAll).
const YK_IP = "185.71.76.5";
const YK_AUTH = "Basic " + Buffer.from("test-shop:whpass").toString("base64");
const PROVIDER_PAYMENT_ID = `pay-n8-${SUFFIX}`;

let buyerToken = "";
let otherToken = "";
let sellerToken = "";
let adminToken = "";
let modToken = "";

let freeSlug = `n8-free-${SUFFIX}`;
let freeVersion = "1.0.0";
let freeResourceId = "";
let paidSlug = `n8-paid-${SUFFIX}`;
let paidResourceId = "";
let paidVersionId = "";
let modSlug = `n8-mod-${SUFFIX}`;
let modResourceId = "";
let drmResourceId = "";
let drmVersionId = "";
let licenseId = "";
let yankedLicenseId = "";
let otherCompletedPurchaseId = "";
let refundPaymentId = "";
const freeFileName = `n8-free-${SUFFIX}.zip`;
const ARTIFACT_CONTENT = "MTA-N8-FREE-ARTIFACT-BYTES";

function setYookassaEnabled(enabled: boolean): void {
  (yookassaModule as unknown as { YOOKASSA_ENABLED: boolean }).YOOKASSA_ENABLED = enabled;
}

function postWebhook(body: Record<string, unknown>) {
  return app
    .post("/payments/webhook")
    .set("X-Forwarded-For", YK_IP)
    .set("Authorization", YK_AUTH)
    .send(body);
}

/** Compact matrix helper: fire one request with an optional bearer token. */
async function call(
  method: "get" | "patch" | "post",
  url: string,
  token?: string,
  body?: Record<string, unknown>
): Promise<request.Response> {
  const req = app[method](url);
  if (token) req.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) return req.send(body);
  return req;
}

/** Seed an ACTIVE publisher key + artifact signature for a version. */
async function seedVersionSignature(
  sellerId: string,
  versionId: string,
  artifactHash: string
): Promise<void> {
  const { publicKey } = await import("../src/lib/artifact/crypto").then((m) =>
    m.generatePublisherKeypair()
  );
  const key = await db.orm.public.PublisherKey.create({
    sellerId,
    keyType: "ED25519",
    publicKey,
    algorithm: "EdDSA",
    status: "ACTIVE",
  });
  await db.orm.public.ArtifactSignature.create({
    versionId,
    keyId: key.id,
    signature: "c2lnbmF0dXJl",
    algorithm: "EdDSA",
    manifestHash: "a".repeat(64),
    artifactHash,
    manifest: { formatVersion: 1, files: [] },
  });
}

async function seedCompletedPurchase(
  buyerId: string,
  resourceId: string,
  versionId: string,
  price: number
): Promise<void> {
  const purchase = await db.orm.public.Purchase.create({
    buyerId,
    resourceId,
    versionId,
    status: "COMPLETED",
    completedAt: new Date().toISOString(),
    priceSnapshot: price,
    finalPrice: price,
    platformFee: Math.round(price * 0.1),
    sellerRevenue: price - Math.round(price * 0.1),
  });
  await db.orm.public.License.create({
    purchaseId: purchase.id,
    versionId,
    status: "ACTIVE",
  });
}

/** Drive register -> verify over HTTP; returns the installation id. */
async function createVerifiedInstallation(licId: string, token: string): Promise<string> {
  const kp = generateInstallationKeypair();
  const reg = await app
    .post("/drm/v2/installations")
    .set("Authorization", `Bearer ${token}`)
    .send({
      publicKey: kp.publicKey,
      licenseId: licId,
      mtaVersion: "1.6",
      moduleVersion: "0.4.0",
    });
  expect(reg.status).toBe(201);
  const verify = await app.post(`/drm/v2/installations/${reg.body.installationId}/verify`).send({
    challengeResponse: signChallenge(reg.body.challenge, kp.privateKey),
  });
  expect(verify.status).toBe(200);
  expect(verify.body.verified).toBe(true);
  return reg.body.installationId as string;
}

beforeAll(async () => {
  if (!dbAvailable) return;
  process.env.YOOKASSA_NOTIFICATION_PASSWORD = "whpass";
  await resetTestEntities();

  buyerToken = await createTestUser(BUYER_ID, `n8buyer_${SUFFIX}`, "USER", generateAccessToken);
  otherToken = await createTestUser(OTHER_ID, `n8other_${SUFFIX}`, "USER", generateAccessToken);
  sellerToken = await createTestUser(SELLER_ID, `n8seller_${SUFFIX}`, "USER", generateAccessToken);
  adminToken = await createTestUser(ADMIN_ID, `n8admin_${SUFFIX}`, "ADMIN", generateAccessToken);
  modToken = await createTestUser(MOD_ID, `n8mod_${SUFFIX}`, "MODERATOR", generateAccessToken);

  // Free resource (N-003): published, price 0, one version whose artifact
  // physically exists in UPLOAD_DIR so the local download path can stream it.
  const free = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: freeSlug,
    title: "N8 Free Resource",
    description: "free fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 0,
  });
  freeResourceId = free.id;
  const freeVersionRow = await db.orm.public.ResourceVersion.create({
    resourceId: free.id,
    version: freeVersion,
    fileUrl: `/uploads/${freeFileName}`,
    fileSize: ARTIFACT_CONTENT.length,
    fileChecksum: "c".repeat(64),
  });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, freeFileName), ARTIFACT_CONTENT);

  // Paid resource: webhooks (N-005) complete a real checkout for it.
  const paid = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: paidSlug,
    title: "N8 Paid Resource",
    description: "paid fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 5000,
  });
  paidResourceId = paid.id;
  const paidVersion = await db.orm.public.ResourceVersion.create({
    resourceId: paid.id,
    version: "1.0.0",
    fileUrl: "https://storage.test/artifact.zip",
    fileSize: 1024,
    fileChecksum: "d".repeat(64),
  });
  paidVersionId = paidVersion.id;

  // Moderation fixture (N-006): seller-submitted resource with a signed
  // version so the publication gate (signature + dependencies) passes.
  const mod = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: modSlug,
    title: "N8 Moderation Resource",
    description: "submitted fixture",
    type: "SCRIPT",
    status: "PENDING_REVIEW",
    price: 1000,
  });
  modResourceId = mod.id;
  const modVersion = await db.orm.public.ResourceVersion.create({
    resourceId: mod.id,
    version: "1.0.0",
    fileUrl: "https://storage.test/artifact.zip",
    fileSize: 1024,
    fileChecksum: "e".repeat(64),
  });
  await seedVersionSignature(SELLER_ID, modVersion.id, "e".repeat(64));

  // DRM fixtures (N-007): signed versions, COMPLETED purchases, ACTIVE
  // licenses — one normal, one whose version releaseStatus is YANKED.
  const drm = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `n8-drm-${SUFFIX}`,
    title: "N8 DRM Resource",
    description: "drm fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 10000,
  });
  drmResourceId = drm.id;
  const drmVersion = await db.orm.public.ResourceVersion.create({
    resourceId: drm.id,
    version: `1.0.0-${SUFFIX}`,
    fileUrl: "https://storage.test/artifact.zip",
    fileSize: 1024,
    fileChecksum: "f".repeat(64),
  });
  drmVersionId = drmVersion.id;
  await seedVersionSignature(SELLER_ID, drmVersion.id, "f".repeat(64));
  await seedCompletedPurchase(BUYER_ID, drm.id, drmVersion.id, 10000);
  const drmLicense = await db.orm.public.License.where({
    purchaseId: (
      await db.orm.public.Purchase.where({ buyerId: BUYER_ID, resourceId: drm.id }).first()
    )!.id,
  }).first();
  licenseId = drmLicense!.id;

  const yanked = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `n8-yanked-${SUFFIX}`,
    title: "N8 Yanked Resource",
    description: "yanked fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 10000,
  });
  const yankedVersion = await db.orm.public.ResourceVersion.create({
    resourceId: yanked.id,
    version: "1.0.0",
    fileUrl: "https://storage.test/artifact.zip",
    fileSize: 1024,
    fileChecksum: "9".repeat(64),
    releaseStatus: "YANKED",
  });
  await seedVersionSignature(SELLER_ID, yankedVersion.id, "9".repeat(64));
  await seedCompletedPurchase(BUYER_ID, yanked.id, yankedVersion.id, 10000);
  const yankedPurchase = await db.orm.public.Purchase
    .where({ buyerId: BUYER_ID, resourceId: yanked.id })
    .first();
  yankedLicenseId = (await db.orm.public.License.where({ purchaseId: yankedPurchase!.id }).first())!.id;

  // N-005: a COMPLETED purchase owned by OTHER for the late/duplicate
  // simulate probe (buyer keeps clean ownership of free/paid fixtures).
  await seedCompletedPurchase(OTHER_ID, paid.id, paidVersionId, 5000);
  otherCompletedPurchaseId = (
    await db.orm.public.Purchase.where({ buyerId: OTHER_ID, resourceId: paid.id }).first()
  )!.id;

  // N-005: captured payment with a prior SUCCEEDED full refund — the INV-013
  // ceiling is already exhausted while the payment row is still refundable.
  const refundPayment = await db.orm.public.Payment.create({
    purchaseId: null,
    provider: "YUKASSA",
    providerPaymentId: `pay-n8ref-${SUFFIX}`,
    amount: 5000,
    currency: "RUB",
    status: "PARTIALLY_REFUNDED",
  });
  refundPaymentId = refundPayment.id;
  await db.orm.public.Refund.create({
    paymentId: refundPayment.id,
    amount: 5000,
    currency: "RUB",
    status: "SUCCEEDED",
    reason: "prior full refund",
  });

  // Fresh server signing key for the DRM route (revoke leftovers first, as in
  // drm-g6.test.ts); the private key feeds the env the route signs with.
  for (const status of ["ACTIVE", "PREVIOUS"] as const) {
    const stale = await db.orm.public.ServerSigningKey.where({ status }).all();
    for (const k of stale) {
      await db.orm.public.ServerSigningKey.where({ id: k.id }).update({ status: "REVOKED" });
    }
  }
  const serverKey = await createServerSigningKey();
  process.env.DRM_SERVER_PRIVATE_KEY = serverKey.privateKey;

  // Provider re-fetch default: succeeds for the exact final amount of the
  // paid fixture (50.00 RUB = 5000 kopecks).
  mockedGetPayment.mockResolvedValue({
    id: PROVIDER_PAYMENT_ID,
    status: "succeeded",
    paid: true,
    amount: { value: "50.00", currency: "RUB" },
    confirmation: { type: "redirect", confirmation_url: "https://yk.test" },
    created_at: new Date().toISOString(),
    description: "n8 test payment",
    metadata: { order_id: "" },
  } as any);
});

afterAll(async () => {
  if (!dbAvailable) return;
  setYookassaEnabled(false);
  fs.rmSync(path.join(UPLOAD_DIR, freeFileName), { force: true });
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("N-003: free purchase E2E flow", () => {
  it("free resource is visible in the public catalog", async () => {
    const res = await call("get", "/resources");
    expect(res.status).toBe(200);
    const listed = res.body.data.find((r: { slug: string }) => r.slug === freeSlug);
    expect(listed).toBeTruthy();
    expect(listed.price).toBe(0);
  });

  it("checkout completes instantly: 201 completed with a licenseId", async () => {
    const res = await call("post", "/purchases", buyerToken, { resourceSlug: freeSlug });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("completed");
    expect(res.body.purchaseId).toBeTruthy();
    expect(res.body.licenseId).toBeTruthy();
  });

  it("license is visible on the purchase detail", async () => {
    const purchase = await db.orm.public.Purchase
      .where({ buyerId: BUYER_ID, resourceId: freeResourceId })
      .first();
    expect(purchase!.status).toBe("COMPLETED");
    const res = await call("get", `/purchases/${purchase!.id}`, buyerToken);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
    expect(res.body.license).toBeTruthy();
    expect(res.body.license.id).toBeTruthy();
    expect(res.body.license.status).toBe("ACTIVE");
  });

  it("buyer downloads the artifact through the entitlement-checked route", async () => {
    const res = await app
      .get(`/resources/${freeSlug}/versions/${freeVersion}/download`)
      .set("Authorization", `Bearer ${buyerToken}`)
      .responseType("blob");
    expect(res.status).toBe(200);
    // res.download names the file `${slug}-${version}${ext}` (versions.ts)
    expect(res.headers["content-disposition"]).toContain(`${freeSlug}-${freeVersion}`);
    expect((res.body as Buffer).toString()).toBe(ARTIFACT_CONTENT);
  });

  it("free acquisition leaves zero Payment rows for the purchase (INV-002)", async () => {
    const purchase = await db.orm.public.Purchase
      .where({ buyerId: BUYER_ID, resourceId: freeResourceId })
      .first();
    const payments = await db.orm.public.Payment.where({ purchaseId: purchase!.id }).all();
    expect(payments.length).toBe(0);
  });
});

describe.skipIf(!dbAvailable)("N-006: authorization matrix", () => {
  it("anonymous requests are rejected as implemented (401 on auth walls)", async () => {
    // authenticate middleware -> 401 before any authorization decision.
    expect((await call("get", `/purchases/${otherCompletedPurchaseId}`)).status).toBe(401);
    expect((await call("patch", `/resources/${freeSlug}`, undefined, { title: "hax" })).status).toBe(401);
    expect(
      (await call("post", "/payments/refunds", undefined, { paymentId: refundPaymentId })).status
    ).toBe(401);
    expect(
      (await call("patch", `/admin/resources/${modResourceId}/status`, undefined, { status: "PUBLISHED" }))
        .status
    ).toBe(401);
  });

  it("non-owner cannot edit or submit another seller's resource (403)", async () => {
    const edit = await call("patch", `/resources/${freeSlug}`, otherToken, { title: "hacked" });
    expect(edit.status).toBe(403);
    const submit = await call("patch", `/resources/${freeSlug}`, otherToken, {
      status: "PENDING_REVIEW",
    });
    expect(submit.status).toBe(403);
    const after = await db.orm.public.Resource.where({ slug: freeSlug }).first();
    expect(after!.title).toBe("N8 Free Resource");
    expect(after!.status).toBe("PUBLISHED");
  });

  it("non-owner cannot fetch another user's purchase detail (403)", async () => {
    const res = await call("get", `/purchases/${otherCompletedPurchaseId}`, buyerToken);
    expect(res.status).toBe(403);
  });

  it("seller cannot publish own resource (403 via admin role check and seller transition)", async () => {
    const viaAdmin = await call("patch", `/admin/resources/${modResourceId}/status`, sellerToken, {
      status: "PUBLISHED",
    });
    expect(viaAdmin.status).toBe(403);
    const viaOwnRoute = await call("patch", `/resources/${modSlug}`, sellerToken, {
      status: "PUBLISHED",
    });
    expect(viaOwnRoute.status).toBe(403);
    const after = await db.orm.public.Resource.where({ id: modResourceId }).first();
    expect(after!.status).toBe("PENDING_REVIEW");
  });

  it("non-admin cannot call refunds or admin routes (403)", async () => {
    const refund = await call("post", "/payments/refunds", otherToken, {
      paymentId: refundPaymentId,
      amount: 1,
    });
    expect(refund.status).toBe(403);
    const list = await call("get", "/admin/resources", otherToken);
    expect(list.status).toBe(403);
    const publish = await call("patch", `/admin/resources/${modResourceId}/status`, otherToken, {
      status: "PUBLISHED",
    });
    expect(publish.status).toBe(403);
  });

  it("moderator CAN publish a submitted resource (PENDING_REVIEW -> PUBLISHED)", async () => {
    const res = await call("patch", `/admin/resources/${modResourceId}/status`, modToken, {
      status: "PUBLISHED",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("PUBLISHED");
    const after = await db.orm.public.Resource.where({ id: modResourceId }).first();
    expect(after!.status).toBe("PUBLISHED");
  });
});

describe.skipIf(!dbAvailable)("N-007: DRM security additions", () => {
  it("rejects activation with a malformed nonce (400)", async () => {
    const installationId = await createVerifiedInstallation(licenseId, buyerToken);
    const res = await app.post("/drm/v2/activate").send({
      licenseId,
      installationId,
      nonce: "xyz-not-64-hex",
    });
    expect(res.status).toBe(400);
    expect(res.body?.error?.code).toBe("INVALID_NONCE");
  });

  it("refuses new leases for a YANKED version (403 INSUFFICIENT_CAPABILITIES)", async () => {
    const installationId = await createVerifiedInstallation(yankedLicenseId, buyerToken);
    const res = await app.post("/drm/v2/activate").send({
      licenseId: yankedLicenseId,
      installationId,
      nonce: generateNonce(),
    });
    expect(res.status).toBe(403);
    // Actual wire code (drmErrorStatus mapping): DRM_-prefixed error code.
    expect(res.body?.error?.code).toBe("DRM_INSUFFICIENT_CAPABILITIES");
  });

  it("reports a stored lease expired beyond the clock-skew window (unit)", async () => {
    const keys = await getTrustedServerKeys();
    const active = keys.find((k) => k.status === "ACTIVE");
    expect(active).toBeTruthy();
    const lease: LeasePayload = {
      protocolVersion: 2,
      licenseId,
      installationId: "inst-n7-expired",
      resourceId: drmResourceId,
      resourceVersionId: drmVersionId,
      artifactHash: "b".repeat(64),
      issuedAt: new Date(Date.now() - 3600_000).toISOString(),
      // well past the 90s skew window
      expiresAt: new Date(Date.now() - (CLOCK_SKEW_SECONDS + 600) * 1000).toISOString(),
      nonce: generateNonce(),
      serverKeyId: active!.keyId,
      capabilities: ["run"],
    };
    const signature = signLease(lease, process.env.DRM_SERVER_PRIVATE_KEY!);
    const result = verifyLeaseSignature(
      { ...lease, signature } as Parameters<typeof verifyLeaseSignature>[0],
      active!.publicKey
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("Lease expired");
  });

  it("rejects a lease signed by an untrusted/unknown server key (unit)", async () => {
    const keys = await getTrustedServerKeys();
    expect(keys.length).toBeGreaterThan(0);
    const foreign = generateInstallationKeypair();
    const lease: LeasePayload = {
      protocolVersion: 2,
      licenseId,
      installationId: "inst-n7-foreign",
      resourceId: drmResourceId,
      resourceVersionId: drmVersionId,
      artifactHash: "b".repeat(64),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      nonce: generateNonce(),
      serverKeyId: "revoked-or-unknown-key-id",
      capabilities: ["run"],
    };
    const signature = signLease(lease, foreign.privateKey);
    // Verification against every trusted key must fail: the lease was signed
    // by a key that never was (or no longer is) a trusted server key.
    for (const key of keys) {
      const result = verifyLeaseSignature(
        { ...lease, signature } as Parameters<typeof verifyLeaseSignature>[0],
        key.publicKey
      );
      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain("Invalid lease signature");
    }
    const endpoint = await app.get("/drm/v2/public-keys");
    expect(endpoint.status).toBe(200);
    expect(
      endpoint.body.keys.some((k: { keyId: string }) => k.keyId === lease.serverKeyId)
    ).toBe(false);
  });

  it("heartbeat for a nonexistent installation is 404", async () => {
    const res = await app.post("/drm/v2/heartbeat").send({
      installationId: crypto.randomUUID(),
      resourceId: drmResourceId,
      uptime: 12,
    });
    expect(res.status).toBe(404);
    expect(res.body?.error?.code).toBe("DRM_INSTALLATION_NOT_FOUND");
  });
});

describe.skipIf(!dbAvailable)("N-005: payment abuse resistance", () => {
  it("out-of-order webhooks: canceled closes the pending purchase (GAP-1), late succeeded repairs and completes", async () => {
    setYookassaEnabled(true);
    try {
      const checkout = await call("post", "/purchases", buyerToken, { resourceSlug: paidSlug });
      expect(checkout.status).toBe(201);
      expect(checkout.body.status).toBe("pending");
      const purchaseId = checkout.body.purchaseId as string;

      // 1. payment.canceled arrives first: acknowledged, and the purchase
      //    must NOT hang as PENDING forever (PLAN-004 GAP-1 — the old
      //    behavior leaked stale PENDING rows; FAILED is the terminal
      //    no-entitlement state).
      const canceled = await postWebhook({
        type: "notification",
        event: "payment.canceled",
        object: {
          id: PROVIDER_PAYMENT_ID,
          status: "canceled",
          paid: false,
          amount: { value: "50.00", currency: "RUB" },
          metadata: { order_id: purchaseId },
        },
      });
      expect(canceled.status).toBe(200);
      let row = await db.orm.public.Purchase.where({ id: purchaseId }).first();
      expect(row!.status).toBe("FAILED");
      expect(await db.orm.public.License.where({ purchaseId }).first()).toBeNull();

      // 2. the late payment.succeeded delivery completes the purchase
      //    (provider truth wins: money was actually captured).
      const succeeded = await postWebhook({
        type: "notification",
        event: "payment.succeeded",
        object: {
          id: PROVIDER_PAYMENT_ID,
          status: "succeeded",
          paid: true,
          amount: { value: "50.00", currency: "RUB" },
          metadata: { order_id: purchaseId },
        },
      });
      expect(succeeded.status).toBe(200);
      row = await db.orm.public.Purchase.where({ id: purchaseId }).first();
      expect(row!.status).toBe("COMPLETED");
      const license = await db.orm.public.License.where({ purchaseId }).first();
      expect(license).toBeTruthy();
    } finally {
      setYookassaEnabled(false);
    }
  });

  it("refund after a full refund is capped by INV-013 (409 refund_exceeds_captured)", async () => {
    const res = await call("post", "/payments/refunds", adminToken, {
      paymentId: refundPaymentId,
      amount: 5000,
      reason: "second full refund attempt",
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("refund_exceeds_captured");
  });

  it("late/duplicate simulate on an already-completed purchase is a client error, not a 500", async () => {
    const res = await call("post", `/payments/${otherCompletedPurchaseId}/simulate`, otherToken, {});
    expect(res.status).toBeLessThan(500);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Purchase is not pending");
  });
});
