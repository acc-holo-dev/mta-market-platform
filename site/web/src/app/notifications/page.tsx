// PLAN-005 M-003/M-004 → PLAN-015 §32: notification center.
// Группировка «Сегодня» / «Ранее», типовые иконки (реальные типы бэкенда),
// mark-read / mark-all-read, каждое уведомление — deep link на объект.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  CheckCheck,
  Newspaper,
  RefreshCcw,
  MessageSquareReply,
  Star,
  ShieldCheck,
  Package,
  PackageOpen,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { Tabs } from "@/components/ui/Tabs";
import {
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  getErrorMessage,
  type NotificationItem,
} from "@/lib/api-ext";
import { bootstrapSession } from "@/lib/api";
import { useAuthStore } from "@/store/auth";

const TYPE_META: Record<
  string,
  { label: string; icon: typeof Bell; tone: string }
> = {
  SERVER_NEWS: {
    label: "Новость сервера",
    icon: Newspaper,
    tone: "bg-ok-soft text-ok",
  },
  SERVER_UPDATE: {
    label: "Обновление сервера",
    icon: RefreshCcw,
    tone: "bg-info-soft text-info",
  },
  FORUM_REPLY: {
    label: "Ответ на форуме",
    icon: MessageSquareReply,
    tone: "bg-accent-soft text-accent-strong",
  },
  REVIEW_EVENT: {
    label: "Отзыв",
    icon: Star,
    tone: "bg-warn-soft text-warn",
  },
  MODERATION: {
    label: "Модерация",
    icon: ShieldCheck,
    tone: "bg-info-soft text-info",
  },
  // PLAN-008: Follow Expansion.
  CREATOR_RESOURCE: {
    label: "Новинка от создателя",
    icon: Package,
    tone: "bg-verified-soft text-verified",
  },
  CREATOR_ARTICLE: {
    label: "Статья создателя",
    icon: FileText,
    tone: "bg-verified-soft text-verified",
  },
  RESOURCE_UPDATE: {
    label: "Обновление ресурса",
    icon: PackageOpen,
    tone: "bg-info-soft text-info",
  },
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isToday(value: string): boolean {
  const date = new Date(value);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** Resolves a notification to its in-platform target (actionable, M model). */
function targetHref(n: NotificationItem): string | null {
  switch (n.entityType) {
    case "serverNews":
    case "serverUpdate":
      return "/news";
    case "forumThread":
      return n.entityId ? `/community/forum/thread/${n.entityId}` : null;
    case "server":
      return null;
    case "serverReview":
      return null;
    default:
      return null;
  }
}

export default function NotificationsPage() {
  const router = useRouter();
  const { isAuthenticated, accessToken } = useAuthStore();
  const [booted, setBooted] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isAuthenticated()) {
        setBooted(true);
        return;
      }
      const ok = await bootstrapSession();
      if (!cancelled && !ok) router.push("/auth/login");
      if (!cancelled) setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, router]);

  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications", filter],
    queryFn: () => fetchNotifications(filter),
    enabled: booted && accessToken !== null,
  });

  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications", "badge"] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const markAll = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["notifications", "badge"] });
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  // PLAN-015 §32: группировка Сегодня / Ранее (по локальной дате создания).
  const { today, earlier } = useMemo(() => {
    const items = query.data?.data ?? [];
    return {
      today: items.filter((n) => isToday(n.createdAt)),
      earlier: items.filter((n) => !isToday(n.createdAt)),
    };
  }, [query.data]);

  if (!booted || !isAuthenticated()) return null;

  const renderItem = (n: NotificationItem) => {
    const href = targetHref(n);
    const meta = TYPE_META[n.type] ?? {
      label: n.type,
      icon: Bell,
      tone: "bg-surface-hover text-content-secondary",
    };
    const Icon = meta.icon;
    return (
      <button
        key={n.id}
        type="button"
        onClick={() => {
          if (!n.readAt) markRead.mutate(n.id);
          if (href) router.push(href);
        }}
        className={`block w-full rounded-card border p-4 text-left transition-colors duration-fast ${
          n.readAt
            ? "border-line bg-surface hover:bg-surface-hover"
            : "border-accent/30 bg-accent-soft/40 hover:bg-accent-soft/60"
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${meta.tone}`}
          >
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-medium">{n.title}</p>
              {!n.readAt ? (
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full bg-accent"
                  aria-label="Непрочитано"
                />
              ) : null}
            </div>
            {n.body ? (
              <p className="mt-0.5 line-clamp-2 text-sm text-content-secondary">{n.body}</p>
            ) : null}
            <p className="mt-1 text-xs text-content-muted">
              {meta.label} · {formatDateTime(n.createdAt)}
            </p>
          </div>
        </div>
      </button>
    );
  };

  const groupHeader = (label: string, count: number) => (
    <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-content-muted">
      {label} <span className="tabular-nums">· {count}</span>
    </p>
  );

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Уведомления</h1>
          <p className="mt-1 text-content-secondary">
            Новости серверов, ответы в обсуждениях и решения модерации.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || (query.data?.unreadCount ?? 0) === 0}
        >
          <CheckCheck className="mr-2 h-4 w-4" aria-hidden />
          Прочитать всё
        </Button>
      </div>

      <div className="mb-4">
        <Tabs
          tabs={[
            ["all", "Все"],
            [
              "unread",
              query.data ? `Непрочитанные (${query.data.unreadCount})` : "Непрочитанные",
            ],
          ]}
          value={filter}
          onChange={(v) => setFilter(v as "all" | "unread")}
        />
      </div>

      {error ? <p className="mb-3 text-sm text-bad">{error}</p> : null}

      {query.isLoading ? (
        <LoadingSpinner label="Загрузка уведомлений..." />
      ) : query.isError ? (
        <ErrorState error={getErrorMessage(query.error)} onRetry={() => query.refetch()} />
      ) : (query.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          icon={<Bell className="h-8 w-8" />}
          title="Уведомлений пока нет"
          description="Подпишитесь на серверы и участвуйте в обсуждениях — здесь появятся события."
        />
      ) : (
        <div className="space-y-4">
          {today.length > 0 ? (
            <section aria-label="Сегодня">
              {groupHeader("Сегодня", today.length)}
              <div className="space-y-2">{today.map(renderItem)}</div>
            </section>
          ) : null}
          {earlier.length > 0 ? (
            <section aria-label="Ранее">
              {groupHeader("Ранее", earlier.length)}
              <div className="space-y-2">{earlier.map(renderItem)}</div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
