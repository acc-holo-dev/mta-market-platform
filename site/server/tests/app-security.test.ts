// TASK A-005 + A-003: production simulate-path and CORS topology tests.
// A-005: the /payments/:id/simulate endpoint must NOT exist in a
// production-like environment (404), and must exist in development.
// A-003: CORS must reflect an explicit origin allowlist with credentials.
import { describe, it, expect, afterAll, vi } from "vitest";
import request from "supertest";

const PROD_ENV = {
  NODE_ENV: "production",
  JWT_SECRET: "production_test_secret_min_32_chars_long_xxxx",
  DATABASE_URL: process.env.TEST_DATABASE_URL || "postgresql://postgres@127.0.0.1:5433/postgres?schema=public",
  CORS_ORIGINS: "https://market.example.com",
};

const savedEnv: Record<string, string | undefined> = {};

async function withProdEnv<T>(fn: (app: ReturnType<typeof request>) => Promise<T>): Promise<T> {
  for (const [k, v] of Object.entries(PROD_ENV)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    // Fresh module registry picks up the production env
    vi.resetModules();
    const { createApp } = await import("../src/app");
    return await fn(request(createApp()));
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  }
}

afterAll(() => {
  delete process.env.DRM_SERVER_PRIVATE_KEY;
});

describe("A-005: production simulate paths", () => {
  it("returns 404 for /payments/:id/simulate in a production-like environment", async () => {
    await withProdEnv(async (app) => {
      const res = await app
        .post("/payments/550e8400-e29b-41d4-a716-446655440099/simulate")
        .set("Authorization", "Bearer fake")
        .send();
      expect(res.status).toBe(404);
    });
  });

  it("keeps the simulate endpoint available outside production (dev/test tooling)", async () => {
    // Default vitest env: NODE_ENV=test -> route registered (auth still required)
    vi.resetModules();
    const { createApp } = await import("../src/app");
    const app = request(createApp());
    const res = await app
      .post("/payments/550e8400-e29b-41d4-a716-446655440099/simulate")
      .send();
    // Route exists (401 without token) — not 404
    expect(res.status).toBe(401);
  });
});

describe("A-010: webhook disabled when provider is not configured", () => {
  it("returns 503 for /payments/webhook when YOOKASSA_ENABLED=false (no unverified bypass)", async () => {
    vi.resetModules();
    process.env.YOOKASSA_ENABLED = "false";
    const { createApp } = await import("../src/app");
    const app = request(createApp());

    const res = await app.post("/payments/webhook").send({
      event: "payment.succeeded",
      object: { id: "x", metadata: { order_id: "y" } },
    });
    expect(res.status).toBe(503);
    delete process.env.YOOKASSA_ENABLED;
    vi.resetModules();
  });
});

describe("A-003: CORS origin model", () => {
  it("allows preflight from an allowlisted origin with credentials", async () => {
    vi.resetModules();
    process.env.CORS_ORIGINS = "http://localhost:3000";
    const { createApp } = await import("../src/app");
    const app = request(createApp());

    const res = await app
      .options("/auth/refresh")
      .set("Origin", "http://localhost:3000")
      .set("Access-Control-Request-Method", "POST");

    expect(res.status).toBeLessThan(400);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    delete process.env.CORS_ORIGINS;
    vi.resetModules();
  });

  it("does not reflect a non-allowlisted origin", async () => {
    vi.resetModules();
    process.env.CORS_ORIGINS = "http://localhost:3000";
    const { createApp } = await import("../src/app");
    const app = request(createApp());

    const res = await app
      .options("/auth/refresh")
      .set("Origin", "https://evil.example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    delete process.env.CORS_ORIGINS;
    vi.resetModules();
  });

  it("never answers with a wildcard origin when credentials are enabled", async () => {
    vi.resetModules();
    process.env.CORS_ORIGINS = "http://localhost:3000,https://market.example.com";
    const { createApp } = await import("../src/app");
    const app = request(createApp());

    const res = await app
      .options("/auth/refresh")
      .set("Origin", "https://market.example.com")
      .set("Access-Control-Request-Method", "POST");

    expect(res.headers["access-control-allow-origin"]).toBe("https://market.example.com");
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    delete process.env.CORS_ORIGINS;
    vi.resetModules();
  });
});