// Seller Storefront (PLAN-003 E-001..E-004): публичная витрина продавца.
// Структура: Seller → Profile → Resources (E-003). Ресурсы ведут обратно
// в Resource Detail (E-004). Непубличные ресурсы сервер не отдаёт.
"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  fetchSellerStore,
  followCreator,
  unfollowCreator,
  fetchMyCreatorFollows,
  getErrorMessage,
} from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { ResourceCard } from "@/components/ui/ResourceCard";
import { ResourceCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { Avatar } from "@/components/ui/Avatar";
import { formatDate } from "@/lib/domain";
import { meFollowsKey } from "@/lib/queries";
import { useAuthStore } from "@/store/auth";
import { PackageCheck, Store, UserPlus } from "lucide-react";

export default function SellerStorePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const decoded = decodeURIComponent(username);
  const router = useRouter();
  const { accessToken, isAuthenticated } = useAuthStore();
  // PLAN-008 E-001: follow state is only the user's own (/me/follows/*);
  // the follower list itself is never exposed (§42). Guests skip the query
  // entirely — a 401 would trigger the global session-expiry redirect.
  const [followState, setFollowState] = useState<{ following: boolean; count: number } | null>(null);
  const [followBusy, setFollowBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);

  const { data: myFollows } = useQuery({
    // O-001: token-free key (axios interceptor carries the token; auth
    // changes invalidate the follows family — no per-token cache misses).
    queryKey: meFollowsKey("creators"),
    queryFn: fetchMyCreatorFollows,
    enabled: isAuthenticated() && !!accessToken,
    retry: false,
  });

  const isFollowing = followState
    ? followState.following
    : (myFollows ?? []).some((f: any) => f.username === decoded);

  const onToggleFollow = async () => {
    setFollowBusy(true);
    setFollowError(null);
    try {
      const res = isFollowing
        ? await unfollowCreator(decoded)
        : await followCreator(decoded);
      setFollowState({ following: res.following, count: res.creatorFollowers });
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        router.push("/auth/login");
        return;
      }
      setFollowError(getErrorMessage(e, "Не удалось изменить подписку"));
    } finally {
      setFollowBusy(false);
    }
  };

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["seller-store", decoded],
    queryFn: () => fetchSellerStore(decoded),
    retry: false,
  });

  const notFound = Boolean(error);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      {/* Breadcrumbs (N-001) */}
      <nav aria-label="Хлебные крошки" className="mb-8 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <Link href="/resources" className="hover:text-accent-strong">
          Маркетплейс
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">{data?.seller.displayName ?? decoded}</span>
      </nav>

      {isLoading ? (
        <div className="space-y-8">
          <div className="h-36 w-full max-w-2xl animate-pulse rounded-card bg-surface-hover" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <ResourceCardSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : notFound || !data ? (
        <div className="text-center py-20">
          <Store className="h-12 w-12 text-content-muted mx-auto mb-4" />
          <h1 className="text-xl font-semibold">Витрина не найдена</h1>
          <p className="mt-1 text-sm text-content-secondary max-w-md mx-auto">
            У этого продавца пока нет публичных товаров или магазин не существует.
          </p>
          <Link href="/resources" className="inline-block mt-6">
            <Button variant="outline">В Маркетплейс</Button>
          </Link>
        </div>
      ) : (
        <>
          {/* E-001: identity-шапка: banner-градиент + avatar + stat-чипы */}
          <header className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
            <div className="mta-hero-surface h-28 w-full md:h-36" aria-hidden />
            <div className="flex flex-col gap-4 px-6 pb-6 sm:-mt-10 sm:flex-row sm:items-end md:px-8">
              <Avatar
                src={data.seller.avatar}
                name={data.seller.displayName || data.seller.username}
                size="lg"
                className="h-20 w-20 flex-shrink-0 text-2xl ring-2 ring-accent/40 ring-offset-2 ring-offset-surface"
              />
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                  {data.seller.displayName}
                </h1>
                <p className="text-sm text-content-secondary">@{data.seller.username}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-content-secondary">
                  <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface-raised px-3 py-1">
                    <PackageCheck className="h-3.5 w-3.5 text-accent" aria-hidden />
                    <span className="font-semibold tabular-nums text-content">{data.seller.resourceCount}</span>
                    {data.seller.resourceCount === 1 ? "ресурс" : "ресурсов"}
                  </span>
                  <span className="inline-flex items-center rounded-pill border border-line bg-surface-raised px-3 py-1 text-content-muted">
                    На Маркетплейсе с {formatDate(data.seller.memberSince)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface-raised px-3 py-1">
                    <UserPlus className="h-3.5 w-3.5 text-accent" aria-hidden />
                    <span className="font-semibold tabular-nums text-content">
                      {(followState ? followState.count : data.seller.creatorFollowers ?? 0).toLocaleString("ru-RU")}
                    </span>
                    подписчиков
                  </span>
                </div>
                {data.seller.supportInfo ? (
                  <p className="mt-3 max-w-xl text-sm text-content-secondary">
                    {data.seller.supportInfo}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-col items-start gap-2 sm:ml-auto">
                <Button
                  variant={isFollowing ? "outline" : "primary"}
                  size="sm"
                  disabled={followBusy}
                  onClick={onToggleFollow}
                >
                  {isFollowing ? "Отписаться" : "Подписаться"}
                </Button>
                {followError ? <p className="text-xs text-bad">{followError}</p> : null}
              </div>
            </div>
          </header>

          {/* E-002: только опубликованные ресурсы (сервер фильтрует) */}
          <section className="mt-10">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">Ресурсы продавца</h2>
            {data.resources.length === 0 ? (
              <div className="rounded-card border border-dashed border-line p-10 text-center">
                <PackageCheck className="h-10 w-10 text-content-muted mx-auto mb-3" />
                <p className="font-medium">Пока нет опубликованных ресурсов</p>
                <p className="mt-1 text-sm text-content-secondary">
                  Товары появятся здесь после прохождения модерации.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.resources.map((r) => (
                  <ResourceCard key={r.id} resource={r} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
