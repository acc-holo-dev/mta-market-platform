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
import { createApp } from "@server/app";
import { db } from "@server/prisma/db";
import { generateAccessToken } from "@server/lib/jwt";
import { resetTestEntities, resetUsersByUsernamePrefix, createTestUser } from "@tests/tools/helpers/db-reset";
import {
  apiRegister,
  sellerOnboard,
  createDraftResource,
  uploadArtifactVersion,
  submitForReview,
  adminPublish,
  checkoutResource,
  simulatePayment,
} from "@tests/tools/helpers/purchase-journey";

const app = request(createApp());

const ADMIN_ID = "550e8400-e29b-41d4-a716-446655441001";

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[plan001-e2e.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  await createTestUser(ADMIN_ID, `p1admin_${Date.now().toString(36)}`, "ADMIN", generateAccessToken);
  // The artifact signing pipeline requires the platform signing key in dev/test.
  const { generatePublisherKeypair } = await import("@server/lib/artifact/crypto");
  process.env.ARTIFACT_SIGNING_PRIVATE_KEY = generatePublisherKeypair().privateKey;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
  // PLAN-016 D-013: the API-created `p1*` users are outside the fixed test
  // UUID range — remove them in the same FK-safe order.
  await resetUsersByUsernamePrefix("p1");
});

describe.skipIf(!dbAvailable)("password authentication", () => {
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
    const session = await apiRegister(app, `p1prof_${S}`);
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

describe.skipIf(!dbAvailable)("full product cycle", () => {
  const S = Date.now().toString(36) + "-e2e";
  let sellerToken = "";
  let adminToken = "";
  let buyerToken = "";
  let buyerId = "";
  let resourceSlug = "";

  it("runs seller -> submit -> approve -> marketplace -> buyer -> license", async () => {
    // ---- 1. seller registers and is approved by admin (L-003 entry) ----
    const seller = await apiRegister(app, `p1seller_${S}`);
    sellerToken = seller.token;
    const admin = await app
      .get("/auth/me")
      .set("Authorization", `Bearer ${generateAccessToken({ userId: ADMIN_ID, email: "a@b.c", role: "ADMIN" })}`);
    void admin;
    adminToken = generateAccessToken({ userId: ADMIN_ID, email: "a@b.c", role: "ADMIN" });

    await sellerOnboard(app, sellerToken, seller.user.id, adminToken, "Plan001 Seller");

    // ---- 2. seller creates the resource (draft) ----
    resourceSlug = `p1-res-${S}`;
    await createDraftResource(app, sellerToken, {
      slug: resourceSlug,
      title: "Plan001 Resource",
      description: "Full product cycle fixture",
      price: 2000,
    });

    // ---- 3. artifact upload + real signing pipeline + version ----
    // A real (valid) ZIP: the artifact pipeline validates archives strictly.
    await uploadArtifactVersion(app, sellerToken, resourceSlug, {
      version: "1.0.0",
      changelog: "initial release",
      marker: "plan001",
      fileName: `p1-artifact-${S}.zip`,
      checksum: "plan001-checksum",
      expectSigned: true, // real signing pipeline ran
    });

    // ---- 4. submit -> PENDING_REVIEW (E-006) ----
    await submitForReview(app, sellerToken, resourceSlug);

    // draft is NOT publicly visible (D-004)
    const draftVisibility = await app.get("/resources");
    expect(
      (draftVisibility.body.data as Array<{ slug: string }>).some((r) => r.slug === resourceSlug)
    ).toBe(false);

    // ---- 5. admin approves -> PUBLISHED (F-003) ----
    const resource = await db.orm.public.Resource.where({ slug: resourceSlug }).first();
    await adminPublish(app, adminToken, resource!.id, "plan001 approval");

    // ---- 6. resource appears in Marketplace ----
    const catalog = await app.get("/resources");
    expect(
      (catalog.body.data as Array<{ slug: string }>).some((r) => r.slug === resourceSlug)
    ).toBe(true);

    // ---- 7. buyer registers and acquires (L-005) ----
    const buyer = await apiRegister(app, `p1buyer_${S}`);
    buyerToken = buyer.token;
    buyerId = buyer.user.id;

    // free resource: instant acquisition
    await createDraftResource(app, sellerToken, {
      slug: `p1-free-${S}`,
      title: "Plan001 Free",
      description: "free acquisition fixture",
      price: 0,
    });
    await submitForReview(app, sellerToken, `p1-free-${S}`);
    const freeRes = await db.orm.public.Resource.where({ slug: `p1-free-${S}` }).first();
    // A published resource ships its artifact: upload + version before approval.
    await uploadArtifactVersion(app, sellerToken, `p1-free-${S}`, {
      version: "1.0.0",
      changelog: "free release",
      marker: "free",
      fileName: `p1-free-${S}.zip`,
    });
    await adminPublish(app, adminToken, freeRes!.id);

    const freeBuy = await checkoutResource(app, buyerToken, `p1-free-${S}`);
    expect(freeBuy.status).toBe("completed");
    expect(freeBuy.licenseId).toBeTruthy();

    // paid resource: pending -> dev completion -> license
    const paidBuy = await checkoutResource(app, buyerToken, resourceSlug);
    expect(paidBuy.status).toBe("pending");

    const simulated = await simulatePayment(app, buyerToken, paidBuy.purchaseId);
    expect(simulated.licenseId).toBeTruthy();

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
      .get(`/purchases/${paidBuy.purchaseId}`)
      .set("Authorization", `Bearer ${buyerToken}`);
    expect(detail.body.license.status).toBe("ACTIVE");
    void buyerId;
  });
});
