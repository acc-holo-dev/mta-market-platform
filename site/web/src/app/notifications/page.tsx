// PLAN-005 M-003/M-004: notification center. Unread / recent / all with
// mark-read and mark-all-read. Every notification links to its object.
"use client";

import { useEffect, useState } from "react";
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
// PLAN-008 icons for the new notification types
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

const TYPE_META: Record<string, { label: string; icon: typeof Bell }> = {
  SERVER_NEWS: { label: "Новость сервера", icon: Newspaper },
  SERVER_UPDATE: { label: "Обновление сервера", icon: RefreshCcw },
  FORUM_REPLY: { label: "Ответ на форуме", icon: MessageSquareReply },
  REVIEW_EVENT: { label: "Отзыв", icon: Star },
  MODERATION: { label: "Модерация", icon: ShieldCheck },
  // PLAN-008: Follow Expansion.
  CREATOR_RESOURCE: { label: "Новинка от создателя", icon: Package },
  CREATOR_ARTICLE: { label: "Статья создателя", icon: FileText },
  RESOURCE_UPDATE: { label: "Обновление ресурса", icon: PackageOpen },
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
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

  if (!booted || !isAuthenticated()) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
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
          <CheckCheck className="mr-2 h-4 w-4" />
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
        <div className="space-y-2">
          {query.data!.data.map((n) => {
            const href = targetHref(n);
            const meta = TYPE_META[n.type] ?? { label: n.type, icon: Bell };
            const Icon = meta.icon;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  if (!n.readAt) markRead.mutate(n.id);
                  if (href) router.push(href);
                }}
                className={`block w-full rounded-card border p-4 text-left transition-colors ${
                  n.readAt
                    ? "border-line bg-surface"
                    : "border-accent/30 bg-accent-soft/40 hover:bg-accent-soft/60"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-hover">
                    <Icon className="h-4 w-4 text-content-secondary" />
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
                  {!n.readAt ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        markRead.mutate(n.id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.stopPropagation();
                          markRead.mutate(n.id);
                        }
                      }}
                      className="flex-shrink-0 rounded-md px-2 py-1 text-xs text-content-secondary hover:bg-surface-hover hover:text-content"
                    >
                      Прочитать
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}