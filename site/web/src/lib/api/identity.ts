// PLAN-016 D-008: identity/auth domain API (discovery, identities link/
// unlink, password change). Доменные модули lib/api/* реэкспортируются из
// lib/api-ext.ts — существующие импорты по всему app не ломаются.
import api from "../api";

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