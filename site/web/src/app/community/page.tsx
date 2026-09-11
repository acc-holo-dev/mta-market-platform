// Сообщество (PLAN-005 F-001): публичный хаб — категории, закреплённые,
// последние обсуждения, активные темы и недавняя активность.
// Гостям доступно чтение; создание тем — после входа.
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
} from "lucide-react";
import { bootstrapSession } from "@/lib/api";
import { fetchCommunityHub, type ThreadCard } from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
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
    <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold tracking-tight">
      {icon}
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
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Сообщество</h1>
          <p className="mt-1 text-content-secondary">
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

      {isLoading ? (
        <LoadingSpinner label="Загрузка сообщества..." />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <div className="space-y-10">
          {/* Категории (F-002) */}
          <section aria-label="Категории форума">
            <SectionHeader
              icon={<MessagesSquare className="h-5 w-5 text-accent" aria-hidden />}
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
                    className="group p-4 rounded-card border border-line bg-surface-raised transition-colors hover:bg-surface-hover"
                  >
                    <p className="font-semibold group-hover:text-accent-strong">{c.name}</p>
                    {c.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-content-secondary">{c.description}</p>
                    ) : null}
                    <p className="mt-2 text-xs text-content-muted">
                      {typeof c.threadCount === "number" ? `${c.threadCount} тем` : "Темы"}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* Закреплённые */}
          {(data?.pinned?.length ?? 0) > 0 ? (
            <section aria-label="Закреплённые темы">
              <SectionHeader
                icon={<Pin className="h-5 w-5 text-accent" aria-hidden />}
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
          <section aria-label="Последние обсуждения">
            <SectionHeader
              icon={<Activity className="h-5 w-5 text-accent" aria-hidden />}
              title="Последние обсуждения"
            />
            <ThreadList threads={data?.latest ?? []} emptyTitle="Обсуждений пока нет" />
          </section>

          {/* Активные */}
          <section aria-label="Активные темы">
            <SectionHeader
              icon={<Flame className="h-5 w-5 text-accent" aria-hidden />}
              title="Активные"
            />
            <ThreadList threads={data?.active ?? []} emptyTitle="Активных тем пока нет" />
          </section>

          {/* Недавняя активность */}
          <section aria-label="Недавняя активность">
            <SectionHeader
              icon={<MessagesSquare className="h-5 w-5 text-accent" aria-hidden />}
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
                      className="flex flex-wrap items-center gap-2 p-4 rounded-card border border-line bg-surface-raised text-sm"
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
                            className="font-medium text-content hover:text-accent-strong"
                          >
                            {name}
                          </Link>
                        ) : (
                          <span className="font-medium text-content">{name ?? "Гость"}</span>
                        )}
                      </span>
                      <span className="text-content-muted">→</span>
                      {a.threadId ? (
                        <Link
                          href={`/community/forum/thread/${a.threadId}`}
                          className="truncate font-medium hover:text-accent-strong"
                        >
                          {a.threadTitle ?? "Тема"}
                        </Link>
                      ) : (
                        <span className="truncate text-content-secondary">{a.threadTitle ?? "Тема"}</span>
                      )}
                      <span className="ml-auto flex-shrink-0 text-xs text-content-muted">
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