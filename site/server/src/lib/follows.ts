// PLAN-008 Workstream D: delivery helpers for the Follow Expansion.
// Events are delivered synchronously inside the mutations (no jobs), with
// recipient dedup — a user who is simultaneously a buyer, resource follower
// and creator follower receives exactly one notification.
import { db } from "../prisma/db";
import { createNotifications } from "./notify";
import { logger } from "./logger";

export async function creatorFollowerIds(sellerUserId: string): Promise<string[]> {
  const rows = await db.orm.public.SellerFollow
    .where({ sellerUserId })
    .select("followerId")
    .limit(500)
    .all();
  return rows.map((r: any) => r.followerId as string);
}

export async function resourceFollowerIds(resourceId: string): Promise<string[]> {
  const rows = await db.orm.public.ResourceFollow
    .where({ resourceId })
    .select("userId")
    .limit(500)
    .all();
  return rows.map((r: any) => r.userId as string);
}

export async function buyerIds(resourceId: string): Promise<string[]> {
  const purchases = await db.orm.public.Purchase
    .where({ resourceId, status: "COMPLETED" })
    .select("buyerId")
    .limit(500)
    .all();
  return Array.from(new Set(purchases.map((p: any) => p.buyerId as string)));
}

/** Does this user have an APPROVED seller profile (i.e., are they a creator)? */
export async function isCreator(userId: string): Promise<boolean> {
  const profile = await db.orm.public.SellerProfile
    .where({ userId, status: "APPROVED" })
    .first();
  return !!profile;
}

export async function usernameOf(userId: string): Promise<string | null> {
  const u = await db.orm.public.User.where({ id: userId }).select("username").first();
  return (u?.username as string) ?? null;
}

interface NotificationDraft {
  recipientId: string;
  type: "CREATOR_RESOURCE" | "CREATOR_ARTICLE" | "RESOURCE_UPDATE";
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}

/**
 * D-004: deliver with recipient dedup and actor exclusion. Returns the
 * number of notifications actually created.
 */
export async function deliverFollowNotifications(
  recipients: string[],
  build: (recipientId: string) => NotificationDraft,
  opts: { excludeActorId?: string | null } = {}
): Promise<number> {
  const unique = Array.from(new Set(recipients)).filter(
    (id) => id && id !== (opts.excludeActorId ?? null)
  );
  if (!unique.length) return 0;
  try {
    return await createNotifications(
      unique.map((recipientId) => build(recipientId)),
      { excludeActorId: opts.excludeActorId ?? null }
    );
  } catch (error) {
    logger.warn("follow_notifications_failed", { error });
    return 0;
  }
}
