// Shared error-envelope helpers.
//
// The API answers failures either as {"error": string} (simple message) or
// {"error": {"code", "message"}} (structured, e.g. DRM_* codes). Both web
// pages and tooling need one canonical way to render a human message.

export type ErrorEnvelope =
  | { error: string }
  | { error: { code?: string; message?: string } };

export function isErrorEnvelope(data: unknown): data is ErrorEnvelope {
  return (
    typeof data === "object" &&
    data !== null &&
    "error" in (data as Record<string, unknown>)
  );
}

/** Extract a display message from any thrown value / axios error. */
export function getErrorMessage(err: unknown, fallback = "Что-то пошло не так"): string {
  const e = err as { response?: { data?: unknown; status?: number }; message?: string };
  const data = e?.response?.data;
  if (isErrorEnvelope(data)) {
    const raw = (data as { error: unknown }).error;
    if (typeof raw === "string") return raw;
    if (raw && typeof raw === "object") {
      const m = (raw as { message?: unknown }).message;
      if (typeof m === "string" && m) return m;
      const c = (raw as { code?: unknown }).code;
      if (typeof c === "string" && c) return c;
    }
  }
  if (e?.message) return e.message;
  return fallback;
}
