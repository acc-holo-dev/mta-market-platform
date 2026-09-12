// PLAN-001 browser E2E (Workstream L), centralized under tests/e2e (PLAN-010
// Rule 002): real Chromium against the real dev servers (Next.js web :3000 +
// Express API :3001 + Postgres/Redis in Docker). This is the acceptance test
// the plan requires: the product flow must pass in a browser, not only at the
// HTTP layer.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // PLAN-017 §32: FK-safe sweep of leftover e2e_* entities after the run
  // (crashed/skipped afterAll hygiene). Servers run externally: no webServer.
  globalTeardown: "./tests/tools/playwright/global-teardown.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
