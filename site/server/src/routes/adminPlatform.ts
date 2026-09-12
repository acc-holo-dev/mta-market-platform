// Admin platform routes (PLAN-017 §36–§45): overview, user management, roles,
// permissions, user activity, audit center, system logs, entity search.
//
// Every route is guarded by the typed permission catalog
// (lib/permissions.ts) instead of ad-hoc role checks. Express 4 does NOT
// auto-catch async handler rejections — every handler catches its own errors
// (routes/servers.ts convention) and mirrors the failure into SystemLog via
// logUnhandled (the global error-handler wiring happens in a later wave).
import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { validateCuid } from "../middleware/validateCuid.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { recordAudit } from "../lib/audit.js";
import { createNotifications } from "../lib/notify.js";
import { affectedCount } from "../lib/ledger.js";
import { logSystem, logUnhandled } from "../lib/systemLog.js";
import {
  PERMISSION_CATALOG,
  ROLE_LABELS,
  ROLE_ORDER,
  ROLE_PERMISSIONS,
  requirePermission,
  type PlatformRole,
} from "../lib/permissions.js";

const router: Router = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function routeOf(req: AuthRequest): string | null {
  return req.originalUrl?.split("?")[0] ?? null;
}

/** Honest total via the aggregate lane (PLAN B-004). */
async function countOf(model: unknown): Promise<number> {
  const agg = await (model as {
    aggregate: (fn: (agg: any) => Record<string, unknown>) => Promise<Record<string, unknown>>;
  }).aggregate((agg: any) => ({ total: agg.count() }));
  return Number(agg.total ?? 0);
}

/**
 * Runtime groupBy returns [{ <groupKeys>, n }], but the static ORM typing
 * models groupBy rows as full table rows — the chain is loosened here,
 * exactly like routes/admin.ts (verified against a live DB).
 */
async function countBy(model: unknown, column: string): Promise<Record<string, number>> {
  const rows = await (model as {
    groupBy: (cols: string[]) => {
      aggregate: (
        fn: (agg: Record<string, (...args: unknown[]) => unknown>) => Record<string, unknown>
      ) => Promise<Array<Record<string, unknown>>>;
    };
  }).groupBy([column]).aggregate((agg) => ({ n: agg.count() }));
  const map: Record<string, number> = {};
  for (const row of rows) map[String(row[column])] = Number(row.n);
  return map;
}

/** Grouped max for TimestamptzString columns (e.g. last login per user). */
async function maxBy(
  model: unknown,
  valueColumn: string,
  groupColumn: string
): Promise<Map<string, string | null>> {
  const rows = await (model as {
    groupBy: (cols: string[]) => {
      aggregate: (
        fn: (agg: Record<string, (...args: unknown[]) => unknown>) => Record<string, unknown>
      ) => Promise<Array<Record<string, unknown>>>;
    };
  }).groupBy([groupColumn]).aggregate((agg) => ({ m: agg.max(valueColumn) }));
  const map = new Map<string, string | null>();
  for (const row of rows) {
    // agg.max returns the raw pg timestamp text ("2026-01-01 12:00:00+00") —
    // normalize to the ISO shape row reads use so consumers get one format.
    const raw = (row.m as string | null) ?? null;
    let normalized: string | null = null;
    if (raw) {
      try {
        const parsed = new Date(raw);
        normalized = Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
      } catch {
        normalized = raw;
      }
    }
    map.set(String(row[groupColumn]), normalized);
  }
  return map;
}

function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

function parsePage(query: Record<string, unknown>, fallbackLimit: number, maxLimit: number) {
  const page = Math.max(parseInt(String(query.page ?? "1"), 10) || 1, 1);
  const limit = Math.min(
    Math.max(parseInt(String(query.limit ?? String(fallbackLimit)), 10) || fallbackLimit, 1),
    maxLimit
  );
  return { page, limit, skip: (page - 1) * limit };
}

/** Safe user projection — passwordHash never leaves the API (§37). */
function userProjection(u: any) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.displayName,
    avatar: u.avatar,
    role: u.role,
    status: u.status,
    emailVerified: u.emailVerified,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    dashboardSeenAt: u.dashboardSeenAt,
  };
}

// ---------------------------------------------------------------------------
// Validation schemas (lib/validation.ts style)
// ---------------------------------------------------------------------------

const USER_ROLES = ["USER", "SELLER", "MODERATOR", "SUPPORT", "FINANCE", "ADMIN", "SUPERADMIN"] as const;
const USER_STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"] as const;

export const suspendUserSchema = z.object({
  reason: z.string().min(1).max(1000),
  confirm: z.boolean().optional(),
});

export const restoreUserSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export const changeRoleSchema = z.object({
  role: z.enum(USER_ROLES),
  confirm: z.boolean().optional(),
  reason: z.string().max(1000).optional(),
});

