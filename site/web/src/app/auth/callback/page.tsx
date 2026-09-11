"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import axios from "axios";
import { useAuthStore } from "@/store/auth";
import api, { bootstrapSession } from "@/lib/api";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
        const { data } = await axios.post<{ accessToken: string }>(
          `${API_BASE_URL}/auth/refresh`,
          null,
          { withCredentials: true }
        );
        const accessToken = data.accessToken;

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
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
        <p className="text-lg text-slate-600 dark:text-slate-400">Авторизация...</p>
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
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="text-lg text-slate-600 dark:text-slate-400">Загрузка...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}