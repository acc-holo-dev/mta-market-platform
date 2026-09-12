// PLAN-017 §32: Playwright global teardown. Runs once after the whole E2E
// suite (workers: 1, serial specs) and sweeps whatever a crashed or skipped
// afterAll left behind, in the canonical FK-safe order:
//   usernames LIKE 'e2e_%' (literal underscore; e2e-admin is never touched)
//   resource slugs LIKE 'e2e-%' and server slugs LIKE 'e2e-%'.
// Servers run externally (no webServer in the config); the dev Postgres on
// :5432 must be reachable — a failed sweep is reported, not fatal.
import { cleanupEntities } from "./cleanup";

export default async function globalTeardown(): Promise<void> {
  await cleanupEntities({
    usernamePrefixes: ["e2e_"],
    resourceSlugPrefixes: ["e2e-"],
    serverSlugPrefixes: ["e2e-"],
  });
}