// PLAN-005 M: notification foundation. Recipient-owned notification objects
// with a stable type vocabulary (M-002). Creation is best-effort: a follower
// notification burst must never fail the triggering request.
import { db } from "../prisma/db";
import { logger } from "./logger";

export type NotificationType =
  | "SERVER_NEWS"
  | "SERVER_UPDATE"
  | "FORUM_REPLY"
  | "REVIEW_EVENT"
  | "MODERATION"
  // PLAN-008: Follow Expansion (Creator + Resource).
  | "CREATOR_RESOURCE"
  | "CREATOR_ARTICLE"
  | "RESOURCE_UPDATE";

export interface NotificationInput {
  recipientId: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

/**
 * Creates notifications for a set of recipients. Deduplicates per recipient
 * (e.g. a user who is both the thread author and a later post author gets
 * one FORUM_REPLY row) and never notifies the actor themselves.
 *
 * At PLAN-005 scale recipients are bounded by the follower list; writes are
 * sequential and failures are logged, not thrown.
 */
export async function createNotifications(
  inputs: NotificationInput[],
  opts: { excludeActorId?: string | null } = {}
): Promise<number> {
  const actor = opts.excludeActorId ?? null;
  const seen = new Set<string>();
  const rows = inputs.filter((n) => {
    if (!n.recipientId || n.recipientId === actor) return false;
    if (seen.has(n.recipientId)) return false;
    seen.add(n.recipientId);
    return true;
  });

  let created = 0;
  for (const n of rows) {
    try {
      await db.orm.public.Notification.create({
        recipientId: n.recipientId,
        type: n.type,
        title: n.title,
        body: n.body ?? null,
        entityType: n.entityType ?? null,
        entityId: n.entityId ?? null,
      });
      created += 1;
    } catch (error) {
      logger.error("notification_create_failed", { recipient_id: n.recipientId, error });
    }
  }
  return created;
}

/** Unread count for the notification badge. */
export async function unreadNotificationCount(recipientId: string): Promise<number> {
  const result = await db.orm.public.Notification.where({ recipientId, readAt: null }).aggregate(
    (agg: any) => ({ total: agg.count() })
  );
  return Number(result.total ?? 0);
}