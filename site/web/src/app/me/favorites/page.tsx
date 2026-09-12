// PLAN-018 Wave-6 I-002: «Избранное» — единая страница закладок пользователя
// по четырём поверхностям (ресурсы / серверы / авторы / обсуждения).
// Источник — GET /me/favorites (тот же кэш ["favorites","mine"], что и на
// странице ресурса). Цель может стать недоступной (subject: null) — честно
// рисуем «недоступно» и даём убрать закладку (best-effort DELETE: цель уже
// удалена → 404 считается успехом удаления).
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bootstrapSession } from "@/lib/api";
import {
  fetchMyFavorites,
  toggleResourceFavorite,
  toggleServerFavorite,
  toggleCreatorFavorite,
  toggleThreadFavorite,
  removeFavoriteById,
  type FavoriteEntry,
  type FavoriteServerSubject,
  type FavoriteCreatorSubject,
  type FavoriteDiscussionSubject,
  type MyFavorites,
  type Resource,
} from "@/lib/api-ext";
import { LoadingSpinner, ErrorState, EmptyState } from "@/components/ui/States";
import { Avatar } from "@/components/ui/Avatar";
import { ResourceCard } from "@/components/ui/ResourceCard";
import { useAuthStore } from "@/store/auth";
import { X, Package, Server, UserPlus, MessagesSquare } from "lucide-react";
import { cn } from "@/lib/utils";

// namespaced favorites key — общий кэш со страницей ресурса
export const myFavoritesKey = () => ["favorites", "mine"] as const;

