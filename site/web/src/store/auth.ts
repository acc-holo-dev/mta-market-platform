// Global auth state (Zustand)
// TASK A-001/D-006 browser token policy:
// - refresh token: HttpOnly cookie only (never enters JS, never stored here);
// - access token: memory only (this store) — survives SPA navigation,
//   dies with the page; a page reload silently re-authenticates via
//   the refresh cookie (see lib/api.ts bootstrap);
// - nothing auth-related is persisted to localStorage/sessionStorage.
import { create } from "zustand";

// Canonical User DTO lives in @mta-market/shared (PLAN-010 site/shared);
// re-exported here so existing imports from "@/store/auth" keep working.
import type { User } from "@mta-market/shared";
export type { User };

interface AuthState {
  user: User | null;
  accessToken: string | null;
  /** Login: store user + in-memory access token. */
  setAuth: (user: User, accessToken: string) => void;
  /** Replace the in-memory access token after a silent refresh. */
  setAccessToken: (accessToken: string) => void;
  setUser: (user: User) => void;
  clearAuth: () => void;
  isAuthenticated: () => boolean;
}

export const useAuthStore = create<AuthState>()((set, get) => ({
  user: null,
  accessToken: null,

  setAuth: (user, accessToken) => {
    set({ user, accessToken });
  },

  setAccessToken: (accessToken) => {
    set({ accessToken });
  },

  setUser: (user) => {
    set({ user });
  },

  clearAuth: () => {
    set({ user: null, accessToken: null });
  },

  isAuthenticated: () => {
    return get().accessToken !== null;
  },
}));