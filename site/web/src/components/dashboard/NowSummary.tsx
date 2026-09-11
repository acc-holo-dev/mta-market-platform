// PLAN-006 Workstream I: «Сейчас / За ночь» — персональная сводка с момента
// последнего визита в dashboard (GET /dashboard/now). Только реальные факты
// по существующим отношениям (подписки, темы, покупки) — без алгоритмов
// (DAILY-EXPERIENCE §6/§15). Пустые блоки не показываются (SURFACE-MAP §33).
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboardNow } from "@/lib/api-ext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Bell, RefreshCcw, MessageSquare, ShoppingBag, Newspaper, UserPlus, PackageOpen } from "lucide-react";

function Row({
  href,
  icon,
  label,
  detail,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  detail?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-card border border-line bg-background p-3 hover:border-accent/40"
    >
      <span className="flex min-w-0 items-center gap-3">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-line bg-surface">
          {icon}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{label}</span>
          {detail ? <span className="block truncate text-xs text-content-secondary">{detail}</span> : null}
        </span>
      </span>
    </Link>
  );
}

export function DashboardNow() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "now"],
    queryFn: fetchDashboardNow,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <Card className="mb-8">
        <CardContent className="p-6 text-sm text-content-muted animate-pulse">
          Загрузка сводки…
        </CardContent>
      </Card>
    );
  }
  if (isError || !data) return null;

  const rows: { key: string; href: string; icon: React.ReactNode; label: string; detail?: string }[] = [];
  if (data.unreadNotifications > 0) {
    rows.push({
      key: "notif",
      href: "/notifications",
      icon: <Bell className="h-4 w-4 text-accent" />,
      label: `Уведомления: ${data.unreadNotifications} новых`,
    });
  }
  if (data.serverUpdates.count > 0) {
    const first = data.serverUpdates.items[0];
    rows.push({
      key: "updates",
      href: first?.server ? `/servers/${first.server.slug}` : "/servers",
      icon: <RefreshCcw className="h-4 w-4 text-accent" />,
      label: `Подписки: ${data.serverUpdates.count} ${
        data.serverUpdates.count === 1 ? "обновление" : "обновлений"
      }`,
      detail: first ? `${first.server?.name ?? ""} — ${first.version}` : undefined,
    });
  }
  if (data.serverNews.count > 0) {
    const first = data.serverNews.items[0];
    rows.push({
      key: "news",
      href: "/news",
      icon: <Newspaper className="h-4 w-4 text-accent" />,
      label: `Новости подписок: ${data.serverNews.count}`,
      detail: first ? first.title : undefined,
    });
  }
  if (data.discussionReplies.count > 0) {
    const first = data.discussionReplies.items[0];
    rows.push({
      key: "replies",
      href: first ? `/community/forum/thread/${first.threadId}` : "/community",
      icon: <MessageSquare className="h-4 w-4 text-accent" />,
      label: `Обсуждения: ${data.discussionReplies.count} ${
        data.discussionReplies.count === 1 ? "новый ответ" : "новых ответов"
      }`,
      detail: first?.threadTitle ?? undefined,
    });
  }
  if (data.purchasedUpdates.count > 0) {
    const first = data.purchasedUpdates.items[0];
    rows.push({
      key: "purchased",
      href: first?.resource ? `/resources/${first.resource.slug}` : "/purchases",
      icon: <ShoppingBag className="h-4 w-4 text-accent" />,
      label: `Покупки: ${data.purchasedUpdates.count} ${
        data.purchasedUpdates.count === 1 ? "новый update" : "новых updates"
      }`,
      detail: first?.resource ? `${first.resource.title} — ${first.version}` : undefined,
    });
  }
  // PLAN-008 E-003: подписки на создателей и отслеживаемые ресурсы.
  if (data.creatorUpdates && data.creatorUpdates.count > 0) {
    const first = data.creatorUpdates.items[0];
    rows.push({
      key: "creator-updates",
      href: first?.resource ? `/resources/${first.resource.slug}` : "/resources",
      icon: <UserPlus className="h-4 w-4 text-accent" />,
      label: `Подписки: ${data.creatorUpdates.count} ${
        data.creatorUpdates.count === 1 ? "новинка" : "новинок"
      } от создателей`,
      detail: first?.resource ? `${first.resource.title} — ${first.version}` : undefined,
    });
  }
  // PLAN-009 D-002: ответы в отслеживаемых обсуждениях.
  if (data.followedThreadReplies && data.followedThreadReplies.count > 0) {
    const first = data.followedThreadReplies.items[0];
    rows.push({
      key: "thread-replies",
      href: first ? `/community/forum/thread/${first.threadId}` : "/community",
      icon: <MessageSquare className="h-4 w-4 text-accent" />,
      label: `Отслеживаемые обсуждения: ${data.followedThreadReplies.count} ${
        data.followedThreadReplies.count === 1 ? "новый ответ" : "новых ответов"
      }`,
      detail: first?.threadTitle ?? undefined,
    });
  }
  if (data.followedResourceUpdates && data.followedResourceUpdates.count > 0) {
    const first = data.followedResourceUpdates.items[0];
    rows.push({
      key: "followed-updates",
      href: first?.resource ? `/resources/${first.resource.slug}` : "/resources",
      icon: <PackageOpen className="h-4 w-4 text-accent" />,
      label: `Отслеживаемые ресурсы: ${data.followedResourceUpdates.count} ${
        data.followedResourceUpdates.count === 1 ? "обновление" : "обновлений"
      }`,
      detail: first?.resource ? `${first.resource.title} — ${first.version}` : undefined,
    });
  }

  return (
    <Card className="mb-10">
      <CardHeader>
        <CardTitle>Сейчас</CardTitle>
        <CardDescription>
          {data.firstVisit
            ? "События за последние 24 часа."
            : `С вашего прошлого визита (${new Date(data.since).toLocaleString("ru-RU")}).`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-content-secondary">
            С прошлого визита новых событий нет. Живая сводка платформы —{" "}
            <Link href="/" className="text-accent-strong hover:underline">
              на главной
            </Link>
            .
          </p>
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {rows.map((r) => (
              <Row key={r.key} href={r.href} icon={r.icon} label={r.label} detail={r.detail} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
