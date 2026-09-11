// API client for MTA Market backend
// TASK A-001: cookie-based session with in-memory access token.
// - All requests are sent withCredentials so the HttpOnly refresh cookie
//   flows to the API (cross-origin dev requires CORS_ORIGINS + COOKIE_SAMESITE=none).
// - 401 -> single-flight refresh -> retry the original request exactly once.
// - Parallel 401s share one refresh promise (no refresh storm).
import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { useAuthStore, type User } from "@/store/auth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

// Request interceptor: attach the in-memory access token.
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

// Single-flight refresh: concurrent 401 responses await the same promise.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ accessToken: string }>(
        `${API_BASE_URL}/auth/refresh`,
        null,
        { withCredentials: true }
      )
      .then(({ data }) => data.accessToken)
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Response interceptor: one refresh + one retry per failed request.
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableConfig | undefined;

    const isRefreshCall = originalRequest?.url?.includes("/auth/refresh");

    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry &&
      !isRefreshCall
    ) {
      originalRequest._retry = true;

      const newToken = await refreshAccessToken();

      if (newToken) {
        const { user, setAccessToken } = useAuthStore.getState();
        setAccessToken(newToken);
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return api(originalRequest);
      }

      // Refresh failed: session is gone (expired/revoked/reuse detected).
      useAuthStore.getState().clearAuth();
      if (typeof window !== "undefined" && !window.location.pathname.startsWith("/auth")) {
        window.location.href = "/auth/login?error=session_expired";
      }
    }

    return Promise.reject(error);
  }
);

/**
 * Bootstrap session after a page reload: exchange the refresh cookie for a
 * fresh access token and load the profile. Safe to call on every app start;
 * resolves to false when there is no valid session.
 */
export async function bootstrapSession(): Promise<boolean> {
  const { isAuthenticated, setAuth, setUser } = useAuthStore.getState();

  if (isAuthenticated()) {
    return true;
  }

  const token = await refreshAccessToken();
  if (!token) {
    return false;
  }

  try {
    const { data: user } = await api.get<User>("/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (user) {
      setAuth(user, token);
    } else {
      setUser(user);
    }
    return true;
  } catch {
    useAuthStore.getState().clearAuth();
    return false;
  }
}

export default api;