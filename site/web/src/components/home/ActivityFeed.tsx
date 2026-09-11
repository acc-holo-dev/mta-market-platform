// PLAN-006 Workstreams C/F/G: the Home activity feed. Each item shows the
// four mandatory elements (§43): clear title, time, context, destination.
// Rendering is honest: unknown types are skipped, empty states are real.
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  fetchActivity,
  type ActivityItem,
  type ActivitySnapshot,
} from "@/lib/api-ext";
import { timeAgo } from "@/lib/domain";
import {
  Server,
  MessageSquare,
  MessageSquarePlus,
  Package,
  PackagePlus,
  RefreshCcw,
  Newspaper,
  Star,
  Radio,
  FileText,
  type LucideIcon,
} from "lucide-react";

function itemTitle(item: ActivityItem): string {
  const serverName = item.server?.name ?? "";
  switch (item.type) {
    case "SERVER_UPDATE":
      return `${serverName} выпустил обновление ${item.version ?? ""}`.trim();
    case "SERVER_NEWS":
      return `${serverName}: ${item.title ?? "новость"}`;
    case "NEW_SERVER":
      return `Новый сервер: ${serverName}`;
    case "SERVER_ONLINE":
      return `${serverName} сейчас онлайн`;
    case "RESOURCE_RELEASE": {
      const by = item.resource?.sellerName ? ` — ${item.resource.sellerName}` : "";
      return `Новый ресурс: ${item.resource?.title ?? item.title ?? ""}${by}`;
    }
    case "RESOURCE_UPDATE":
      return `${item.resource?.title ?? item.title ?? "Ресурс"} — версия ${item.version ?? ""}`.trim();
    case "NEW_ARTICLE": {
      const by = item.author?.displayName || item.author?.username;
      return `Новая статья: ${item.article?.title ?? item.title ?? ""}${by ? ` — ${by}` : ""}`;
    }
    case "NEW_DISCUSSION":
      return `Новое обсуждение: «${item.thread?.title ?? item.title ?? ""}»`;
    case "DISCUSSION_REPLY":
      return `«${item.thread?.title ?? item.title ?? "Обсуждение"}» — ${item.count ?? 1} новых ответов`;
    case "NEW_REVIEW": {
      const target = item.server?.name ?? item.resource?.title ?? "";
      const verified = item.review?.verified ? " · ✓ Verified Interaction" : "";
      return `Новый отзыв: ${target}${verified}`;
    }
    default:
      return "";
  }
}

function itemIcon(type: string): LucideIcon | null {
  switch (type) {
    case "SERVER_UPDATE":
      return RefreshCcw;
    case "SERVER_NEWS":
      return Newspaper;
    case "NEW_SERVER":
    case "SERVER_ONLINE":
      return Server;
    case "RESOURCE_RELEASE":
      return PackagePlus;
    case "RESOURCE_UPDATE":
      return Package;
    case "NEW_ARTICLE":
      return FileText;
    case "NEW_DISCUSSION":
      return MessageSquarePlus;
    case "DISCUSSION_REPLY":
      return MessageSquare;
    case "NEW_REVIEW":
      return Star;
    default:
      return Radio;
  }
}

export function ActivityItemRow({ item }: { item: ActivityItem }) {
  const Icon = itemIcon(item.type);
  const title = itemTitle(item);
  if (!title) return null; // unknown type — skip, never render garbage
  return (
    <Link
      href={item.href}
      className="group flex items-start gap-3 rounded-card border border-line bg-surface p-3 transition-colors hover:border-accent/40 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {Icon ? (
        <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-line bg-background">
          <Icon className="h-4 w-4 text-accent" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium group-hover:text-accent-strong">
          {title}
        </span>
        <span className="mt-0.5 block text-xs text-content-secondary">{timeAgo(item.at)}</span>
      </span>
    </Link>
  );
}

export function ActivityFeed({ snapshot }: { snapshot?: ActivitySnapshot }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["activity", "snapshot"],
    queryFn: fetchActivity,
    enabled: snapshot === undefined,
  });
  const snap = snapshot ?? data;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-[62px] rounded-card border border-line bg-surface/60 animate-pulse" />
        ))}
      </div>
    );
  }
  if (isError || !snap) {
    return (
      <div className="rounded-card border border-line bg-surface p-4 text-sm text-content-secondary">
        Не удалось загрузить активность.{" "}
        <button className="text-accent-strong hover:underline" onClick={() => refetch()}>
          Повторить
        </button>
      </div>
    );
  }
  if (!snap.items.length) {
    // J-001: honest empty state (§38 — no imitation of life).
    return (
      <div className="rounded-card border border-line bg-surface p-6 text-center">
        <p className="text-sm font-medium">Пока тихо</p>
        <p className="mt-1 text-sm text-content-secondary">
          Свежих событий ещё нет. Загляните в серверы, маркетплейс и сообщество ниже.
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {snap.items.map((item, idx) => (
        <ActivityItemRow key={`${item.type}-${item.href}-${item.at}-${idx}`} item={item} />
      ))}
    </div>
  );
}
