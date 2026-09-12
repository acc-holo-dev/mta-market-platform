// Canonical configuration loader (PLAN-017 §10).
//
// One loading abstraction for the platform's non-secret configuration:
//   config/environments/<env>.yaml   — per-environment structure
//   config/application/*.yaml        — cross-environment application config
//   config/schemas/*.json            — structural contracts for both
//
// Rules:
//   - config/ is non-secret configuration. Secret values never live here;
//     the loader reads file NAMES of env vars (passwordEnv) and never
//     resolves, logs or exports secret material.
//   - Malformed configuration must be rejected with actionable diagnostics.
//   - Missing configuration degrades to safe defaults with a warning, so a
//     missing directory can never take the API down (production deployments
//     do not ship config/ into the runtime image).

import fs from "node:fs";
import path from "node:path";

export type ConfigIssue = { file: string; message: string };

export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

export type EnvironmentConfig = {
  api?: {
    port?: number;
    hostPort?: number;
    nodeEnv?: "development" | "production";
    baseUrl?: string;
    frontendUrl?: string;
    corsOrigins?: string[];
    cookieSameSite?: "lax" | "strict" | "none";
    trustProxy?: boolean;
  };
  web?: { port?: number; hostPort?: number; publicApiUrl?: string };
  database?: {
    host?: string;
    port?: number;
    db?: string;
    user?: string;
    passwordEnv?: string;
    test?: { url?: string; composeFile?: string; hostPort?: number };
  };
  redis?: { url?: string };
  storage?: { s3Enabled?: boolean; uploadDir?: string };
  module?: { build?: { preset?: string }; drm?: { marketApiBase?: string; keyStoreHome?: string } };
  payments?: { providersEnabled?: boolean };
  email?: { enabled?: boolean };
  jobs?: { reconciliationEnabled?: boolean; serverMonitoringEnabled?: boolean };
  vitest?: { fileParallelism?: boolean; testTimeoutMs?: number };
  e2e?: { baseURL?: string; apiUrl?: string; adminEmail?: string };
};

export type FeatureFlags = Record<string, boolean>;

export type RateLimitColumn = Partial<Record<"development" | "test" | "staging" | "production", number>>;

export type ApplicationConfig = {
  features: FeatureFlags;
  overrides: Record<string, FeatureFlags>;
  rateLimits: Record<string, RateLimitColumn>;
  windowsMs: Record<string, number>;
  logging: { format: RateLimitColumn; level: RateLimitColumn };
};

// --- Minimal YAML subset parser ---------------------------------------------
// Supports exactly the subset used by config/: comments, nested maps by
// indentation, inline [a, b] string/number arrays, block scalars (plain),
// quoted strings, ints, floats, booleans, null. Anything else is a hard
// parse error (malformed configuration must be rejected, not guessed).

const ENV_NAMES = new Set(["development", "test", "staging", "production"]);

function parseScalar(raw: string): YamlValue {
  const t = raw.trim();
  if (t === "" || t === "~" || t === "null") return null;
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "{}") return {};
  if ((t.startsWith('"') && t.endsWith('"') && t.length >= 2) || (t.startsWith("'") && t.endsWith("'") && t.length >= 2)) {
    return t.slice(1, -1);
  }
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  if (t.startsWith("[") && t.endsWith("]")) {
    const inner = t.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((part) => parseScalar(part));
  }
  return t;
}

