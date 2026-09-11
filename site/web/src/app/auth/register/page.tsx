// Auth: registration with username/email/password (PLAN-001 A-003).
// PLAN-013: token-based presentation — hero-surface фон, бренд-марка, card
// max-w-md; копия/селекторы (labels «Имя пользователя»/«Email», #password,
// #confirmPassword, «Зарегистрироваться») сохранены для E2E (plan001).
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff, Gauge } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { registerRequest, getErrorMessage } from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";

const USERNAME_RE = /^[a-zA-Z0-9_-]+$/;

export default function RegisterPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      registerRequest({
        username: username.trim(),
        email: email.trim(),
        password,
        confirmPassword,
      }),
    // 201 -> session issued by the server: sign in immediately.
    onSuccess: ({ user, accessToken }) => {
      setAuth(user, accessToken);
      router.push("/");
    },
    onError: (e) => setServerError(getErrorMessage(e, "Не удалось зарегистрироваться")),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setClientError(null);
    setServerError(null);

    if (username.trim().length < 3 || !USERNAME_RE.test(username.trim())) {
      setClientError("Имя пользователя: минимум 3 символа, только латиница, цифры, _ и -");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setClientError("Введите корректный email");
      return;
    }
    if (password.length < 8) {
      setClientError("Пароль должен содержать минимум 8 символов");
      return;
    }
    if (password !== confirmPassword) {
      setClientError("Пароли не совпадают");
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
            <CardTitle className="text-3xl font-bold tracking-tight">Регистрация</CardTitle>
            <CardDescription>Создайте аккаунт покупателя и продавца MTA Market</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-1.5">
                <label
                  htmlFor="username"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Имя пользователя
                </label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ivan_petrov"
                  disabled={mutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="email"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ivan@example.com"
                  disabled={mutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="password"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Пароль (минимум 8 символов)
                </label>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
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
              <div className="space-y-1.5">
                <label
                  htmlFor="confirmPassword"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Повторите пароль
                </label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={mutation.isPending}
                />
                {confirmPassword.length > 0 && confirmPassword !== password ? (
                  <p className="text-xs text-bad" role="alert">
                    Пароли не совпадают
                  </p>
                ) : null}
              </div>

              {clientError ? (
                <p className="text-sm text-bad" role="alert">
                  {clientError}
                </p>
              ) : null}
              {serverError ? (
                <p className="text-sm text-bad" role="alert">
                  {serverError}
                </p>
              ) : null}

              <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
                {mutation.isPending ? "Регистрация..." : "Зарегистрироваться"}
              </Button>
            </form>

            <div className="text-center text-sm text-content-secondary">
              Уже есть аккаунт?{" "}
              <Link href="/auth/login" className="text-accent-strong transition-colors duration-fast hover:underline">
                Войти
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
