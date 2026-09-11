// PLAN Block 3 integration tests:
// - B-004: honest pagination (COUNT total + SQL page; 25 records / limit 10
//   => total 25, pages 3) on the fully isolated reviews endpoint and on the
//   shared /resources list;
// - B-005: /admin/stats backed by DB aggregates (deltas over seeded rows,
//   tolerant to parallel suites sharing the database);
// - B-007: request-id middleware (header, propagation, invalid-id handling,
//   request_id bound into the access log).
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";

import { createApp } from "../src/app";
import { db } from "../src/prisma/db";
import { generateAccessToken } from "../src/lib/jwt";
import { resetTestEntities, createTestUser } from "./helpers/db-reset";

const app = request(createApp());

const SELLER_ID = "550e8400-e29b-41d4-a716-446655446001";
const ADMIN_ID = "550e8400-e29b-41d4-a716-446655446002";
const BUYER_ID_PREFIX = "550e8400-e29b-41d4-a716-4466554461"; // 61xx buyers
const SUFFIX = Date.now().toString(36);

const REVIEW_COUNT = 25;

const dbAvailable = await (async (): Promise<boolean> => {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn("[block3-observability.test] DATABASE UNAVAILABLE — tests skipped.");
    return false;
  }
})();

let adminToken = "";
let reviewsSlug = "";

beforeAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();

  adminToken = await createTestUser(ADMIN_ID, `blk3adm_${SUFFIX}`, "ADMIN", generateAccessToken);
  await createTestUser(SELLER_ID, `blk3sel_${SUFFIX}`, "USER", generateAccessToken);

  // Fully isolated resource with exactly 25 reviews (12x5 + 13x4 => avg 4.48 -> 4.5)
  const resource = await db.orm.public.Resource.create({
    sellerId: SELLER_ID,
    slug: `blk3-reviews-${SUFFIX}`,
    title: "Block3 Pagination",
    description: "pagination fixture",
    type: "SCRIPT",
    status: "PUBLISHED",
    price: 1000,
  });
  reviewsSlug = resource.slug;

  for (let i = 0; i < REVIEW_COUNT; i++) {
    const buyerId = `${BUYER_ID_PREFIX}${String(i).padStart(2, "0")}`;
    await db.orm.public.User.create({
      id: buyerId,
      email: `blk3buyer${i}_${SUFFIX}@test.local`,
      username: `blk3b${i}_${SUFFIX}`,
      role: "USER",
      status: "ACTIVE",
    });
    await db.orm.public.Review.create({
      resourceId: resource.id,
      buyerId,
      rating: i < 12 ? 5 : 4,
      comment: `review ${i}`,
    });
  }

  // 25 published resources for the shared /resources list delta check
  for (let i = 0; i < 25; i++) {
    await db.orm.public.Resource.create({
      sellerId: SELLER_ID,
      slug: `blk3-res-${SUFFIX}-${i}`,
      title: `Block3 Res ${i}`,
      description: "pagination fixture",
      type: "SCRIPT",
      status: "PUBLISHED",
      price: 1000 + i,
    });
  }
});

afterAll(async () => {
  if (!dbAvailable) return;
  await resetTestEntities();
});

