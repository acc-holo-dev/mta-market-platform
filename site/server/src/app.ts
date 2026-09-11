// TASK A-001/A-002/A-003/A-006: Express app factory.
// Extracted from index.ts so integration tests can boot the app
// without binding a port (supertest) and so middleware wiring is
// explicit and testable.
import express, { Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { requestIdMiddleware } from "./middleware/requestId";
import { observabilityMiddleware } from "./middleware/observability";
import { metrics } from "./lib/metrics";
import { db } from "./prisma/db";
import authRoutes from "./routes/auth";
import resourcesRoutes from "./routes/resources";
import versionsRoutes from "./routes/versions";
import reviewsRoutes from "./routes/reviews";
import drmRoutes from "./routes/drm";
import drmV2Routes from "./routes/drm/v2";
import purchasesRoutes from "./routes/purchases";
import uploadRoutes from "./routes/upload";
import mediaRoutes from "./routes/media";
import paymentsRoutes from "./routes/payments";
import adminRoutes from "./routes/admin";
import servicesRoutes from "./routes/services";
import sellerRoutes from "./routes/seller";
import sellersRoutes from "./routes/sellers";
import disputesRoutes from "./routes/disputes";
// PLAN-005: Community & Server Foundation routers.
import serversRoutes from "./routes/servers";
import serverNewsRoutes from "./routes/serverNews";
import serverReviewsRoutes from "./routes/serverReviews";
import communityRoutes from "./routes/community";
import notificationsRoutes from "./routes/notifications";
import reportsRoutes from "./routes/reports";
import integrationRoutes from "./routes/integration";
import profilesRoutes from "./routes/profiles";
import searchRoutes from "./routes/search";
import newsRoutes from "./routes/news";
import dashboardRoutes from "./routes/dashboard";
// PLAN-006: Daily Experience read layer (derived activity, live aggregates).
import activityRoutes from "./routes/activity";
// PLAN-007: Content Foundation (articles).
import contentRoutes from "./routes/content";
import adminContentRoutes from "./routes/adminContent";
// PLAN-008: Follow Expansion (Creator + Resource).
import followsRoutes from "./routes/follows";
import adminCommunityRoutes from "./routes/adminCommunity";
import { standardRateLimit } from "./lib/rateLimit";
import { reqLog } from "./middleware/requestId";

/**
 * Allowed browser origins for cross-origin credentialed requests.
 *
 * TASK A-003 topology decision:
 * - production: same-origin behind nginx (`/api/` -> backend), so the
 *   browser never issues a cross-origin request; CORS stays closed by
 *   default (empty allowlist = no cross-origin access).
 * - development: web :3000 -> api :3001 is cross-origin, so the allowlist
 *   must explicitly contain the web origin (CORS_ORIGINS env).
 *
 * Wildcard origins are forbidden with credentials (browser spec and plan).
 */
function getAllowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export function createApp(): Express {
  const app = express();

  // Behind nginx (docker-compose.prod / nginx.conf) the real client IP
  // arrives via X-Forwarded-For. Trust exactly one proxy hop so req.ip
  // is the client address for rate limiting and audit fields.
  // Set TRUST_PROXY=false for direct-exposure deployments.
  if (process.env.TRUST_PROXY !== "false") {
    app.set("trust proxy", 1);
  }

  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());
  // PLAN B-007: request_id on every request (header + logs).
  app.use(requestIdMiddleware);
  // PLAN O-001/Q-001: metrics + security headers.
  app.use(observabilityMiddleware);

  const allowedOrigins = getAllowedOrigins();
  app.use(
    cors({
      origin(origin, callback) {
        // Non-browser clients (curl, server-to-server, same-origin) send
        // no Origin header -> allow. Browser origins must be allowlisted.
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  app.use(standardRateLimit);

  app.get("/", (_req, res) => {
    res.json({
      name: "MTA Market API",
      version: "0.1.0",
      status: "ok",
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "healthy", timestamp: new Date().toISOString() });
  });

  // PLAN O-002: separate liveness and readiness probes.
  // /live: the process is up (no dependency checks).
  app.get("/live", (_req, res) => {
    res.json({ status: "live" });
  });

  // /ready: required dependencies answer. DB is required; Redis failures
  // degrade (rate limiter fails open) and are reported but non-fatal.
  app.get("/ready", async (_req, res) => {
    const checks: Record<string, string> = {};
    let ready = true;
    try {
      await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
      checks.database = "ok";
    } catch {
      checks.database = "unavailable";
      ready = false;
    }
    checks.redis = "optional";
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", checks });
  });

  // PLAN O-001: Prometheus text exposition endpoint.
  app.get("/metrics", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(metrics.render());
  });

  app.use("/auth", authRoutes);
  app.use("/resources", resourcesRoutes);
  app.use("/resources", versionsRoutes);
  app.use("/resources", reviewsRoutes);
  // TASK A-006: DRM v2 is the canonical machine protocol (/drm/v2/*).
  app.use("/drm", drmV2Routes);
  // TASK A-007: v1 activation endpoints are deprecated (410) inside;
  // v1 license management endpoints (my-licenses, revoke) remain.
  app.use("/drm", drmRoutes);
  app.use("/purchases", purchasesRoutes);
  app.use("/upload", uploadRoutes);
  // PLAN-003 A-002: public media serving (covers/screenshots). Mounted before
  // the JSON 404 handler; read-only, serves only media-<hex> image names.
  app.use("/media", mediaRoutes);
  app.use("/payments", paymentsRoutes);
  app.use("/services", servicesRoutes);
  app.use("/seller", sellerRoutes);
  // PLAN-003 E-001: public seller storefront (читаемый username в URL).
  app.use("/sellers", sellersRoutes);
  app.use("/disputes", disputesRoutes);
  app.use("/admin", adminRoutes);
  // PLAN-005 mounts. /servers/:slug/create-safety: static subroutes are
  // registered inside each router before dynamic ones.
  app.use("/servers", serversRoutes);
  app.use("/servers", serverNewsRoutes);
  app.use("/servers", serverReviewsRoutes);
  app.use("/community", communityRoutes);
  app.use("/notifications", notificationsRoutes);
  app.use("/reports", reportsRoutes);
  app.use("/integration", integrationRoutes);
  app.use("/profiles", profilesRoutes);
  app.use("/search", searchRoutes);
  app.use("/news", newsRoutes);
  app.use("/dashboard", dashboardRoutes);
  // PLAN-006: Daily Experience read layer (derived activity, live aggregates).
  app.use("/activity", activityRoutes);
  // PLAN-007: Content Foundation (articles).
  app.use("/content", contentRoutes);
  app.use("/admin", adminCommunityRoutes);
  app.use("/admin", adminContentRoutes);
  // PLAN-008: Follow Expansion (creator/resource follow, own follow state).
  // Paths inside the router are absolute (/creators/..., /resources/...,
  // /me/follows/...); a single root mount avoids double prefixes.
  app.use("/", followsRoutes);

  // PLAN-004 J-003 (audit): global error handler — in Express 4 a rejected
  // async handler would otherwise become an unhandledRejection and crash the
  // process. Must be registered after all routes (4 args make it an error
  // middleware).
  app.use(
    (
      error: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      reqLog(req).error("unhandled_route_error", { error });
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Explicit JSON 404 for unknown routes (TASK A-005 relies on this for
  // disabled test endpoints in production-like environments).
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return app;
}