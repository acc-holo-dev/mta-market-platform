// Canonical API error model (PLAN-019 E-004/E-005).
//
// One error envelope for the whole API:
//   { "error": { "code": "RESOURCE_NOT_FOUND", "message": "...", "requestId": "..." } }
//
// Adoption is done route-by-route in the modular-monolith wave; until a
// route migrates it keeps its legacy string shape — the two shapes must not
// be mixed inside one route. Frontend consumers use
// @mta-market/shared getErrorMessage, which understands both.
//
// HTTP status policy (E-005) — one mapping, no endpoint-specific semantics:
//   400 VALIDATION_FAILED        — malformed input (schema validation)
//   401 UNAUTHORIZED             — missing/invalid/expired credentials
//   403 FORBIDDEN                — authenticated, not allowed
//   404 NOT_FOUND                — resource/route does not exist
//   409 CONFLICT                 — state conflict, duplicate, idempotency
//   422 UNPROCESSABLE            — semantically invalid business payload
//   429 RATE_LIMITED             — too many requests
//   500 INTERNAL                 — unexpected server failure (no details leak)
//   502 BAD_GATEWAY              — external provider returned garbage
//   503 SERVICE_UNAVAILABLE      — dependency down (Redis fail-closed etc.)

import type { Request } from "express";

export type ApiErrorPayload = {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);
export const unauthorized = (message = "Требуется авторизация", code = "UNAUTHORIZED") =>
  new ApiError(401, code, message);
export const forbidden = (message = "Доступ запрещён", code = "FORBIDDEN") =>
  new ApiError(403, code, message);
export const notFound = (message = "Не найдено", code = "NOT_FOUND") =>
  new ApiError(404, code, message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new ApiError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new ApiError(422, code, message, details);
export const tooManyRequests = (message = "Слишком много запросов", code = "RATE_LIMITED") =>
  new ApiError(429, code, message);
export const internal = (message = "Внутренняя ошибка сервера", code = "INTERNAL") =>
  new ApiError(500, code, message);
export const badGateway = (code: string, message: string, details?: unknown) =>
  new ApiError(502, code, message, details);
export const serviceUnavailable = (code: string, message: string, details?: unknown) =>
  new ApiError(503, code, message, details);

/** Map a legacy numeric status to its canonical code (E-005 table). */
export function canonicalCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "VALIDATION_FAILED";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "UNPROCESSABLE";
    case 429:
      return "RATE_LIMITED";
    case 502:
      return "BAD_GATEWAY";
    case 503:
      return "SERVICE_UNAVAILABLE";
    default:
      return "INTERNAL";
  }
}

/** Build the canonical payload for any thrown value. Never leaks internals:
 *  unknown errors collapse to 500 INTERNAL with the generic message; stack
 *  traces, SQL fragments and secret values never enter the payload. */
export function toErrorPayload(error: unknown, requestId?: string): {
  status: number;
  payload: ApiErrorPayload;
} {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      payload: {
        error: {
          code: error.code,
          message: error.message,
          ...(requestId ? { requestId } : {}),
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      },
    };
  }
  return {
    status: 500,
    payload: {
      error: {
        code: "INTERNAL",
        message: "Внутренняя ошибка сервера",
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}

/** Convenience for route handlers that answer errors themselves. */
export function requestIdOf(req: Request): string | undefined {
  const header = req.headers["x-request-id"];
  return typeof header === "string" ? header : undefined;
}
