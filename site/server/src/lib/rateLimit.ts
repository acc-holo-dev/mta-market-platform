// Rate limiting middleware using Redis
import { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";
import { logger } from "./logger";

interface RateLimitOptions {
  windowMs: number; // время окна в миллисекундах
  max: number; // максимум запросов в окне
  keyPrefix?: string;
  /**
   * PLAN-004 M-002: Redis outage semantics.
   * - fail-closed (security-critical limiters: auth, strict, per-account):
   *   when Redis cannot be reached the request is rejected with 503 — an
   *   unavailable limiter must not silently disable brute-force protection;
   * - fail-open (bulk traffic): availability wins, the limiter is skipped
   *   for the failed request.
   * Global override: RATE_LIMIT_FAIL_CLOSED ("true"/"false").
   */
  failClosed?: boolean;
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix = "rl", failClosed = false } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const identifier = req.ip || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${identifier}`;

    try {
      const current = await redis.incr(key);

      if (current === 1) {
        await redis.pexpire(key, windowMs);
      }

      res.setHeader("X-RateLimit-Limit", max);
      res.setHeader("X-RateLimit-Remaining", Math.max(0, max - current));

      if (current > max) {
        res.status(429).json({
          error: "Too many requests",
          retryAfter: Math.ceil(windowMs / 1000),
        });
        return;
      }

      next();
    } catch (error) {
      logger.error("rate_limit_error", { key_prefix: keyPrefix, fail_closed: failClosed, error });
      if (failClosed) {
        // M-002: security-critical limiters must not degrade into "no limit".
        // 503 tells the client/probe the dependency is down (vs 429 "you are
        // abusive"); operator alerts fire on the error log above.
        res.status(503).json({ error: "Rate limiter temporarily unavailable" });
        return;
      }
      next();
    }
  };
}

// Предустановки
// Thresholds are env-configurable so staging/tests can tune them without
// code changes. Production values are pinned in docker-compose.prod.yml
// (PLAN-004 A-003) — dev/E2E values must never leak into production.
export const strictRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: parseInt(process.env.STRICT_RATE_LIMIT_MAX || "10", 10),
  keyPrefix: "rl:strict",
  failClosed: true, // DRM/upload protection: fail closed
});

export const standardRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: parseInt(process.env.STANDARD_RATE_LIMIT_MAX || "300", 10),
  keyPrefix: "rl:standard",
  // PLAN-004 M-002: the global limiter covers bulk traffic; hard-failing the
  // whole API because Redis hiccuped is worse than losing one limit window.
  // RATE_LIMIT_FAIL_CLOSED=true opts into fail-closed for it as well.
  failClosed: (process.env.RATE_LIMIT_FAIL_CLOSED ?? "false") === "true",
});

export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: parseInt(process.env.AUTH_RATE_LIMIT_MAX || "300", 10),
  keyPrefix: "rl:auth",
  failClosed: true, // login/register/refresh brute-force protection
});

/**
 * PLAN Q-002: per-account rate limiting for sensitive operations. Identity
 * (user id) dimensions complement IP limits: a single account cannot brute
 * force refresh/coupons/reviews by rotating IPs. Fails closed like the other
 * security-critical limiters when Redis is unavailable (M-002).
 */
export function userRateLimit(options: {
  windowMs: number;
  max: number;
  action: string;
}) {
  const { windowMs, max, action } = options;

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    // Tests exercise endpoints repeatedly with fixed user ids; the per-user
    // limiter follows the same policy as the IP limiters in vitest.config
    // (AUTH_RATE_LIMIT_MAX=1000 etc.): disabled under NODE_ENV=test.
    if (process.env.NODE_ENV === "test") {
      next();
      return;
    }
    const userId =
      (req as { user?: { userId?: string } }).user?.userId ??
      req.ip ??
      "unknown";
    const key = `rlu:${action}:${userId}`;

    try {
      const current = await redis.incr(key);
      if (current === 1) {
        await redis.pexpire(key, windowMs);
      }
      if (current > max) {
        logger.warn("user_rate_limit_exceeded", { action, user_id: userId });
        res.status(429).json({
          error: "Too many requests for this action",
          retryAfter: Math.ceil(windowMs / 1000),
        });
        return;
      }
      next();
    } catch (error) {
      logger.error("rate_limit_error", { key_prefix: `rlu:${action}`, fail_closed: true, error });
      res.status(503).json({ error: "Rate limiter temporarily unavailable" });
    }
  };
}

import type { AuthRequest as AuthenticatedRequest } from "./auth";
