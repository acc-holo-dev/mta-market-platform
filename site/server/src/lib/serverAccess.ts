// PLAN-005 A-004/Q/AA: server-side authorization for the Server domain.
// Frontend UI hiding is never trusted — every ownership/management rule is
// enforced here and called from every mutating server route.
import { db } from "../prisma/db";

export type ServerStaffRole = "OWNER" | "ADMIN" | "MODERATOR";

export interface ServerRow {
  id: string;
  ownerId: string;
  lifecycle: string;
  verification: string;
  [k: string]: unknown;
}

/**
 * Loads the staff role of a user on a server. OWNER additionally accepts the
 * server.ownerId identity (defensive: the OWNER member row is created at
 * registration, but ownerId stays the source of truth).
 */
export async function loadStaffRole(
  server: Pick<ServerRow, "id" | "ownerId">,
  userId: string
): Promise<ServerStaffRole | null> {
  if (server.ownerId === userId) return "OWNER";
  const member = await db.orm.public.ServerMember.where({ serverId: server.id, userId }).first();
  if (!member) return null;
  if (member.role === "OWNER") return "OWNER";
  if (member.role === "ADMIN") return "ADMIN";
  if (member.role === "MODERATOR") return "MODERATOR";
  return null;
}

/** News/updates/branding/privacy are owner+admin capabilities. */
export function canManage(role: string | null): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Community/discussion management additionally allows moderators. */
export function canModerateCommunity(role: string | null): boolean {
  return role === "OWNER" || role === "ADMIN" || role === "MODERATOR";
}

/** Lifecycle states visible in public listings/pages. */
export const PUBLIC_SERVER_LIFECYCLES: readonly string[] = ["VERIFIED", "ACTIVE"];

export function isPubliclyVisible(server: Pick<ServerRow, "lifecycle">): boolean {
  return PUBLIC_SERVER_LIFECYCLES.includes(server.lifecycle);
}