const usersQuerySchema = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(USER_STATUSES).optional(),
  role: z.enum(USER_ROLES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const auditQuerySchema = z.object({
  userId: z.string().max(100).optional(),
  actorId: z.string().max(100).optional(),
  action: z.string().max(200).optional(),
  targetType: z.string().max(100).optional(),
  targetId: z.string().max(100).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  ip: z.string().max(64).optional(),
  requestId: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const systemLogsQuerySchema = z.object({
  level: z.enum(["DEBUG", "INFO", "WARN", "ERROR"]).optional(),
  service: z.string().max(100).optional(),
  requestId: z.string().max(100).optional(),
  route: z.string().max(200).optional(),
  errorCode: z.string().max(100).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const searchEntitiesQuerySchema = z.object({
  type: z.enum(["user", "resource", "server", "review", "thread", "news", "article", "version"]),
  q: z.string().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

// ---------------------------------------------------------------------------
// §36: overview — one bounded aggregate round, no N+1
// ---------------------------------------------------------------------------

// Disputes still requiring staff attention (resolved states are history).
const OPEN_DISPUTE_STATUSES = ["OPEN", "WAITING_BUYER", "WAITING_SELLER", "UNDER_REVIEW"];
// Money-bearing payment states (captured per payment_purchase_captured_uq).
const CAPTURED_PAYMENT_STATUSES = ["SUCCEEDED", "SETTLEMENT_PENDING", "SETTLED"];

router.get(
  "/overview",
  authenticate,
  requirePermission("users.view"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const since30d = new Date(Date.now() - 30 * 24 * 3600_000);

      // Trivial DB probe: system.database reports THIS probe's outcome (§36).
      let database = "ok";
      try {
        await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
      } catch {
        database = "unavailable";
      }

      const [userStatuses, resourceStatuses, serverVerification, reportOpen, purchaseAgg, paymentAgg, adActive, entTotal, entExpiredActive, disputeOpen] =
        await Promise.all([
          countBy(db.orm.public.User, "status"),
          countBy(db.orm.public.Resource, "status"),
          countBy(db.orm.public.Server, "verification"),
          countOf(db.orm.public.Report.where({ status: "OPEN" })),
          db.orm.public.Purchase
            .where({ status: "COMPLETED" })
            .where((p: any) => p.createdAt.gte(since30d))
            .aggregate((a: any) => ({ count: a.count() })),
          db.orm.public.Payment
            .where((p: any) => p.status.in(CAPTURED_PAYMENT_STATUSES))
            .where((p: any) => p.createdAt.gte(since30d))
            .aggregate((a: any) => ({ revenue: a.sum("amount") })),
          countOf(db.orm.public.AdCampaign.where({ status: "ACTIVE" })),
          countOf(db.orm.public.Entitlement.where({ revokedAt: null })),
          db.orm.public.Entitlement
            .where({ revokedAt: null })
            .where((e: any) => e.expiresAt.lte(new Date()))
            .aggregate((a: any) => ({ count: a.count() })),
          countOf(db.orm.public.Dispute.where((d: any) => d.status.in(OPEN_DISPUTE_STATUSES))),
        ]);

      res.json({
        users: {
          total:
            Number(userStatuses.ACTIVE ?? 0) +
            Number(userStatuses.SUSPENDED ?? 0) +
            Number(userStatuses.BANNED ?? 0),
          active: Number(userStatuses.ACTIVE ?? 0),
          suspended: Number(userStatuses.SUSPENDED ?? 0),
          banned: Number(userStatuses.BANNED ?? 0),
        },
        resources: {
          total:
            Number(resourceStatuses.DRAFT ?? 0) +
            Number(resourceStatuses.PENDING_REVIEW ?? 0) +
            Number(resourceStatuses.PUBLISHED ?? 0) +
            Number(resourceStatuses.SUSPENDED ?? 0),
          published: Number(resourceStatuses.PUBLISHED ?? 0),
          pendingReview: Number(resourceStatuses.PENDING_REVIEW ?? 0),
        },
        servers: {
          total:
            Number(serverVerification.PENDING ?? 0) +
            Number(serverVerification.VERIFIED ?? 0) +
            Number(serverVerification.FAILED ?? 0) +
            Number(serverVerification.EXPIRED ?? 0),
          verified: Number(serverVerification.VERIFIED ?? 0),
          pending: Number(serverVerification.PENDING ?? 0),
        },
        reports: { open: Number(reportOpen) },
        disputes: { open: Number(disputeOpen) },
        sales: {
          // kopecks; names mirror the web façade (AdminOverview.sales)
          count30d: Number(purchaseAgg.count ?? 0),
          revenueMinor30d: Number(paymentAgg.revenue ?? 0),
        },
        advertising: { activeCampaigns: Number(adActive) },
        premium: {
          // Active = not revoked and not expired (revokedAt NULL minus the
          // expired subset — avoids an OR predicate on a nullable column).
          activeEntitlements: Number(entTotal) - Number(entExpiredActive.count ?? 0),
        },
        system: { database, uptimeSeconds: Math.floor(process.uptime()) },
      });
    } catch (error) {
      reqLog(req).error("admin_overview_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch admin overview" });
    }
  }
);

// ---------------------------------------------------------------------------
// §37: user management
// ---------------------------------------------------------------------------

// GET /admin/users — paged user list with search/filters and per-row counters.
router.get(
  "/users",
  authenticate,
  requirePermission("users.view"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = usersQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Validation failed");
        return;
      }
      const { search, status, role } = parsed.data;
      const { page, limit, skip } = parsePage(req.query as Record<string, unknown>, 20, 100);

      // Search is a cross-field OR (email/username/displayName): resolve a
      // bounded id set per field and union in JS — same approach as the
      // public /servers search (avoids untyped OR predicates).
      let searchIds: string[] | null = null;
      if (search && search.trim()) {
        const pattern = `%${search.trim()}%`;
        const [byEmail, byUsername, byDisplayName] = await Promise.all([
          db.orm.public.User.where((u: any) => u.email.ilike(pattern)).select("id").limit(400).all(),
          db.orm.public.User.where((u: any) => u.username.ilike(pattern)).select("id").limit(400).all(),
          db.orm.public.User.where((u: any) => u.displayName.ilike(pattern)).select("id").limit(400).all(),
        ]);
        searchIds = Array.from(
          new Set([...byEmail, ...byUsername, ...byDisplayName].map((r: any) => r.id as string))
        );
        if (searchIds.length === 0) {
          res.json({ users: [], total: 0, page, limit });
          return;
        }
      }

      const base = () => {
        let q = db.orm.public.User.where({});
        if (status) q = q.where({ status });
        if (role) q = q.where({ role });
        if (searchIds) q = q.where((u: any) => (u.id as any).in(searchIds));
        return q;
      };

      const rows = await base()
        .orderBy((u: any) => u.createdAt.desc())
        .limit(limit)
        .offset(skip)
        .all();
      const totalAgg = await base().aggregate((a: any) => ({ total: a.count() }));

      // Per-row enrichment for THIS page only (no N+1): one grouped query
      // per counter instead of per-user lookups.
      const ids = rows.map((r: any) => r.id as string);
      const [lastLogins, resourceCounts, purchaseCounts, identityCounts] = ids.length
        ? await Promise.all([
            maxBy(
              db.orm.public.Session.where((s: any) => s.userId.in(ids)),
              "createdAt",
              "userId"
            ),
            db.orm.public.Resource
              .where((r: any) => r.sellerId.in(ids))
              .groupBy("sellerId")
              .aggregate((a: any) => ({ total: a.count() })),
            db.orm.public.Purchase
              .where((p: any) => p.buyerId.in(ids))
              .groupBy("buyerId")
              .aggregate((a: any) => ({ total: a.count() })),
            db.orm.public.Account
              .where((a: any) => a.userId.in(ids))
              .groupBy("userId")
              .aggregate((a: any) => ({ total: a.count() })),
          ])
        : [new Map(), new Map(), new Map(), new Map()];

      const groupedCounts = (groupRows: unknown, key: string): Map<string, number> => {
        const map = new Map<string, number>();
        for (const row of groupRows as any[]) map.set(row[key], Number(row.total ?? 0));
        return map;
      };
      const resourceMap = groupedCounts(resourceCounts, "sellerId");
      const purchaseMap = groupedCounts(purchaseCounts, "buyerId");
      const identityMap = groupedCounts(identityCounts, "userId");
      const loginMap = lastLogins as Map<string, string | null>;

      res.json({
        users: rows.map((u: any) => ({
          id: u.id,
          email: u.email,
          username: u.username,
          displayName: u.displayName,
          role: u.role,
          status: u.status,
          createdAt: u.createdAt,
          lastLoginAt: loginMap.get(u.id) ?? null,
          counts: {
            resources: resourceMap.get(u.id) ?? 0,
            purchases: purchaseMap.get(u.id) ?? 0,
            identities: identityMap.get(u.id) ?? 0,
          },
        })),
        total: Number((totalAgg as any).total ?? 0),
        page,
        limit,
      });
    } catch (error) {
      reqLog(req).error("admin_platform_users_fetch_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch users" });
    }
  }
);

// GET /admin/users/:id — full inspect (§37). No tokens/secrets leave the DB.
router.get(
  "/users/:id",
  authenticate,
  requirePermission("users.view"),
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.params.id as string;
      const user = await db.orm.public.User.where({ id: userId }).first();
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const ownResources = await db.orm.public.Resource
        .where({ sellerId: userId })
        .select("id", "slug", "title", "status")
        .orderBy((r: any) => r.createdAt.desc())
        .limit(20)
        .all();
      const ownResourceIds = ownResources.map((r: any) => r.id as string);

      const [identities, sessionAgg, lastSession, authoredModeration, targetedModeration, purchases, sellerProfile] =
        await Promise.all([
          // OAuth identity providers ONLY — accessToken/refreshToken never
          // cross the API boundary (§37). The Account model carries no
          // createdAt column — provider linkage only.
          db.orm.public.Account
            .where({ userId })
            .select("provider", "providerAccountId")
            .limit(20)
            .all(),
          db.orm.public.Session.where({ userId }).aggregate((a: any) => ({ total: a.count() })),
          db.orm.public.Session
            .where({ userId })
            .orderBy((s: any) => s.createdAt.desc())
            .limit(1)
            .all(),
          db.orm.public.ModerationEvent
            .where({ actorId: userId })
            .orderBy((m: any) => m.createdAt.desc())
            .limit(50)
            .all(),
          ownResourceIds.length
            ? db.orm.public.ModerationEvent
                .where((m: any) => (m.resourceId as any).in(ownResourceIds))
                .orderBy((m: any) => m.createdAt.desc())
                .limit(50)
                .all()
            : Promise.resolve([] as any[]),
          db.orm.public.Purchase
            .where({ buyerId: userId })
            .orderBy((p: any) => p.createdAt.desc())
            .limit(20)
            .all(),
          db.orm.public.SellerProfile.where({ userId }).first(),
        ]);

      // Bounded title resolution for the purchase summary.
      const purchaseResourceIds = Array.from(
        new Set((purchases as any[]).map((p) => p.resourceId as string))
      );
      const purchasedTitles = purchaseResourceIds.length
        ? await db.orm.public.Resource
            .where((r: any) => (r.id as any).in(purchaseResourceIds))
            .select("id", "title")
            .all()
        : [];
      const purchaseTitleById = new Map(
        purchasedTitles.map((r: any) => [r.id, r.title as string])
      );

      // Moderation history: events authored by the user + events on the
      // user's own resources (as the moderation target).
      const moderation = [
        ...(authoredModeration as any[]).map((m) => ({ ...m, kind: "authored" as const })),
        ...(targetedModeration as any[]).map((m) => ({ ...m, kind: "targeted" as const })),
      ]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 50);

      res.json({
        user: userProjection(user),
        // legacy aliases the web façade reads (AdminUserDetail): the same
        // data under the names the frontend consumes.
        identities: identities as any[],
        sessions: {
          count: Number(sessionAgg.total ?? 0),
          last: lastSession.length
            ? {
                id: lastSession[0].id,
                createdAt: lastSession[0].createdAt,
                ipAddress: lastSession[0].ipAddress,
                userAgent: lastSession[0].userAgent,
              }
            : null,
        },
        sessionsCount: Number(sessionAgg.total ?? 0),
        lastLoginAt: lastSession.length ? lastSession[0].createdAt : null,
        moderation,
        moderationHistory: moderation,
        resources: ownResources,
        purchases: (purchases as any[]).map((p) => ({
          id: p.id,
          resourceId: p.resourceId,
          resourceTitle: purchaseTitleById.get(p.resourceId) ?? null,
          status: p.status,
          amountMinor: p.finalPrice,
          createdAt: p.createdAt,
        })),
        sellerProfile: sellerProfile
          ? {
              exists: true,
              status: sellerProfile.status,
              displayName: sellerProfile.displayName,
              payoutEnabled: sellerProfile.payoutEnabled,
              appliedAt: sellerProfile.appliedAt,
            }
          : { exists: false },
      });
    } catch (error) {
      reqLog(req).error("admin_platform_user_detail_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch user" });
    }
  }
);

