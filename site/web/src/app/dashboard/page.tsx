// Покупки (PLAN-002 G-004): история покупок + лицензии, без фиктивных
// показателей (M-001).
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { bootstrapSession } from "@/lib/api";
import { fetchMyPurchases, fetchDashboardCommunity, formatRub, type Purchase } from "@/lib/api-ext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { DashboardNow } from "@/components/dashboard/NowSummary";
import Link from "next/link";
import { Store, ShoppingBag, Server, Users, MessageSquare, Bell, Newspaper, RefreshCcw } from "lucide-react";
import { typeLabel, formatDate } from "@/lib/domain";

export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();

  useEffect(() => {
    // Access token lives in memory only: after a page reload the store is
    // empty, so silently restore the session from the refresh cookie first.
    let cancelled = false;
    (async () => {
      const ok = await bootstrapSession();
      if (!cancelled && !ok) {
        router.push("/auth/login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const {
    data: purchases,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["purchases", "my", "dashboard"],
    queryFn: fetchMyPurchases,
    enabled: isAuthenticated(),
  });

  if (!isAuthenticated() || !user) {
    return null;
  }

  const list = (purchases as Purchase[] | undefined) ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Покупки</h1>
        <p className="mt-1 text-content-secondary">
          Привет, {user.displayName || user.username}! Здесь ваши приобретённые ресурсы и лицензии.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Мои покупки</CardTitle>
            <CardDescription>Ресурсы, лицензии и загрузки</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-content-muted">Загрузка покупок...</p>
            ) : error ? (
              <ErrorState error={error} onRetry={() => refetch()} />
            ) : list.length === 0 ? (
              <EmptyState
                icon={<ShoppingBag className="h-12 w-12 text-content-muted mx-auto mb-4" />}
                title="У вас пока нет покупок"
                description="Выберите ресурс на Маркетплейсе — лицензия выдаётся сразу после оплаты"
                action={
                  <Link href="/resources">
                    <Button variant="primary" size="sm">
                      На Маркетплейс
                    </Button>
                  </Link>
                }
              />
            ) : (
              <div className="space-y-3">
                {list.map((p) => (
                  <div
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-card border border-line bg-surface-raised"
                  >
                    <div>
                      <Link
                        href={p.resource ? `/resources/${p.resource.slug}` : "/resources"}
                        className="font-semibold hover:text-accent-strong"
                      >
                        {p.resource?.title ?? "Ресурс недоступен"}
                      </Link>
                      <p className="text-sm text-content-secondary">
                        {typeLabel(p.resource.type ?? "")} · {formatDate(p.createdAt)}
                        {p.version ? ` · v${p.version.version}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-semibold">{formatRub(p.priceSnapshot)}</div>
                        <StatusBadge status={p.status} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Аккаунт</CardTitle>
            <CardDescription>Профиль, баланс и лицензии</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/account" className="block">
              <Button variant="outline" className="w-full" size="sm">
                Профиль и баланс
              </Button>
            </Link>
            <Link href="/seller" className="block">
              <Button variant="ghost" className="w-full" size="sm">
                <Store className="mr-2 h-4 w-4" />
                Мой магазин
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* PLAN-006 I: сводка «Сейчас / За ночь» — персональный вход в экосистему */}
      <DashboardNow />

      {/* PLAN-005 N: виджеты «My MTA» — сообщество (серверы, подписки, форум) */}
      <section className="mt-10">
        <h2 className="text-2xl font-bold tracking-tight">My MTA</h2>
        <MyMtaWidgets />
      </section>
    </div>
  );
}

// ---------- PLAN-005 N: виджеты «My MTA» (GET /dashboard/community) ----------
const SERVER_LIFECYCLE_LABELS: Record<string, string> = {
  CREATED: "Создан",
  PENDING_VERIFICATION: "Ожидает проверки",
  VERIFIED: "Верифицирован",
  ACTIVE: "Активен",
  SUSPENDED: "Приостановлен",
  ARCHIVED: "Архивирован",
};

/** MonitoringPill-style: зелёный ONLINE, серый UNKNOWN, красный OFFLINE. */
function monitoringDotClass(state: string): string {
  if (state === "ONLINE") return "bg-ok";
  if (state === "OFFLINE") return "bg-bad";
  return "bg-line-strong";
}

function monitoringLabel(state: string): string {
  if (state === "ONLINE") return "Онлайн";
  if (state === "OFFLINE") return "Оффлайн";
  return "Нет данных";
}

function MyMtaWidgets() {
  const { isAuthenticated } = useAuthStore();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard", "community"],
    queryFn: fetchDashboardCommunity,
    enabled: isAuthenticated(),
  });

  if (error) {
    return <ErrorState error={error} onRetry={() => refetch()} className="mt-6" />;
  }
  if (isLoading || !data) {
    return <LoadingSpinner label="Загрузка My MTA..." className="mt-6" />;
  }

  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {/* а) Мои серверы */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5 text-accent" />
            Мои серверы
          </CardTitle>
          <CardDescription>Серверы, где вы владелец</CardDescription>
        </CardHeader>
        <CardContent>
          {data.ownedServers.length === 0 ? (
            <EmptyState
              className="py-6"
              icon={<Server className="h-10 w-10 text-content-muted mx-auto mb-3" />}
              title="Вы ещё не зарегистрировали сервер"
              action={
                <Link href="/servers/create">
                  <Button variant="primary" size="sm">
                    Зарегистрировать сервер
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {data.ownedServers.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-card border border-line bg-surface-raised"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`h-2 w-2 flex-shrink-0 rounded-full ${monitoringDotClass(s.monitoring)}`}
                      aria-hidden
                    />
                    <Link
                      href={`/servers/${s.slug}`}
                      className="truncate font-medium hover:text-accent-strong"
                    >
                      {s.name}
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {s.playerCount != null ? (
                      <span className="text-sm text-content-secondary">
                        {s.playerCount}
                        {s.maxPlayers != null ? `/${s.maxPlayers}` : ""}
                      </span>
                    ) : null}
                    {s.verification !== "VERIFIED" ? (
                      <span className="inline-flex items-center rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn">
                        Не верифицирован
                      </span>
                    ) : null}
                    {s.lifecycle === "SUSPENDED" || s.lifecycle === "ARCHIVED" ? (
                      <span className="inline-flex items-center rounded-full border border-bad/30 bg-bad/10 px-2 py-0.5 text-xs font-medium text-bad">
                        {SERVER_LIFECYCLE_LABELS[s.lifecycle] ?? s.lifecycle}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* б) Подписки */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" />
            Подписки
          </CardTitle>
          <CardDescription>Серверы, новости и обновления</CardDescription>
        </CardHeader>
        <CardContent>
          {data.following.length === 0 &&
          data.followedNews.length === 0 &&
          data.updates.length === 0 ? (
            <EmptyState
              className="py-6"
              icon={<Users className="h-10 w-10 text-content-muted mx-auto mb-3" />}
              title="Пока пусто"
              description="Подпишитесь на серверы, чтобы видеть обновления"
            />
          ) : (
            <div className="space-y-3">
              {data.following.map((f) => (
                <Link
                  key={`server-${f.slug}`}
                  href={`/servers/${f.slug}`}
                  className="flex items-center gap-2.5 rounded-card border border-line bg-surface-raised p-3 hover:bg-surface-hover"
                >
                  <span
                    className={`h-2 w-2 flex-shrink-0 rounded-full ${monitoringDotClass(f.monitoring)}`}
                    aria-hidden
                  />
                  <span className="font-medium">{f.name}</span>
                  <span className="text-xs text-content-muted">— {monitoringLabel(f.monitoring)}</span>
                </Link>
              ))}
              {data.followedNews.map((n) => (
                <Link
                  key={`news-${n.id}`}
                  href="/news"
                  className="flex items-center gap-2.5 rounded-card border border-line bg-surface-raised p-3 hover:bg-surface-hover"
                >
                  <Newspaper className="h-4 w-4 flex-shrink-0 text-content-muted" />
                  <span className="min-w-0 flex-1 truncate">{n.title}</span>
                  {n.server ? (
                    <span className="flex-shrink-0 text-xs text-content-muted">{n.server.name}</span>
                  ) : null}
                </Link>
              ))}
              {data.updates.map((u) => (
                <Link
                  key={`update-${u.id}`}
                  href="/news"
                  className="flex items-center gap-2.5 rounded-card border border-line bg-surface-raised p-3 hover:bg-surface-hover"
                >
                  <RefreshCcw className="h-4 w-4 flex-shrink-0 text-content-muted" />
                  <span className="min-w-0 flex-1 truncate">
                    v{u.version} {u.title}
                  </span>
                  {u.serverSlug ? (
                    <span className="flex-shrink-0 text-xs text-content-muted">{u.serverSlug}</span>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* в) Обсуждения */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-accent" />
            Обсуждения
          </CardTitle>
          <CardDescription>Ваши темы на форуме</CardDescription>
        </CardHeader>
        <CardContent>
          {data.discussions.length === 0 ? (
            <EmptyState className="py-6" title="Нет обсуждений" />
          ) : (
            <div className="space-y-3">
              {data.discussions.map((t) => (
                <Link
                  key={t.id}
                  href={`/community/forum/thread/${t.id}`}
                  className="block rounded-card border border-line bg-surface-raised p-4 hover:bg-surface-hover"
                >
                  <p className="font-medium">{t.title}</p>
                  <p className="mt-1 text-sm text-content-secondary">
                    {t.replyCount} {t.replyCount === 1 ? "ответ" : "ответов"}
                    {t.lastPostAt ? ` · ${formatDate(t.lastPostAt)}` : ""}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* г) Уведомления */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-accent" />
            Уведомления
          </CardTitle>
          <CardDescription>Непрочитанные события</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-3xl font-bold">{data.unreadNotifications}</p>
          <p className="text-sm text-content-secondary">
            {data.unreadNotifications === 1
              ? "Новое уведомление"
              : "Непрочитанных уведомлений"}
          </p>
          <Link href="/notifications" className="block">
            <Button variant="outline" size="sm" className="w-full">
              Все уведомления
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
