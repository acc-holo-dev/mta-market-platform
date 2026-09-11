// PLAN-001 L-001 + L-005: the main product E2E.
// Full cycle over real HTTP with real crypto, no mocks:
//   seller registers -> applies -> approved -> creates resource -> uploads
//   artifact (real signing pipeline) -> submits -> admin approves ->
//   resource appears in Marketplace -> buyer registers -> acquires (free +
//   paid) -> license -> entitlement visible.
// Plus L-001: password registration/login/logout semantics and C-002/C-003
// balance initialization.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs";
import path from "path";
import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";
import { buildZip } from "./helpers/zip";

const app = request(createApp());

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655441001";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan001-e2e.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

interface Session {
  token: string;
  user: { id: string; username: string; role: string; balance: { available: number } };
}

async function register(username: string): Promise<Session> {
  const res = await app
    .post("/auth/register")
    .send({ username, email: `${username}@plan001.local`, password: "plan001-password" });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, user: res.body.user };
}

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  await createTestUser(ADMIN_ID, `p1admin_${Date.now().toString(36)}`, "ADMIN", generateAccessToken);
  // The artifact signing pipeline requires the platform signing key in dev/test.
  const { generatePublisherKeypair } = await import("../src/lib/artifact/crypto");
  process.env.ARTIFACT_SIGNING_PRIVATE_KEY = generatePublisherKeypair().privateKey;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("L-001: password authentication", () => {
  const S = Date.now().toString(36);

  it("registers a user: session issued, role USER, balance persisted at 0 (C-002)", async () => {
    const res = await app
      .post("/auth/register")
      .send({
        username: `p1user_${S}`,
        email: `p1user_${S}@plan001.local`,
        password: "plan001-password",
        confirmPassword: "plan001-password",
      });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.role).toBe("USER");
    expect(res.body.user.balance.available).toBe(0);

    const me = await app
      .get("/auth/me")
      .set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.balance.available).toBe(0);
    expect(me.body.balance.currency).toBe("RUB");
  });

  it("rejects duplicate username and duplicate email (409)", async () => {
    await app.post("/auth/register").send({
      username: `p1dup_${S}`,
      email: `p1dup_${S}@plan001.local`,
      password: "plan001-password",
    });
    const dupName = await app.post("/auth/register").send({
      username: `p1dup_${S}`,
      email: `other_${S}@plan001.local`,
      password: "plan001-password",
    });
    expect(dupName.status).toBe(409);
    expect(dupName.body.error.code).toBe("USERNAME_TAKEN");

    const dupEmail = await app.post("/auth/register").send({
      username: `p1dup2_${S}`,
      email: `p1dup_${S}@plan001.local`,
      password: "plan001-password",
    });
    expect(dupEmail.status).toBe(409);
    expect(dupEmail.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("logs in via email AND via username; wrong password rejected uniformly", async () => {
    await app.post("/auth/register").send({
      username: `p1login_${S}`,
      email: `p1login_${S}@plan001.local`,
      password: "plan001-password",
    });
    const byEmail = await app
      .post("/auth/login")
      .send({ login: `p1login_${S}@plan001.local`, password: "plan001-password" });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.accessToken).toBeTruthy();

    const byUsername = await app
      .post("/auth/login")
      .send({ login: `p1login_${S}`, password: "plan001-password" });
    expect(byUsername.status).toBe(200);

    const bad = await app
      .post("/auth/login")
      .send({ login: `p1login_${S}`, password: "wrong-password" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("INVALID_CREDENTIALS");

    // OAuth-only user (no passwordHash): login rejected, no plaintext leak
    const oauthLike = await app
      .post("/auth/login")
      .send({ login: `nobody_${S}`, password: "whatever" });
    expect(oauthLike.status).toBe(401);
  });

  it("never stores the password in plaintext (bcrypt hash)", async () => {
    const username = `p1hash_${S}`;
    await app.post("/auth/register").send({
      username,
      email: `p1hash_${S}@plan001.local`,
      password: "plan001-password",
    });
    const user = await db.orm.public.User.where({ username }).first();
    expect(user?.passwordHash).toBeTruthy();
    expect(user!.passwordHash).not.toContain("plan001-password");
    expect(user!.passwordHash!.startsWith("$2")).toBe(true); // bcrypt
  });

  it("profile edit changes only allowed fields (B-002)", async () => {
    const session = await register(`p1prof_${S}`);
    const patch = await app
      .patch("/auth/me")
      .set("Authorization", `Bearer ${session.token}`)
      .send({ displayName: "Plan001 User", role: "ADMIN" });
    expect(patch.status).toBe(200);
    const me = await app
      .get("/auth/me")
      .set("Authorization", `Bearer ${session.token}`);
    expect(me.body.displayName).toBe("Plan001 User");
    expect(me.body.role).toBe("USER"); // role tampering ignored
  });
});

describe.skipIf(!dbAvailable)("L-005: full product cycle", () => {
  const S = Date.now().toString(36) + "-e2e";
  let sellerToken = "";
  let adminToken = "";
  let buyerToken = "";
  let buyerId = "";
  let resourceSlug = "";

  it("runs seller -> submit -> approve -> marketplace -> buyer -> license", async () => {
    // ---- 1. seller registers and is approved by admin (L-003 entry) ----
    const seller = await register(`p1seller_${S}`);
    sellerToken = seller.token;
    const admin = await app
      .get("/auth/me")
      .set("Authorization", `Bearer ${generateAccessToken({ userId: ADMIN_ID, email: "a@b.c", role: "ADMIN" })}`);
    void admin;
    adminToken = generateAccessToken({ userId: ADMIN_ID, email: "a@b.c", role: "ADMIN" });

    await app
      .post("/seller/apply")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ displayName: "Plan001 Seller" });
    const approve = await app
      .post(`/seller/${seller.user.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(approve.status).toBe(200);

    // ---- 2. seller creates the resource (draft) ----
    resourceSlug = `p1-res-${S}`;
    const created = await app
      .post("/resources")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        slug: resourceSlug,
        title: "Plan001 Resource",
        description: "Full product cycle fixture",
        type: "SCRIPT",
        price: 2000,
      });
    console.error("DBG create", created.status, JSON.stringify(created.body).slice(0,150));
    expect(created.status).toBe(201);

    // ---- 3. artifact upload + real signing pipeline + version ----
    // A real (valid) ZIP: the artifact pipeline validates archives strictly.
    const artifact = buildZip([{ path: "meta/main.lua", content: "return 'plan001'" }]);
    const fileName = `p1-artifact-${S}.zip`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), artifact);
    const uploaded = await app
      .post("/upload/resource")
      .set("Authorization", `Bearer ${sellerToken}`)
      .attach("file", path.join(UPLOAD_DIR, fileName));
    console.error("DBG upload", uploaded.status, JSON.stringify(uploaded.body).slice(0, 200));
    expect(uploaded.status).toBe(201);
    const fileUrl: string = uploaded.body.fileUrl;

    const version = await app
      .post(`/resources/${resourceSlug}/versions`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        version: "1.0.0",
        changelog: "initial release",
        fileUrl,
        fileSize: artifact.length,
        fileChecksum: "plan001-checksum",
      });
    console.error("DBG version", version.status, JSON.stringify(version.body).slice(0,200));
    expect(version.status).toBe(201);
    expect(version.body.signed).toBe(true); // real signing pipeline ran

    // ---- 4. submit -> PENDING_REVIEW (E-006) ----
    const submit = await app
      .patch(`/resources/${resourceSlug}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "PENDING_REVIEW" });
    console.error("DBG submit", submit.status, JSON.stringify(submit.body).slice(0,150));
    expect(submit.status).toBe(200);

    // draft is NOT publicly visible (D-004)
    const draftVisibility = await app.get("/resources");
    expect(
      (draftVisibility.body.data as Array<{ slug: string }>).some((r) => r.slug === resourceSlug)
    ).toBe(false);

    // ---- 5. admin approves -> PUBLISHED (F-003) ----
    const resource = await db.orm.public.Resource.where({ slug: resourceSlug }).first();
    const approveRes = await app
      .patch(`/admin/resources/${resource!.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PUBLISHED", reason: "plan001 approval" });
    console.error("DBG approve", approveRes.status, JSON.stringify(approveRes.body).slice(0,150));
    expect(approveRes.status).toBe(200);

    // ---- 6. resource appears in Marketplace ----
    const catalog = await app.get("/resources");
    expect(
      (catalog.body.data as Array<{ slug: string }>).some((r) => r.slug === resourceSlug)
    ).toBe(true);

    // ---- 7. buyer registers and acquires (L-005) ----
    const buyer = await register(`p1buyer_${S}`);
    buyerToken = buyer.token;
    buyerId = buyer.user.id;

    // free resource: instant acquisition
    const freeCreated = await app
      .post("/resources")
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        slug: `p1-free-${S}`,
        title: "Plan001 Free",
        description: "free acquisition fixture",
        type: "SCRIPT",
        price: 0,
      });
    expect(freeCreated.status).toBe(201);
    const freeSubmit = await app
      .patch(`/resources/p1-free-${S}`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({ status: "PENDING_REVIEW" });
    expect(freeSubmit.status).toBe(200);
    const freeRes = await db.orm.public.Resource.where({ slug: `p1-free-${S}` }).first();
    // A published resource ships its artifact: upload + version before approval.
    const freeArtifact = buildZip([{ path: "meta/main.lua", content: "return 'free'" }]);
    const freeFileName = `p1-free-${S}.zip`;
    fs.writeFileSync(path.join(UPLOAD_DIR, freeFileName), freeArtifact);
    const freeUpload = await app
      .post("/upload/resource")
      .set("Authorization", `Bearer ${sellerToken}`)
      .attach("file", path.join(UPLOAD_DIR, freeFileName));
    expect(freeUpload.status).toBe(201);
    const freeVersion = await app
      .post(`/resources/p1-free-${S}/versions`)
      .set("Authorization", `Bearer ${sellerToken}`)
      .send({
        version: "1.0.0",
        changelog: "free release",
        fileUrl: freeUpload.body.fileUrl,
        fileSize: freeUpload.body.fileSize,
        fileChecksum: freeUpload.body.fileChecksum,
      });
    expect(freeVersion.status).toBe(201);
    const freeApprove = await app
      .patch(`/admin/resources/${freeRes!.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "PUBLISHED" });
    expect(freeApprove.status).toBe(200);

    const freeBuy = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug: `p1-free-${S}` });
    console.error("DBG freeBuy", freeBuy.status, JSON.stringify(freeBuy.body).slice(0, 200));
    expect(freeBuy.status).toBe(201);
    expect(freeBuy.body.status).toBe("completed");
    expect(freeBuy.body.licenseId).toBeTruthy();

    // paid resource: pending -> dev completion -> license
    const paidBuy = await app
      .post("/purchases")
      .set("Authorization", `Bearer ${buyerToken}`)
      .send({ resourceSlug });
    expect(paidBuy.status).toBe(201);
    expect(paidBuy.body.status).toBe("pending");

    const simulated = await app
      .post(`/payments/${paidBuy.body.purchaseId}/simulate`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(simulated.status).toBe(200);
    expect(simulated.body.licenseId).toBeTruthy();

    // ---- 8. buyer sees purchases + entitlements (H-004) ----
    const myPurchases = await app
      .get("/purchases/my")
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(myPurchases.status).toBe(200);
    const slugs = (myPurchases.body as Array<{ resource: { slug: string } }>).map(
      (p) => p.resource?.slug
    );
    expect(slugs).toContain(resourceSlug);
    expect(slugs).toContain(`p1-free-${S}`);

    const detail = await app
      .get(`/purchases/${paidBuy.body.purchaseId}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(detail.body.license.status).toBe("ACTIVE");
    void buyerId;
  });
});
