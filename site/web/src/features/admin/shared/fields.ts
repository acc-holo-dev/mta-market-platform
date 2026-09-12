// PLAN-017 §36: defensive field readers for admin tables whose row shapes
// may vary slightly between backend revisions (audit-events, system-logs,
// user purchases / moderation history). Only string/number primitives are
// trusted; everything else stays unknown.
export type UnknownRow = Record<string, unknown>;

/** Первое присутствующее строковое (или числовое → строка) поле из keys. */
export function pickString(row: UnknownRow | null | undefined, keys: string[]): string | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

export function pickNumber(row: UnknownRow | null | undefined, keys: string[]): number | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

/** Безопасная сериализация before/after/meta — всегда текст, никогда HTML. */
export function prettyJson(value: unknown): string {
  if (value == null) return "—";
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** label вложенного объекта-актера (actor: {username|displayName|email|id}). */
export function nestedLabel(row: UnknownRow | null | undefined, key: string): string | null {
  if (!row) return null;
  const nested = row[key];
  if (!nested || typeof nested !== "object") return null;
  return pickString(nested as UnknownRow, ["displayName", "username", "email", "label", "id"]);
}