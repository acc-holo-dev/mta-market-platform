// TASK A-008: Resource moderation state machine and transition policy.
// Single source of truth for who may move a resource between statuses.
// Sellers manage content; moderators manage the lifecycle.

export const RESOURCE_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "PUBLISHED",
  "SUSPENDED",
] as const;

export type ResourceStatus = (typeof RESOURCE_STATUSES)[number];

export function isResourceStatus(value: unknown): value is ResourceStatus {
  return (
    typeof value === "string" &&
    (RESOURCE_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Seller-allowed transitions (TASK A-008):
 * - DRAFT -> PENDING_REVIEW  (submit for moderation)
 * - PENDING_REVIEW -> DRAFT  (withdraw submission)
 *
 * Everything else is privileged. Notably a seller can NEVER:
 * - publish (PUBLISHED) — moderation-only;
 * - suspend (SUSPENDED) — moderation-only;
 * - leave SUSPENDED (unsuspend) — moderation-only;
 * - unpublish a PUBLISHED resource (PUBLISHED -> DRAFT) — moderation-only.
 */
export const SELLER_TRANSITIONS: Record<ResourceStatus, readonly ResourceStatus[]> = {
  DRAFT: ["PENDING_REVIEW"],
  PENDING_REVIEW: ["DRAFT"],
  PUBLISHED: [],
  SUSPENDED: [],
};

/**
 * Moderator/admin-allowed transitions (PLAN J-001 state machine):
 * - PENDING_REVIEW -> PUBLISHED (approve)
 * - PENDING_REVIEW -> DRAFT (reject back to seller)
 * - PENDING_REVIEW -> SUSPENDED (reject hard)
 * - PUBLISHED -> SUSPENDED (take down)
 * - SUSPENDED -> PENDING_REVIEW (unsuspend into review)
 * - SUSPENDED -> DRAFT (return to seller)
 */
export const ADMIN_TRANSITIONS: Record<ResourceStatus, readonly ResourceStatus[]> = {
  DRAFT: [],
  PENDING_REVIEW: ["PUBLISHED", "DRAFT", "SUSPENDED"],
  PUBLISHED: ["SUSPENDED"],
  SUSPENDED: ["PENDING_REVIEW", "DRAFT"],
};

export function isTransitionAllowed(
  from: ResourceStatus,
  to: ResourceStatus,
  actor: "seller" | "admin"
): boolean {
  const table = actor === "seller" ? SELLER_TRANSITIONS : ADMIN_TRANSITIONS;
  return (table[from] ?? []).includes(to);
}