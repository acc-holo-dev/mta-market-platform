// Сообщество (PLAN-005 F-001): публичный хаб — категории, закреплённые,
// последние обсуждения, активные темы и недавняя активность.
// Гостям доступно чтение; создание тем — после входа.
// PLAN-013: hero-бенд на .mta-hero-surface, секции — карточки, категории —
// pill-cards; h1/копия/ARIA не изменены (E2E).
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  MessagesSquare,
  MessageSquarePlus,
  Pin,
  Flame,
  Activity,
  ArrowRight,
} from "lucide-react";
import { bootstrapSession } from "@/lib/api";
import { fetchCommunityHub, type ThreadCard } from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Skeleton } from "@/components/ui/Skeleton";
import { ThreadRow, formatRelative, authorName } from "@/components/community/ThreadRow";
import { Avatar } from "@/components/ui/Avatar";

function SectionHeader({
  icon,
  title,
}: {
  title: string;
  icon: React.ReactNode;
}) {
  return (
    <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold tracking-tight">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
        {icon}
      </span>
      {title}
    </h2>
  );
}

function ThreadList({ threads, emptyTitle }: { threads: ThreadCard[]; emptyTitle: string }) {
  if (threads.length === 0) {
    return (
      <EmptyState
        className="py-8"
        icon={<MessagesSquare className="h-8 w-8" />}
        title={emptyTitle}
      />
    );
  }
  return (
    <div className="space-y-2">
      {threads.map((t) => (
        <ThreadRow key={t.id} thread={t} />
      ))}
    </div>
  );
}

export default function CommunityPage() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [booted, setBooted] = useState(false);

  // Публичная страница: сессию тихо восстанавливаем, но гостя не редиректим.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await bootstrapSession();
      if (!cancelled) setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["community", "hub"],
    queryFn: fetchCommunityHub,
    enabled: booted,
  });

  if (!booted) return null;

  const authed = isAuthenticated();
  const categories = data?.categories ?? [];
  // Активной CTA нет отдельной страницы создания: форма живёт в категории.
  const firstCategory = categories[0];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {/* Hero-бенд заголовка: мягкий brand-glow; h1 и копия не изменяются */}
      <div className="mta-hero-surface mb-8 rounded-lg border border-line p-6 shadow-card md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="mta-brand-text-gradient text-3xl font-bold tracking-tight">Сообщество</h1>
            <p className="mt-2 max-w-xl text-sm text-content-secondary">
              Форум MTA:SA — обсуждения, помощь и новости серверов
            </p>
          </div>
          {authed ? (
            firstCategory ? (
              <Link href={`/community/forum/${firstCategory.slug}`}>
                <Button>
                  <MessageSquarePlus className="mr-2 h-4 w-4" aria-hidden />
                  Создать тему
                </Button>
              </Link>
            ) : null
          ) : (
            <Link href="/auth/login">
              <Button>
                <MessageSquarePlus className="mr-2 h-4 w-4" aria-hidden />
                Создать тему
              </Button>
            </Link>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-8" aria-busy="true">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-28 rounded-card" />
            ))}
          </div>
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20 rounded-card" />
            ))}
          </div>
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-8">
          {/* Категории (F-002) */}
          <section aria-label="Категории форума" className="rounded-lg border border-line bg-surface-inset p-4 shadow-card sm:p-5">
            <SectionHeader
              icon={<MessagesSquare className="h-4 w-4" aria-hidden />}
              title="Категории"
            />
            {categories.length === 0 ? (
              <EmptyState
                className="py-8"
                title="Категорий пока нет"
                description="Разделы форума появятся позже."
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data!.categories.map((c) => (
                  <Link
                    key={c.id}
                    href={`/community/forum/${c.slug}`}
                    className="group rounded-card border border-line bg-surface p-4 transition-colors duration-fast hover:border-accent/40 hover:bg-surface-hover"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong transition-colors duration-fast group-hover:bg-accent group-hover:text-on-accent">
                        <MessagesSquare className="h-4 w-4" aria-hidden />
                      </span>
                      <p className="font-semibold tracking-tight group-hover:text-accent-strong">{c.name}</p>
                    </div>
                    {c.description ? (
                      <p className="mt-2 line-clamp-2 text-sm text-content-secondary">{c.description}</p>
                    ) : null}
                    <p className="mt-3 text-xs tabular-nums text-content-muted">
                      {typeof c.threadCount === "number" ? `${c.threadCount} тем` : "Темы"}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Закреплённые */}
          {(data?.pinned?.length ?? 0) > 0 ? (
            <section aria-label="Закреплённые темы" className="rounded-lg border border-line bg-surface-inset p-4 shadow-card sm:p-5">
              <SectionHeader
                icon={<Pin className="h-4 w-4" aria-hidden />}
                title="Закреплённые"
              />
              <div className="space-y-2">
                {data!.pinned.map((t) => (
                  <ThreadRow key={t.id} thread={t} />
                ))}
              </div>
            </section>
          ) : null}

          {/* Последние обсуждения */}
          <section aria-label="Последние обсуждения" className="rounded-lg border border-line bg-surface-inset p-4 shadow-card sm:p-5">
            <SectionHeader
              icon={<Activity className="h-4 w-4" aria-hidden />}
              title="Последние обсуждения"
            />
            <ThreadList threads={data?.latest ?? []} emptyTitle="Обсуждений пока нет" />
          </section>

          {/* Активные */}
          <section aria-label="Активные темы" className="rounded-lg border border-line bg-surface-inset p-4 shadow-card sm:p-5">
            <SectionHeader
              icon={<Flame className="h-4 w-4" aria-hidden />}
              title="Активные"
            />
            <ThreadList threads={data?.active ?? []} emptyTitle="Активных тем пока нет" />
          </section>

          {/* Недавняя активность */}
          <section aria-label="Недавняя активность" className="rounded-lg border border-line bg-surface-inset p-4 shadow-card sm:p-5">
            <SectionHeader
              icon={<Activity className="h-4 w-4" aria-hidden />}
              title="Недавняя активность"
            />
            {(data?.recentActivity?.length ?? 0) === 0 ? (
              <EmptyState
                className="py-8"
                icon={<Activity className="h-8 w-8" />}
                title="Активности пока нет"
                description="Ответьте в обсуждении — активность появится здесь."
              />
            ) : (
              <div className="space-y-2">
                {data!.recentActivity.map((a) => {
                  const name = authorName(a.author);
                  return (
                    <div
                      key={a.postId}
                      className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-4 text-sm transition-colors duration-fast hover:bg-surface-hover"
                    >
                      {name ? (
                        <Avatar
                          src={a.author?.avatar}
                          name={name}
                          size="sm"
                          className="h-6 w-6 text-[11px]"
                        />
                      ) : null}
                      <span className="text-content-secondary">
                        {a.author?.username ? (
                          <Link
                            href={`/profile/${a.author.username}`}
                            className="font-medium text-content transition-colors duration-fast hover:text-accent-strong"
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="font-medium text-content">{name ?? "Гость"}</span>
                        )}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-content-muted" aria-hidden />
                      {a.threadId ? (
                        <Link
                          href={`/community/forum/thread/${a.threadId}`}
                          className="truncate font-medium transition-colors duration-fast hover:text-accent-strong"
                        >
                          {a.threadTitle ?? "Тема"}
                        </Link>
                      ) : (
                        <span className="truncate text-content-secondary">{a.threadTitle ?? "Тема"}</span>
                      )}
                      <span className="ml-auto flex-shrink-0 text-xs tabular-nums text-content-muted">
                        {formatRelative(a.createdAt)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}