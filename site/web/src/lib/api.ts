// Canonical fetch-based API client for the MTA Market backend.
// PLAN-019 E-003 + A-005: replaces the axios instance with the same public
// semantics, on plain `fetch` — zero new dependencies.
//
// Call-shape contract (DECISION, documented):
// - api.get<T>(url, config?) / api.post<T>(url, body?, config?) / patch / put /
//   delete resolve to an AXIOS-LIKE ENVELOPE `{ data: T; status: number }`,
//   NOT the bare data. Every existing call site (the lib/api/* domain modules,
//   api-ext, direct page usage) destructures `{ data }`, so keeping the
//   envelope lets the whole codebase compile unchanged while the transport
//   switches to fetch. The `status` field is additive information.
// - Every request is sent with `credentials: "include"` (axios
//   `withCredentials: true` parity) so the HttpOnly refresh cookie flows to
//   the API (cross-origin dev requires CORS_ORIGINS + COOKIE_SAMESITE=none).
// - Bearer injection from the in-memory zustand auth store — same as the old
//   request interceptor: a store token wins over an explicit header.
// - 401 → single-flight POST /auth/refresh (cookie-based) → retry once with
//   the new token. Parallel 401s share one refresh promise (no refresh storm).
//   /auth/refresh and /auth/login never trigger the refresh flow.
// - On refresh failure: clearAuth + hard redirect to
//   /auth/login?error=session_expired (exact legacy UX; no sessionStorage
//   flags exist in this flow). The original 401 is still rejected to the
//   caller, like the old interceptor did via `Promise.reject(error)`.
// - Errors are `ApiError` and carry `.response = { data, status }` exactly
//   like AxiosError, so @mta-market/shared getErrorMessage (and any call site
//   reading err.response?.data) keeps working unchanged for both error
//   envelopes: `{ error: string }` today and the canonical
//   `{ error: { code, message, requestId } }` coming server-side.
// - No default timeout (the axios instance had none); cancellation is
//   opt-in via `config.signal` only.
// - FormData bodies never get a manual Content-Type: the browser must set
//   the multipart boundary (same as axios's transformRequest behavior).

import { useAuthStore, type User } from "@/store/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/** Config accepted by every verb — mirrors the axios fields actually used. */
export interface ApiRequestConfig {
  /** Query params; URLSearchParams serialization, undefined/null skipped. */
  params?: Record<string, string | number | boolean | undefined | null>;
  /** Request body (also accepted positionally by post/patch/put). */
  body?: unknown;
  /** axios-parity alias for `body` (axios-style delete-with-body call sites
   * in lib/api/advertising.ts pass `{ data }` as the request config). */
  data?: unknown;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** AbortSignal support; there is deliberately no default timeout. */
  signal?: AbortSignal;
  /** Accepted for axios-parity call sites; credentials are always "include". */
  withCredentials?: boolean;
  /** Upload progress is not observable with fetch; accepted and ignored. */
  onUploadProgress?: (event: { loaded: number; total?: number }) => void;
}

/* eslint-disable @typescript-eslint/no-explicit-any --
   The `any` fallback mirrors axios's AxiosResponse<any>: untyped call sites
   across the ~130 api-ext domain functions keep compiling with `data: any`
   instead of erroring on `unknown`. */
export interface ApiResult<T = any> {
  data: T;
  status: number;
}

/** fetch-era replacement for AxiosError with the same `.response` envelope. */
export class ApiError extends Error {
  readonly status?: number;
  readonly data?: unknown;
  /** axios-compatible shape: shared getErrorMessage() reads `.response.data`. */
  readonly response?: { data: unknown; status: number };

  constructor(message: string, init: { status?: number; data?: unknown } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = init.status;
    this.data = init.data;
    if (init.status !== undefined) {
      this.response = { data: init.data, status: init.status };
    }
  }
}

