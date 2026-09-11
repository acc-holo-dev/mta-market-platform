// PLAN B-006: Structured logger.
// Production output is single-line JSON with the fields required by the plan
// (level, message, timestamp, service, request_id, user_id, error code).
// Sensitive values are redacted before serialization — access/refresh tokens,
// passwords, secrets and private keys must never reach the logs.
// Format: LOG_FORMAT=json (default in production) | pretty (default in dev).

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Structured log fields (flat, JSON-serializable; sensitive keys are redacted). */
export type LogFields = Record<string, unknown>;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVELS = LEVEL_ORDER;

const SENSITIVE_KEY = /access[_-]?token|refresh[_-]?token|password|secret|authorization|credentials|private[_-]?key|notification[_-]?password|cookie|bearer/i;

/** Deep-mask sensitive values; returns a safe copy. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value === null || value === undefined) return value;

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: depth === 0 ? value.stack : undefined };
  }

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }

  return value;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Bind persistent fields (e.g. request_id) into every entry. */
  child(bindings: LogFields): Logger;
}

const minLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";
const useJson = (process.env.LOG_FORMAT || (process.env.NODE_ENV === "production" ? "json" : "pretty")) === "json";

function emit(level: LogLevel, message: string, fields: LogFields | undefined, bindings: LogFields | undefined): void {
  if (LEVELS[level] < LEVELS[minLevel]) return;

  const entry = {
    level,
    service: "mta-market-api",
    timestamp: new Date().toISOString(),
    message,
    ...(bindings ? redact(bindings) as Record<string, unknown> : {}),
    ...(fields ? redact(fields) as Record<string, unknown> : {}),
  };

  if (useJson) {
    // Single-line JSON: machine-parseable, one event per line.
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(entry));
    return;
  }

  const ctx = Object.entries(entry)
    .filter(([k]) => !["level", "service", "timestamp", "message"].includes(k))
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" ");
  // eslint-disable-next-line no-console
  console.log(`[${entry.timestamp}] ${level.toUpperCase().padEnd(5)} ${message}${ctx ? " " + ctx : ""}`);
}

function makeLogger(bindings: LogFields = {}): Logger {
  return {
    debug: (m, f) => emit("debug", m, f, bindings),
    info: (m, f) => emit("info", m, f, bindings),
    warn: (m, f) => emit("warn", m, f, bindings),
    error: (m, f) => emit("error", m, f, bindings),
    child: (extra) => makeLogger({ ...bindings, ...extra }),
  };
}

export const logger: Logger = makeLogger();