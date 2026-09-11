// ThreadRow (PLAN-005 F-001/F-003): компактная строка темы, переиспользуется
// на хабе сообщества и в листингах категорий/серверов.
"use client";

import Link from "next/link";
import { Eye, MessageSquare } from "lucide-react";
import type { ThreadCard } from "@/lib/api-ext";
import { Avatar } from "@/components/ui/Avatar";
import { cn } from "@/lib/utils";

/** Относительное время (ru-RU): «5 мин. назад», «2 дн. назад», старше 30 дней — дата. */
export function formatRelative(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const diffMs = Date.now() - date.getTime();
  const rtf = new Intl.RelativeTimeFormat("ru-RU", { numeric: "auto" });
  const minutes = Math.round(diffMs / 60_000);
  if (minutes === 0) return "только что";
  const hours = Math.round(diffMs / 3_600_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const days = Math.round(diffMs / 86_400_000);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  if (Math.abs(days) <= 30) return rtf.format(days, "day");
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

export function authorName(author: { username: string | null; displayName: string | null } | null | undefined): string | null {
  if (!author) return null;
  return author.displayName || author.username || null;
}

/** Чип состояния темы: OPEN — без метки, LOCKED/ARCHIVED — серые. */
export function ThreadStateChip({ state }: { state: string }) {
  if (state === "LOCKED") {
    return (
      <span className="inline-flex items-center rounded-full border border-line bg-surface-hover px-2 py-0.5 text-xs text-content-secondary">
        🔒 Закрыта
      </span>
    );
  }
  if (state === "ARCHIVED") {
    return (
      <span className="inline-flex items-center rounded-full border border-line bg-surface-hover px-2 py-0.5 text-xs text-content-secondary">
        В архиве
      </span>
    );
  }
  return null;
}

export function PinnedChip() {
  return (
    <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-xs text-accent-strong">
      📌 Закреплена
    </span>
  );
}

export function ThreadRow({
  thread,
  server,
  className,
}: {
  thread: ThreadCard;
  /** Опциональный чип привязки к серверу (например, на страницах серверов). */
  server?: { slug: string; name: string } | null;
  className?: string;
}) {
  const name = authorName(thread.author);
  const lastActivity = formatRelative(thread.lastPostAt ?? thread.createdAt);

  return (
    <div
      className={cn(
        "p-4 rounded-card border border-line bg-surface-raised",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/community/forum/thread/${thread.id}`}
              className="truncate font-semibold hover:text-accent-strong"
            >
              {thread.title}
            </Link>
            {thread.pinned ? <PinnedChip /> : null}
            <ThreadStateChip state={thread.state} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-content-secondary">
            {name ? (
              <span className="inline-flex items-center gap-1.5">
                <Avatar src={thread.author?.avatar} name={name} size="sm" className="h-5 w-5 text-[10px]" />
                {thread.author?.username ? (
                  <Link href={`/profile/${thread.author.username}`} className="hover:text-accent-strong">
                    {name}
                  </Link>
                ) : (
                  <span>{name}</span>
                )}
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3.5 w-3.5" aria-hidden />
              {thread.replyCount}
            </span>
            {typeof thread.views === "number" ? (
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" aria-hidden />
                {thread.views}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-col items-end gap-1.5 text-xs text-content-muted">
          {lastActivity ? <span>{lastActivity}</span> : null}
          {server ? (
            <Link
              href={`/servers/${server.slug}`}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-content-secondary hover:text-accent-strong"
            >
              {server.name}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}