function buildUrl(path: string, params?: ApiRequestConfig["params"]): string {
  const base =
    path.startsWith("http://") || path.startsWith("https://")
      ? path
      : `${API_BASE_URL}${path}`;
  if (!params) return base;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue; // skip absent params
    search.append(key, String(value));
  }
  const qs = search.toString();
  if (!qs) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${qs}`;
}

function toBodyInit(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof FormData !== "undefined" && body instanceof FormData) return body;
  if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
    return body; // fetch sets application/x-www-form-urlencoded itself
  }
  return JSON.stringify(body);
}

async function send(
  method: string,
  path: string,
  body: unknown,
  config: ApiRequestConfig | undefined,
  forceToken?: string | null
): Promise<Response> {
  const headers: Record<string, string> = { ...(config?.headers ?? {}) };

  const bodyInit = toBodyInit(body);
  const isJsonBody =
    bodyInit !== undefined &&
    !(typeof FormData !== "undefined" && bodyInit instanceof FormData) &&
    !(typeof URLSearchParams !== "undefined" && bodyInit instanceof URLSearchParams) &&
    typeof bodyInit === "string";
  if (isJsonBody && !Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
    headers["Content-Type"] = "application/json";
  }

  // Bearer injection from the in-memory zustand store (request-interceptor
  // parity): a store token wins over an explicit header. forceToken exists
  // only for the post-refresh retry.
  const token = forceToken !== undefined ? forceToken : useAuthStore.getState().accessToken;
  if (token) headers["Authorization"] = `Bearer ${token}`;

  return fetch(buildUrl(path, config?.params), {
    method,
    headers,
    body: bodyInit,
    credentials: "include", // axios withCredentials parity
    signal: config?.signal,
  });
}

async function toApiError(response: Response): Promise<ApiError> {
  let data: unknown = "";
  try {
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text; // non-JSON error body (axios parity: raw string)
      }
    }
  } catch {
    data = "";
  }
  return new ApiError(`Request failed with status code ${response.status}`, {
    status: response.status,
    data,
  });
}

async function parseResult<T>(response: Response): Promise<ApiResult<T>> {
  const status = response.status;
  if (status === 204 || status === 304) {
    // axios parity: no content → data === "". Property access on the empty
    // string never throws, unlike an `undefined` payload would.
    return { data: "" as any, status };
  }
  const text = await response.text();
  if (!text) return { data: "" as any, status };
  try {
    return { data: JSON.parse(text) as any, status };
  } catch {
    return { data: text as any, status }; // non-JSON body (transformResponse parity)
  }
}

// Single-flight refresh: concurrent 401 responses await the same promise.
let refreshPromise: Promise<string | null> | null = null;

/**
 * Exchange the HttpOnly refresh cookie for a fresh access token.
 * Single-flight; resolves to null when the session is gone.
 * Exported for the OAuth callback page (raw axios usage migrated, E-003).
 */
export function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = send("POST", "/auth/refresh", null, undefined)
      .then(async (response) => {
        if (!response.ok) return null;
        const { data } = await parseResult<{ accessToken?: string }>(response);
        return data?.accessToken ?? null;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function request<T>(
  method: string,
  path: string,
  body: unknown,
  config: ApiRequestConfig | undefined
): Promise<ApiResult<T>> {
  const isRefreshCall = path.includes("/auth/refresh");
  const isLoginCall = path.includes("/auth/login");

  // `config.data` is the axios-parity alias consumed when no positional body
  // was passed (delete-with-body call sites).
  const effectiveBody = body !== undefined ? body : config?.data;

  let response = await send(method, path, effectiveBody, config);

  // One refresh + one retry per failed request (response-interceptor parity).
  if (!response.ok && response.status === 401 && !isRefreshCall && !isLoginCall) {
    const newToken = await refreshAccessToken();

    if (newToken) {
      useAuthStore.getState().setAccessToken(newToken);
      response = await send(method, path, effectiveBody, config, newToken);
    } else {
      // Refresh failed: session is gone (expired/revoked/reuse detected).
      useAuthStore.getState().clearAuth();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
        window.location.href = "/auth/login?error=session_expired";
      }
      throw await toApiError(response);
    }
  }

  if (!response.ok) {
    throw await toApiError(response);
  }
  return parseResult<T>(response);
}

/**
 * Canonical API client (PLAN-019 E-003). Verb signatures intentionally match
 * the axios instance they replace: get(url, config?), post/patch/put(url,
 * body?, config?), delete(url, config?) — all resolving `{ data, status }`.
 */
export const api = {
  get: <T = any>(path: string, config?: ApiRequestConfig): Promise<ApiResult<T>> =>
    request<T>("GET", path, undefined, config),
  post: <T = any>(path: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResult<T>> =>
    request<T>("POST", path, body, config),
  patch: <T = any>(path: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResult<T>> =>
    request<T>("PATCH", path, body, config),
  put: <T = any>(path: string, body?: unknown, config?: ApiRequestConfig): Promise<ApiResult<T>> =>
    request<T>("PUT", path, body, config),
  delete: <T = any>(path: string, config?: ApiRequestConfig): Promise<ApiResult<T>> =>
    request<T>("DELETE", path, undefined, config),
};

export default api;

/**
 * Bootstrap session after a page reload: exchange the refresh cookie for a
 * fresh access token and load the profile. Safe to call on every app start;
 * resolves to false when there is no valid session. Logic preserved exactly
 * from the axios client (A-001).
 */
export async function bootstrapSession(): Promise<boolean> {
  const { isAuthenticated, setAuth, setUser } = useAuthStore.getState();

  if (isAuthenticated()) {
    return true;
  }

  const token = await refreshAccessToken();
  if (!token) {
    return false;
  }

  try {
    const { data: user } = await api.get<User>("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (user) {
      setAuth(user, token);
    } else {
      setUser(user);
    }
    return true;
  } catch {
    useAuthStore.getState().clearAuth();
    return false;
  }
}