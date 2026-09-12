// PLAN-019 O-001/O-003 — React Query key factory (site/web).
//
// POLICY (server state):
// 1. Every useQuery/useInfiniteQuery key for server state is built HERE via
//    these factories — never as an inline literal array in a component.
//    One endpoint == one key family; two components reading the same endpoint
//    MUST share one key (one cache entry) unless the params genuinely differ.
// 2. Invalidation after mutations (O-003) uses the SAME factories:
//    canonical invalidation points in this codebase —
//      · resource publish/unpublish  → seller-resources family (still a
//        literal in seller pages — pending its own factory, do not copy it).
//      · purchase completed/created  → purchasesKeys.all (resources/[slug])
//      · follow / unfollow           → meFollowsKey(kind) or meFollowsKey()
//      · profile update (patchProfile) → ["me"] + meFollowsKey() (account)
//      · notification read           → notificationsKeys.all + badge()
//      · identity unlink             → identitiesKey() (account/identities)
//    Prefix keys ("purchases", "me", "notifications") invalidate the whole
//    family below them — keep roots stable, add specificity at the leaf.
// 3. Auth-sensitive queries (["me", …]) NEVER embed accessToken in the key:
//    the token travels via the axios interceptor, and auth-state mutations
//    invalidate the family root instead (token-in-key caused cross-login
//    cache misses / stale duplicates — PLAN-019 audit).
// 4. staleTime / refetchInterval / retry stay PER CALL SITE — this module
//    only owns key identity. Never touch QueryClient defaults here.

// ---------- identities (GET /auth/identities) ----------
// Single canonical key. account/page.tsx and account/identities/page.tsx both
// fetch via fetchIdentities — one key, one shared cache entry.
export const identitiesKey = () => ["identities"] as const;

// ---------- seller profile (GET /sellers/me) ----------
// One key for both consumers (seller cabinet + Sidebar creator section):
// same endpoint, same freshness expectations → shared cache entry.
export const sellerProfileKey = () => ["seller", "profile"] as const;

// ---------- search (GET /search) ----------
// "results" (search page) and "dropdown" (GlobalSearch) legitimately differ in
// staleness options, but belong to one family so any invalidation of
// ["search"] hits both.
export const searchKeys = {
  resultsKey: (q: string) => ["search", "results", q] as const,
  dropdownKey: (q: string) => ["search", "dropdown", q] as const,
} as const;

// ---------- activity ----------
// Two endpoints: GET /activity (aggregate snapshot — LiveStrip,
// ActivityFeed, PopularSection, home page) and GET /activity/live (LiveChip).
// Different endpoints → different keys; no limit is passed today, the optional
// leaf is reserved for a future ?limit= param (it changes the cache identity).
export const activityKeys = {
  snapshotKey: (limit?: number) =>
    limit === undefined
      ? (["activity", "snapshot"] as const)
      : (["activity", "snapshot", limit] as const),
  liveKey: () => ["activity", "live"] as const,
};

// ---------- purchases (GET /purchases/my) ----------
// One endpoint, several UI contexts. The context is a cache-identity leaf so
// panels can keep independent observers, while ["purchases"] remains the
// family root for post-purchase invalidation.
export const purchasesKeys = {
  all: () => ["purchases"] as const,
};
export const myPurchasesKey = (context: string, ...rest: readonly unknown[]) =>
  ["purchases", "my", context, ...rest] as const;

// ---------- follows (GET /me/follows/{creators|resources|threads}) ----------
// Token-free by policy (see header §3): the axios interceptor attaches the
// access token; auth transitions invalidate the family root instead.
// meFollowsKey() (no kind) → ["me","follows"] root for family invalidation.
export type FollowKind = "creators" | "resources" | "threads";
export const meFollowsKey = (kind?: FollowKind) =>
  kind === undefined ? (["me", "follows"] as const) : (["me", "follows", kind] as const);

// ---------- notifications (GET /notifications) ----------
// listKey(filter) and badgeKey() hit the same endpoint with different params —
// legitimately distinct cache entries, one family for invalidation.
export const notificationsKeys = {
  all: () => ["notifications"] as const,
  listKey: (filter: "all" | "unread", ...rest: readonly unknown[]) =>
    ["notifications", filter, ...rest] as const,
  badgeKey: () => ["notifications", "badge"] as const,
};

// ---------- resource detail (GET /resources/:slug …) ----------
export const resourceKeys = {
  resource: (slug: string) => ["resource", slug] as const,
  resourceVersions: (slug: string) => ["resource-versions", slug] as const,
  resourceReviews: (slug: string, ...rest: readonly unknown[]) =>
    ["resource-reviews", slug, ...rest] as const,
};