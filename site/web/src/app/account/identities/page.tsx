// PLAN-016 A-006: страница управления внешними идентичностями.
// Закрывает мёртвый redirect: серверный link-callback ведёт сюда
// (?linked=1). Привязка — через POST /auth/:provider/link/start
// (ставит link_user cookie) → браузерный переход на authorize URL.
// Отвязка — DELETE /auth/identities/:id (последний метод входа защищён).
"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Unlink, ShieldAlert } from "lucide-react";
import { bootstrapSession } from "@/lib/api";
import {
  fetchAuthProviders,
  fetchIdentities,
  startIdentityLink,
  unlinkIdentity,
  getErrorMessage,
  type Identity,
} from "@/lib/api-ext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import { useAuthStore } from "@/store/auth";

function IdentitiesPageContent() {
  const router = useRouter();
  const { accessToken } = useAuthStore();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await bootstrapSession();
      if (!cancelled && !ok) router.push("/auth/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("linked") === "1") {
      setNotice("Идентичность привязана.");
    }
  }, []);

  const identitiesQuery = useQuery({
    queryKey: ["auth", "identities"],
    queryFn: fetchIdentities,
    enabled: accessToken !== null,
  });

  const providersQuery = useQuery({
    queryKey: ["auth", "providers"],
    queryFn: fetchAuthProviders,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const linkMutation = useMutation({
    mutationFn: startIdentityLink,
    onSuccess: ({ authorizationUrl }) => {
      window.location.href = authorizationUrl;
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const unlinkMutation = useMutation({
    mutationFn: unlinkIdentity,
    onSuccess: () => {
      setError(null);
      setNotice("Идентичность отвязана.");
      qc.invalidateQueries({ queryKey: ["auth", "identities"] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  if (!accessToken) return null;

  const identities = identitiesQuery.data ?? [];
  const linkedProviders = new Set(identities.map((i) => i.provider.toLowerCase()));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-content-muted">
        <Link href="/account" className="hover:text-accent-strong">
          Профиль
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">Подключения</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Подключения</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Внешние способы входа, привязанные к вашему аккаунту. Последний
          способ входа нельзя отвязать.
        </p>
      </div>

      {notice ? (
        <p
          className="mb-4 rounded-card border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok"
          role="status"
        >
          {notice}
        </p>
      ) : null}
      {error ? (
        <p
          className="mb-4 rounded-card border border-bad/30 bg-bad-soft px-4 py-3 text-sm text-bad"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Привязанные способы входа</CardTitle>
          <CardDescription>Токены внешних сервисов никогда не показываются.</CardDescription>
        </CardHeader>
        <CardContent>
          {identitiesQuery.isLoading ? (
            <LoadingSpinner label="Загрузка подключений…" className="py-6" />
          ) : identitiesQuery.error ? (
            <ErrorState error={identitiesQuery.error} onRetry={() => identitiesQuery.refetch()} />
          ) : !identities.length ? (
            <EmptyState
              icon={<Link2 className="mx-auto mb-3 h-10 w-10 text-content-muted" aria-hidden />}
              title="Внешние способы входа не привязаны"
              description="Вы входите по имени пользователя или email. Привяжите внешнюю идентичность для быстрого входа."
            />
          ) : (
            <ul className="space-y-2">
              {identities.map((identity: Identity) => (
                <li
                  key={identity.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface-raised p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold capitalize text-content">
                      {identity.provider.toLowerCase()}
                    </p>
                    <p className="text-xs tabular-nums text-content-muted">
                      ID: {identity.providerAccountId.slice(0, 12)}
                      {identity.providerAccountId.length > 12 ? "…" : ""}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={unlinkMutation.isPending}
                    aria-label={`Отвязать ${identity.provider}`}
                    onClick={() => {
                      setError(null);
                      unlinkMutation.mutate(identity.id);
                    }}
                  >
                    <Unlink className="mr-2 h-4 w-4" aria-hidden />
                    Отвязать
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Привязать новую</CardTitle>
          <CardDescription>Только включённые на платформе сервисы.</CardDescription>
        </CardHeader>
        <CardContent>
          {providersQuery.data && providersQuery.data.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {providersQuery.data
                .filter((p) => !linkedProviders.has(p.provider))
                .map((p) => (
                  <Button
                    key={p.provider}
                    variant="outline"
                    size="sm"
                    disabled={linkMutation.isPending}
                    onClick={() => {
                      setError(null);
                      if (p.mode === "direct") {
                        // Direct-провайдеры (Telegram) привязываются при входе
                        // через виджет — честная подсказка вместо сломанного флоу.
                        setError(
                          "Telegram привязывается автоматически при входе через Telegram-виджет ниже."
                        );
                        return;
                      }
                      linkMutation.mutate(p.provider);
                    }}
                  >
                    <Link2 className="mr-2 h-4 w-4" aria-hidden />
                    Привязать {p.displayName}
                  </Button>
                ))}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-content-secondary">
              <ShieldAlert className="h-4 w-4 text-content-muted" aria-hidden />
              Внешние сервисы не включены на платформе.
            </p>
          )}

          {/* Direct-провайдер (Telegram): привязка произойдёт при входе виджетом */}
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
              Вход через внешний сервис
            </p>
            <OAuthButtons exclude={[...linkedProviders]} onError={(m) => setError(m)} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function IdentitiesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <LoadingSpinner label="Загрузка…" />
        </div>
      }
    >
      <IdentitiesPageContent />
    </Suspense>
  );
}