// ---------------------------------------------------------------------------
// §41: suspend / restore / role change — CAS updates, audit, SystemLog, notify
// ---------------------------------------------------------------------------

router.post(
  "/users/:id/suspend",
  authenticate,
  requirePermission("users.suspend"),
  validateCuid("id"),
  validate(suspendUserSchema, "body"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.params.id as string;
      const { reason, confirm } = req.body as { reason: string; confirm?: boolean };
      const actor = req.user!;

      const user = await db.orm.public.User.where({ id: userId }).first();
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (user.id === actor.userId) {
        badRequest(res, "Cannot suspend yourself");
        return;
      }
      // §41: a SUPERADMIN can only be suspended by a SUPERADMIN, or by an
      // ADMIN that explicitly confirms the action.
      if (
        user.role === "SUPERADMIN" &&
        !(actor.role === "SUPERADMIN" || (actor.role === "ADMIN" && confirm === true))
      ) {
        res.status(403).json({
          error: "Superadmin suspension requires SUPERADMIN actor or ADMIN with confirm=true",
        });
        return;
      }

      // CAS: race with a concurrent status update loses atomically.
      const result = await db.orm.public.User
        .where({ id: userId, status: user.status })
        .updateAndCount({ status: "SUSPENDED" } as any);
      if (affectedCount(result) === 0) {
        res.status(409).json({ error: "User status changed concurrently" });
        return;
      }

      // Revoke sessions: hard delete (Session rows are refresh-token hashes;
      // outstanding access tokens die within their short TTL).
      await db.orm.public.Session.where({ userId }).delete();

      await recordAudit({
        actorId: actor.userId,
        action: "user.suspend",
        targetType: "user",
        targetId: userId,
        before: { status: user.status },
        after: { status: "SUSPENDED", reason },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      void logSystem({
        level: "WARN",
        service: "api",
        requestId: req.id ?? null,
        route: routeOf(req),
        message: `User ${userId} suspended`,
        meta: { actorId: actor.userId, reason },
      });
      await createNotifications([
        {
          recipientId: userId,
          type: "MODERATION",
          title: "Ваш аккаунт заблокирован",
          body: reason.slice(0, 500),
          entityType: "user",
          entityId: userId,
        },
      ]);

      const updated = await db.orm.public.User.where({ id: userId }).first();
      res.json(updated ? userProjection(updated) : { id: userId, status: "SUSPENDED" });
    } catch (error) {
      reqLog(req).error("admin_platform_user_suspend_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to suspend user" });
    }
  }
);

