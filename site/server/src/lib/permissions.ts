// PLAN L-002: permission model.
// Central place deciding WHO may do WHAT. Roles group permissions: a plain
// USER gains seller capabilities through an APPROVED SellerProfile (L-001);
// ADMIN/MODERATOR carry platform privileges. Route handlers call these
// helpers instead of scattering role checks.

import { db } from "../prisma/db";

export type Actor = {
  userId: string;
  role: "USER" | "ADMIN" | "MODERATOR";
};

export function isAdminOrModerator(actor: Pick<Actor, "role">): boolean {
  return actor.role === "ADMIN" || actor.role === "MODERATOR";
}

export function isAdmin(actor: Pick<Actor, "role">): boolean {
  return actor.role === "ADMIN";
}

/**
 * L-001: seller publish/create capability. A user can create and submit
 * resources/services only with an APPROVED seller profile (moderators and
 * admins are always allowed — they moderate the marketplace).
 */
export async function canCreateListings(actor: Actor): Promise<boolean> {
  if (isAdminOrModerator(actor)) return true;
  const profile = await db.orm.public.SellerProfile
    .where({ userId: actor.userId, status: "APPROVED" })
    .first();
  return profile != null;
}

/** Human-readable reason for a denied listing action (for API responses). */
export function sellerGateMessage(): string {
  return "Seller approval required. Apply at POST /seller/apply and wait for moderation.";
}

/**
 * K-001: a purchase is a valid review basis only when the buyer is not the
 * seller of the resource (self-purchase review fraud).
 */
export async function isSelfPurchase(purchaseId: string, buyerId: string): Promise<boolean> {
  const purchase = await db.orm.public.Purchase.where({ id: purchaseId }).first();
  if (!purchase) return false;
  const resource = await db.orm.public.Resource
    .where({ id: purchase.resourceId })
    .first();
  return resource?.sellerId === buyerId;
}
