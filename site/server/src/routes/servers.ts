// PLAN-005 Workstreams A/B/D/E/L/Q/S/T: Server domain routes.
//
// Server is the hub entity: identity + monitoring + news + community + reviews.
// Privacy discipline (S/T): private technical data is filtered from every
// public payload HERE, in the backend authorization layer — frontend UI
// hiding is never trusted (workstream AA).
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit, userRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";
import { recordAudit } from "../lib/audit";
import { isOwnMediaUrl } from "../lib/media";
import { verifyAccessToken } from "../lib/jwt";
import { makeServerSlug } from "../lib/slug";
import { loadStaffRole, isPubliclyVisible, PUBLIC_SERVER_LIFECYCLES } from "../lib/serverAccess";
import { isHeartbeatFresh, heartbeatStaleMs } from "../lib/serverMonitoring";
import { generateIntegrationToken, sha256Hex } from "../lib/serverIntegration";
import { createNotifications } from "../lib/notify";

const router: Router = Router();

const MAX_PAGE_LIMIT = 50;

function parsePaging(query: any): { page: number; limit: number; skip: number } {
  const page = Math.max(parseInt(query.page || "1", 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || "12", 10) || 12, 1), MAX_PAGE_LIMIT);
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Optional authentication: reads the Bearer token when present and resolves
 * the user id; never rejects the request. Guests keep full read access and
 * the payload only gains caller-relative fields (following, staff view).
 */
function optionalUserId(req: AuthRequest): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const payload = verifyAccessToken(header.substring(7));
  return payload?.userId ?? null;
}

/** Public projection of a Server row — connection data never included (S). */
function publicServerFields(server: any) {
  return {
    id: server.id,
    slug: server.slug,
    name: server.name,
    description: server.description,
    logoUrl: server.logoUrl,
    bannerUrl: server.bannerUrl,
    accentColor: server.accentColor,
    websiteUrl: server.websiteUrl,
    discordUrl: server.discordUrl,
    region: server.region,
    lifecycle: server.lifecycle,
    verification: server.verification,
    monitoring: server.monitoring,
    playerCount: server.playerCount,
    maxPlayers: server.maxPlayers,
    lastSeenAt: server.lastSeenAt,
    verifiedAt: server.verifiedAt,
    createdAt: server.createdAt,
  };
}

async function loadRole(server: { id: string; ownerId: string }, userId: string) {
  return loadStaffRole(server, userId);
}

async function ratingOf(serverId: string): Promise<number | null> {
  const agg = await db.orm.public.ServerReview.where({ serverId, status: "VISIBLE" }).aggregate(
    (a: any) => ({ avg: a.avg("rating") })
  );
  return agg.avg == null ? null : Number(agg.avg);
}

async function followerCount(serverId: string): Promise<number> {
  const agg = await db.orm.public.ServerFollow.where({ serverId }).aggregate((a: any) => ({
    total: a.count(),
  }));
  return Number(agg.total ?? 0);
}

// ---------------------------------------------------------------------------
// Registration + discovery
// ---------------------------------------------------------------------------

// GET /servers — public discovery list (VERIFIED/ACTIVE only; W: typed results).
router.get("/", standardRateLimit, async (req, res: Response) => {
  try {
    const { page, limit, skip } = parsePaging(req.query);
    const q = (req.query.q as string | undefined)?.trim();
    const sort = (req.query.sort as string | undefined) || "players";

    let searchIds: string[] | null = null;
    if (q) {
      const pattern = `%${q}%`;
      const byName = await db.orm.public.Server
        .where((s: any) => s.name.ilike(pattern))
        .select("id")
        .limit(400)
        .all();
      const byDesc = await db.orm.public.Server
        .where((s: any) => s.description.ilike(pattern))
        .select("id")
        .limit(400)
        .all();
      const ids = Array.from(new Set([...byName, ...byDesc].map((r: any) => r.id as string)));
      if (ids.length === 0) {
        res.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } });
        return;
      }
      searchIds = ids;
    }

    const base = () => {
      const q2 = db.orm.public.Server.where((s: any) => s.lifecycle.in(PUBLIC_SERVER_LIFECYCLES));
      return searchIds ? q2.where((s: any) => (s.id as any).in(searchIds!)) : q2;
    };

    const servers = await base()
      .orderBy((s: any) => (sort === "newest" ? s.createdAt.desc() : s.createdAt.desc()))
      .limit(limit)
      .offset(skip)
      .all();

    const countResult = await base().aggregate((agg: any) => ({ total: agg.count() }));
    const total = Number(countResult.total);

    const cards = await Promise.all(
      servers.map(async (s: any) => {
        const [followers, avg] = await Promise.all([followerCount(s.id), ratingOf(s.id)]);
        return {
          ...publicServerFields(s),
          followerCount: followers,
          rating: avg != null ? Math.round(avg * 10) / 10 : null,
        };
      })
    );

    // "players" sort uses the real reported online count; servers without a
    // current value go last (never fabricated — workstream E/AA).
    if (sort === "players") {
      cards.sort((a: any, b: any) => (b.playerCount ?? -1) - (a.playerCount ?? -1));
    }

    res.json({ data: cards, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) {
    reqLog(req).error("servers_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch servers" });
  }
});