export default function FavoritesPage() {
  const router = useRouter();
  const qc = useQueryClient();
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
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: myFavoritesKey(),
    queryFn: () => fetchMyFavorites(),
    enabled: authed,
    retry: false,
  });

  // Удаление закладки: optimistic (локально убираем сразу), best-effort API.
  // 404 = цель уже удалена сервером → удаление считаем успешным (без
  // рефетча: серверное состояние не изменилось). Прочие ошибки откатывают.
  const removeMutation = useMutation({
    mutationFn: async (entry: FavoriteEntry) => {
      const s = (entry.subject ?? {}) as Record<string, unknown>;
      if (entry.targetType === "RESOURCE" && typeof s.slug === "string" && s.slug) {
        return toggleResourceFavorite(s.slug, false);
      }
      if (entry.targetType === "SERVER" && typeof s.slug === "string" && s.slug) {
        return toggleServerFavorite(s.slug, false);
      }
      if (entry.targetType === "CREATOR" && typeof s.username === "string" && s.username) {
        return toggleCreatorFavorite(s.username, false);
      }
      if (entry.targetType === "DISCUSSION" && entry.targetId) {
        return toggleThreadFavorite(entry.targetId, false);
      }
      // Stale row (target already deleted server-side): remove by favorite
      // row id — owner-scoped DELETE /me/favorites/:favoriteId (PLAN-017 §I).
      return removeFavoriteById(entry.id);
    },
    onMutate: async (entry) => {
      await qc.cancelQueries({ queryKey: myFavoritesKey() });
      const prev = qc.getQueryData<MyFavorites>(myFavoritesKey());
      qc.setQueryData<MyFavorites>(myFavoritesKey(), (old) => {
        if (!old) return old;
        const strip = <T,>(list: T[] | undefined): T[] =>
          (list ?? []).filter((e) => (e as FavoriteEntry).id !== entry.id);
        return {
          ...old,
          data: {
            RESOURCE: strip(old.data?.RESOURCE),
            SERVER: strip(old.data?.SERVER),
            CREATOR: strip(old.data?.CREATOR),
            DISCUSSION: strip(old.data?.DISCUSSION),
          },
        };
      });
      return { prev };
    },
    onError: (err, _entry, ctx) => {
      const status = (err as { status?: number })?.status;
      if (status !== 404 && ctx?.prev) qc.setQueryData(myFavoritesKey(), ctx.prev);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: myFavoritesKey() });
    },
  });

  if (!authed) return null;

  const groups = data?.data;
  const total = data?.total ?? 0;
  const anyLoading = isLoading;

  const removeButton = (entry: FavoriteEntry, label?: string) => (
    <button
      type="button"
      onClick={() => removeMutation.mutate(entry)}
      disabled={removeMutation.isPending}
      aria-label={`Убрать из избранного${label ? `: ${label}` : ""}`}
      title="Убрать из избранного"
      className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-line bg-surface text-content-muted transition-colors duration-fast hover:border-bad/40 hover:text-bad focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <X className="h-3.5 w-3.5" aria-hidden />
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-8 sm:px-6">
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">Избранное</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Избранное</h1>
        <p className="mt-1 text-sm text-content-secondary">
          Закладки ресурсов, серверов, авторов и обсуждений.
        </p>
      </div>

      {anyLoading ? (
        <LoadingSpinner label="Загрузка избранного…" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : total === 0 ? (
        <EmptyState
          icon={<Package className="h-12 w-12 text-content-muted mx-auto mb-4" />}
          title="В избранном пока пусто"
          description="Нажимайте «В избранное» на страницах ресурсов — закладки соберутся здесь."
          action={
            <Link href="/resources">
              <span className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-on-accent transition-colors duration-fast hover:bg-accent-strong">
                На Маркетплейс
              </span>
            </Link>
          }
        />
      ) : (
        <div className="space-y-8">
          {/* Ресурсы — карточки ResourceCard */}
          <section aria-label="Ресурсы">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
              <Package className="h-4 w-4" aria-hidden /> Ресурсы
              <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                {groups?.RESOURCE?.length ?? 0}
              </span>
            </h2>
            {(groups?.RESOURCE?.length ?? 0) === 0 ? (
              <p className="text-sm text-content-secondary">Пока нет закладок ресурсов.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {groups!.RESOURCE.map((entry) => {
                  const s = entry.subject;
                  if (!s) {
                    return <StaleRow key={entry.id} entry={entry} removeButton={removeButton} />;
                  }
                  const card = {
                    id: s.id ?? entry.targetId,
                    slug: s.slug ?? "",
                    title: s.title ?? "Без названия",
                    description: "",
                    type: "",
                    status: "PUBLISHED",
                    price: Number(s.price ?? 0),
                    createdAt: entry.createdAt ?? new Date().toISOString(),
                    coverUrl: s.coverUrl ?? null,
                  } as unknown as Resource;
                  return (
                    <div key={entry.id} className="relative">
                      <ResourceCard resource={card} />
                      <div className="absolute right-2 top-2 z-10">
                        {removeButton(entry, s.title ?? undefined)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Серверы */}
          <section aria-label="Серверы">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
              <Server className="h-4 w-4" aria-hidden /> Серверы
              <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                {groups?.SERVER?.length ?? 0}
              </span>
            </h2>
            {(groups?.SERVER?.length ?? 0) === 0 ? (
              <p className="text-sm text-content-secondary">Пока нет закладок серверов.</p>
            ) : (
              <ul className="space-y-2">
                {groups!.SERVER.map((entry) => (
                  <SubjectRow key={entry.id} entry={entry} removeButton={removeButton}>
                    {(s: FavoriteServerSubject) => (
                      <Link
                        href={`/servers/${s.slug}`}
                        className="flex min-w-0 items-center gap-3 transition-colors duration-fast hover:text-accent-strong"
                      >
                        <Avatar src={s.logoUrl ?? null} name={s.name ?? "?"} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-content">
                            {s.name ?? "Сервер"}
                          </span>
                          <span className="block truncate text-xs text-content-secondary">
                            Сервер MTA
                          </span>
                        </span>
                      </Link>
                    )}
                  </SubjectRow>
                ))}
              </ul>
            )}
          </section>

          {/* Авторы */}
          <section aria-label="Авторы">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
              <UserPlus className="h-4 w-4" aria-hidden /> Авторы
              <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                {groups?.CREATOR?.length ?? 0}
              </span>
            </h2>
            {(groups?.CREATOR?.length ?? 0) === 0 ? (
              <p className="text-sm text-content-secondary">Пока нет закладок авторов.</p>
            ) : (
              <ul className="space-y-2">
                {groups!.CREATOR.map((entry) => (
                  <SubjectRow key={entry.id} entry={entry} removeButton={removeButton}>
                    {(s: FavoriteCreatorSubject) => (
                      <Link
                        href={`/sellers/${encodeURIComponent(s.username ?? "")}`}
                        className="flex min-w-0 items-center gap-3 transition-colors duration-fast hover:text-accent-strong"
                      >
                        <Avatar src={s.avatar ?? null} name={s.displayName || s.username || "?"} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-content">
                            {s.displayName || s.username || "Автор"}
                          </span>
                          <span className="block truncate text-xs text-content-secondary">
                            @{s.username ?? "—"}
                          </span>
                        </span>
                      </Link>
                    )}
                  </SubjectRow>
                ))}
              </ul>
            )}
          </section>

          {/* Обсуждения */}
          <section aria-label="Обсуждения">
            <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
              <MessagesSquare className="h-4 w-4" aria-hidden /> Обсуждения
              <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                {groups?.DISCUSSION?.length ?? 0}
              </span>
            </h2>
            {(groups?.DISCUSSION?.length ?? 0) === 0 ? (
              <p className="text-sm text-content-secondary">Пока нет закладок обсуждений.</p>
            ) : (
              <ul className="space-y-2">
                {groups!.DISCUSSION.map((entry) => (
                  <SubjectRow key={entry.id} entry={entry} removeButton={removeButton}>
                    {(s: FavoriteDiscussionSubject) => (
                      <Link
                        href={`/community/forum/thread/${entry.targetId}`}
                        className="flex min-w-0 items-center gap-3 transition-colors duration-fast hover:text-accent-strong"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-content">
                            {s.title ?? "Обсуждение"}
                          </span>
                          <span className="block truncate text-xs text-content-secondary">
                            {(s.replyCount ?? 0)} ответов
                          </span>
                        </span>
                      </Link>
                    )}
                  </SubjectRow>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** Строка простого списка (серверы/авторы/обсуждения) или честное «недоступно». */
function SubjectRow<S>({
  entry,
  removeButton,
  children,
}: {
  entry: FavoriteEntry<S>;
  removeButton: (entry: FavoriteEntry<S>, label?: string) => React.ReactNode;
  children: (subject: S) => React.ReactNode;
}) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 transition-colors duration-fast hover:border-line-strong">
      {entry.subject ? (
        children(entry.subject)
      ) : (
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-hover text-content-muted">
            <X className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 text-sm text-content-muted">Недоступно</span>
        </span>
      )}
      {removeButton(entry)}
    </li>
  );
}

/** Недоступный ресурс (subject: null) — честная строка + удаление закладки. */
function StaleRow({
  entry,
  removeButton,
}: {
  entry: FavoriteEntry;
  removeButton: (entry: FavoriteEntry, label?: string) => React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line bg-surface p-4 text-center"
      )}
    >
      <p className="text-sm font-medium text-content-muted">Недоступно</p>
      <p className="text-xs text-content-muted">Ресурс удалён или скрыт.</p>
      {removeButton(entry)}
    </div>
  );
}
