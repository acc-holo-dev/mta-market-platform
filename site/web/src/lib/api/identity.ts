// PLAN-016 D-008: identity/auth domain API (discovery, identities link/
// unlink, password change). Доменные модули lib/api/* реэкспортируются из
// lib/api-ext.ts — существующие импорты по всему app не ломаются.
// PLAN-019 E-003: the core auth/profile functions (fetchMe, login, register,
// profile patch, identities) moved here from lib/api-ext.ts. AuthResponse /
// MeUser / Balance come from @mta-market/shared — the local duplicates were
// removed (PLAN-019 audit: shared-type dedup).
import api from "../api";
import type { AuthResponse, MeUser } from "@mta-market/shared";

// ---------- Core auth / profile (PLAN-001 A-003, B-002, C-003, D-002) ----------

/** GET /auth/me — the profile plus the balance (C-003). */
export async function fetchMe(): Promise<MeUser> {
  const { data } = await api.get<MeUser>("/auth/me");
  return data;
}

/** Login with username OR email + password (A-002/A-003). */
export async function loginRequest(login: string, password: string): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/login", { login, password });
  return data;
}

/** Register; the server returns 201 with a session (A-001). */
export async function registerRequest(body: {
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
}): Promise<AuthResponse> {
  const { data } = await api.post<AuthResponse>("/auth/register", body);
  return data;
}

/** PATCH /auth/me — only displayName and avatar are editable (B-002). */
export async function patchProfile(body: { displayName?: string; avatar?: string }): Promise<MeUser> {
  const { data } = await api.patch<MeUser>("/auth/me", body);
  return data;
}

export interface Identity {
  id: string;
  provider: string;
  providerAccountId: string;
}

export async function fetchIdentities(): Promise<Identity[]> {
  const { data } = await api.get<Identity[]>("/auth/identities");
  return data;
}

// ---------- External provider discovery / identity link (PLAN-016) ----------

/** GET /auth/providers — public discovery of enabled login providers. */
export interface AuthProviderInfo {
  provider: string;
  displayName: string;
  mode: "redirect" | "direct";
  botName?: string;
}

export async function fetchAuthProviders(): Promise<AuthProviderInfo[]> {
  const { data } = await api.get<{ providers: AuthProviderInfo[] }>("/auth/providers");
  return data.providers;
}

/** POST /auth/:provider/link/start — set the link_user cookie for this session. */
export async function startIdentityLink(provider: string): Promise<{ authorizationUrl: string }> {
  const { data } = await api.post<{ authorizationUrl: string }>(
    `/auth/${encodeURIComponent(provider)}/link/start`
  );
  return data;
}

/** DELETE /auth/identities/:id — unlink an external identity. */
export async function unlinkIdentity(id: string): Promise<{ message: string }> {
  const { data } = await api.delete<{ message: string }>(`/auth/identities/${id}`);
  return data;
}

/** PATCH /auth/password — change the local password (invalidates other sessions). */
export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<{ message: string; revokedSessions: number }> {
  const { data } = await api.patch<{ message: string; revokedSessions: number }>("/auth/password", {
    currentPassword,
    newPassword,
  });
  return data;
}

// --- Активные сессии (PLAN-019 L-003) ----------------------------------------

export interface SessionInfo {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastRotatedAt: string | null;
  current: boolean;
}

/** GET /auth/sessions — активные сессии текущего пользователя (без токенов). */
export async function fetchSessions(): Promise<SessionInfo[]> {
  const { data } = await api.get<{ sessions: SessionInfo[] }>("/auth/sessions");
  return data.sessions;
}

/** DELETE /auth/sessions/:id — отозвать одну свою сессию. */
export async function revokeSession(id: string): Promise<{ message: string }> {
  const { data } = await api.delete<{ message: string }>(`/auth/sessions/${id}`);
  return data;
}

/** DELETE /auth/sessions — отозвать все сессии, кроме текущей. */
export async function revokeAllSessions(): Promise<{ revoked: number; keptCurrent: boolean }> {
  const { data } = await api.delete<{ revoked: number; keptCurrent: boolean }>("/auth/sessions");
  return data;
}