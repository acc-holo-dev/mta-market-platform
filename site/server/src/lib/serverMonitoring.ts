// PLAN-005 E: monitoring state derived ONLY from real integration data.
// E-006 rule: "the system does not know" (UNKNOWN) is never presented as
// "the server is definitely down" (OFFLINE). OFFLINE is recorded exclusively
// when the integration itself reports a graceful shutdown.
import { db } from "../prisma/db";
import { logger } from "./logger";

/**
 * A heartbeat is considered fresh for this long after lastSeenAt. The module
 * heartbeats every SERVER_HEARTBEAT_INTERVAL_SECONDS (default 60s); three
 * missed intervals flip ONLINE servers to UNKNOWN (not OFFLINE).
 */
export function heartbeatStaleMs(): number {
  const interval =
    parseInt(process.env.SERVER_HEARTBEAT_INTERVAL_SECONDS || "60", 10) * 1000;
  return interval * 3;
}

export function isHeartbeatFresh(lastSeenAt: Date | string | null): boolean {
  if (!lastSeenAt) return false;
  const ts = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  return Date.now() - ts.getTime() <= heartbeatStaleMs();
}

/**
 * Persists one real sample and updates the server's live monitoring state.
 * `state ONLINE` requires fresh heartbeat context; `OFFLINE` is only set
 * when the server itself reported a graceful shutdown.
 */
export async function recordHeartbeatSample(
  serverId: string,
  sample: { state: "ONLINE" | "OFFLINE"; players: number; maxPlayers?: number | null }
): Promise<void> {
  await db.orm.public.ServerStatusSample.create({
    serverId,
    state: sample.state,
    players: sample.players,
    maxPlayers: sample.maxPlayers ?? null,
  });
}

/**
 * Monitoring sweep job: ONLINE servers whose heartbeats stopped fall back to
 * UNKNOWN (E-006), and stale ACTIVE review tokens are marked EXPIRED.
 * Returns how many servers/tokens were updated (for tests/observability).
 */
export async function runMonitoringSweep(): Promise<{ servers: number; tokens: number }> {
  let servers = 0;
  let tokens = 0;
  try {
    const staleCandidates = await db.orm.public.Server.where({ monitoring: "ONLINE" }).all();
    for (const server of staleCandidates) {
      if (!isHeartbeatStale(server.lastSeenAt)) continue;
      await db.orm.public.Server.where({ id: server.id }).update({
        monitoring: "UNKNOWN",
        playerCount: null,
      });
      servers += 1;
    }
  } catch (error) {
    logger.error("monitoring_sweep_servers_failed", { error });
  }

  try {
    const activeTokens = await db.orm.public.ServerReviewToken.where({ status: "ACTIVE" }).all();
    for (const token of activeTokens) {
      if (new Date(token.expiresAt).getTime() > Date.now()) continue;
      await db.orm.public.ServerReviewToken.where({ id: token.id }).update({ status: "EXPIRED" });
      tokens += 1;
    }
  } catch (error) {
    logger.error("monitoring_sweep_tokens_failed", { error });
  }

  return { servers, tokens };
}

function isHeartbeatStale(lastSeenAt: Date | string | null): boolean {
  if (!lastSeenAt) return true;
  const ts = typeof lastSeenAt === "string" ? new Date(lastSeenAt) : lastSeenAt;
  return Date.now() - ts.getTime() > heartbeatStaleMs();
}