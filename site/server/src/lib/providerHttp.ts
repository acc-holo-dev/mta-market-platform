// PLAN-020 S-004a: bounded outbound HTTP for provider integrations
// (payments + OAuth). A hung provider/OAuth endpoint must not hold the HTTP
// request — or its PROCESSING idempotency row — forever: the abort surfaces
// as a normal failure and the existing retry/idempotency paths recover it.
//
// One knob for all outbound provider traffic (payment + OAuth):
//   PROVIDER_HTTP_TIMEOUT_MS (default 15000)

const PROVIDER_TIMEOUT_MS = parseInt(process.env.PROVIDER_HTTP_TIMEOUT_MS || "15000", 10);

/** fetch() with a hard time bound; signature-compatible with global fetch. */
export function providerFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
}
