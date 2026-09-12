// PLAN-017 §9: feature-flag access helper for server runtime code.
//
// Wraps config/loader.ts featureFlags(environment) with:
//   - a stable environment name: NODE_ENV === "production" -> "production",
//     otherwise "development" (test runs share the development column);
//   - a 60s in-memory cache of the YAML-resolved flag table so hot paths
//     (public advertising endpoints) never re-read config/ per request;
//   - a per-call env override map checked BEFORE the YAML value.
//
// ENV OVERRIDE CONTRACT (testability + emergency ops switch):
//   Any flag `<name>` can be forced through the environment variable
//   `FEATURE_<NAME>` where NAME is the flag name uppercased with every
//   non-alphanumeric character replaced by an underscore:
//       advertising          -> FEATURE_ADVERTISING
//       premium              -> FEATURE_PREMIUM
//       live_demo            -> FEATURE_LIVE_DEMO
//       "3d"                 -> FEATURE_3D
//       advanced_analytics   -> FEATURE_ADVANCED_ANALYTICS
//   Accepted values: "true"/"1" -> true, "false"/"0" -> false
//   (case-insensitive). Any other value (including empty) is NOT an
//   override — an invalid value must never silently enable a feature.
//   The override is deliberately re-read on every call (process.env lookup
//   is cheap) so a forced flag takes effect immediately, including under
//   the YAML cache; only the YAML resolution itself is cached for 60s.

import { featureFlags, type FeatureFlags } from "../config/loader.js";

const CACHE_TTL_MS = 60_000;

let cache: { environment: string; flags: FeatureFlags; loadedAt: number } | null = null;

/** "production" when NODE_ENV=production, otherwise "development". */
export function featureEnvironment(): "production" | "development" {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

/** FEATURE_<NAME> env key for a flag name (uppercase, non-alnum -> "_"). */
export function featureEnvKey(name: string): string {
  return `FEATURE_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

function envOverride(name: string): boolean | undefined {
  const raw = process.env[featureEnvKey(name)];
  if (raw === undefined || raw === "") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return undefined;
}

function cachedYamlFlags(): FeatureFlags {
  const environment = featureEnvironment();
  const now = Date.now();
  if (cache && cache.environment === environment && now - cache.loadedAt < CACHE_TTL_MS) {
    return cache.flags;
  }
  const { flags } = featureFlags(environment);
  cache = { environment, flags, loadedAt: now };
  return flags;
}

/** True when the named feature is enabled for the current environment. */
export function isFeatureEnabled(name: string): boolean {
  const override = envOverride(name);
  if (override !== undefined) return override;
  const flags = cachedYamlFlags();
  return flags[name] === true;
}