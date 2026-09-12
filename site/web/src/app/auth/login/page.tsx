// Auth: username/email + password login (PLAN-001 A-003), plus Discord OAuth.
// PLAN-013: token-based presentation — hero-surface фон, бренд-марка, card
// max-w-md; копия/селекторы (labels, #password, кнопка «Войти» в форме)
// сохранены для E2E (plan001/plan003).
"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Gauge } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { loginRequest, getErrorMessage } from "@/lib/api-ext";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";

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
        ? "Не удалось войти через внешний сервис. Попробуйте ещё раз."
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
    <div className="mta-hero-surface flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        {/* Бренд-марка — тот же знак, что в Navbar (§6/§7) */}
        <Link
          href="/"
          className="mb-8 flex flex-shrink-0 items-center justify-center gap-2.5"
          aria-label="MTA Market — на главную"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-soft shadow-accent ring-1 ring-line-accent/40">
            <Gauge className="h-5 w-5 text-accent-strong" />
          </span>
          <span className="text-xl font-bold tracking-tight">
            MTA&nbsp;<span className="mta-brand-text-gradient">Market</span>
          </span>
        </Link>

        <Card className="w-full max-w-md shadow-raised">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold tracking-tight">Вход в MTA Market</CardTitle>
            <CardDescription>
              Войдите, чтобы покупать и продавать ресурсы для MTA:SA
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label
                  htmlFor="login"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Имя пользователя или email
                </label>
                <Input
                  id="login"
                  name="login"
                  autoComplete="username"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="ivan или ivan@example.com"
                  disabled={mutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Пароль
                </label>
                <div className="relative">
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
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-content-muted transition-colors duration-fast hover:text-content"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {oauthErrorText ? (
                <p className="text-sm text-bad" role="alert">
                  {oauthErrorText}
                </p>
              ) : null}
              {error ? (
                <p className="text-sm text-bad" role="alert">
                  {error}
                </p>
              ) : null}

              <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? "Вход..." : "Войти"}
              </Button>
            </form>

            <div className="flex items-center gap-3">
              <div className="h-px flex-1 bg-line" />
              <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">или</span>
              <div className="h-px flex-1 bg-line" />
            </div>

<OAuthButtons onError={(m) => setError(m)} />
            <div className="text-center text-sm text-content-secondary">
              Нет аккаунта?{" "}
              <Link href="/auth/register" className="text-accent-strong transition-colors duration-fast hover:underline">
                Зарегистрируйтесь
              </Link>
            </div>

            <div className="border-t border-line pt-4">
              <Link
                href="/"
                className="text-sm text-content-secondary transition-colors duration-fast hover:text-content"
              >
                ← Вернуться на Маркетплейс
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="mta-hero-surface flex min-h-screen items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-line-strong border-t-accent mx-auto" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