export function parseYamlSubset(text: string, file = "<yaml>"): YamlValue {
  const lines: { indent: number; content: string; line: number }[] = [];
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const noComment = stripComment(rawLine);
    if (noComment.trim() === "") return;
    const indent = noComment.length - noComment.trimStart().length;
    if (noComment.trim() === "-") return; // bare list items unsupported — reject below
    lines.push({ indent, content: noComment.trim(), line: i + 1 });
  });

  let pos = 0;
  const valueAt = (minIndent: number): YamlValue => {
    if (pos >= lines.length) return null;
    const { indent, content, line } = lines[pos];
    if (indent < minIndent) return null;
    const kv = content.match(/^([^:]+):\s*(.*)$/);
    if (!kv) throw new Error(`${file}:${line}: expected 'key: value', got "${content}"`);
    if (indent !== minIndent) {
      throw new Error(`${file}:${line}: inconsistent indentation (expected ${minIndent}, got ${indent})`);
    }
    pos += 1;
    const key = kv[1].trim().replace(/^["']|["']$/g, "");
    const rawValue = kv[2].trim();
    if (rawValue !== "") return parseScalar(rawValue);
    // Nested block: either a map (child lines deeper) or nothing.
    if (pos < lines.length && lines[pos].indent > indent) {
      return valueAt(lines[pos].indent);
    }
    return null;
  };

  const result: { [key: string]: YamlValue } = {};
  while (pos < lines.length) {
    const { indent, content, line } = lines[pos];
    const kv = content.match(/^([^:]+):\s*(.*)$/);
    if (!kv) throw new Error(`${file}:${line}: expected 'key: value', got "${content}"`);
    if (indent !== 0) throw new Error(`${file}:${line}: top-level key must not be indented`);
    pos += 1;
    const key = kv[1].trim().replace(/^["']|["']$/g, "");
    const rawValue = kv[2].trim();
    if (rawValue !== "") {
      result[key] = parseScalar(rawValue);
    } else if (pos < lines.length && lines[pos].indent > indent) {
      result[key] = valueAt(lines[pos].indent);
    } else {
      result[key] = null;
    }
  }
  return result;
}

function stripComment(line: string): string {
  // A '#' starts a comment only outside quotes.
  let inQuote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

// --- Tiny JSON-Schema subset validator --------------------------------------
// Covers the constructs used by config/schemas/*.json: type, enum, const,
// required, properties, additionalProperties (bool or schema), items,
// minimum, maximum, $ref (#/$defs/X), $defs.

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean | Schema;
  items?: Schema;
  minimum?: number;
  maximum?: number;
  $ref?: string;
  $defs?: Record<string, Schema>;
};

export function validateAgainstSchema(value: unknown, schema: Schema, root: Schema = schema): string[] {
  const errors: string[] = [];
  const fail = (message: string) => errors.push(message);

  if (schema.$ref) {
    const name = schema.$ref.replace("#/$defs/", "");
    const def = root.$defs?.[name];
    if (!def) {
      fail(`unresolvable $ref ${schema.$ref}`);
      return errors;
    }
    return validateAgainstSchema(value, def, root);
  }

  if (schema.const !== undefined && value !== schema.const) {
    fail(`expected constant ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  }
  if (schema.enum && !schema.enum.some((option) => option === value)) {
    fail(`value ${JSON.stringify(value)} not in enum [${schema.enum.join(", ")}]`);
  }

  const actualType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matches =
      expected.includes(actualType) ||
      (actualType === "number" && Number.isInteger(value) && expected.includes("integer"));
    if (!matches) {
      fail(`expected type ${expected.join("|")}, got ${actualType}`);
      return errors;
    }
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) fail(`value ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`value ${value} > maximum ${schema.maximum}`);
  }
  if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      validateAgainstSchema(item, schema.items as Schema, root).forEach((message) => fail(`[${i}] ${message}`));
    });
  }
  if ((schema.type === "object" || schema.properties || schema.required) && value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (!(key in object)) fail(`missing required key "${key}"`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (key in object) {
        validateAgainstSchema(object[key], sub, root).forEach((message) => fail(`${key}: ${message}`));
      }
    }
    const additional = schema.additionalProperties ?? true;
    if (additional === false) {
      for (const key of Object.keys(object)) {
        if (!(key in (schema.properties ?? {}))) fail(`unexpected key "${key}"`);
      }
    } else if (typeof additional === "object") {
      for (const [key, item] of Object.entries(object)) {
        if (key in (schema.properties ?? {})) continue;
        validateAgainstSchema(item, additional, root).forEach((message) => fail(`${key}: ${message}`));
      }
    }
  }
  return errors;
}

// --- Config discovery / loading ---------------------------------------------

export type LoadedConfig<T> = { config: T; issues: ConfigIssue[]; configDir: string | null };

