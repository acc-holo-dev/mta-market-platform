// Auth: registration with username/email/password (PLAN-001 A-003).
"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Eye, EyeOff } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { registerRequest, getErrorMessage } from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { ErrorText } from "@/components/ui/StatusBadge";

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-900 dark:to-slate-950 py-12 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Регистрация</CardTitle>
          <CardDescription>Создайте аккаунт покупателя и продавца MTA Market</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div>
              <label htmlFor="username" className="text-sm text-slate-600 dark:text-slate-400">
                Имя пользователя
              </label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="ivan_petrov"
                className="mt-1"
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label htmlFor="email" className="text-sm text-slate-600 dark:text-slate-400">
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
                className="mt-1"
                disabled={mutation.isPending}
              />
            </div>
            <div>
              <label htmlFor="password" className="text-sm text-slate-600 dark:text-slate-400">
                Пароль (минимум 8 символов)
              </label>
              <div className="relative mt-1">
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
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="confirmPassword" className="text-sm text-slate-600 dark:text-slate-400">
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
                className="mt-1"
                disabled={mutation.isPending}
              />
              {confirmPassword.length > 0 && confirmPassword !== password ? (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">Пароли не совпадают</p>
              ) : null}
            </div>

            {clientError ? <ErrorText message={clientError} /> : null}
            {serverError ? <ErrorText message={serverError} /> : null}

            <Button type="submit" size="lg" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending ? "Регистрация..." : "Зарегистрироваться"}
            </Button>
          </form>

          <div className="text-center text-sm text-slate-600 dark:text-slate-400">
            Уже есть аккаунт?{" "}
            <Link href="/auth/login" className="text-blue-600 hover:underline dark:text-blue-400">
              Войти
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