router.post(
  "/users/:id/restore",
  authenticate,
  requirePermission("users.suspend"),
  validateCuid("id"),
  validate(restoreUserSchema, "body"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.params.id as string;
      const { reason } = req.body as { reason: string };
      const actor = req.user!;

      const user = await db.orm.public.User.where({ id: userId }).first();
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (user.status === "ACTIVE") {
        res.status(409).json({ error: "User is not suspended" });
        return;
      }

      const result = await db.orm.public.User
        .where({ id: userId, status: user.status })
        .updateAndCount({ status: "ACTIVE" } as any);
      if (affectedCount(result) === 0) {
        res.status(409).json({ error: "User status changed concurrently" });
        return;
      }

      await recordAudit({
        actorId: actor.userId,
        action: "user.restore",
        targetType: "user",
        targetId: userId,
        before: { status: user.status },
        after: { status: "ACTIVE", reason },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      void logSystem({
        level: "INFO",
        service: "api",
        requestId: req.id ?? null,
        route: routeOf(req),
        message: `User ${userId} restored`,
        meta: { actorId: actor.userId, reason },
      });
      await createNotifications([
        {
          recipientId: userId,
          type: "MODERATION",
          title: "Ваш аккаунт разблокирован",
          body: reason.slice(0, 500),
          entityType: "user",
          entityId: userId,
        },
      ]);

      const updated = await db.orm.public.User.where({ id: userId }).first();
      res.json(updated ? userProjection(updated) : { id: userId, status: "ACTIVE" });
    } catch (error) {
      reqLog(req).error("admin_platform_user_restore_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to restore user" });
    }
  }
);