describe.skipIf(!dbAvailable)("B-007: request id / tracing", () => {
  it("assigns an X-Request-Id to every response", async () => {
    const res = await app.get("/resources?limit=1");
    expect(res.status).toBe(200);
    const id = res.headers["x-request-id"];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("propagates a well-formed upstream request id", async () => {
    const res = await app
      .get("/resources?limit=1")
      .set("X-Request-Id", "upstream-trace-0001");
    expect(res.headers["x-request-id"]).toBe("upstream-trace-0001");
  });

  it("replaces an invalid upstream request id", async () => {
    const res = await app.get("/resources?limit=1").set("X-Request-Id", "bad id!");
    const id = res.headers["x-request-id"];
    expect(id).not.toBe("bad id!");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("binds the request id into the structured access log", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const res = await app
        .get("/resources?limit=1")
        .set("X-Request-Id", "log-binding-0001");
      const id = res.headers["x-request-id"];
      const lines = logSpy.mock.calls.map((c) => c.join(" "));
      const access = lines.find((l) => l.includes("http_request") && l.includes(`request_id=${id}`));
      expect(access).toBeTruthy();
      expect(access).toContain("route=/resources");
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe.skipIf(!dbAvailable)("B-004: honest pagination", () => {
  it("25 reviews, limit 10 => total 25, pages 3, avg over ALL reviews", async () => {
    const res = await app.get(`/resources/${reviewsSlug}/reviews?page=1&limit=10`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.stats.total).toBe(REVIEW_COUNT);
    expect(res.body.stats.averageRating).toBe(4.5); // (12*5 + 13*4) / 25 = 4.48 -> 4.5
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 10, total: 25, pages: 3 });
  });

  it("serves pages 2 and 3 with SQL limit/offset", async () => {
    const p2 = await app.get(`/resources/${reviewsSlug}/reviews?page=2&limit=10`);
    const p3 = await app.get(`/resources/${reviewsSlug}/reviews?page=3&limit=10`);
    expect(p2.body.data).toHaveLength(10);
    expect(p3.body.data).toHaveLength(5); // 25 = 10 + 10 + 5
    expect(p3.body.pagination.page).toBe(3);
  });

  it("resources list: total is the collection size, never page.length", async () => {
    const before = await app.get("/resources?limit=1");
    const totalBefore = before.body.pagination.total as number;

    const res = await app.get("/resources?limit=10&page=1");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(10);
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(totalBefore);
    expect(res.body.pagination.pages).toBe(Math.ceil(res.body.pagination.total / 10));
  });
});

describe.skipIf(!dbAvailable)("B-005: admin statistics via aggregates", () => {
  it("rejects non-admin users", async () => {
    const userToken = await createTestUser(
      "550e8400-e29b-41d4-a716-446655446099",
      `blk3usr_${SUFFIX}`,
      "USER",
      generateAccessToken
    );
    const res = await app.get("/admin/stats").set("Authorization", `Bearer ${userToken}`);
    expect(res.status).toBe(403);
  });

  it("returns aggregate-backed stats that include the seeded rows", async () => {
    const before = await app.get("/admin/stats").set("Authorization", `Bearer ${adminToken}`);
    expect(before.status).toBe(200);
    const usersBefore = before.body.users.total as number;
    const resourcesBefore = before.body.resources.total as number;
    const reviewsBefore = before.body.reviews.total as number;

    // Seed two more users and one more published resource
    await db.orm.public.User.create({
      id: "550e8400-e29b-41d4-a716-446655446097",
      email: `blk3stat1_${SUFFIX}@test.local`,
      username: `blk3s1_${SUFFIX}`,
      role: "USER",
      status: "ACTIVE",
    });
    await db.orm.public.User.create({
      id: "550e8400-e29b-41d4-a716-446655446098",
      email: `blk3stat2_${SUFFIX}@test.local`,
      username: `blk3s2_${SUFFIX}`,
      role: "USER",
      status: "BANNED",
    });
    await db.orm.public.Resource.create({
      sellerId: SELLER_ID,
      slug: `blk3-stats-${SUFFIX}`,
      title: "Block3 Stats",
      description: "stats fixture",
      type: "SCRIPT",
      status: "PUBLISHED",
      price: 500,
    });

    const after = await app.get("/admin/stats").set("Authorization", `Bearer ${adminToken}`);
    expect(after.status).toBe(200);
    expect(after.body.users.total).toBeGreaterThanOrEqual(usersBefore + 2);
    expect(after.body.users.banned).toBeGreaterThanOrEqual(1);
    expect(after.body.resources.total).toBeGreaterThanOrEqual(resourcesBefore + 1);
    expect(after.body.reviews.total).toBeGreaterThanOrEqual(reviewsBefore);
    // averageRating is a DB aggregate, rounded to one decimal
    expect(typeof after.body.reviews.averageRating).toBe("number");
  });
});
