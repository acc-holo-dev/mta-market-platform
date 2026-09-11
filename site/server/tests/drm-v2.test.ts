// TASK A-006: DRM v2 protocol integration test.
// Exercises the full server-side protocol over real HTTP:
// register (authenticated, ownership-checked) -> verify challenge ->
// activate (signed lease) -> heartbeat -> lease lookup, plus the
// security negatives (INV-007: license activation must prove ownership).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { createServerSigningKey } from "../src/lib/drm/service";
import { generateInstallationKeypair, signChallenge, generateNonce } from "../src/lib/drm/crypto";
import { generatePublisherKeypair } from "../src/lib/artifact/crypto";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());

const BUYER_ID = "550e8400-e29b-41d4-a716-446655440010";
const SELLER_ID = "550e8400-e29b-41d4-a716-446655440011";
const STRANGER_ID = "550e8400-e29b-41d4-a716-446655440012";
const SUFFIX = Date.now().toString(36);

let buyerToken = "";
let strangerToken = "";
let licenseId = "";
let serverPublicKey = "";

// Decided at file load time so describe.skipIf sees the real value.
const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn(
      "[drm-v2.test] DATABASE UNAVAILABLE — integration tests skipped. " +
        "Start a PostgreSQL with the contract schema applied (prisma db init)."
    );
    return false;
  }
})();

async function cleanup(): Promise<void> {
  await resetTestEntities();
}

beforeAll(async () => {
  if (!dbAvailable) return;

  await cleanup();

  buyerToken = await createTestUser(BUYER_ID, `buyer_${SUFFIX}`, "USER", generateAccessToken);
  await createTestUser(SELLER_ID, `seller_${SUFFIX}`, "USER", generateAccessToken);
  strangerToken = await createTestUser(STRANGER_ID, `stranger_${SUFFIX}`, "USER", generateAccessToken);

  // Seller -> resource -> version -> purchase -> license chain
  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `drm-test-${SUFFIX}`,
    title: "DRM Test Resource",
    description: "Integration test resource",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 10000,
  });

  const version = await db.orm.public.ResourceVersion.create({
    resourceId: resource.id,
    version: `1.0.0-${SUFFIX}`,
    fileUrl: "https://storage.test/artifact.zip",
    fileSize: 1024,
    fileChecksum: "deadbeef",
  });

  const purchase = await db.orm.public.Purchase.create({
    buyerId: BUYER_ID,
    resourceId: resource.id,
    versionId: version.id,
    status: "COMPLETED",
    priceSnapshot: 10000,
    finalPrice: 10000,
    platformFee: 1000,
    sellerRevenue: 9000,
    completedAt: new Date().toISOString(),
  });

  const license = await db.orm.public.License.create({
    purchaseId: purchase.id,
    versionId: version.id,
    status: "ACTIVE",
  });
  licenseId = license.id;

  // Publisher key + artifact signature for the version (required for leases)
  const { publicKey: publisherPub } = generatePublisherKeypair();
  const publisherKey = await db.orm.public.PublisherKey.create({
    sellerId: SELLER_ID,
    keyType: "ED25519",
    publicKey: publisherPub,
    algorithm: "EdDSA",
    status: "ACTIVE",
  });

  await db.orm.public.ArtifactSignature.create({
    versionId: version.id,
    keyId: publisherKey.id,
    signature: "c2lnbmF0dXJl",
    algorithm: "EdDSA",
    manifestHash: "a".repeat(64),
    artifactHash: "b".repeat(64),
    manifest: { formatVersion: 1, files: [] },
  });

  // Fresh server signing key (private key only known here, set as env)
  const existingKeys = await db.orm.public.ServerSigningKey.where({ status: "ACTIVE" }).all();
  for (const k of existingKeys) {
    await db.orm.public.ServerSigningKey.where({ id: k.id }).update({ status: "REVOKED" });
  }
  const serverKey = await createServerSigningKey();
  process.env.DRM_SERVER_PRIVATE_KEY = serverKey.privateKey;
  serverPublicKey = serverKey.publicKey;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await cleanup();
});

