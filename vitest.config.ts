import path from "node:path";
import { defineConfig } from "vitest/config";

// Centralized test runner for the platform (PLAN-010 Rule 002: the only
// test location is the root tests/ tree). Component sources are aliased so
// tests can import server internals without relative depth chains.
//
// Integration suites share one PostgreSQL: files must not run in parallel or
// they destroy each other's fixtures (resetTestEntities).
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public";

export default defineConfig({
  resolve: {
    alias: {
      "@server": path.resolve(__dirname, "site/server/src"),
      "@tests": path.resolve(__dirname, "tests"),
    },
  },
  test: {
    include: [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/concurrency/**/*.test.ts",
    ],
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: process.env.JWT_SECRET || "test_secret_min_32_chars_long_xxxxxxxxxxxx",
      JWT_ACCESS_EXPIRY: "15m",
      JWT_REFRESH_EXPIRY: "7d",
      NODE_ENV: "test",
      REDIS_URL: process.env.TEST_REDIS_URL || "redis://127.0.0.1:6379",
      // Fail fast when Redis is absent: the rate limiter fails open.
      REDIS_CONNECT_TIMEOUT: "300",
      REDIS_MAX_RETRIES_PER_REQUEST: "1",
      REDIS_ENABLE_OFFLINE_QUEUE: "false",
      EMAIL_ENABLED: "false",
      YOOKASSA_ENABLED: "false",
      S3_ENABLED: "false",
      FRONTEND_URL: "http://localhost:3000",
      CORS_ORIGINS: "http://localhost:3000",
      // Tests exercise the endpoints repeatedly; keep the limiter open.
      AUTH_RATE_LIMIT_MAX: "10000",
      STANDARD_RATE_LIMIT_MAX: "10000",
      STRICT_RATE_LIMIT_MAX: "10000",
    },
  },
});
