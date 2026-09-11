// PLAN-012 §4/§10: database-invariant error classification.
//
// The ORM surfaces Postgres constraint violations as SqlQueryError-shaped
// errors (kind "sql_query", sqlState "23505", constraint name). The helper
// below classifies them without importing ORM internals: the shape is
// detected structurally (including through `cause` chains, because some
// lanes wrap the driver error), so callers can turn "the database rejected
// the duplicate" into business outcomes (exactly-once repair instead of a
// 500).

interface UniqueViolationShape {
  constraint: string;
}

function shapeOfUniqueViolation(error: unknown): UniqueViolationShape | null {
  if (typeof error !== "object" || error === null) return null;
  const e = error as {
    kind?: unknown;
    sqlState?: unknown;
    code?: unknown;
    constraint?: unknown;
  };
  // SqlQueryError-shaped (ORM runtime): kind "sql_query" + SQLSTATE 23505.
  if (e.kind === "sql_query" && e.sqlState === "23505") {
    return { constraint: typeof e.constraint === "string" ? e.constraint : "" };
  }
  // Raw driver shape: PG error code 23505.
  if (e.code === "23505") {
    return { constraint: typeof e.constraint === "string" ? e.constraint : "" };
  }
  return null;
}

/**
 * True when the error is a Postgres unique/primary-key violation (SQLSTATE
 * 23505), optionally narrowed to a specific constraint name. Follows the
 * `cause` chain so wrapped driver errors are recognized too. When the
 * constraint name is missing on a wrapped error the SQLSTATE alone decides.
 */
export function isUniqueViolation(
  error: unknown,
  constraint?: string
): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const hit = shapeOfUniqueViolation(current);
    if (hit) {
      if (!constraint) return true;
      if (!hit.constraint) return true;
      if (hit.constraint === constraint) return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
