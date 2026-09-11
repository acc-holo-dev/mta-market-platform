// PLAN-005 Workstreams C/AC/33: server integration endpoints — the wire
// protocol consumed by the mta-market-module.
//
// Proof-of-control (C-001): the module sends the integration token that the
// owner configured; possession of the secret proves control of the server.
// The same heartbeat carries ONLY aggregate monitoring data (online count,
// max players, status) — never player identity, IP or chat (§33).
import { Router, Response } from "express";
import { standardRateLimit } from "../lib/rateLimit";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";
import { recordAudit } from "../lib/audit";
import { sha256Hex, issueReviewToken } from "../lib/serverIntegration";
import { recordHeartbeatSample } from "../lib/serverMonitoring";
import { logger } from "../lib/logger";

const router: Router = Router();

interface HeartbeatBody {
  token?: unknown;
  state?: unknown;
  players?: unknown;
  maxPlayers?: unknown;
  version?: unknown;
}

/**
 * POST /integration/heartbeat — the module reports liveness + player counts.
 *
 * Effects:
 *  - valid token: server monitoring = ONLINE (or OFFLINE when the server
 *    gracefully reports shutdown), lastSeenAt/players updated, sample stored;
 *  - first valid heartbeat: verification PENDING -> VERIFIED, lifecycle
 *    CREATED/PENDING_VERIFICATION -> VERIFIED (A-003), audited;
 *  - unknown token: 401 (never leak which server a token belongs to).
 */
router.post("/heartbeat", standardRateLimit, async (req, res: Response) => {
  try {
    const { token, state, players, maxPlayers } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof token !== "string" || token.length < 16 || token.length > 120) {
      res.status(401).json({ error: "Invalid integration token" });
      return;
    }

    const server = await db.orm.public.Server
      .where({ integrationTokenHash: sha256Hex(token) })
      .first();
    if (!server) {
      res.status(401).json({ error: "Invalid integration token" });
      return;
    }
    if (server.lifecycle === "SUSPENDED" || server.lifecycle === "ARCHIVED") {
      res.status(403).json({ error: "Server is suspended or archived" });
      return;
    }

    // Graceful shutdown is the only source of OFFLINE (E-006): heartbeats
    // that simply stop arriving degrade to UNKNOWN via the monitoring sweep.
    const reportedState = state === "OFFLINE" ? "OFFLINE" : "ONLINE";
    const playersNum =
      players === undefined || players === null ? (reportedState === "OFFLINE" ? 0 : null) : Math.max(0, Math.round(Number(players)));
    const maxPlayersNum =
      maxPlayers === undefined || maxPlayers === null || maxPlayers === ""
        ? server.maxPlayers ?? null
        : Math.max(0, Math.round(Number(maxPlayers)));

    if (playersNum !== null && !Number.isFinite(playersNum)) {
      res.status(400).json({ error: "players must be a number" });
      return;
    }

    await recordHeartbeatSample(server.id, {
      state: reportedState,
      players: playersNum ?? 0,
      maxPlayers: maxPlayersNum,
    });

    const wasUnverified = server.verification !== "VERIFIED";
    const update: Record<string, unknown> = {
      monitoring: reportedState,
      lastSeenAt: new Date().toISOString(),
      playerCount: reportedState === "OFFLINE" ? 0 : playersNum,
      maxPlayers: maxPlayersNum,
    };
    if (reportedState === "ONLINE" && wasPending(server)) {
      update.verification = "VERIFIED";
      update.verifiedAt = new Date().toISOString();
      update.verificationNote = null;
      update.lifecycle = server.lifecycle === "ACTIVE" ? "ACTIVE" : "VERIFIED";
    }

    const updated = await db.orm.public.Server.where({ id: server.id }).update(update);

    if (wasPending(server)) {
      logger.info("server_verification_confirmed", { server_id: server.id });
      await recordAudit({
        actorId: "system",
        action: "server.verification.confirmed",
        targetType: "server",
        targetId: server.id,
        after: { via: "integration_heartbeat" },
        ip: req.ip,
        requestId: (req as any).id ?? null,
      });
    }

    res.json({
      status: "ok",
      monitoring: updated?.monitoring ?? reportedState,
      verification: updated?.verification ?? server.verification,
    });
  } catch (error) {
    reqLog(req).error("integration_heartbeat_failed", { error });
    res.status(500).json({ error: "Heartbeat failed" });
  }
});

function wasPending(server: any): boolean {
  return server.verification !== "VERIFIED";
}

/**
 * POST /integration/review-tokens — the module requests a one-time review
 * token for a player (J-002). Bound to the authenticated server, expiring,
 * single-use; the plaintext token is returned exactly once and handed to the
 * player by the server itself (MTA Market never sees who the player is).
 */
router.post("/review-tokens", standardRateLimit, async (req, res: Response) => {
  try {
    const { token, note, ttlMinutes } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof token !== "string" || token.length < 16 || token.length > 120) {
      res.status(401).json({ error: "Invalid integration token" });
      return;
    }
    const server = await db.orm.public.Server
      .where({ integrationTokenHash: sha256Hex(token) })
      .first();
    if (!server) {
      res.status(401).json({ error: "Invalid integration token" });
      return;
    }
    if (server.lifecycle === "SUSPENDED" || server.lifecycle === "ARCHIVED") {
      res.status(403).json({ error: "Server integration suspended" });
      return;
    }
    const issued = await issueReviewToken(server.id, {
      ttlMinutes: typeof ttlMinutes === "number" ? ttlMinutes : undefined,
      note: typeof note === "string" ? note.slice(0, 200) : null,
    });
    res.status(201).json({
      reviewToken: issued.token,
      expiresAt: issued.expiresAt,
    });
  } catch (error) {
    reqLog(req).error("review_token_issue_failed", { error });
    res.status(500).json({ error: "Failed to issue review token" });
  }
});

export default router;