// TASK A-002/A-003: Centralized cookie handling for authentication.
// Single source of truth for cookie names and attributes so that the
// cookie policy stays consistent with the deployment topology (A-003).
import type { Response } from "express";

export const REFRESH_COOKIE = "refresh_token";

// Refresh token lifetime must match the JWT refresh expiry (7d default).
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type CookieSameSite = "lax" | "strict" | "none";

/**
 * Resolve cookie attributes from the environment.
 *
 * Topology rules (TASK A-003):
 * - production is same-origin behind nginx -> SameSite=Lax + Secure;
 * - cross-origin development (web :3000 -> api :3001) requires
 *   COOKIE_SAMESITE=none, which forces Secure (browser requirement;
 *   localhost is treated as a trustworthy context by modern browsers).
 */
export function getRefreshCookieAttributes(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: CookieSameSite;
  path: string;
  maxAge: number;
} {
  const raw = (process.env.COOKIE_SAMESITE || "lax").toLowerCase();
  const sameSite: CookieSameSite =
    raw === "strict" || raw === "none" ? (raw as CookieSameSite) : "lax";

  // SameSite=None is rejected by browsers without the Secure attribute.
  const secure = process.env.NODE_ENV === "production" || sameSite === "none";

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  };
}

/** Set the refresh token cookie on a response. */
export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, getRefreshCookieAttributes());
}

/** Clear the refresh token cookie on a response. */
export function clearRefreshCookie(res: Response): void {
  const attrs = getRefreshCookieAttributes();
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: attrs.httpOnly,
    secure: attrs.secure,
    sameSite: attrs.sameSite,
    path: attrs.path,
  });
}