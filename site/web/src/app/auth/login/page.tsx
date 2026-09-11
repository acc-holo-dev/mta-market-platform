// Auth: username/email + password login (PLAN-001 A-003), plus Discord OAuth.
"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { loginRequest, getErrorMessage } from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { ErrorText } from "@/components/ui/StatusBadge";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const oauthError = searchParams.get("error");
  const oauthErrorText =
    oauthError === "session_expired"
      ? "Сессия истекла. Войдите снова."
      : oauthError
        ? "Не удалось войти через Discord. Попробуйте ещё раз."
        : null;

  const mutation = useMutation({
    mutationFn: () => loginRequest(login.trim(), password),
    onSuccess: ({ user, accessToken }) => {
      setAuth(user, accessToken);
      router.push("/");
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось войти")),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!login.trim() || !password) {
      setError("Введите логин (имя или email) и пароль");
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-950 py-12 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Вход в MTA Market</CardTitle>
          <CardDescription>
            Войдите, чтобы покупать и продавать ресурсы для MTA:SA
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="login" className="text-sm text-slate-600 dark:text-slate-400">
                Имя пользователя или email
              </label>
              <Input
                id="login"
                name="login"
                autoComplete="username"
                value={login}
                onChange={(e) => setLogin(e.target.value)}
                placeholder="ivan или ivan@example.com"
                className="mt-1"
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm text-slate-600 dark:text-slate-400">
                Пароль
              </label>
              <div className="relative mt-1">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                  disabled={mutation.isPending}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {oauthErrorText ? <ErrorText message={oauthErrorText} /> : null}
            {error ? <ErrorText message={error} /> : null}

            <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? "Вход..." : "Войти"}
            </Button>
          </form>

          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            <span className="text-xs text-slate-400 uppercase">или</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
          </div>

          <Button
            variant="outline"
            size="lg"
            className="w-full"
            disabled={mutation.isPending}
            onClick={() => {
              window.location.href = `${
                process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
              }/auth/discord`;
            }}
          >
            <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
            </svg>
            Войти через Discord
          </Button>

          <div className="text-center text-sm text-slate-600 dark:text-slate-400">
            Нет аккаунта?{" "}
            <Link
              href="/auth/register"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Зарегистрируйтесь
            </Link>
          </div>

          <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
            <Link
              href="/"
              className="text-sm text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
            >
              ← Вернуться на Маркетплейс
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