router.patch(
  "/users/:id/role",
  authenticate,
  requirePermission("roles.manage"),
  validateCuid("id"),
  validate(changeRoleSchema, "body"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.params.id as string;
      const { role, confirm, reason } = req.body as {
        role: (typeof USER_ROLES)[number];
        confirm?: boolean;
        reason?: string;
      };
      const actor = req.user!;

      const user = await db.orm.public.User.where({ id: userId }).first();
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      // §41 (a): nobody changes their own role.
      if (user.id === actor.userId) {
        res.status(403).json({ error: "Cannot change your own role" });
        return;
      }
      // §41 (b): never demote the last SUPERADMIN. SUPERADMIN count is small
      // — the guard reads the bounded id set instead of an untyped not().
      if (user.role === "SUPERADMIN" && role !== "SUPERADMIN") {
        const superadmins = await db.orm.public.User
          .where({ role: "SUPERADMIN" })
          .select("id")
          .all();
        const others = superadmins.filter((u: any) => u.id !== userId);
        if (others.length < 1) {
          res.status(409).json({ error: "Cannot demote the last SUPERADMIN (last_superadmin)" });
          return;
        }
      }
      // §41 (c): escalation INTO ADMIN/SUPERADMIN is confirm-gated.
      if ((role === "ADMIN" || role === "SUPERADMIN") && confirm !== true) {
        res.status(409).json({
          error: "Granting ADMIN/SUPERADMIN requires confirm=true (confirmation_required)",
        });
        return;
      }

      // CAS on the previous role: a concurrent role change aborts the update.
      const result = await db.orm.public.User
        .where({ id: userId, role: user.role })
        .updateAndCount({ role } as any);
      if (affectedCount(result) === 0) {
        res.status(409).json({ error: "Role changed concurrently" });
        return;
      }

      await recordAudit({
        actorId: actor.userId,
        action: "user.role.change",
        targetType: "user",
        targetId: userId,
        before: { role: user.role },
        after: { role, reason: reason ?? null },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      void logSystem({
        level: "WARN",
        service: "api",
        requestId: req.id ?? null,
        route: routeOf(req),
        message: `Role of user ${userId} changed: ${user.role} -> ${role}`,
        meta: { actorId: actor.userId, before: user.role, after: role, reason: reason ?? null },
      });
      await createNotifications([
        {
          recipientId: userId,
          type: "MODERATION",
          title: `Ваша роль изменена: ${ROLE_LABELS[role as PlatformRole]}`,
          entityType: "user",
          entityId: userId,
        },
      ]);

      const updated = await db.orm.public.User.where({ id: userId }).first();
      res.json(updated ? userProjection(updated) : { id: userId, role });
    } catch (error) {
      reqLog(req).error("admin_platform_user_role_change_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to change role" });
    }
  }
);

// ---------------------------------------------------------------------------
// §40: roles & permissions matrix
// ---------------------------------------------------------------------------

router.get(
  "/roles",
  authenticate,
  requirePermission("roles.view"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const memberCounts = await countBy(db.orm.public.User, "role");
      res.json({
        roles: ROLE_ORDER.map((role) => ({
          role,
          label: ROLE_LABELS[role],
          permissions: [...ROLE_PERMISSIONS[role]],
          members: Number(memberCounts[role] ?? 0),
        })),
      });
    } catch (error) {
      reqLog(req).error("admin_platform_roles_fetch_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch roles" });
    }
  }
);

router.get(
  "/permissions",
  authenticate,
  requirePermission("roles.view"),
  standardRateLimit,
  async (_req: AuthRequest, res: Response) => {
    void _req;
    res.json({ permissions: PERMISSION_CATALOG });
  }
);

// ---------------------------------------------------------------------------
// §42: user activity timeline — parallel bounded queries merged in JS
// ---------------------------------------------------------------------------

