// TASK A-012: Secret startup policy tests.
// 1. Unit: production validation fails on missing critical secrets.
// 2. Acceptance: a process started in production with a missing secret
//    exits non-zero (real child process, not a mock).
import { describe, it, expect, afterEach, vi } from "vitest";
import { spawnSync } from "child_process";
import path from "path";
import { createRequire } from "module";

// tsx CLI resolved through the server package's dependency graph — a
// hard-coded relative path breaks when pnpm hoisting shifts (PLAN-019 A).
// Resolution chain: package.json dir + dist/cli.mjs (verified on disk) →
// package entry when it already points at the CLI.
const serverRequire = createRequire(
  path.resolve(__dirname, "../../../site/server/package.json")
);
function resolveTsxCli(): string {
  try {
    const pkgJsonPath = serverRequire.resolve("tsx/package.json");
    const candidate = path.join(path.dirname(pkgJsonPath), "dist", "cli.mjs");
    if (require("fs").existsSync(candidate)) return candidate;
  } catch {
    // fall through to the entry-based resolution
  }
  const entry = serverRequire.resolve("tsx");
  if (entry.endsWith("cli.mjs") && require("fs").existsSync(entry)) return entry;
  throw new Error(`tsx CLI not resolvable (entry: ${entry})`);
}
const tsxCli = resolveTsxCli();

const savedEnv: Record<string, string | undefined> = {};

async function withEnv(
  env: Record<string, string | undefined>,
  fn: () => Promise<void> | void
): Promise<void> {
  for (const [k, v] of Object.entries(env)) {
    savedEnv[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// validateEnvironment caches NODE_ENV at module load (PRODUCTION const),
// so the production mode requires a fresh module import.
async function validateAsProduction(): Promise<ReturnType<typeof import("@server/lib/startupValidation")["validateEnvironment"]>> {
  vi.resetModules();
  const { validateEnvironment } = await import("@server/lib/startupValidation");
  return validateEnvironment();
}

afterEach(() => {
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
  vi.resetModules();
});

describe("A-012: production secret validation (unit)", () => {
  it("fails when JWT_SECRET is missing in production", async () => {
    await withEnv({ NODE_ENV: "production", JWT_SECRET: undefined }, async () => {
      const result = await validateAsProduction();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("JWT_SECRET"))).toBe(true);
    });
  });

  it("fails when JWT_SECRET is too weak (<32 chars)", async () => {
    await withEnv({ NODE_ENV: "production", JWT_SECRET: "short" }, async () => {
      const result = await validateAsProduction();
      expect(result.errors.some((e) => e.includes("too weak"))).toBe(true);
    });
  });

  it("fails when DRM_SERVER_PRIVATE_KEY is missing (A-012: DRM signing keys)", async () => {
    await withEnv({ NODE_ENV: "production", DRM_SERVER_PRIVATE_KEY: undefined }, async () => {
      const result = await validateAsProduction();
      expect(result.errors.some((e) => e.includes("DRM_SERVER_PRIVATE_KEY"))).toBe(true);
    });
  });

  it("fails when ARTIFACT_SIGNING_PRIVATE_KEY is missing (B-002 signing key)", async () => {
    await withEnv({ NODE_ENV: "production", ARTIFACT_SIGNING_PRIVATE_KEY: undefined }, async () => {
      const result = await validateAsProduction();
      expect(result.errors.some((e) => e.includes("ARTIFACT_SIGNING_PRIVATE_KEY"))).toBe(true);
    });
  });

  it("fails when DRM_MASTER_KEY is missing (PLAN-004 A-002: DEK envelope encryption)", async () => {
    await withEnv({ NODE_ENV: "production", DRM_MASTER_KEY: undefined }, async () => {
      const result = await validateAsProduction();
      expect(result.errors.some((e) => e.includes("DRM_MASTER_KEY"))).toBe(true);
    });
  });

  it("fails when DRM_MASTER_KEY is not 32 bytes of base64", async () => {
    await withEnv({ NODE_ENV: "production", DRM_MASTER_KEY: "dG9vLXNob3J0" }, async () => {
      const result = await validateAsProduction();
      expect(result.errors.some((e) => e.includes("DRM_MASTER_KEY must be base64"))).toBe(true);
    });
  });

  it("fails when S3 is disabled in production (local storage not secure)", async () => {
    await withEnv({ NODE_ENV: "production", S3_ENABLED: "false" }, async () => {
      const result = await validateAsProduction();
      expect(result.errors.some((e) => e.includes("S3_ENABLED must be true"))).toBe(true);
    });
  });

  it("passes with a complete production secret set", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        JWT_SECRET: "a".repeat(64),
        DATABASE_URL: "postgresql://test:test@localhost:5433/test",
        DISCORD_CLIENT_ID: "id",
        DISCORD_CLIENT_SECRET: "secret",
        DISCORD_REDIRECT_URI: "https://market.example.com/auth/callback",
        OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
        DRM_SERVER_PRIVATE_KEY: "k",
        DRM_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
        ARTIFACT_SIGNING_PRIVATE_KEY: "k",
        S3_ENABLED: "true",
        S3_BUCKET: "bucket",
        S3_ACCESS_KEY: "ak",
        S3_SECRET_KEY: "sk",
      },
      async () => {
        const result = await validateAsProduction();
        expect(result.valid).toBe(true);
      }
    );
  });

  // PLAN-016 A-009a: OAuth providers are configuration, not a feature.
  it("does NOT require any OAuth provider in production (provider without env is disabled)", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        JWT_SECRET: "a".repeat(64),
        DATABASE_URL: "postgresql://test:test@localhost:5433/test",
        DISCORD_CLIENT_ID: undefined,
        DISCORD_CLIENT_SECRET: undefined,
        DRM_SERVER_PRIVATE_KEY: "k",
        DRM_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
        ARTIFACT_SIGNING_PRIVATE_KEY: "k",
        S3_ENABLED: "true",
        S3_BUCKET: "bucket",
        S3_ACCESS_KEY: "ak",
        S3_SECRET_KEY: "sk",
      },
      async () => {
        const result = await validateAsProduction();
        // No OAuth configured → the encryption key is not required either.
        expect(result.errors).toHaveLength(0);
      }
    );
  });

  it("fails when an OAuth provider is configured without OAUTH_TOKEN_ENCRYPTION_KEY (PLAN-016 A-009)", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        JWT_SECRET: "a".repeat(64),
        DATABASE_URL: "postgresql://test:test@localhost:5433/test",
        DISCORD_CLIENT_ID: "id",
        DISCORD_CLIENT_SECRET: "secret",
        DRM_SERVER_PRIVATE_KEY: "k",
        DRM_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
        ARTIFACT_SIGNING_PRIVATE_KEY: "k",
        S3_ENABLED: "true",
        S3_BUCKET: "bucket",
        S3_ACCESS_KEY: "ak",
        S3_SECRET_KEY: "sk",
      },
      async () => {
        const result = await validateAsProduction();
        expect(result.valid).toBe(false);
        expect(
          result.errors.some((e) => e.includes("OAUTH_TOKEN_ENCRYPTION_KEY is required"))
        ).toBe(true);
      }
    );
  });

  it("fails when OAUTH_TOKEN_ENCRYPTION_KEY is not 32 bytes of base64", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        JWT_SECRET: "a".repeat(64),
        DATABASE_URL: "postgresql://test:test@localhost:5433/test",
        VK_CLIENT_ID: "id",
        VK_CLIENT_SECRET: "secret",
        OAUTH_TOKEN_ENCRYPTION_KEY: "dG9vLXNob3J0",
        DRM_SERVER_PRIVATE_KEY: "k",
        DRM_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
        ARTIFACT_SIGNING_PRIVATE_KEY: "k",
        S3_ENABLED: "true",
        S3_BUCKET: "bucket",
        S3_ACCESS_KEY: "ak",
        S3_SECRET_KEY: "sk",
      },
      async () => {
        const result = await validateAsProduction();
        expect(result.errors.some((e) => e.includes("OAUTH_TOKEN_ENCRYPTION_KEY must be base64"))).toBe(true);
      }
    );
  });

  it("fails when a payment provider is enabled but not configured (PLAN-016 P-003/P-004)", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        JWT_SECRET: "a".repeat(64),
        DATABASE_URL: "postgresql://test:test@localhost:5433/test",
        TBANK_ENABLED: "true",
        DRM_SERVER_PRIVATE_KEY: "k",
        DRM_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
        ARTIFACT_SIGNING_PRIVATE_KEY: "k",
        S3_ENABLED: "true",
        S3_BUCKET: "bucket",
        S3_ACCESS_KEY: "ak",
        S3_SECRET_KEY: "sk",
      },
      async () => {
        const result = await validateAsProduction();
        expect(result.errors.some((e) => e.includes("TBANK_TERMINAL_KEY"))).toBe(true);
      }
    );
  });
});

