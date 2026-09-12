// PLAN-017 §31: canonical E2E fixture API. All specs import from this module
// instead of re-implementing registration/login/artifact/cleanup plumbing.
// The raw building blocks (psql, artifact builders, UI flows) stay in
// ./helpers and are re-exported here so specs have a single import surface.
import { APIRequestContext, expect } from "@playwright/test";
import {
  API,
  RUN,
  ADMIN_EMAIL,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  psql,
  buildZip,
  makeArtifact,
  makeMediaPng,
  apiLogin,
  uiRegister,
  uiLogin,
} from "./helpers";

export {
  API,
  RUN,
  ADMIN_EMAIL,
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  psql,
  buildZip,
  makeArtifact,
  makeMediaPng,
  apiLogin,
  uiRegister,
  uiLogin,
};

export { cleanupEntities, type CleanupSpec } from "./cleanup";

export interface ApiRegistration {
  token: string;
  user: { id: string; username: string; role: string; balance?: { available: number } };
}

/**
 * Register through the API (username gets a unique-per-run `@e2e.local`
 * email); asserts 201 and returns the session.
 */
export async function apiRegister(
  request: APIRequestContext,
  username: string,
  opts: { password?: string } = {}
): Promise<ApiRegistration> {
  const password = opts.password ?? "e2e-user-password-123";
  const res = await request.post(`${API}/auth/register`, {
    data: { username, email: `${username}@e2e.local`, password },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as ApiRegistration;
}

/** Bearer token of the fixed e2e-admin account (created before the run). */
export async function adminApi(request: APIRequestContext): Promise<string> {
  return apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * Upgrade a freshly registered user to an approved seller through the API:
 * POST /seller/apply, then the admin approves the profile. Use this when a
 * spec needs an APPROVED seller without driving the admin-panel UI.
 */
export async function sellerSetup(
  request: APIRequestContext,
  username: string,
  opts: { password?: string; displayName?: string; adminToken?: string } = {}
): Promise<ApiRegistration> {
  const session = await apiRegister(request, username, opts);
  const adminToken = opts.adminToken ?? (await adminApi(request));
  const apply = await request.post(`${API}/seller/apply`, {
    headers: { Authorization: `Bearer ${session.token}` },
    data: { displayName: opts.displayName ?? "E2E Seller Studio" },
  });
  expect(apply.status()).toBe(201);
  const approve = await request.post(`${API}/seller/${session.user.id}/approve`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  expect(approve.status()).toBe(200);
  return session;
}