// POST /servers — register a server (B-001..B-003). lifecycle CREATED.
router.post(
  "/",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 10, action: "server_create" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const { name, description, host, port, region, websiteUrl, discordUrl } = req.body ?? {};
      if (typeof name !== "string" || name.trim().length < 3 || name.trim().length > 60) {
        res.status(400).json({ error: "Название сервера: от 3 до 60 символов" });
        return;
      }
      if (host !== undefined && host !== null && (typeof host !== "string" || host.length > 255)) {
        res.status(400).json({ error: "Invalid host" });
        return;
      }
      const portNum =
        port === undefined || port === null || port === "" ? null : parseInt(port as any, 10);
      if (portNum !== null && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)) {
        res.status(400).json({ error: "Port must be an integer 1-65535" });
        return;
      }

      let slug = makeServerSlug(name.trim());
      for (let i = 0; i < 5; i += 1) {
        const existing = await db.orm.public.Server.where({ slug }).first();
        if (!existing) break;
        slug = makeServerSlug(name.trim());
      }

      const server = await db.orm.public.Server.create({
        ownerId: req.user!.userId,
        slug,
        name: name.trim(),
        description: typeof description === "string" ? description.slice(0, 8000) : "",
        host: typeof host === "string" && host ? host : null,
        port: portNum,
        region: typeof region === "string" && region ? region.slice(0, 64) : null,
        websiteUrl: typeof websiteUrl === "string" && websiteUrl ? websiteUrl.slice(0, 255) : null,
        discordUrl: typeof discordUrl === "string" && discordUrl ? discordUrl.slice(0, 255) : null,
        lifecycle: "CREATED",
        verification: "PENDING",
        monitoring: "UNKNOWN",
      });

      await db.orm.public.ServerMember.create({
        serverId: server.id,
        userId: req.user!.userId,
        role: "OWNER",
      });

      await recordAudit({
        actorId: req.user!.userId,
        action: "server.create",
        targetType: "server",
        targetId: server.id,
        after: { slug: server.slug },
        ip: req.ip,
        requestId: req.id ?? null,
      });

      res.status(201).json(server);
    } catch (error) {
      reqLog(req).error("server_create_failed", { error });
      res.status(500).json({ error: "Failed to create server" });
    }
  }
);

// GET /servers/my — the caller's own servers (must precede /:slug).
router.get("/my", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const memberships = await db.orm.public.ServerMember.where({ userId: req.user!.userId }).all();
    const ownerIds = memberships.filter((m: any) => m.role === "OWNER").map((m: any) => m.serverId);
    const servers = ownerIds.length
      ? await db.orm.public.Server.where((s: any) => s.id.in(ownerIds)).orderBy((m) => m.updatedAt.desc()).all()
      : [];
    res.json({ data: servers });
  } catch (error) {
    reqLog(req).error("servers_my_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch own servers" });
  }
});

