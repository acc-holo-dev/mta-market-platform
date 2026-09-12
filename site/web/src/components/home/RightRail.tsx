// PLAN-015 §12: правый рельс Home — Top Creators, компактная активность,
// вторичный sponsored-плейсмент. Только реальные данные: авторы выводятся из
// реальных публикаций каталога (агрегация на клиенте), активность — /activity.
"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Package } from "lucide-react";
import {
  fetchHomepage,
  type ActivityItem,
  type ActivitySnapshot,
  type Resource,
} from "@/lib/api-ext";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { PromotionHero, type PromotionItem } from "@/components/home/PromotionHero";
import { timeAgo } from "@/lib/domain";

interface CreatorStat {
  username: string;
  displayName: string;
  avatar: string | null;
  resources: number;
  freeCount: number;
  rating: number | null;
}

/** Честная агрегация активных авторов из реальных публикаций (без фейка). */
function deriveCreators(resources: Resource[]): CreatorStat[] {
  const bySeller = new Map<string, CreatorStat>();
  for (const r of resources) {
    const username = r.seller?.username;
    if (!username) continue;
    const entry = bySeller.get(username) ?? {
      username,
      displayName: r.seller?.displayName || username,
      avatar: r.seller?.avatar ?? null,
      resources: 0,
      freeCount: 0,
      rating: r.rating ?? null,
    };
    entry.resources += 1;
    if (r.price === 0) entry.freeCount += 1;
    bySeller.set(username, entry);
  }
  return [...bySeller.values()].sort((a, b) => b.resources - a.resources).slice(0, 5);
}

function TopCreators() {
  const { data, isLoading } = useQuery({
    queryKey: ["resources", "homepage"],
    queryFn: fetchHomepage,
    staleTime: 120_000,
  });

  const creators = useMemo(
    () => deriveCreators([...(data?.popular ?? []), ...(data?.newest ?? []), ...(data?.free ?? [])]),
    [data]
  );

  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-content-muted">
        Активные авторы
      </h3>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : creators.length === 0 ? (
        <p className="text-sm text-content-secondary">Пока нет публикаций</p>
      ) : (
        <ul className="space-y-1">
          {creators.map((c) => (
            <li key={c.username}>
              <Link
                href={`/sellers/${encodeURIComponent(c.username)}`}
                className="flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-fast hover:bg-surface-hover"
              >
                <Avatar src={c.avatar} name={c.displayName} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-content">
                  {c.displayName}
                </span>
                <span className="flex flex-shrink-0 items-center gap-1 text-xs tabular-nums text-content-muted">
                  <Package className="h-3 w-3" aria-hidden />
                  {c.resources}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/resources?sort=rating"
        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline"
      >
        Ресурсы авторов
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}

function activityLine(item: ActivityItem): string {
  const serverName = item.server?.name ?? "";
  switch (item.type) {
    case "SERVER_UPDATE":
      return `${serverName || "Сервер"} · обновление ${item.version ?? ""}`.trim();
    case "SERVER_NEWS":
      return `${serverName}: ${item.title ?? "новость"}`;
    case "NEW_SERVER":
      return `Новый сервер: ${serverName}`;
    case "SERVER_ONLINE":
      return `${serverName} онлайн`;
    case "RESOURCE_RELEASE":
      return `Релиз: ${item.resource?.title ?? ""}`;
    case "RESOURCE_UPDATE":
      return `${item.resource?.title ?? "Ресурс"} · v${item.version ?? ""}`;
    case "NEW_ARTICLE":
      return `Статья: ${item.article?.title ?? ""}`;
    case "NEW_DISCUSSION":
      return `Обсуждение: ${item.thread?.title ?? ""}`;
    case "DISCUSSION_REPLY":
      return `${item.thread?.title ?? "Обсуждение"} · +${item.count ?? 1}`;
    case "NEW_REVIEW":
      return `Отзыв: ${item.server?.name ?? item.resource?.title ?? ""}`;
    default:
      return "";
  }
}

function ActivityRail({
  snapshot,
  isLoading,
}: {
  snapshot?: ActivitySnapshot;
  isLoading?: boolean;
}) {
  // Loading: скелетон, а не пустое состояние (§41).
  if (!snapshot && isLoading) {
    return (
      <div className="rounded-card border border-line bg-surface p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-content-muted">
          Лента событий
        </h3>
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  const items = snapshot?.items?.slice(0, 5) ?? [];

  if (!snapshot || items.length === 0) {
    return (
      <div className="rounded-card border border-line bg-surface p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-content-muted">
          Лента событий
        </h3>
        <p className="text-sm text-content-secondary">Свежих событий нет</p>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-content-muted">
        Лента событий
      </h3>
      <ul className="space-y-2.5">
        {items.map((item, idx) => {
          const line = activityLine(item);
          if (!line) return null;
          return (
            <li key={`${item.type}-${item.at}-${idx}`}>
              <Link
                href={item.href}
                className="block rounded-md px-1 py-0.5 transition-colors duration-fast hover:bg-surface-hover"
              >
                <span className="block truncate text-sm text-content">{line}</span>
                <span className="text-xs text-content-muted">{timeAgo(item.at)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <Link
        href="/news"
        className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline"
      >
        Все события
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}

export function RightRail({
  snapshot,
  snapshotLoading,
  promotions,
}: {
  snapshot?: ActivitySnapshot;
  snapshotLoading?: boolean;
  promotions?: PromotionItem[];
}) {
  return (
    <aside aria-label="Дополнительно" className="space-y-4">
      {promotions?.length ? (
        <PromotionHero items={promotions} placement="home_rail_secondary" compact />
      ) : null}
      <TopCreators />
      <ActivityRail snapshot={snapshot} isLoading={snapshotLoading} />
    </aside>
  );
}

