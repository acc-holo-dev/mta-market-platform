// PLAN Q-004: append-only audit log, separate from application logs.
// Sensitive state changes (moderation, seller approvals, refunds, dispute
// transitions, key rotation) record who did WHAT to WHICH target, from
// where, under which request_id. Records are never updated or deleted.
import { db } from "../prisma/db";
import { logger } from "./logger";

export interface AuditInput {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  requestId?: string | null;
}

function snapshot(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Records an audit event; failures never break the caller's flow. */
export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await db.orm.public.AuditLog.create({
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      before: snapshot(input.before),
      after: snapshot(input.after),
      ip: input.ip ?? null,
      requestId: input.requestId ?? null,
    });
    logger.info("audit_recorded", {
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      actor_id: input.actorId,
    });
  } catch (error) {
    // The audit trail must not silently disappear: log loudly, never throw.
    logger.error("audit_write_failed", {
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      error,
    });
  }
}
