// PLAN-019 E-003 + A-005 + §61: lib/api-ext.ts is now a pure RE-EXPORT SHIM.
//
// The physical split into domain modules under lib/api/ is complete:
//   ./api/identity  — auth, profile, identities, external providers, sessions
//   ./api/payments  — payment provider discovery
//   ./api/resources — resources, media, versions, reviews, upload, search
//   ./api/servers   — servers, server news/updates, server reviews, statistics
//   ./api/community — forum, follows, notifications, reports, public profiles
//   ./api/content   — articles, dashboard widgets, activity read layer
//   ./api/commerce  — purchases, payments, services, disputes, seller analytics
//   ./api/admin     — NEW admin endpoints + façade over the legacy admin fns
//                     (unchanged; imports everything admin-related from here)
//   ./api/advertising — admin advertising/premium (unchanged)
//
// Strategy: zero-risk shim. All importer files keep importing from
// "@/lib/api-ext" (directly or via the lib/api/admin|advertising façades,
// which re-export from this module) and compile UNCHANGED; importer migration
// to the domain modules happens opportunistically in the frontend wave.
//
// Shared-type dedup (PLAN-019 audit): AuthResponse / MeUser / Balance /
// Pagination / Paginated are no longer re-declared — they are re-exported
// from @mta-market/shared. `Resource` stays web-side (not defined in shared).
//
// Deleted as provably dead exports (§61 usage sweep: zero references in src):
//   - StaffMember — unused twin interface of StaffMemberRow, ./api/servers
// (fetchSellerStore was re-checked against its importer in
// app/sellers/[username]/page.tsx and stays — it is alive.)
//
// The canonical fetch client lives in ./api.ts (E-003/A-005: axios removed).

export { getErrorMessage, formatRub } from "@mta-market/shared";

export type {
  AuthResponse,
  MeUser,
  Balance,
  Pagination,
  Paginated,
} from "@mta-market/shared";

export * from "./api/identity";
export * from "./api/payments";
export * from "./api/resources";
export * from "./api/servers";
export * from "./api/community";
export * from "./api/content";
export * from "./api/commerce";