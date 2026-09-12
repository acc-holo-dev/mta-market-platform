// PLAN-015 §6/§31: Подписки — единая страница follow-состояний пользователя.
// Реальные домены: creators (/me/follows/creators), resources
// (/me/follows/resources), threads (/me/follows/threads). Никакого фейка:
// пусто = честное пусто.
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  bootstrapSession,
} from "@/lib/api";
import {
  fetchMyCreatorFollows,
  fetchMyResourceFollows,
  fetchMyThreadFollows,
} from "@/lib/api-ext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { LoadingSpinner, ErrorState } from "@/components/ui/States";
import { Avatar } from "@/components/ui/Avatar";
import { useAuthStore } from "@/store/auth";
import { meFollowsKey } from "@/lib/queries";
import { UserPlus, Package, MessagesSquare } from "lucide-react";

export default function FollowingPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

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

  const authed = isAuthenticated();
  const creators = useQuery({
    queryKey: meFollowsKey("creators"),
    queryFn: fetchMyCreatorFollows,
    enabled: authed,
  });
  const resources = useQuery({
    queryKey: meFollowsKey("resources"),
    queryFn: fetchMyResourceFollows,
    enabled: authed,
  });
  const threads = useQuery({
    queryKey: meFollowsKey("threads"),
    queryFn: fetchMyThreadFollows,
    enabled: authed,
  });

  if (!authed) return null;

  const anyLoading = creators.isLoading || resources.isLoading || threads.isLoading;
  const loadError = creators.error || resources.error || threads.error;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6">
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">Подписки</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Подписки</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Авторы, ресурсы и обсуждения, за которыми вы следите.
        </p>
      </div>

      {anyLoading ? (
        <LoadingSpinner label="Загрузка подписок…" />
      ) : loadError ? (
        <ErrorState
          error={creators.error ?? resources.error ?? threads.error}
          onRetry={() => {
            creators.refetch();
            resources.refetch();
            threads.refetch();
          }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Авторы */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <UserPlus className="h-5 w-5 text-accent" aria-hidden />
                Авторы
              </CardTitle>
              <CardDescription>{creators.data?.length ?? 0}</CardDescription>
            </CardHeader>
            <CardContent>
              {!creators.data?.length ? (
                <p className="text-sm text-content-secondary">
                  Вы пока ни за кем не следите.{" "}
                  <Link href="/resources?sort=rating" className="text-accent-strong hover:underline">
                    Найти авторов
                  </Link>
                </p>
              ) : (
                <ul className="space-y-1">
                  {creators.data.map((c) => (
                    <li key={c.username}>
                      <Link
                        href={`/sellers/${encodeURIComponent(c.username)}`}
                        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-fast hover:bg-surface-hover"
                      >
                        <Avatar src={c.avatar} name={c.displayName || c.username} size="sm" />
                        <span className="min-w-0 truncate text-sm font-medium text-content">
                          {c.displayName || c.username}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Ресурсы */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <Package className="h-5 w-5 text-accent" aria-hidden />
                Ресурсы
              </CardTitle>
              <CardDescription>{resources.data?.length ?? 0}</CardDescription>
            </CardHeader>
            <CardContent>
              {!resources.data?.length ? (
                <p className="text-sm text-content-secondary">
                  Нет отслеживаемых ресурсов.{" "}
                  <Link href="/resources" className="text-accent-strong hover:underline">
                    В маркет
                  </Link>
                </p>
              ) : (
                <ul className="space-y-1">
                  {resources.data.map((r) => (
                    <li key={r.slug}>
                      <Link
                        href={`/resources/${r.slug}`}
                        className="block truncate rounded-md px-2 py-1.5 text-sm text-content transition-colors duration-fast hover:bg-surface-hover"
                      >
                        {r.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Обсуждения */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg font-semibold">
                <MessagesSquare className="h-5 w-5 text-accent" aria-hidden />
                Обсуждения
              </CardTitle>
              <CardDescription>{threads.data?.length ?? 0}</CardDescription>
            </CardHeader>
            <CardContent>
              {!threads.data?.length ? (
                <p className="text-sm text-content-secondary">
                  Нет отслеживаемых тем.{" "}
                  <Link href="/community" className="text-accent-strong hover:underline">
                    В сообщество
                  </Link>
                </p>
              ) : (
                <ul className="space-y-1">
                  {threads.data.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/community/forum/thread/${t.id}`}
                        className="block rounded-md px-2 py-1.5 transition-colors duration-fast hover:bg-surface-hover"
                      >
                        <span className="block truncate text-sm text-content">{t.title}</span>
                        <span className="text-xs text-content-muted tabular-nums">
                          {t.replyCount} ответов{t.lastPostAt ? ` · ${new Date(t.lastPostAt).toLocaleDateString("ru-RU")}` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