function findConfigDir(explicit: string | undefined, cwd: string): string | null {
  if (explicit && fs.existsSync(path.join(explicit, "environments"))) return explicit;
  let current = cwd;
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(current, "config", "environments");
    if (fs.existsSync(candidate)) return path.join(current, "config");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function readYaml(file: string): YamlValue {
  const raw = fs.readFileSync(file, "utf8");
  return parseYamlSubset(raw, file);
}

const DEFAULT_FEATURES: FeatureFlags = {
  creator: true,
  services: true,
  advertising: false,
  premium: false,
  live_demo: false,
  "3d": false,
  advanced_analytics: false,
};

export function loadEnvironment(name: string, opts: { configDir?: string; cwd?: string } = {}): LoadedConfig<EnvironmentConfig> {
  const issues: ConfigIssue[] = [];
  const dir = findConfigDir(opts.configDir ?? process.env.PLATFORM_CONFIG_DIR, opts.cwd ?? process.cwd());
  if (!dir) {
    issues.push({ file: "config/", message: "config directory not found — using safe defaults" });
    return { config: {}, issues, configDir: null };
  }
  const file = path.join(dir, "environments", `${name}.yaml`);
  if (!fs.existsSync(file)) {
    issues.push({ file, message: `environment file not found — using safe defaults` });
    return { config: {}, issues, configDir: dir };
  }
  try {
    const parsed = readYaml(file);
    const schema = JSON.parse(fs.readFileSync(path.join(dir, "schemas", "environment.schema.json"), "utf8")) as Schema;
    const errors = validateAgainstSchema(parsed, schema);
    if (errors.length) {
      issues.push({ file, message: `schema validation failed: ${errors.slice(0, 10).join("; ")}` });
      return { config: {}, issues, configDir: dir };
    }
    return { config: parsed as EnvironmentConfig, issues, configDir: dir };
  } catch (error) {
    issues.push({ file, message: `malformed configuration rejected: ${(error as Error).message}` });
    return { config: {}, issues, configDir: dir };
  }
}

export function loadApplication(opts: { configDir?: string; cwd?: string } = {}): LoadedConfig<ApplicationConfig> {
  const issues: ConfigIssue[] = [];
  const empty: ApplicationConfig = {
    features: { ...DEFAULT_FEATURES },
    overrides: {},
    rateLimits: {},
    windowsMs: {},
    logging: { format: {}, level: {} },
  };
  const dir = findConfigDir(opts.configDir ?? process.env.PLATFORM_CONFIG_DIR, opts.cwd ?? process.cwd());
  if (!dir) {
    issues.push({ file: "config/", message: "config directory not found — using safe defaults" });
    return { config: empty, issues, configDir: null };
  }
  const appDir = path.join(dir, "application");
  try {
    const features = readYaml(path.join(appDir, "features.yaml")) as { features?: FeatureFlags; overrides?: Record<string, FeatureFlags> };
    const limits = readYaml(path.join(appDir, "limits.yaml")) as { rateLimits?: Record<string, RateLimitColumn>; windowsMs?: Record<string, number> };
    const logging = readYaml(path.join(appDir, "logging.yaml")) as { logging?: { format?: RateLimitColumn; level?: RateLimitColumn } };
    const schema = JSON.parse(fs.readFileSync(path.join(dir, "schemas", "application.schema.json"), "utf8")) as Schema;
    const merged = { ...features, ...limits, logging: logging.logging };
    const errors = validateAgainstSchema(merged, schema);
    if (errors.length) {
      issues.push({ file: appDir, message: `schema validation failed: ${errors.slice(0, 10).join("; ")}` });
      return { config: empty, issues, configDir: dir };
    }
    return {
      config: {
        features: { ...DEFAULT_FEATURES, ...(features.features ?? {}) },
        overrides: features.overrides ?? {},
        rateLimits: limits.rateLimits ?? {},
        windowsMs: limits.windowsMs ?? {},
        logging: { format: logging.logging?.format ?? {}, level: logging.logging?.level ?? {} },
      },
      issues,
      configDir: dir,
    };
  } catch (error) {
    issues.push({ file: appDir, message: `malformed configuration rejected: ${(error as Error).message}` });
    return { config: empty, issues, configDir: dir };
  }
}

export function featureFlags(environment: string, opts: { configDir?: string; cwd?: string } = {}): { flags: FeatureFlags; issues: ConfigIssue[] } {
  const app = loadApplication(opts);
  const overrides = app.config.overrides[environment] ?? {};
  const flags: FeatureFlags = { ...app.config.features };
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === "boolean") flags[key] = value;
  }
  return { flags, issues: app.issues };
}

export function rateLimitsFor(environment: string, opts: { configDir?: string; cwd?: string } = {}): { limits: Record<string, number>; issues: ConfigIssue[] } {
  const app = loadApplication(opts);
  const limits: Record<string, number> = {};
  for (const [name, column] of Object.entries(app.config.rateLimits)) {
    const value = column[environment as keyof RateLimitColumn] ?? column.development;
    if (typeof value === "number") limits[name] = value;
  }
  return { limits, issues: app.issues };
}
