"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/auth";
// E-003: the raw axios refresh exchange was migrated onto the canonical
// fetch client — refreshAccessToken() performs the same cookie-based
// /auth/refresh POST (credentials: "include"), single-flight shared.
import api, { bootstrapSession, refreshAccessToken } from "@/lib/api";

function AuthCallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setAuth } = useAuthStore();

  useEffect(() => {
    const handleCallback = async () => {
      // TASK A-001: the server never puts tokens in the URL. The OAuth
      // callback left an HttpOnly refresh cookie on the API origin; the
      // access token is obtained via /auth/refresh and kept in memory only.
      const error = searchParams.get("error");
      if (error) {
        router.push(`/auth/login?error=${encodeURIComponent(error)}`);
        return;
      }

      try {
        // Exchange the refresh cookie for an access token (memory only).
        const accessToken = await refreshAccessToken();
        if (!accessToken) {
          throw new Error("refresh exchange failed");
        }

        // Load the profile with the fresh access token.
        const { data: user } = await api.get("/auth/me", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        setAuth(user, accessToken);

        // Redirect to dashboard
        router.push("/dashboard");
      } catch (error) {
        console.error("Auth callback error:", error);
        router.push("/auth/login?error=auth_failed");
      }
    };

    handleCallback();
  }, [searchParams, router, setAuth]);

  return (
    <div className="mta-hero-surface flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <div className="h-12 w-12 animate-spin rounded-full border-2 border-line-strong border-t-accent mx-auto"></div>
        <p className="text-lg text-content-secondary">Авторизация...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  // bootstrapSession is exported for app-level reload recovery; the callback
  // page performs its own explicit refresh exchange above.
  void bootstrapSession;
  return (
    <Suspense
      fallback={
        <div className="mta-hero-surface flex min-h-screen items-center justify-center">
          <div className="text-center space-y-4">
            <div className="h-12 w-12 animate-spin rounded-full border-2 border-line-strong border-t-accent mx-auto"></div>
            <p className="text-lg text-content-secondary">Загрузка...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}