// GET /servers/:slug — public server page payload (D-001..D-003), privacy
// filtered. Staff sees the unfiltered view through caller.isStaff.
router.get("/:slug", standardRateLimit, async (req, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const callerId = optionalUserId(req);
    const role = callerId ? await loadRole(server, callerId) : null;
    const isStaff = role !== null;
    if (!isPubliclyVisible(server) && !isStaff) {
      res.status(404).json({ error: "Server not found" });
      return;
    }

    const [followers, reviewAgg, following] = await Promise.all([
      followerCount(server.id),
      ratingOf(server.id),
      callerId
        ? db.orm.public.ServerFollow.where({ serverId: server.id, userId: callerId }).first()
        : Promise.resolve(null),
    ]);
    const reviewAvg = reviewAgg == null ? null : Number(reviewAgg);

    res.json({
      server: {
        ...publicServerFields(server),
        // Stats visibility (S): hidden stats withhold live numbers and last
        // seen — the aggregate follower count and rating remain public.
        playerCount: server.showStats ? server.playerCount : null,
        maxPlayers: server.showStats ? server.maxPlayers : null,
        lastSeenAt: server.showStats ? server.lastSeenAt : null,
        followerCount: followers,
        rating: reviewAvg != null ? Math.round(reviewAvg * 10) / 10 : null,
      },
      caller: { isStaff, role, following: !!following },
      privacy: {
        showStats: server.showStats,
        showStaff: server.showStaff,
        showResources: server.showResources,
        showCommunity: server.showCommunity,
        showTechStack: server.showTechStack,
      },
    });
  } catch (error) {
    reqLog(req).error("server_detail_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch server" });
  }
});

// PATCH /servers/:slug — identity/branding/connection edit (owner+admins).
router.patch("/:slug", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const role = await loadRole(server, req.user!.userId);
    if (role !== "OWNER" && role !== "ADMIN") {
      res.status(403).json({ error: "Not allowed" });
      return;
    }

    const b = req.body ?? {};
    const update: Record<string, unknown> = {};

    if (b.name !== undefined) {
      if (typeof b.name !== "string" || b.name.trim().length < 3 || b.name.trim().length > 60) {
        res.status(400).json({ error: "Название сервера: от 3 до 60 символов" });
        return;
      }
      update.name = b.name.trim();
    }
    if (b.description !== undefined) {
      if (typeof b.description !== "string" || b.description.length > 8000) {
        res.status(400).json({ error: "Invalid description" });
        return;
      }
      update.description = b.description;
    }
    for (const key of ["logoUrl", "bannerUrl"] as const) {
      if (b[key] !== undefined) {
        if (b[key] === null || b[key] === "") {
          update[key] = null;
        } else if (typeof b[key] === "string" && isOwnMediaUrl(b[key])) {
          update[key] = b[key];
        } else {
          res.status(400).json({ error: `${key} must be an uploaded /media/ image` });
          return;
        }
      }
    }
    if (b.accentColor !== undefined) {
      if (b.accentColor === null || b.accentColor === "") {
        update.accentColor = null;
      } else if (typeof b.accentColor === "string" && /^#[0-9a-fA-F]{6}$/.test(b.accentColor)) {
        update.accentColor = b.accentColor;
      } else {
        res.status(400).json({ error: "accentColor must be #RRGGBB" });
        return;
      }
    }
    for (const key of ["websiteUrl", "discordUrl"] as const) {
      if (b[key] !== undefined) {
        if (b[key] === null || b[key] === "") {
          update[key] = null;
        } else if (
          typeof b[key] === "string" &&
          b[key].length <= 255 &&
          /^https?:\/\//.test(b[key])
        ) {
          update[key] = b[key];
        } else {
          res.status(400).json({ error: `${key} must be an http(s) URL` });
          return;
        }
      }
    }
    // Connection data — owner-managed, never publicly rendered (S).
    if (b.host !== undefined) {
      if (b.host === null || b.host === "") update.host = null;
      else if (typeof b.host === "string" && b.host.length <= 255) update.host = b.host;
      else {
        res.status(400).json({ error: "Invalid host" });
        return;
      }
    }
    if (b.port !== undefined) {
      if (b.port === null || b.port === "") update.port = null;
      else {
        const p = parseInt(b.port as any, 10);
        if (!Number.isInteger(p) || p < 1 || p > 65535) {
          res.status(400).json({ error: "Port must be an integer 1-65535" });
          return;
        }
        update.port = p;
      }
    }
    if (b.region !== undefined) {
      if (b.region === null || b.region === "") update.region = null;
      else if (typeof b.region === "string" && b.region.length <= 64) update.region = b.region;
      else {
        res.status(400).json({ error: "Invalid region" });
        return;
      }
    }

    const updated = await db.orm.public.Server.where({ id: server.id }).update(update);
    await recordAudit({
      actorId: req.user!.userId,
      action: "server.update",
      targetType: "server",
      targetId: server.id,
      after: update,
      ip: req.ip,
      requestId: req.id ?? null,
    });
    res.json(updated);
  } catch (error) {
    reqLog(req).error("server_update_failed", { error });
    res.status(500).json({ error: "Failed to update server" });
  }
});

