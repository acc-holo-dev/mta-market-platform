// TASK A-001/A-002/A-003/A-006: Express app factory.
// Extracted from index.ts so integration tests can boot the app
// without binding a port (supertest) and so middleware wiring is
// explicit and testable.
import express, { Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { observabilityMiddleware } from "./middleware/observability.js";
import { metrics, recordOutboxGauge } from "./lib/metrics.js";
import { db } from "./prisma/db.js";
import authRoutes from "./routes/auth.js";
import resourcesRoutes from "./routes/resources.js";
import versionsRoutes from "./routes/versions.js";
import reviewsRoutes from "./routes/reviews.js";
import drmRoutes from "./routes/drm.js";
import drmV2Routes from "./routes/drm/v2.js";
import purchasesRoutes from "./routes/purchases.js";
import uploadRoutes from "./routes/upload.js";
import mediaRoutes from "./routes/media.js";
import paymentsRoutes from "./routes/payments.js";
import adminRoutes from "./routes/admin.js";
import servicesRoutes from "./routes/services.js";
import sellerRoutes from "./routes/seller.js";
import sellersRoutes from "./routes/sellers.js";
import disputesRoutes from "./routes/disputes.js";
// PLAN-005: Community & Server Foundation routers.
import serversRoutes from "./routes/servers.js";
import serverNewsRoutes from "./routes/serverNews.js";
import serverReviewsRoutes from "./routes/serverReviews.js";
import communityRoutes from "./routes/community.js";
import notificationsRoutes from "./routes/notifications.js";
import reportsRoutes from "./routes/reports.js";
import integrationRoutes from "./routes/integration.js";
import profilesRoutes from "./routes/profiles.js";
import searchRoutes from "./routes/search.js";
import newsRoutes from "./routes/news.js";
import dashboardRoutes from "./routes/dashboard.js";
// PLAN-006: Daily Experience read layer (derived activity, live aggregates).
import activityRoutes from "./routes/activity.js";
// PLAN-007: Content Foundation (articles).
import contentRoutes from "./routes/content.js";
import adminContentRoutes from "./routes/adminContent.js";
// PLAN-008: Follow Expansion (Creator + Resource).
import followsRoutes from "./routes/follows.js";
import adminCommunityRoutes from "./routes/adminCommunity.js";
// PLAN-017 §9/§10: platform configuration surface (feature flags).
import configRoutes from "./routes/config.js";
// PLAN-017 F/G/H: admin platform, advertising control center, premium
// entitlements (feature module routers).
import adminPlatformRoutes from "./routes/adminPlatform.js";
import advertisingRoutes from "./routes/advertising.js";
import adminAdvertisingRoutes from "./routes/adminAdvertising.js";
import adminPremiumRoutes from "./routes/adminPremium.js";
// Wave-6 productization routers (PLAN-018): finance, trust, updates,
// favorites, alerts, subscriptions, deals, demo, feedback, leak radar.
import adminFinanceRoutes from "./routes/adminFinance.js";
import sellerPayoutsRoutes from "./routes/sellerPayouts.js";
import sellerDiscountRoutes from "./routes/discounts.js";
import trustRoutes from "./routes/trust.js";
import updatesRoutes from "./routes/updates.js";
import favoritesRoutes from "./routes/favorites.js";
import alertsRoutes from "./routes/alerts.js";
import subscriptionRoutes from "./routes/subscriptions.js";
import dealRoutes from "./routes/deals.js";
import demoRoutes from "./routes/demo.js";
import feedbackRoutes from "./routes/feedback.js";
import leakRoutes from "./routes/leak.js";
// PLAN-017 §44: unhandled route errors land in the SystemLog admin surface.
import { logUnhandled, type RequestLogContext } from "./lib/systemLog.js";
import { standardRateLimit } from "./lib/rateLimit.js";
import { reqLog } from "./middleware/requestId.js";

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

  // PLAN-020 Q-005-a: webhook payloads are small signed JSON documents. A
  // tight route-scoped parser (mounted BEFORE the global 10mb one) removes
  // the unauthenticated large-body parse surface on signature-checked
  // routes; the rawBody stash required for HMAC verification is preserved.
  app.use(
    "/payments/webhook",
    express.json({
      limit: "256kb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );

  // PLAN-016 P-002: stash raw bytes for HMAC webhook verification while
  // keeping the global JSON body parsing contract unchanged.
  app.use(
    express.json({
      limit: "10mb",
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
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
  app.get("/metrics", async (_req, res) => {
    // PLAN-020 P-003.1: outbox gauges are derived from the live database at
    // scrape time. The worker is a separate process — its in-memory registry
    // is not scrapeable — and process-local counters would silently render
    // zeros forever (the exact defect the audit flagged). Bounded COUNT
    // queries, best-effort: scrape never fails on observability.
    try {
      const statusCounts = await Promise.all(
        (["PENDING", "PROCESSING", "FAILED", "PROCESSED"] as const).map((status) =>
          db.orm.public.OutboxEvent
            .where({ status })
            .aggregate((agg: any) => ({ total: agg.count() }))
            .then((r: unknown) => Number((r as { total?: number })?.total ?? 0))
            .catch(() => 0)
        )
      );
      const [pending, processing, failed, processed] = statusCounts;
      recordOutboxGauge("outbox_depth", pending + processing);
      recordOutboxGauge("outbox_dead_letter", failed);
      recordOutboxGauge("outbox_processed", processed);
    } catch {
      // keep the previous series; never fail the scrape
    }
    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(metrics.render());
  });

  // PLAN-017 §9: typed feature flags (config/application/features.yaml).
  app.use("/config", configRoutes);

  app.use("/auth", authRoutes);
  app.use("/resources", resourcesRoutes);
  app.use("/resources", versionsRoutes);
  app.use("/resources", reviewsRoutes);
  // TASK A-006: DRM v2 is the canonical machine protocol (/drm/v2/*).
  app.use("/drm", drmV2Routes);
  // TASK A-007: v1 activation endpoints are deprecated (410) inside.
  // PLAN-020 A-004.01: the v1 license management endpoints were removed —
  // canonical license management lives in lib/drm/service.ts via /drm/v2.
  app.use("/drm", drmRoutes);
  app.use("/purchases", purchasesRoutes);
  app.use("/upload", uploadRoutes);
  // PLAN-003 A-002: public media serving (covers/screenshots). Mounted before
  // the JSON 404 handler; read-only, serves only media-<hex> image names.
  app.use("/media", mediaRoutes);
  app.use("/payments", paymentsRoutes);
  app.use("/services", servicesRoutes);
  app.use("/seller", sellerRoutes);
  // PLAN-003 E-001: public seller storefront (читаеКъй username У URL).
  app.use("/sellers", sellersRoutes);
  app.use("/disputes", disputesRoutes);
  // PLAN-017 §36–§45: the admin platform router MUST precede the legacy
  // admin router — both define GET /admin/users and PATCH /admin/users/:id/role,
  // and Express matches mounts in registration order. Without this ordering
  // the §37 user list and the §41 guarded role change are unreachable.
  // All other legacy admin paths (/resources, /stats, /versions, ...) do not
  // overlap and still resolve through adminRoutes.
  app.use("/admin", adminPlatformRoutes);
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
  // PLAN-017 F/G/H: admin platform (users/roles/audit/logs/overview),
  // advertising control center, premium entitlements.
  app.use("/admin/advertising", adminAdvertisingRoutes);
  app.use("/admin/premium", adminPremiumRoutes);
  app.use("/advertising", advertisingRoutes);
  // Wave-6 productization: prefixed mounts (routers use prefixed-relative
  // paths) plus root-late mounts for routers that own mixed surfaces
  // (user + admin paths inside one file, follows-router precedent). The
  // /seller sub-routers come after sellerRoutes and only handle paths the
  // legacy seller router leaves unmatched.
  app.use("/seller", sellerPayoutsRoutes);
  app.use("/seller", sellerDiscountRoutes);
  app.use("/trust", trustRoutes);
  app.use("/me", updatesRoutes);
  app.use("/admin/finance", adminFinanceRoutes);
  app.use("/admin/leak-cases", leakRoutes);
  app.use("/", favoritesRoutes);
  app.use("/", alertsRoutes);
  app.use("/", subscriptionRoutes);
  app.use("/", dealRoutes);
  app.use("/", demoRoutes);
  app.use("/", feedbackRoutes);
  // PLAN-008: Follow Expansion (creator/resource follow, own follow state).
  // Paths inside the router are absolute (/creators/..., /resources/...,
  // /me/follows/...); a single root mount avoids double prefixes.
  app.use("/", followsRoutes);

  // PLAN-004 J-003 (audit): global error handler — in Express 4 a rejected
  // async handler would otherwise become an unhandledRejection and crash the
  // process. Must be registered after all routes (4 args make it an error
  // middleware). PLAN-017 §44: unhandled errors are mirrored into the
  // SystemLog (append-only admin surface) in addition to the request log.
  app.use(
    (
      error: unknown,
      req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      reqLog(req).error("unhandled_route_error", { error });
      logUnhandled(error, { req: req as unknown as RequestLogContext });
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