router.get(
  "/users/:id/activity",
  authenticate,
  requirePermission("users.view"),
  validateCuid("id"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = activityQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Validation failed");
        return;
      }
      const limit = parsed.data.limit;
      const userId = req.params.id as string;

      const user = await db.orm.public.User.where({ id: userId }).first();
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const [sessions, purchases, ownResourceRows, reviews, posts, articles, reports, roleAudits, moderationEvents] =
        await Promise.all([
          db.orm.public.Session
            .where({ userId })
            .orderBy((s: any) => s.createdAt.desc())
            .limit(limit)
            .all(),
          db.orm.public.Purchase
            .where({ buyerId: userId })
            .orderBy((p: any) => p.createdAt.desc())
            .limit(limit)
            .all(),
          db.orm.public.Resource
            .where({ sellerId: userId })
            .select("id", "slug", "title", "createdAt")
            .orderBy((r: any) => r.createdAt.desc())
            .limit(limit)
            .all(),
          db.orm.public.Review
            .where({ buyerId: userId })
            .orderBy((r: any) => r.createdAt.desc())
            .limit(limit)
            .all(),
          db.orm.public.ForumPost
            .where({ authorId: userId })
            .orderBy((p: any) => p.createdAt.desc())
            .limit(limit)
            .all(),
          db.orm.public.Article
            .where({ authorId: userId })
            .select("id", "slug", "title", "createdAt")
            .orderBy((a: any) => a.createdAt.desc())
            .limit(limit)
            .all(),
          db.orm.public.Report
            .where({ reporterId: userId })
            .orderBy((r: any) => r.createdAt.desc())
            .limit(limit)
            .all(),
          db.orm.public.AuditLog
            .where({ targetType: "user", targetId: userId })
            .where((a: any) => a.action.ilike("%role%"))
            .orderBy((a: any) => a.createdAt.desc())
            .limit(limit)
            .all(),
          db.orm.public.ModerationEvent
            .where({ actorId: userId })
            .orderBy((m: any) => m.createdAt.desc())
            .limit(limit)
            .all(),
        ]);

      // One grouped title resolution for purchases + reviews (no N+1).
      const titleIds = Array.from(
        new Set([
          ...(purchases as any[]).map((p) => p.resourceId as string),
          ...(reviews as any[]).map((r) => r.resourceId as string),
        ])
      );
      const titleRows = titleIds.length
        ? await db.orm.public.Resource.where((r: any) => (r.id as any).in(titleIds))
            .select("id", "title")
            .all()
        : [];
      const purchaseTitleById = new Map(titleRows.map((r: any) => [r.id, r.title as string]));
      const ownTitleById = new Map(
        (ownResourceRows as any[]).map((r) => [r.id, r.title as string])
      );
      const titleOf = (resourceId: string): string =>
        ownTitleById.get(resourceId) ?? purchaseTitleById.get(resourceId) ?? "ресурс";

      // Versions of own resources + refunds via the user's payment attempts +
      // thread titles for forum posts.
      const ownResourceIds = (ownResourceRows as any[]).map((r) => r.id as string);
      const purchaseIds = (purchases as any[]).map((p) => p.id as string);
      const [versions, payments, threadTitleRows] = await Promise.all([
        ownResourceIds.length
          ? db.orm.public.ResourceVersion
              .where((v: any) => (v.resourceId as any).in(ownResourceIds))
              .orderBy((v: any) => v.publishedAt.desc())
              .limit(limit)
              .all()
          : Promise.resolve([] as any[]),
        purchaseIds.length
          ? db.orm.public.Payment
              .where((p: any) => (p.purchaseId as any).in(purchaseIds))
              .select("id", "purchaseId")
              .limit(limit * 2)
              .all()
          : Promise.resolve([] as any[]),
        (posts as any[]).length
          ? db.orm.public.ForumThread
              .where((t: any) =>
                (t.id as any).in((posts as any[]).map((p) => p.threadId as string))
              )
              .select("id", "title")
              .all()
          : Promise.resolve([] as any[]),
      ]);

      const paymentIds = (payments as any[]).map((p) => p.id as string);
      const refunds = paymentIds.length
        ? await db.orm.public.Refund
            .where((r: any) => (r.paymentId as any).in(paymentIds))
            .orderBy((r: any) => r.createdAt.desc())
            .limit(limit)
            .all()
        : [];
      const paymentById = new Map((payments as any[]).map((p) => [p.id, p]));
      const threadTitleById = new Map(
        (threadTitleRows as any[]).map((t) => [t.id, t.title as string])
      );

      type Entry = {
        type: string;
        at: string;
        summary: string;
        refType?: string;
        refId?: string;
        amountMinor?: number;
      };
      const entries: Entry[] = [];

      for (const s of sessions as any[]) {
        entries.push({
          type: "login",
          at: s.createdAt,
          summary: s.ipAddress ? `Вход в аккаунт · ${s.ipAddress}` : "Вход в аккаунт",
          refType: "session",
          refId: s.id,
        });
      }
      for (const p of purchases as any[]) {
        entries.push({
          type: "purchase",
          at: p.createdAt,
          summary: `Покупка ресурса «${titleOf(p.resourceId)}»`,
          refType: "purchase",
          refId: p.id,
          amountMinor: p.finalPrice,
        });
      }
      for (const r of refunds as any[]) {
        const payment = paymentById.get(r.paymentId) as any;
        const purchase = payment?.purchaseId
          ? (purchases as any[]).find((p) => p.id === payment.purchaseId)
          : undefined;
        entries.push({
          type: "refund",
          at: r.createdAt,
          summary: purchase
            ? `Возврат по покупке «${titleOf(purchase.resourceId)}»`
            : "Возврат средств",
          refType: "refund",
          refId: r.id,
          amountMinor: r.amount,
        });
      }
      for (const r of ownResourceRows as any[]) {
        entries.push({
          type: "resource_created",
          at: r.createdAt,
          summary: `Создан ресурс «${r.title}»`,
          refType: "resource",
          refId: r.id,
        });
      }
      for (const v of versions as any[]) {
        entries.push({
          type: "version_published",
          at: v.publishedAt,
          summary: `Публикация версии ${v.version} — «${titleOf(v.resourceId)}»`,
          refType: "resourceVersion",
          refId: v.id,
        });
      }
      for (const r of reviews as any[]) {
        entries.push({
          type: "review_created",
          at: r.createdAt,
          summary: `Отзыв на ресурс «${titleOf(r.resourceId)}» · оценка ${r.rating}`,
          refType: "review",
          refId: r.id,
        });
      }
      for (const p of posts as any[]) {
        const threadTitle = threadTitleById.get(p.threadId);
        entries.push({
          type: "forum_post",
          at: p.createdAt,
          summary: threadTitle
            ? `Сообщение в обсуждении «${threadTitle}»`
            : "Сообщение в обсуждении",
          refType: "forumPost",
          refId: p.id,
        });
      }
      for (const a of articles as any[]) {
        entries.push({
          type: "article_created",
          at: a.createdAt,
          summary: `Статья «${a.title}»`,
          refType: "article",
          refId: a.id,
        });
      }
      for (const r of reports as any[]) {
        entries.push({
          type: "report_filed",
          at: r.createdAt,
          summary: `Жалоба (${String(r.targetType).toLowerCase()})`,
          refType: "report",
          refId: r.id,
        });
      }
      for (const a of roleAudits as any[]) {
        let summary = "Изменение роли";
        try {
          const before = a.before ? (JSON.parse(a.before) as { role?: string }) : null;
          const after = a.after
            ? (JSON.parse(a.after) as { role?: string; reason?: string | null })
            : null;
          if (before?.role || after?.role) {
            summary = `Изменение роли: ${before?.role ?? "?"} → ${after?.role ?? "?"}`;
          }
          if (after?.reason) summary += ` — ${after.reason}`;
        } catch {
          // keep the default summary
        }
        entries.push({
          type: "role_changed",
          at: a.createdAt,
          summary,
          refType: "user",
          refId: userId,
        });
      }
      for (const m of moderationEvents as any[]) {
        entries.push({
          type: "moderation_event",
          at: m.createdAt,
          summary: `Модерация ресурса: ${m.fromStatus} → ${m.toStatus}`,
          refType: "moderationEvent",
          refId: m.id,
        });
      }

      entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

      res.json({ entries: entries.slice(0, limit), total: entries.length });
    } catch (error) {
      reqLog(req).error("admin_platform_user_activity_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch user activity" });
    }
  }
);