// DELETE /servers/:slug — owner archives the server (archiving is not history
// deletion: rows persist, the page becomes unreachable for non-staff).
router.delete("/:slug", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    if (server.ownerId !== req.user!.userId) {
      res.status(403).json({ error: "Только владелец может архивировать сервер" });
      return;
    }
    const updated = await db.orm.public.Server.where({ id: server.id }).update({
      lifecycle: "ARCHIVED",
      monitoring: "UNKNOWN",
      playerCount: null,
    });
    await recordAudit({
      actorId: req.user!.userId,
      action: "server.archive",
      targetType: "server",
      targetId: server.id,
      ip: req.ip,
      requestId: req.id ?? null,
    });
    res.json(updated);
  } catch (error) {
    reqLog(req).error("server_archive_failed", { error });
    res.status(500).json({ error: "Failed to archive server" });
  }
});

// PATCH /servers/:slug/privacy — owner-only switches (S/T), enforced here.
router.patch(
  "/:slug/privacy",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      if (server.ownerId !== req.user!.userId) {
        res.status(403).json({ error: "Только владелец может менять настройки приватности" });
        return;
      }
      const b = req.body ?? {};
      const update: Record<string, unknown> = {};
      for (const key of ["showResources", "showStaff", "showTechStack", "showStats", "showCommunity"]) {
        if (b[key] !== undefined) {
          if (typeof b[key] !== "boolean") {
            res.status(400).json({ error: `${key} must be a boolean` });
            return;
          }
          update[key] = b[key];
        }
      }
      if (Object.keys(update).length === 0) {
        res.status(400).json({ error: "Nothing to update" });
        return;
      }
      const updated = await db.orm.public.Server.where({ id: server.id }).update(update);
      await recordAudit({
        actorId: req.user!.userId,
        action: "server.privacy",
        targetType: "server",
        targetId: server.id,
        after: update,
        ip: req.ip,
        requestId: req.id ?? null,
      });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("server_privacy_failed", { error });
      res.status(500).json({ error: "Failed to update privacy settings" });
    }
  }
);

// ---------------------------------------------------------------------------
// Ownership verification (C-001..C-003)
// ---------------------------------------------------------------------------

// POST /servers/:slug/integration-token — owner issues/rotates the module
// secret. The plaintext token is returned exactly once.
router.post(
  "/:slug/integration-token",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      if (server.ownerId !== req.user!.userId) {
        res.status(403).json({ error: "Только владелец может выпустить токен интеграции" });
        return;
      }
      const token = generateIntegrationToken();
      const verified = server.verification === "VERIFIED";
      const updated = await db.orm.public.Server.where({ id: server.id }).update({
        integrationTokenHash: sha256Hex(token),
        integrationTokenIssuedAt: new Date().toISOString(),
        verification: verified ? "PENDING" : server.verification,
        verificationNote: verified
          ? "Токен перевыпущен. Подтвердите владение заново — статус обновится после первого heartbeat."
          : "Токен выпущен. Настройте интеграцию на сервере — статус обновится после первого heartbeat.",
        lifecycle:
          server.lifecycle === "CREATED" && !verified ? "PENDING_VERIFICATION" : server.lifecycle,
      });
      await recordAudit({
        actorId: req.user!.userId,
        action: "server.integration_token.issue",
        targetType: "server",
        targetId: server.id,
        ip: req.ip,
        requestId: req.id ?? null,
      });
      res.status(201).json({ token, server: updated });
    } catch (error) {
      reqLog(req).error("server_token_issue_failed", { error });
      res.status(500).json({ error: "Failed to issue integration token" });
    }
  }
);

