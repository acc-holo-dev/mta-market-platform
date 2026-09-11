// PLAN-006 Workstream H: «Популярное» blocks — real metrics only (H-001..H-004):
// top servers by the actual reported online, hot discussions by real activity.
// No trending labels, no fabricated rankings (DAILY-EXPERIENCE §19–20).
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchActivity } from "@/lib/api-ext";
import { MessageSquare, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";

export function PopularSection() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["activity", "popular"],
    queryFn: fetchActivity,
    select: (snap) => snap.popular,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-48 rounded-card" />
        <Skeleton className="h-48 rounded-card" />
      </div>
    );
  }
  if (isError || !data) return null; // hide silently — popular is optional signal

  const hasServers = data.servers.length > 0;
  const hasDiscussions = data.discussions.length > 0;
  if (!hasServers && !hasDiscussions) return null; // J-001: hide empty blocks

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {hasServers ? (
        <div className="rounded-card border border-line bg-surface p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-content-muted">
            Топ серверов сейчас
          </h3>
          <div className="space-y-2">
            {data.servers.map((s) => (
              <Link
                key={s.slug}
                href={`/servers/${s.slug}`}
                className="flex items-center justify-between gap-3 rounded-card bg-surface-inset p-3 transition-colors duration-fast hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex min-w-0 items-center gap-3">
                  {s.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.logoUrl} alt="" className="h-8 w-8 rounded-full object-cover" loading="lazy" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
                      <Users className="h-4 w-4" aria-hidden />
                    </span>
                  )}
                  <span className="truncate text-sm font-medium text-content">{s.name}</span>
                </span>
                {/* Реальный онлайн: ok-цвет + tabular-nums (§3 Numeric). */}
                <span className="flex-shrink-0 text-sm font-semibold text-ok tabular-nums">
                  {s.playerCount ?? 0}
                  <span className="text-content-muted">/{s.maxPlayers ?? "?"}</span>
                </span>
              </Link>
            ))}
          </div>
          <Link
            href="/servers?sort=players"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            Все серверы
          </Link>
        </div>
      ) : null}

      {hasDiscussions ? (
        <div className="rounded-card border border-line bg-surface p-5">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-content-muted">
            Активные обсуждения
          </h3>
          <div className="space-y-2">
            {data.discussions.map((d) => (
              <Link
                key={d.id}
                href={`/community/forum/thread/${d.id}`}
                className="flex items-center justify-between gap-3 rounded-card bg-surface-inset p-3 transition-colors duration-fast hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="min-w-0 flex items-center gap-3">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-strong">
                    <MessageSquare className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="truncate text-sm font-medium text-content">{d.title}</span>
                </span>
                <span className="flex-shrink-0 text-xs text-content-secondary tabular-nums">
                  {d.replyCount} ответов
                </span>
              </Link>
            ))}
          </div>
          <Link
            href="/community"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            В сообщество
          </Link>
        </div>
      ) : null}
    </div>
  );
}