describe.skipIf(!dbAvailable)("DRM v2 protocol", () => {
  it("rejects unauthenticated installation registration", async () => {
    const res = await app.post("/drm/v2/installations").send({
      publicKey: "pk", licenseId, mtaVersion: "1.6", moduleVersion: "0.1.0",
    });
    expect(res.status).toBe(401);
  });

  it("rejects registration for a license the user does not own (INV-007)", async () => {
    const { publicKey } = generateInstallationKeypair();
    const res = await app
      .post("/drm/v2/installations")
      .set("Authorization", `Bearer ${strangerToken}`)
      .send({ publicKey, licenseId, mtaVersion: "1.6", moduleVersion: "0.1.0" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("DRM_LICENSE_NOT_OWNED");
  });

  it("registers an installation for the license owner and issues a challenge", async () => {
    const { publicKey } = generateInstallationKeypair();
    const res = await app
      .post("/drm/v2/installations")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ publicKey, licenseId, mtaVersion: "1.6", moduleVersion: "0.1.0" });
    expect(res.status).toBe(201);
    expect(res.body.installationId).toBeTruthy();
    expect(res.body.challenge).toBeTruthy();
  });

  it("completes the full cycle: verify challenge -> activate -> signed lease -> heartbeat -> lease lookup", async () => {
    // 1. Register
    const { publicKey, privateKey } = generateInstallationKeypair();
    const reg = await app
      .post("/drm/v2/installations")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ publicKey, licenseId, mtaVersion: "1.6", moduleVersion: "0.1.0" });
    expect(reg.status).toBe(201);
    const { installationId, challenge } = reg.body;

    // 2. Verify possession of the private key
    const signature = signChallenge(challenge, privateKey);
    const verify = await app
      .post(`/drm/v2/installations/${installationId}/verify`)
      .send({ challengeResponse: signature });
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);

    // 3. Activate: obtain a signed lease
    const nonce = generateNonce();
    const activate = await app.post("/drm/v2/activate").send({
      licenseId, installationId, nonce,
    });
    expect(activate.status).toBe(200);
    const lease = activate.body;
    expect(lease.protocolVersion).toBe(2);
    expect(lease.licenseId).toBe(licenseId);
    expect(lease.installationId).toBe(installationId);
    expect(lease.signature).toBeTruthy();
    expect(lease.expiresAt > lease.issuedAt).toBe(true);

    // 4. Lease is retrievable
    const lookup = await app.get(`/drm/v2/leases/${installationId}/${lease.resourceId}`);
    expect(lookup.status).toBe(200);
    expect(lookup.body.nonce).toBe(nonce);

    // 5. Heartbeat acknowledges and reports a valid lease
    const heartbeat = await app.post("/drm/v2/heartbeat").send({
      installationId, resourceId: lease.resourceId, uptime: 60,
    });
    expect(heartbeat.status).toBe(200);
    expect(heartbeat.body.acknowledged).toBe(true);
    expect(heartbeat.body.leaseValid).toBe(true);
  });

  it("rejects activation with a license different from the bound one (INV-011)", async () => {
    const { publicKey, privateKey } = generateInstallationKeypair();
    const reg = await app
      .post("/drm/v2/installations")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ publicKey, licenseId, mtaVersion: "1.6", moduleVersion: "0.1.0" });
    const { installationId, challenge } = reg.body;
    await app
      .post(`/drm/v2/installations/${installationId}/verify`)
      .send({ challengeResponse: signChallenge(challenge, privateKey) });

    const fakeLicenseId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const activate = await app.post("/drm/v2/activate").send({
      licenseId: fakeLicenseId, installationId, nonce: generateNonce(),
    });
    expect(activate.status).toBe(403);
    expect(activate.body.error.code).toBe("DRM_LICENSE_INSTALLATION_MISMATCH");
  });

  it("rejects nonce reuse (replay protection)", async () => {
    const { publicKey, privateKey } = generateInstallationKeypair();
    const reg = await app
      .post("/drm/v2/installations")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ publicKey, licenseId, mtaVersion: "1.6", moduleVersion: "0.1.0" });
    const { installationId, challenge } = reg.body;
    await app
      .post(`/drm/v2/installations/${installationId}/verify`)
      .send({ challengeResponse: signChallenge(challenge, privateKey) });

    const nonce = generateNonce();
    const first = await app.post("/drm/v2/activate").send({ licenseId, installationId, nonce });
    expect(first.status).toBe(200);

    const replay = await app.post("/drm/v2/activate").send({ licenseId, installationId, nonce });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe("DRM_NONCE_ALREADY_USED");
  });

  it("rejects activation for an unverified installation", async () => {
    const { publicKey } = generateInstallationKeypair();
    const reg = await app
      .post("/drm/v2/installations")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ publicKey, licenseId, mtaVersion: "1.6", moduleVersion: "0.1.0" });
    const { installationId } = reg.body;

    const activate = await app.post("/drm/v2/activate").send({
      licenseId, installationId, nonce: generateNonce(),
    });
    expect(activate.status).toBe(403);
    expect(activate.body.error.code).toBe("DRM_INSTALLATION_NOT_VERIFIED");
  });

  it("rejects a challenge signed with the wrong key", async () => {
    const { publicKey } = generateInstallationKeypair();
    const wrongKeypair = generateInstallationKeypair();
    const reg = await app
      .post("/drm/v2/installations")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ publicKey, licenseId, mtaVersion: "1.6", moduleVersion: "0.1.0" });
    const { installationId } = reg.body;

    const verify = await app
      .post(`/drm/v2/installations/${installationId}/verify`)
      .send({ challengeResponse: signChallenge(reg.body.challenge, wrongKeypair.privateKey) });
    expect(verify.status).toBe(401);
    expect(verify.body.error.code).toBe("DRM_INVALID_CHALLENGE_RESPONSE");
  });

  it("v1 activation protocol is blocked with 410 (A-007)", async () => {
    const res = await app.post("/drm/activate").send({ licenseKey: "x", serverSerial: "y" });
    expect(res.status).toBe(410);
    expect(res.body.status).toBe("deprecated");

    const verify = await app.post("/drm/verify").send({ publicKey: "x", privateKey: "y", serverSerial: "z" });
    expect(verify.status).toBe(410);
  });
});