// GET /servers/:slug/verification — staff view of the state machine (C-003).
router.get(
  "/:slug/verification",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const role = await loadRole(server, req.user!.userId);
      if (!role) {
        res.status(403).json({ error: "Staff access required" });
        return;
      }
      res.json({
        verification: server.verification,
        note: server.verificationNote,
        verifiedAt: server.verifiedAt,
        issuedAt: server.integrationTokenIssuedAt,
        hasToken: !!server.integrationTokenHash,
      });
    } catch (error) {
      reqLog(req).error("server_verification_fetch_failed", { error });
      res.status(500).json({ error: "Failed to fetch verification state" });
    }
  }
);

// ---------------------------------------------------------------------------
// Staff (G/Q) — public only with owner opt-in (showStaff)
// ---------------------------------------------------------------------------

router.get("/:slug/staff", standardRateLimit, async (req, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const callerId = optionalUserId(req);
    const role = callerId ? await loadRole(server, callerId) : null;
    if (!server.showStaff && !role) {
      res.json({ visible: false, data: [] });
      return;
    }
    const members = await db.orm.public.ServerMember.where({ serverId: server.id }).all();
    const ids = members.map((m: any) => m.userId as string);
    const users = ids.length
      ? await db.orm.public.User
          .where((u: any) => u.id.in(ids))
          .select("id", "username", "displayName", "avatar")
          .all()
      : [];
    const byId = new Map(users.map((u: any) => [u.id, u]));
    res.json({
      visible: true,
      data: members.map((m: any) => ({
        userId: m.userId,
        role: m.role,
        username: byId.get(m.userId)?.username ?? null,
        displayName: byId.get(m.userId)?.displayName ?? null,
        avatar: byId.get(m.userId)?.avatar ?? null,
      })),
    });
  } catch (error) {
    reqLog(req).error("server_staff_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch staff" });
  }
});

// POST /servers/:slug/staff — owner appoints ADMIN/MODERATOR staff.
router.post(
  "/:slug/staff",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      if (server.ownerId !== req.user!.userId) {
        res.status(403).json({ error: "Только владелец может управлять персоналом" });
        return;
      }
      const { userId, role } = req.body ?? {};
      if (typeof userId !== "string" || !["ADMIN", "MODERATOR"].includes(role)) {
        res.status(400).json({ error: "userId and role (ADMIN|MODERATOR) are required" });
        return;
      }
      const user = await db.orm.public.User.where({ id: userId }).first();
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      const existing = await db.orm.public.ServerMember.where({ serverId: server.id, userId }).first();
      const member = existing
        ? await db.orm.public.ServerMember.where({ id: existing.id }).update({ role })
        : await db.orm.public.ServerMember.create({ serverId: server.id, userId, role });
      await createNotifications([
        {
          recipientId: userId,
          type: "MODERATION",
          title: `Вам выдана роль ${role} на сервере «${server.name}»`,
          entityType: "server",
          entityId: server.id,
        },
      ]);
      await recordAudit({
        actorId: req.user!.userId,
        action: "server.staff.upsert",
        targetType: "server",
        targetId: server.id,
        after: { userId, role },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      res.status(201).json(member);
    } catch (error) {
      reqLog(req).error("server_staff_upsert_failed", { error });
      res.status(500).json({ error: "Failed to update staff" });
    }
  }
);

// DELETE /servers/:slug/staff/:userId — owner removes a staff member.
router.delete(
  "/:slug/staff/:userId",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      if (server.ownerId !== req.user!.userId) {
        res.status(403).json({ error: "Только владелец может управлять персоналом" });
        return;
      }
      if (req.params.userId === server.ownerId) {
        res.status(400).json({ error: "Владельца нельзя удалить" });
        return;
      }
      await db.orm.public.ServerMember
        .where({ serverId: server.id, userId: req.params.userId as string })
        .delete();
      await recordAudit({
        actorId: req.user!.userId,
        action: "server.staff.remove",
        targetType: "server",
        targetId: server.id,
        after: { userId: req.params.userId as string },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      res.json({ message: "Staff member removed" });
    } catch (error) {
      reqLog(req).error("server_staff_remove_failed", { error });
      res.status(500).json({ error: "Failed to remove staff member" });
    }
  }
);

// ---------------------------------------------------------------------------
// Owner dashboard (N): /servers/:slug/manage
// ---------------------------------------------------------------------------

