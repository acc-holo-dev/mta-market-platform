// PLAN O-001: HTTP metrics middleware + Q-001 security headers.
// - records http_requests_total / http_5xx_total / http_latency_ms;
// - sets baseline security headers on every response (helmet-equivalent
//   without a dependency).
import type { Request, Response, NextFunction } from "express";
import { metrics, METRIC_HELP } from "../lib/metrics";

export function observabilityMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  // Q-001: security headers.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  // API-only surface: no need for scripts/styles from anywhere.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  if (process.env.NODE_ENV === "production") {
    // Behind TLS-terminating proxy; harmless on plain HTTP dev.
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const route = req.originalUrl?.split("?")[0] ?? "unknown";
    const labels = { method: req.method, route, status_class: `${Math.floor(res.statusCode / 100)}xx` };
    metrics.counter("http_requests_total", METRIC_HELP.http_requests_total, labels);
    if (res.statusCode >= 500) {
      metrics.counter("http_5xx_total", METRIC_HELP.http_5xx_total, { route });
    }
    metrics.observe("http_latency_ms", METRIC_HELP.http_latency_ms, durationMs);
  });

  next();
}
