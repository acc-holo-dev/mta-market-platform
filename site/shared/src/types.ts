// Shared DTO types for MTA Market platform components.
//
// PLAN-010 Rule 006: `site/web` and `site/server` must not import each
// other's source. The API response contracts they both rely on live here
// (and, machine-readable, in contracts/api/). The server remains the source
// of truth — these types mirror the responses of the implemented API and
// must be updated together with the routes.

/** Authenticated user shape returned by /auth/* endpoints. */
export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatar: string | null;
  role: string;
  status: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

/** Balance amounts are integer kopecks (RUB minor units). */
export interface Balance {
  available: number;
  currency: string;
}

/** GET /auth/me response shape: the profile plus the balance. */
export type MeUser = User & { createdAt?: string; balance: Balance };

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}
