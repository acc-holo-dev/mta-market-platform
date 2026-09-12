// Startup validation: check required environment variables and configuration
// SECURITY: Fail fast in production if critical secrets are missing.
// PLAN-016 A-009a: OAuth providers are configuration, not a feature — by
// default NONE is mandatory in production; a provider without env is simply
// disabled (honest absence, A-010). Only owner-declared mandatory providers
// would move to the required list (none today, documented in AUTH.md).

const PRODUCTION = process.env.NODE_ENV === "production";

/** True when the value is base64 decoding to exactly 32 bytes (AES-256 key). */
function isValidBase32ByteKey(value: string): boolean {
  try {
    const buf = Buffer.from(value, "base64");
    return buf.length === 32;
  } catch {
    return false;
  }
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate required environment variables
 */
export function validateEnvironment(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Critical secrets (MUST exist in production)
  const requiredInProduction = [
    "JWT_SECRET",
    "DATABASE_URL",
  ];

  /**
   * PLAN-016 A-009a: a partially configured OAuth provider is a
   * misconfiguration — surface it as a warning (the provider stays honestly
   * disabled at runtime, discovery never advertises it).
   */
  const oauthProviders: [string, string, string][] = [
    ["DISCORD", "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"],
    ["YANDEX", "YANDEX_CLIENT_ID", "YANDEX_CLIENT_SECRET"],
    ["GOOGLE", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    ["VK", "VK_CLIENT_ID", "VK_CLIENT_SECRET"],
  ];

  // Optional but recommended
  const recommended = [
    "FRONTEND_URL",
    "REDIS_URL",
    "S3_ENABLED",
  ];

  // Production-specific requirements
  if (PRODUCTION) {
    // JWT_SECRET must be strong
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      errors.push("JWT_SECRET is required in production. Generate with: openssl rand -base64 64");
    } else if (jwtSecret.length < 32) {
      errors.push("JWT_SECRET too weak. Must be at least 32 characters. Generate with: openssl rand -base64 64");
    }

    // Database must be configured
    if (!process.env.DATABASE_URL) {
      errors.push("DATABASE_URL is required in production");
    }

    // PLAN-016 A-009a: no OAuth provider is mandatory in production — a
    // provider without env is simply disabled. But when ANY OAuth provider
    // IS configured, stored provider tokens must be encrypted at rest (A-009).
    const oauthConfigured = oauthProviders.some(([, idEnv]) => Boolean(process.env[idEnv])) ||
      Boolean(process.env.TELEGRAM_BOT_TOKEN);
    if (oauthConfigured) {
      const tokenKey = process.env.OAUTH_TOKEN_ENCRYPTION_KEY;
      if (!tokenKey) {
        errors.push(
          "OAUTH_TOKEN_ENCRYPTION_KEY is required in production when any OAuth provider is configured. Generate with: openssl rand -base64 32"
        );
      } else if (!isValidBase32ByteKey(tokenKey)) {
        errors.push("OAUTH_TOKEN_ENCRYPTION_KEY must be base64 encoding of exactly 32 bytes (AES-256).");
      }
    }
    for (const [name, idEnv, secretEnv] of oauthProviders) {
      if (Boolean(process.env[idEnv]) !== Boolean(process.env[secretEnv])) {
        warnings.push(`${name} OAuth is partially configured — the provider stays disabled`);
      }
    }

    // TASK A-012: DRM signing keys are production-critical — without the
    // private key the server cannot issue leases. Fail closed at startup
    // instead of at the first activation attempt.
    if (!process.env.DRM_SERVER_PRIVATE_KEY) {
      errors.push(
        "DRM_SERVER_PRIVATE_KEY is required in production. Generate with: pnpm --filter @mta-market/server drm:keygen"
      );
    }

    // PLAN-004 A-002 (audit): DRM_MASTER_KEY wraps per-version DEKs (envelope
    // encryption, G-005). Without it every version upload/DEK release throws
    // EncryptionNotConfiguredError at runtime — fail fast instead. It must
    // decode to exactly 32 bytes (AES-256) base64.
    if (!process.env.DRM_MASTER_KEY) {
      errors.push(
        "DRM_MASTER_KEY is required in production (envelope encryption of artifact DEKs). Generate with: openssl rand -base64 32"
      );
    } else if (!isValidBase32ByteKey(process.env.DRM_MASTER_KEY)) {
      errors.push("DRM_MASTER_KEY must be base64 encoding of exactly 32 bytes (AES-256).");
    }

    // TASK A-012/B-002: artifact signing key is production-critical —
    // versions cannot be signed (and thus published) without it.
    if (!process.env.ARTIFACT_SIGNING_PRIVATE_KEY) {
      errors.push(
        "ARTIFACT_SIGNING_PRIVATE_KEY is required in production. Generate with the artifact keygen CLI and store in the secret manager."
      );
    }

    // YooKassa configuration (if enabled)
    if (process.env.YOOKASSA_ENABLED === "true") {
      if (!process.env.YOOKASSA_SHOP_ID) {
        errors.push("YOOKASSA_SHOP_ID is required when YOOKASSA_ENABLED=true");
      }
      if (!process.env.YOOKASSA_SECRET_KEY) {
        errors.push("YOOKASSA_SECRET_KEY is required when YOOKASSA_ENABLED=true");
      }
      if (!process.env.YOOKASSA_NOTIFICATION_PASSWORD) {
        errors.push("YOOKASSA_NOTIFICATION_PASSWORD is required when YOOKASSA_ENABLED=true");
      }
    }

    // PLAN-016 P-003/P-004: additional payment providers follow the same
    // enabled→configured contract (a disabled provider is simply absent).
    if (process.env.TBANK_ENABLED === "true") {
      if (!process.env.TBANK_TERMINAL_KEY) {
        errors.push("TBANK_TERMINAL_KEY is required when TBANK_ENABLED=true");
      }
      if (!process.env.TBANK_PASSWORD) {
        errors.push("TBANK_PASSWORD is required when TBANK_ENABLED=true");
      }
    }
    if (process.env.CRYPTO_ENABLED === "true") {
      if (!process.env.CRYPTO_MERCHANT_ID) {
        errors.push("CRYPTO_MERCHANT_ID is required when CRYPTO_ENABLED=true");
      }
      if (!process.env.CRYPTO_API_KEY) {
        errors.push("CRYPTO_API_KEY is required when CRYPTO_ENABLED=true");
      }
    }

    // S3 configuration (if enabled)
    if (process.env.S3_ENABLED === "true") {
      if (!process.env.S3_BUCKET) {
        errors.push("S3_BUCKET is required when S3_ENABLED=true");
      }
      if (!process.env.S3_ACCESS_KEY) {
        errors.push("S3_ACCESS_KEY is required when S3_ENABLED=true");
      }
      if (!process.env.S3_SECRET_KEY) {
        errors.push("S3_SECRET_KEY is required when S3_ENABLED=true");
      }
      if (!process.env.S3_REGION) {
        warnings.push("S3_REGION not set, defaulting to us-east-1");
      }
    } else {
      errors.push("S3_ENABLED must be true in production (local storage not secure)");
    }

    // Frontend URL must be set
    if (!process.env.FRONTEND_URL) {
      warnings.push("FRONTEND_URL not set, CORS may not work correctly");
    }

    // Redis should be configured for rate limiting
    if (!process.env.REDIS_URL) {
      warnings.push("REDIS_URL not set, rate limiting will use memory (not production-safe)");
    }
  } else {
    // Development: warn if critical secrets missing
    requiredInProduction.forEach((key) => {
      if (!process.env[key]) {
        warnings.push(`${key} not set (required in production)`);
      }
    });
  }

  // Check recommended variables (warnings only)
  recommended.forEach((key) => {
    if (!process.env[key]) {
      warnings.push(`${key} not set (recommended)`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Print validation results and exit if invalid in production
 */
export function enforceEnvironmentValidation(): void {
  const result = validateEnvironment();

  if (result.warnings.length > 0) {
    console.warn("\n⚠️  Environment Warnings:");
    result.warnings.forEach((warning) => {
      console.warn(`   - ${warning}`);
    });
  }

  if (result.errors.length > 0) {
    console.error("\n❌ Environment Validation FAILED:");
    result.errors.forEach((error) => {
      console.error(`   - ${error}`);
    });

    if (PRODUCTION) {
      console.error("\n🛑 FATAL: Cannot start server in production with missing secrets.");
      console.error("   Fix the errors above and restart.\n");
      process.exit(1);
    } else {
      console.warn("\n⚠️  Development mode: Server will start despite errors.");
      console.warn("   These errors MUST be fixed before production deployment.\n");
    }
  } else {
    console.log("\n✅ Environment validation passed");
  }
}
