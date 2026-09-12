// Shared register → seller → resource → publish → buy → download step
// helpers for the integration purchase journeys. Extracted from the inline
// implementation in commerce/purchase-journey.test.ts (PLAN-001 full cycle)
// and reused by commerce/free-flow-authz.test.ts (free-flow checkout +
// entitlement download). Each helper performs the same request the suites
// used to inline and asserts exactly the same intermediate statuses — the
// callers keep their business assertions, so assertion counts are unchanged.
import fs from "fs";
import path from "path";
import { expect } from "vitest";
import request from "supertest";
import { UPLOAD_DIR } from "@server/lib/upload";
import { buildZip } from "@tests/tools/helpers/zip";

/** Minimal structural type for the supertest app (`request(createApp())`). */
export interface TestApp {
  get(url: string): any;
  post(url: string): any;
  patch(url: string): any;
  delete(url: string): any;
}

export interface ApiSession {
  token: string;
  user: { id: string; username: string; role: string; balance?: { available: number } };
}

/**
 * Register through the real API and assert 201. Mirrors the journey suite's
 * `register()` helper: `{ username, email, password }`, no confirmPassword.
 */
export async function apiRegister(
  app: TestApp,
  username: string,
  opts: { password?: string; emailDomain?: string } = {}
): Promise<ApiSession> {
  const password = opts.password ?? "plan001-password";
  const emailDomain = opts.emailDomain ?? "plan001.local";
  const res = await app
    .post("/auth/register")
    .send({ username, email: `${username}@${emailDomain}`, password });
  expect(res.status).toBe(201);
  return { token: res.body.accessToken, user: res.body.user };
}

/**
 * Seller onboarding: apply (seller) + admin approve. Asserts the approve
 * round-trip (200); the apply call is asserted by apply-route suites.
 */
export async function sellerOnboard(
  app: TestApp,
  sellerToken: string,
  sellerUserId: string,
  adminToken: string,
  displayName = "Journey Seller"
): Promise<void> {
  await app
    .post("/seller/apply")
    .set("Authorization", `Bearer ${sellerToken}`)
    .send({ displayName });
  const approve = await app
    .post(`/seller/${sellerUserId}/approve`)
    .set("Authorization", `Bearer ${adminToken}`);
  expect(approve.status).toBe(200);
}

/** Create a draft resource; asserts 201. */
export async function createDraftResource(
  app: TestApp,
  token: string,
  spec: {
    slug: string;
    title: string;
    description: string;
    type?: string;
    price: number;
  }
): Promise<void> {
  const created = await app
    .post("/resources")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "SCRIPT", ...spec });
  expect(created.status).toBe(201);
}

export interface ArtifactVersionSpec {
  version: string;
  changelog: string;
  /** Marker embedded in the archive's meta/main.lua. */
  marker: string;
  /** File name for the upload (defaults to `<slug>.zip`). */
  fileName?: string;
  /** Version metadata overrides; defaults to the upload response values. */
  fileSize?: number;
  checksum?: string;
  /** Assert `signed === true` on the created version (real signing pipeline). */
  expectSigned?: boolean;
}

/**
 * Real artifact pipeline step: build a valid ZIP, upload it through the
 * multipart route, and attach a signed version. Asserts 201 for both calls
 * (plus the optional signed check) and returns the version metadata.
 */
export async function uploadArtifactVersion(
  app: TestApp,
  token: string,
  slug: string,
  spec: ArtifactVersionSpec
): Promise<{ fileUrl: string; fileSize: number; fileChecksum: string }> {
  const artifact = buildZip([{ path: "meta/main.lua", content: `return '${spec.marker}'` }]);
  const fileName = spec.fileName ?? `${slug}.zip`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), artifact);
  const uploaded = await app
    .post("/upload/resource")
    .set("Authorization", `Bearer ${token}`)
    .attach("file", path.join(UPLOAD_DIR, fileName));
  expect(uploaded.status).toBe(201);

  const version = await app
    .post(`/resources/${slug}/versions`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      version: spec.version,
      changelog: spec.changelog,
      fileUrl: uploaded.body.fileUrl,
      fileSize: spec.fileSize ?? uploaded.body.fileSize,
      fileChecksum: spec.checksum ?? uploaded.body.fileChecksum,
    });
  expect(version.status).toBe(201);
  if (spec.expectSigned) {
    expect(version.body.signed).toBe(true);
  }
  return {
    fileUrl: uploaded.body.fileUrl,
    fileSize: uploaded.body.fileSize,
    fileChecksum: uploaded.body.fileChecksum,
  };
}

/** Move a draft into the moderation queue; asserts 200. */
export async function submitForReview(app: TestApp, token: string, slug: string): Promise<void> {
  const submit = await app
    .patch(`/resources/${slug}`)
    .set("Authorization", `Bearer ${token}`)
    .send({ status: "PENDING_REVIEW" });
  expect(submit.status).toBe(200);
}

/** Admin publishes a resource row; asserts 200. */
export async function adminPublish(
  app: TestApp,
  adminToken: string,
  resourceId: string,
  reason?: string
): Promise<void> {
  const approveRes = await app
    .patch(`/admin/resources/${resourceId}/status`)
    .set("Authorization", `Bearer ${adminToken}`)
    .send({ status: "PUBLISHED", ...(reason !== undefined ? { reason } : {}) });
  expect(approveRes.status).toBe(200);
}

/** Checkout a resource; asserts 201 and returns the response body. */
export async function checkoutResource(
  app: TestApp,
  token: string,
  slug: string,
  opts: { discountCode?: string } = {}
): Promise<{
  purchaseId: string;
  status: string;
  licenseId?: string;
  amount?: number;
  [k: string]: unknown;
}> {
  const res = await app
    .post("/purchases")
    .set("Authorization", `Bearer ${token}`)
    .send({ resourceSlug: slug, ...(opts.discountCode !== undefined ? { discountCode: opts.discountCode } : {}) });
  expect(res.status).toBe(201);
  return res.body;
}

/** Dev-complete a pending purchase through the simulate route; asserts 200. */
export async function simulatePayment(
  app: TestApp,
  token: string,
  purchaseId: string
): Promise<{ licenseId?: string; [k: string]: unknown }> {
  const res = await app
    .post(`/payments/${purchaseId}/simulate`)
    .set("Authorization", `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body;
}

/**
 * Entitlement-checked artifact download. Returns the raw supertest response
 * (blob body + headers) so callers keep their own download assertions.
 */
export async function downloadVersion(
  app: TestApp,
  token: string,
  slug: string,
  version: string
): Promise<request.Response> {
  return app
    .get(`/resources/${slug}/versions/${version}/download`)
    .set("Authorization", `Bearer ${token}`)
    .responseType("blob");
}