router.get(
  "/:slug/manage",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const role = await loadRole(server, req.user!.userId);
      if (!role) {
        res.status(403).json({ error: "Staff access required" });
        return;
      }
      const [followers, reviews, recentNews, recentUpdates, resources, drafts] = await Promise.all([
        followerCount(server.id),
        db.orm.public.ServerReview.where({ serverId: server.id }).aggregate(
          (a: any) => ({ total: a.count(), avg: a.avg("rating") })
        ),
        db.orm.public.ServerNews.where({ serverId: server.id }).orderBy((n: any) => n.createdAt.desc()).limit(5).all(),
        db.orm.public.ServerUpdate.where({ serverId: server.id }).orderBy((u: any) => u.publishedAt.desc()).limit(5).all(),
        db.orm.public.ServerResource.where({ serverId: server.id }).all(),
        db.orm.public.ServerNews.where({ serverId: server.id, status: "DRAFT" }).aggregate(
          (a: any) => ({ total: a.count() })
        ),
      ]);
      res.json({
        server,
        staffRole: role,
        stats: {
          followerCount: followers,
          reviewCount: Number(reviews.total ?? 0),
          rating: reviews.avg == null ? null : Math.round(Number(reviews.avg) * 10) / 10,
          draftNewsCount: Number(drafts.total ?? 0),
          resourceCount: resources.length,
        },
        recentNews,
        recentUpdates,
        heartbeat: {
          staleMs: heartbeatStaleMs(),
          fresh: isHeartbeatFresh(server.lastSeenAt),
          lastSeenAt: server.lastSeenAt,
        },
      });
    } catch (error) {
      reqLog(req).error("server_manage_fetch_failed", { error });
      res.status(500).json({ error: "Failed to fetch server management data" });
    }
  }
);

// ---------------------------------------------------------------------------
// Used resources — the opt-in relationship (T)
// ---------------------------------------------------------------------------

// POST /servers/:slug/resources — owner explicitly links a used resource.
router.post(
  "/:slug/resources",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const role = await loadRole(server, req.user!.userId);
      if (role !== "OWNER" && role !== "ADMIN") {
        res.status(403).json({ error: "Staff access required" });
        return;
      }
      const { resourceId, displayName, note } = req.body ?? {};
      if (!resourceId && !displayName) {
        res.status(400).json({ error: "resourceId or displayName is required" });
        return;
      }
      if (resourceId) {
        const resource = await db.orm.public.Resource.where({ id: resourceId as string }).first();
        if (!resource) {
          res.status(404).json({ error: "Resource not found" });
          return;
        }
      }
      const row = await db.orm.public.ServerResource.create({
        serverId: server.id,
        resourceId: resourceId || null,
        displayName:
          typeof displayName === "string" && displayName.trim()
            ? displayName.trim().slice(0, 120)
            : "Ресурс",
        note: typeof note === "string" ? note.slice(0, 300) : null,
      });
      await recordAudit({
        actorId: req.user!.userId,
        action: "server.resource.link",
        targetType: "server",
        targetId: server.id,
        after: { resourceId: resourceId || null },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      res.status(201).json(row);
    } catch (error) {
      reqLog(req).error("server_resource_link_failed", { error });
      res.status(500).json({ error: "Failed to link resource" });
    }
  }
);

// DELETE /servers/:slug/resources/:rowId — owner removes the link.
router.delete(
  "/:slug/resources/:rowId",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const role = await loadRole(server, req.user!.userId);
      if (role !== "OWNER" && role !== "ADMIN") {
        res.status(403).json({ error: "Staff access required" });
        return;
      }
      await db.orm.public.ServerResource.where({ id: req.params.rowId as string, serverId: server.id }).delete();
      res.json({ message: "Resource link removed" });
    } catch (error) {
      reqLog(req).error("server_resource_unlink_failed", { error });
      res.status(500).json({ error: "Failed to remove resource link" });
    }
  }
);