describe("A-012: acceptance — missing secret exits non-zero", () => {
  it(
    "server process with a missing production secret exits non-zero",
    () => {
      const serverDir = path.resolve(__dirname, "../../..", "site/server");
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_ENV: "production",
        PORT: "3999",
        DATABASE_URL: "postgresql://postgres@127.0.0.1:5433/postgres?schema=public",
        DISCORD_CLIENT_ID: "id",
        DISCORD_CLIENT_SECRET: "secret",
        DISCORD_REDIRECT_URI: "https://market.example.com/auth/callback",
        DRM_SERVER_PRIVATE_KEY: "k",
        DRM_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
        ARTIFACT_SIGNING_PRIVATE_KEY: "k",
        S3_ENABLED: "true",
        S3_BUCKET: "bucket",
        S3_ACCESS_KEY: "ak",
        S3_SECRET_KEY: "sk",
        // JWT_SECRET intentionally missing
      };
      // PLAN-004 A-002: an explicit empty value cannot be overridden by
      // dotenv (apps/server/.env carries a dev JWT_SECRET), so the child
      // deterministically fails validation instead of booting on the dev
      // secret. Previously deleting the var let dotenv fill it in, making
      // the acceptance racy (server started, timeout-SIGTERM exited 0).
      env.JWT_SECRET = "";

      const result = spawnSync(process.execPath, [tsxCli, "src/index.ts"], {
        cwd: serverDir,
        env,
        encoding: "utf-8",
        timeout: 60000,
      });

      expect(result.status).not.toBe(0);
      expect(`${result.stderr}`).toContain("JWT_SECRET");
    },
    60000
  );
});