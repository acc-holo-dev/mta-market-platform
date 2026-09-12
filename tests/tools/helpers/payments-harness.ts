// Shared fetch-boundary harness for payment-provider adapter suites
// (PLAN-016 C3: T-Bank + crypto invoice). Consolidates the copy-pasted parts
// of the webhook/provider test harnesses: each suite sets its own provider
// env vars BEFORE its dynamic imports (module-load constants) and stubs the
// global fetch so the REAL transport + adapter run end-to-end; this module
// factors only the pieces that are literally common between the suites.
// The YooKassa HTTP-level suite (commerce/payments-webhook-yookassa.test.ts)
// keeps its own DB-backed harness — materially different harness style.
import { vi } from "vitest";
import type { ProviderWebhookContext } from "@server/lib/paymentProvider";

/** A JSON `Response` the stubbed fetch can return (ok or application error). */
export function respondJson(payload: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

/**
 * Webhook context for the provider verify/parse entry points. `rawBody` is
 * only used by providers that sign over the exact wire bytes (crypto invoice).
 */
export function providerWebhookCtx(body: unknown, rawBody?: Buffer): ProviderWebhookContext {
  return { req: {} as ProviderWebhookContext["req"], body, rawBody, sourceIp: "1.2.3.4" };
}

/** Replace the global fetch with the suite's mock for the whole file run. */
export function stubProviderFetch(fetchMock: ReturnType<typeof vi.fn>): void {
  vi.stubGlobal("fetch", fetchMock);
}

/** Restore the globals stubbed by `stubProviderFetch`. */
export function restoreProviderFetch(): void {
  vi.unstubAllGlobals();
}

/** JSON body of the last fetch call (the transports POST a JSON string). */
export function lastFetchBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const call = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse(String(call[1].body));
}