// GET /servers/:slug/resources — public ONLY while the owner keeps the opt-in
// enabled; the backend, not the UI, decides what leaves the database.
router.get("/:slug/resources", standardRateLimit, async (req, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    const callerId = optionalUserId(req);
    const role = callerId ? await loadRole(server, callerId) : null;
    if (!server.showResources && !role) {
      res.json({ enabled: false, data: [] });
      return;
    }
    const links = await db.orm.public.ServerResource.where({ serverId: server.id }).all();
    const marketIds = links.filter((l: any) => l.resourceId).map((l: any) => l.resourceId as string);
    const marketRows = marketIds.length
      ? await db.orm.public.Resource
          .where((r: any) => r.id.in(marketIds))
          .where({ status: "PUBLISHED" })
          .all()
      : [];
    const byId = new Map(marketRows.map((r: any) => [r.id, r]));
    res.json({
      enabled: true,
      data: links.map((l: any) => {
        const market = l.resourceId ? byId.get(l.resourceId) : null;
        return {
          id: l.id,
          displayName: market ? market.title : l.displayName,
          slug: market ? market.slug : null,
          coverUrl: market ? market.coverUrl : null,
          note: l.note,
        };
      }),
    });
  } catch (error) {
    reqLog(req).error("server_resources_fetch_failed", { error });
    res.status(500).json({ error: "Failed to fetch server resources" });
  }
});

// ---------------------------------------------------------------------------
// Follow (L)
// ---------------------------------------------------------------------------

router.post(
  "/:slug/follow",
  authenticate,
  standardRateLimit,
  userRateLimit({ windowMs: 60 * 60_000, max: 120, action: "server_follow" }),
  async (req: AuthRequest, res: Response) => {
    try {
      const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
      if (!server || !isPubliclyVisible(server)) {
        res.status(404).json({ error: "Server not found" });
        return;
      }
      const existing = await db.orm.public.ServerFollow.where({
        serverId: server.id,
        userId: req.user!.userId,
      }).first();
      if (existing) {
        res.json({ following: true });
        return;
      }
      await db.orm.public.ServerFollow.create({ serverId: server.id, userId: req.user!.userId });
      res.status(201).json({ following: true });
    } catch (error) {
      reqLog(req).error("server_follow_failed", { error });
      res.status(500).json({ error: "Failed to follow server" });
    }
  }
);

router.delete("/:slug/follow", authenticate, standardRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    await db.orm.public.ServerFollow.where({ serverId: server.id, userId: req.user!.userId }).delete();
    res.json({ following: false });
  } catch (error) {
    reqLog(req).error("server_unfollow_failed", { error });
    res.status(500).json({ error: "Failed to unfollow server" });
  }
});

// ---------------------------------------------------------------------------
// Statistics (E-004/E-005) — computed from real samples only
// ---------------------------------------------------------------------------

router.get("/:slug/statistics", standardRateLimit, async (req, res: Response) => {
  try {
    const server = await db.orm.public.Server.where({ slug: req.params.slug as string }).first();
    if (!server) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    if (!isPubliclyVisible(server)) {
      res.status(404).json({ error: "Server not found" });
      return;
    }
    if (!server.showStats) {
      res.json({ enabled: false, data: null });
      return;
    }
    const ranges: Record<string, number> = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 };
    const rangeKey = req.query.range as string | undefined;
    const rangeHours = ranges[rangeKey ?? "24h"] ?? 24;
    const since = new Date(Date.now() - rangeHours * 3600_000);
    const samples = await db.orm.public.ServerStatusSample
      .where({ serverId: server.id })
      .where((s: any) => s.sampledAt.gte(since))
      .orderBy((s: any) => s.sampledAt.asc())
      .limit(5000)
      .all();

    const onlineSamples = samples.filter((s: any) => s.state === "ONLINE");
    const players = onlineSamples.map((s: any) => s.players as number);
    const peak = players.length ? Math.max(...players) : null;
    const average = players.length
      ? Math.round((players.reduce((a, b) => a + b, 0) / players.length) * 10) / 10
      : null;
    const uptimePct = samples.length
      ? Math.round((onlineSamples.length / samples.length) * 1000) / 10
      : null;

    const step = samples.length > 200 ? Math.ceil(samples.length / 200) : 1;
    res.json({
      enabled: true,
      range: { hours: rangeHours, label: rangeKey || "24h" },
      data: {
        peak,
        average,
        uptimePct,
        sampleCount: samples.length,
        current: {
          state: server.monitoring,
          players: server.playerCount,
          maxPlayers: server.maxPlayers,
          lastSeenAt: server.lastSeenAt,
        },
        samples: samples
          .filter((_, i) => i % step === 0)
          .map((s: any) => ({ t: s.sampledAt, players: s.players, state: s.state })),
      },
    });
  } catch (error) {
    reqLog(req).error("server_statistics_failed", { error });
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
});

export default router;