// ---------------------------------------------------------------------------
// §43: audit center (append-only — read endpoint)
// ---------------------------------------------------------------------------

router.get(
  "/audit-events",
  authenticate,
  requirePermission("audit.view"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = auditQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Validation failed");
        return;
      }
      const f = parsed.data;
      const { page, limit, skip } = parsePage(req.query as Record<string, unknown>, 20, 100);

      // AuditLog has no subject column: `userId` filters by the actor (the
      // append-only model records actor/target pairs only).
      const actorFilter = f.actorId ?? f.userId;
      const base = () => {
        let q = db.orm.public.AuditLog.where({});
        if (actorFilter) q = q.where({ actorId: actorFilter });
        if (f.targetType) q = q.where({ targetType: f.targetType });
        if (f.targetId) q = q.where({ targetId: f.targetId });
        if (f.ip) q = q.where({ ip: f.ip });
        if (f.requestId) q = q.where({ requestId: f.requestId });
        if (f.action) q = q.where((a: any) => a.action.ilike(`%${f.action}%`));
        if (f.from) q = q.where((a: any) => a.createdAt.gte(new Date(f.from as string)));
        if (f.to) q = q.where((a: any) => a.createdAt.lte(new Date(f.to as string)));
        return q;
      };

      const [rows, totalAgg] = await Promise.all([
        base().orderBy((a: any) => a.createdAt.desc()).limit(limit).offset(skip).all(),
        base().aggregate((a: any) => ({ total: a.count() })),
      ]);
      const total = Number((totalAgg as any).total ?? 0);

      res.json({
        events: rows,
        total,
        page,
        limit,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (error) {
      reqLog(req).error("admin_platform_audit_fetch_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch audit events" });
    }
  }
);

// ---------------------------------------------------------------------------
// §44: system logs (bounded retention, read endpoint)
// ---------------------------------------------------------------------------

router.get(
  "/system-logs",
  authenticate,
  requirePermission("logs.view"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = systemLogsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Validation failed");
        return;
      }
      const f = parsed.data;
      const { page, limit, skip } = parsePage(req.query as Record<string, unknown>, 20, 100);

      const base = () => {
        let q = db.orm.public.SystemLog.where({});
        if (f.service) q = q.where({ service: f.service });
        if (f.requestId) q = q.where({ requestId: f.requestId });
        if (f.route) q = q.where({ route: f.route });
        if (f.errorCode) q = q.where({ errorCode: f.errorCode });
        if (f.level) q = q.where({ level: f.level } as any);
        if (f.from) q = q.where((l: any) => l.createdAt.gte(new Date(f.from as string)));
        if (f.to) q = q.where((l: any) => l.createdAt.lte(new Date(f.to as string)));
        return q;
      };

      const [rows, totalAgg] = await Promise.all([
        base().orderBy((l: any) => l.createdAt.desc()).limit(limit).offset(skip).all(),
        base().aggregate((a: any) => ({ total: a.count() })),
      ]);
      const total = Number((totalAgg as any).total ?? 0);

      res.json({
        logs: rows,
        total,
        page,
        limit,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      });
    } catch (error) {
      reqLog(req).error("admin_platform_system_logs_fetch_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to fetch system logs" });
    }
  }
);

// ---------------------------------------------------------------------------
// §66: admin picker entity search (minimum gate: users.view)
// ---------------------------------------------------------------------------

router.get(
  "/search-entities",
  authenticate,
  requirePermission("users.view"),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const parsed = searchEntitiesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        badRequest(res, "Validation failed: type is required, q needs at least 2 chars, limit <= 20");
        return;
      }
      const type = parsed.data.type;
      const q = parsed.data.q.trim();
      const limit = parsed.data.limit;
      const pattern = `%${q}%`;

      const items: Array<{ id: string; label: string; sublabel?: string | null }> = [];

      if (type === "user") {
        const [byEmail, byUsername, byDisplayName] = await Promise.all([
          db.orm.public.User
            .where((u: any) => u.email.ilike(pattern))
            .select("id", "email", "username", "displayName")
            .limit(limit)
            .all(),
          db.orm.public.User
            .where((u: any) => u.username.ilike(pattern))
            .select("id", "email", "username", "displayName")
            .limit(limit)
            .all(),
          db.orm.public.User
            .where((u: any) => u.displayName.ilike(pattern))
            .select("id", "email", "username", "displayName")
            .limit(limit)
            .all(),
        ]);
        const seen = new Set<string>();
        for (const u of [...byEmail, ...byUsername, ...byDisplayName] as any[]) {
          if (seen.has(u.id)) continue;
          seen.add(u.id);
          items.push({
            id: u.id,
            label: u.displayName || u.username || u.email,
            sublabel: u.email,
          });
        }
      } else if (type === "resource") {
        const [byTitle, bySlug] = await Promise.all([
          db.orm.public.Resource
            .where((r: any) => r.title.ilike(pattern))
            .select("id", "slug", "title", "status")
            .limit(limit)
            .all(),
          db.orm.public.Resource
            .where((r: any) => r.slug.ilike(pattern))
            .select("id", "slug", "title", "status")
            .limit(limit)
            .all(),
        ]);
        const seen = new Set<string>();
        for (const r of [...byTitle, ...bySlug] as any[]) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          items.push({ id: r.id, label: r.title, sublabel: `${r.slug} · ${r.status}` });
        }
      } else if (type === "server") {
        const [byName, bySlug] = await Promise.all([
          db.orm.public.Server
            .where((s: any) => s.name.ilike(pattern))
            .select("id", "slug", "name")
            .limit(limit)
            .all(),
          db.orm.public.Server
            .where((s: any) => s.slug.ilike(pattern))
            .select("id", "slug", "name")
            .limit(limit)
            .all(),
        ]);
        const seen = new Set<string>();
        for (const s of [...byName, ...bySlug] as any[]) {
          if (seen.has(s.id)) continue;
          seen.add(s.id);
          items.push({ id: s.id, label: s.name, sublabel: s.slug });
        }
      } else if (type === "review") {
        const [byComment, byId] = await Promise.all([
          db.orm.public.Review
            .where((r: any) => r.comment.ilike(pattern))
            .select("id", "comment", "resourceId", "rating")
            .limit(limit)
            .all(),
          db.orm.public.Review
            .where((r: any) => r.id.ilike(`${q}%`))
            .select("id", "comment", "resourceId", "rating")
            .limit(limit)
            .all(),
        ]);
        const seen = new Set<string>();
        for (const r of [...byComment, ...byId] as any[]) {
          if (seen.has(r.id)) continue;
          seen.add(r.id);
          items.push({
            id: r.id,
            label: r.comment ? r.comment.slice(0, 80) : `Отзыв ${r.id.slice(0, 8)}…`,
            sublabel: `оценка ${r.rating}`,
          });
        }
      } else if (type === "thread") {
        const rows = await db.orm.public.ForumThread
          .where((t: any) => t.title.ilike(pattern))
          .select("id", "title", "state")
          .limit(limit)
          .all();
        for (const t of rows as any[]) {
          items.push({ id: t.id, label: t.title, sublabel: t.state });
        }
      } else if (type === "news") {
        const rows = await db.orm.public.ServerNews
          .where((n: any) => n.title.ilike(pattern))
          .select("id", "title", "status")
          .limit(limit)
          .all();
        for (const n of rows as any[]) {
          items.push({ id: n.id, label: n.title, sublabel: n.status });
        }
      } else if (type === "article") {
        const [byTitle, bySlug] = await Promise.all([
          db.orm.public.Article
            .where((a: any) => a.title.ilike(pattern))
            .select("id", "slug", "title", "status")
            .limit(limit)
            .all(),
          db.orm.public.Article
            .where((a: any) => a.slug.ilike(pattern))
            .select("id", "slug", "title", "status")
            .limit(limit)
            .all(),
        ]);
        const seen = new Set<string>();
        for (const a of [...byTitle, ...bySlug] as any[]) {
          if (seen.has(a.id)) continue;
          seen.add(a.id);
          items.push({ id: a.id, label: a.title, sublabel: `${a.slug} · ${a.status}` });
        }
      } else {
        // version: match by id prefix or resource slug.
        const seen = new Set<string>();
        const byIdVersions = await db.orm.public.ResourceVersion
          .where((v: any) => v.id.ilike(`${q}%`))
          .select("id", "version", "resourceId")
          .limit(limit)
          .all();
        for (const v of byIdVersions as any[]) {
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          items.push({ id: v.id, label: `v${v.version}`, sublabel: v.resourceId });
        }
        const resourceMatches = await db.orm.public.Resource
          .where((r: any) => r.slug.ilike(pattern))
          .select("id", "slug", "title")
          .limit(limit)
          .all();
        if (resourceMatches.length) {
          const versionRows = await db.orm.public.ResourceVersion
            .where((v: any) => (v.resourceId as any).in(resourceMatches.map((r: any) => r.id)))
            .select("id", "version", "resourceId")
            .orderBy((v: any) => v.publishedAt.desc())
            .limit(limit)
            .all();
          const slugById = new Map(resourceMatches.map((r: any) => [r.id, r.slug as string]));
          for (const v of versionRows as any[]) {
            if (seen.has(v.id)) continue;
            seen.add(v.id);
            items.push({
              id: v.id,
              label: `v${v.version}`,
              sublabel: slugById.get(v.resourceId) ?? null,
            });
          }
        }
      }

      res.json({ type, items: items.slice(0, limit) });
    } catch (error) {
      reqLog(req).error("admin_platform_search_entities_failed", { error });
      logUnhandled(error, { req });
      res.status(500).json({ error: "Failed to search entities" });
    }
  }
);

export default router;