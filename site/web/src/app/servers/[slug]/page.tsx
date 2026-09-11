// Публичная страница сервера (PLAN-005 D): hero, вкладки
// Обзор / Live / Новости / Обновления / Отзывы / Сообщество.
// Гостям доступна полностью; приватные блоки фильтрует бэкенд (privacy.*),
// UI дополнительно скрывает их (workstream AA — never trusted).
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  ExternalLink,
  Flag,
  Globe,
  Heart,
  Loader2,
  MessageSquare,
  Newspaper,
  RefreshCcw,
  Send,
  Server as ServerIcon,
  Settings,
  Star,
  Users,
} from "lucide-react";
import { bootstrapSession } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import {
  claimReviewToken,
  createReport,
  createServerReview,
  fetchReviewEligibility,
  fetchServer,
  fetchServerCommunityMembers,
  fetchServerCommunityThreads,
  fetchServerNews,
  fetchServerResources,
  fetchServerReviews,
  fetchServerStaff,
  fetchServerStatistics,
  fetchServerUpdates,
  followServer,
  getErrorMessage,
  mediaUrl,
  unfollowServer,
  type ServerDetail,
  type ServerReviewItem,
  type ServerUpdateItem,
  type ServerResourceCard,
} from "@/lib/api-ext";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select, Textarea } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { MonitoringPill, VerificationBadge } from "@/components/servers/ServerCard";

type TabKey = "overview" | "live" | "news" | "updates" | "reviews" | "community";

const TABS: [TabKey, string][] = [
  ["overview", "Обзор"],
  ["live", "Live"],
  ["news", "Новости"],
  ["updates", "Обновления"],
  ["reviews", "Отзывы"],
  ["community", "Сообщество"],
];

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ServerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = use(params);
  const slug = decodeURIComponent(rawSlug);
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();
  const qc = useQueryClient();

  // Молчаливое восстановление сессии (подписка/отзыв после перезагрузки).
  useEffect(() => {
    bootstrapSession();
  }, []);

  // Вкладка — в hash, чтобы ссылками можно было поделиться разделом.
  const [tab, setTab] = useState<TabKey>("overview");
  useEffect(() => {
    const h = window.location.hash.replace("#", "") as TabKey;
    if (TABS.some(([k]) => k === h)) setTab(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeTab = (t: TabKey) => {
    setTab(t);
    window.history.replaceState(null, "", t === "overview" ? window.location.pathname : `#${t}`);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["server", slug],
    queryFn: () => fetchServer(slug),
    retry: false,
  });

  // Подписка: состояние держим локально после первого действия (сервер не
  // возвращает following в ServerDetail).
  const [following, setFollowing] = useState<boolean | null>(null);
  const followMut = useMutation({
    mutationFn: async (): Promise<boolean> => {
      if (following) {
        const r = await unfollowServer(slug);
        return r.following;
      }
      const r = await followServer(slug);
      return r.following;
    },
    onSuccess: (f) => {
      setFollowing(f);
      qc.invalidateQueries({ queryKey: ["server", slug] });
    },
  });

  const onFollow = () => {
    if (!isAuthenticated()) {
      router.push("/auth/login");
      return;
    }
    followMut.mutate();
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Skeleton className="h-48 w-full rounded-card" />
        <div className="mt-6 flex items-center gap-4">
          <Skeleton className="h-20 w-20 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
        <Skeleton className="mt-8 h-10 w-full" />
        <Skeleton className="mt-6 h-40 w-full rounded-card" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <div className="text-center py-20">
          <ServerIcon className="h-12 w-12 text-content-muted mx-auto mb-4" />
          <h1 className="text-xl font-semibold">Сервер не найден</h1>
          <p className="mt-1 text-sm text-content-secondary max-w-md mx-auto">
            Сервер не существует, заархивирован или ещё не прошёл модерацию.
          </p>
          <Link href="/servers" className="inline-block mt-6">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Все серверы
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { server, caller, privacy } = data as ServerDetail;
  const banner = mediaUrl(server.bannerUrl);
  const logo = mediaUrl(server.logoUrl);
  const isFollowing = following === true;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <Link href="/servers" className="hover:text-accent-strong">
          Серверы
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">{server.name}</span>
      </nav>

      {/* ---------- Hero ---------- */}
      <div className="mb-8">
        <div className="relative h-48 w-full overflow-hidden rounded-card border border-line bg-surface-hover">
          {banner ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={banner} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-r from-accent-soft via-surface-raised to-surface" />
          )}
          <div
            className="absolute inset-0 bg-gradient-to-t from-surface via-surface/30 to-transparent"
            aria-hidden
          />
        </div>

        <div className="mt-4 flex flex-col gap-4 sm:-mt-10 sm:flex-row sm:items-end">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logo}
              alt={server.name}
              loading="lazy"
              className="h-20 w-20 flex-shrink-0 rounded-2xl border-2 object-cover bg-surface"
              style={server.accentColor ? { borderColor: server.accentColor } : undefined}
            />
          ) : (
            <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-2xl border-2 border-line bg-surface text-xl font-bold text-content-secondary">
              {server.name.slice(0, 2).toUpperCase()}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{server.name}</h1>
              <VerificationBadge verification={server.verification} />
              <MonitoringPill state={server.monitoring} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-content-secondary">
              {/* Статистика онлайна — только когда владелец её открывает (S). */}
              {privacy.showStats ? (
                <span className="inline-flex items-center gap-1">
                  <Users className="h-4 w-4" />
                  {server.playerCount != null
                    ? `${server.playerCount}/${server.maxPlayers ?? "—"} онлайн`
                    : "—/— онлайн"}
                </span>
              ) : null}
              {server.rating != null ? (
                <span className="inline-flex items-center gap-1">
                  <Star className="h-4 w-4 fill-accent text-accent" />
                  {server.rating}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <Heart className="h-4 w-4" />
                {server.followerCount.toLocaleString("ru-RU")} подписчиков
              </span>
              {server.region ? (
                <span className="inline-flex items-center gap-1">
                  <Globe className="h-4 w-4" />
                  {server.region}
                </span>
              ) : null}
            </div>
          </div>

          {/* Действия */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isFollowing ? "secondary" : "primary"}
              size="sm"
              onClick={onFollow}
              disabled={followMut.isPending}
            >
              {followMut.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Heart className={cn("mr-2 h-4 w-4", isFollowing && "fill-current")} />
              )}
              {isFollowing ? "Отписаться" : "Подписаться"}
            </Button>
            {followMut.error ? (
              <span className="text-xs text-bad">{getErrorMessage(followMut.error)}</span>
            ) : null}
            {server.discordUrl ? (
              <a href={server.discordUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <MessageSquare className="mr-2 h-4 w-4" />
                  Discord
                </Button>
              </a>
            ) : null}
            {server.websiteUrl ? (
              <a href={server.websiteUrl} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Сайт
                </Button>
              </a>
            ) : null}
            {caller.isStaff ? (
              <Link href={`/servers/${slug}/manage`}>
                <Button variant="outline" size="sm">
                  <Settings className="mr-2 h-4 w-4" />
                  Управление
                </Button>
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {/* ---------- Tabs (мобильные: горизонтальный скролл) ---------- */}
      <Tabs tabs={TABS} value={tab} onChange={changeTab} className="mb-6" />

      {tab === "overview" ? <OverviewSection slug={slug} server={server} privacy={privacy} /> : null}
      {tab === "live" ? <LiveSection slug={slug} privacy={privacy} /> : null}
      {tab === "news" ? <NewsSection slug={slug} /> : null}
      {tab === "updates" ? <UpdatesSection slug={slug} /> : null}
      {tab === "reviews" ? <ReviewsSection slug={slug} serverId={server.id} serverName={server.name} /> : null}
      {tab === "community" ? <CommunitySection slug={slug} privacy={privacy} /> : null}
    </div>
  );
}

/* ============================== Обзор ============================== */

function OverviewSection({
  slug,
  server,
  privacy,
}: {
  slug: string;
  server: ServerDetail["server"];
  privacy: ServerDetail["privacy"];
}) {
  const resourcesQuery = useQuery({
    queryKey: ["server-resources", slug],
    queryFn: () => fetchServerResources(slug),
    enabled: privacy.showResources,
  });

  const staffQuery = useQuery({
    queryKey: ["server-staff", slug],
    queryFn: () => fetchServerStaff(slug),
    enabled: privacy.showStaff,
  });

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>О сервере</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="whitespace-pre-wrap text-sm text-content-secondary">
            {server.description || "Владелец сервера пока не добавил описание."}
          </p>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
            {server.region ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-content-muted">Регион</dt>
                <dd className="mt-0.5 text-content">{server.region}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-xs uppercase tracking-wide text-content-muted">В каталоге с</dt>
              <dd className="mt-0.5 text-content">{formatDateShort(server.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-content-muted">Подписчики</dt>
              <dd className="mt-0.5 text-content">{server.followerCount.toLocaleString("ru-RU")}</dd>
            </div>
            {server.verifiedAt ? (
              <div>
                <dt className="text-xs uppercase tracking-wide text-content-muted">Верификация</dt>
                <dd className="mt-0.5 flex items-center gap-1 text-ok">
                  <BadgeCheck className="h-4 w-4" />
                  Подтверждён {formatDateShort(server.verifiedAt)}
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {/* Ресурсы — только при включённой опции; enabled:false → не рендерим ничего. */}
      {privacy.showResources && resourcesQuery.data?.enabled ? (
        <Card>
          <CardHeader>
            <CardTitle>Используемые ресурсы</CardTitle>
            <CardDescription>Ресурсы Маркетплейса, которые использует сервер.</CardDescription>
          </CardHeader>
          <CardContent>
            {resourcesQuery.data.data.length === 0 ? (
              <p className="text-sm text-content-muted">Сервер пока не отметил используемые ресурсы.</p>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {resourcesQuery.data.data.map((r: ServerResourceCard) => (
                  <ResourceRow key={r.id} row={r} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Персонал — только при включённой опции (visible=false → пусто). */}
      {privacy.showStaff && staffQuery.data?.visible ? (
        <Card>
          <CardHeader>
            <CardTitle>Персонал</CardTitle>
            <CardDescription>Администрация сервера.</CardDescription>
          </CardHeader>
          <CardContent>
            {staffQuery.data.data.length === 0 ? (
              <p className="text-sm text-content-muted">Список персонала пуст.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {staffQuery.data.data.map((m) => (
                  <li
                    key={m.userId}
                    className="flex items-center gap-3 rounded-card border border-line bg-surface-raised p-3"
                  >
                    <Avatar src={m.avatar} name={m.displayName || m.username || "Игрок"} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {m.displayName || m.username || "Участник"}
                      </p>
                      <p className="text-xs text-content-secondary">{staffRoleLabel(m.role)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function staffRoleLabel(role: string): string {
  switch (role) {
    case "OWNER":
      return "Владелец";
    case "ADMIN":
      return "Администратор";
    case "MODERATOR":
      return "Модератор";
    default:
      return role;
  }
}

function ResourceRow({ row }: { row: ServerResourceCard }) {
  const cover = mediaUrl(row.coverUrl);
  const inner = (
    <div className="flex items-center gap-3 rounded-card border border-line bg-surface-raised p-3 transition-colors group-hover:bg-surface-hover">
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" loading="lazy" className="h-12 w-12 flex-shrink-0 rounded-md object-cover" />
      ) : (
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md bg-surface-hover text-content-muted">
          <ServerIcon className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{row.displayName}</p>
        {row.note ? <p className="truncate text-xs text-content-secondary">{row.note}</p> : null}
      </div>
    </div>
  );
  return row.slug ? (
    <Link href={`/resources/${row.slug}`} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/* ============================== Live ============================== */

function LiveSection({ slug, privacy }: { slug: string; privacy: ServerDetail["privacy"] }) {
  const statsQuery = useQuery({
    queryKey: ["server-stats", slug, "24h"],
    queryFn: () => fetchServerStatistics(slug, "24h"),
  });

  const payload = statsQuery.data?.data ?? null;
  const current = payload?.current ?? null;
  const lastSeen = current?.lastSeenAt ?? null;
  const ageMin = lastSeen ? Math.floor((Date.now() - new Date(lastSeen).getTime()) / 60_000) : null;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-accent" />
            Текущее состояние
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <MonitoringPill state={current?.state ?? "UNKNOWN"} />
            {privacy.showStats && current ? (
              <span className="text-sm text-content">
                {current.players != null
                  ? `${current.players}/${current.maxPlayers ?? "—"} игроков`
                  : "—/— игроков"}
              </span>
            ) : null}
            {privacy.showStats && lastSeen ? (
              <span className="text-sm text-content-secondary">Активность: {formatDateTime(lastSeen)}</span>
            ) : null}
          </div>

          {!privacy.showStats ? (
            <p className="text-sm text-content-secondary">
              Владелец скрыл статистику онлайна этого сервера.
            </p>
          ) : (
            <FreshnessHint minutes={ageMin} />
          )}
        </CardContent>
      </Card>

      {/* Онлайн за 24 часа (inline SVG, без библиотек графиков) */}
      {privacy.showStats ? (
        <Card>
          <CardHeader>
            <CardTitle>Онлайн за 24 часа</CardTitle>
            <CardDescription>Измерения модуля мониторинга (каждый heartbeat).</CardDescription>
          </CardHeader>
          <CardContent>
            {statsQuery.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : statsQuery.error ? (
              <ErrorState error={statsQuery.error} onRetry={() => statsQuery.refetch()} />
            ) : !payload || payload.sampleCount === 0 ? (
              <EmptyState
                icon={<Activity className="h-12 w-12 text-content-muted mx-auto mb-4" />}
                title="Нет данных"
                description="Модуль мониторинга ещё не прислал измерений за последние 24 часа."
              />
            ) : (
              <div className="space-y-4">
                <Sparkline samples={payload.samples} />
                <div className="grid grid-cols-3 gap-4 text-center text-sm">
                  <div>
                    <p className="text-lg font-semibold text-content">{payload.peak ?? "—"}</p>
                    <p className="text-xs text-content-muted">Пик онлайна</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-content">{payload.average ?? "—"}</p>
                    <p className="text-xs text-content-muted">Средний онлайн</p>
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-content">
                      {payload.uptimePct != null ? `${payload.uptimePct}%` : "—"}
                    </p>
                    <p className="text-xs text-content-muted">Uptime</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

/** Свежесть heartbeat: подсказка о достоверности данных мониторинга. */
function FreshnessHint({ minutes }: { minutes: number | null }) {
  if (minutes == null) {
    return <p className="text-sm text-content-muted">Heartbeat ещё не поступал.</p>;
  }
  if (minutes < 10) {
    return <p className="text-sm text-ok">Данные свежие — heartbeat получен {minutes} мин назад.</p>;
  }
  if (minutes < 60) {
    return (
      <p className="text-sm text-warn">Данные могут устареть — последний heartbeat {minutes} мин назад.</p>
    );
  }
  return (
    <p className="text-sm text-bad">
      Сервер давно не отправлял heartbeat ({minutes} мин назад) — статус может быть неточным.
    </p>
  );
}

/** Спарклайн онлайна: inline SVG polyline, без библиотек. */
function Sparkline({
  samples,
}: {
  samples: { t: string; players: number; state: string }[];
}) {
  if (samples.length < 2) return null;
  const values = samples.map((s) => (typeof s.players === "number" ? s.players : 0));
  const max = Math.max(...values, 1);
  const W = 300;
  const H = 60;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - 4 - (v / max) * (H - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-24 w-full text-accent"
      role="img"
      aria-label="График онлайна за 24 часа"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ============================== Новости ============================== */

function NewsSection({ slug }: { slug: string }) {
  const newsQuery = useQuery({
    queryKey: ["server-news", slug],
    queryFn: () => fetchServerNews(slug, 1),
  });

  if (newsQuery.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-card" />
        ))}
      </div>
    );
  }
  if (newsQuery.error) {
    return <ErrorState error={newsQuery.error} onRetry={() => newsQuery.refetch()} />;
  }

  const items = newsQuery.data?.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Newspaper className="h-12 w-12 text-content-muted mx-auto mb-4" />}
        title="Новостей пока нет"
        description="Владелец сервера ещё ничего не публиковал."
      />
    );
  }

  return (
    <div className="space-y-4">
      {items.map((n) => {
        const cover = mediaUrl(n.coverUrl);
        return (
          <Link key={n.id} href={`/servers/${slug}/news/${n.id}`} className="block">
            <article className="flex gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:bg-surface-hover">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt="" loading="lazy" className="h-16 w-24 flex-shrink-0 rounded-md object-cover" />
              ) : null}
              <div className="min-w-0">
                <h3 className="font-semibold">{n.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-content-secondary">
                  {n.content.slice(0, 200)}
                </p>
                <p className="mt-2 text-xs text-content-muted">
                  {formatDateShort(n.publishedAt ?? n.createdAt)}
                  {n.thread ? ` · ${n.thread.replyCount} ответов в обсуждении` : ""}
                </p>
              </div>
            </article>
          </Link>
        );
      })}
    </div>
  );
}

/* ============================== Обновления ============================== */

function UpdatesSection({ slug }: { slug: string }) {
  const updatesQuery = useQuery({
    queryKey: ["server-updates", slug],
    queryFn: () => fetchServerUpdates(slug, 1),
  });

  if (updatesQuery.isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-card" />
        ))}
      </div>
    );
  }
  if (updatesQuery.error) {
    return <ErrorState error={updatesQuery.error} onRetry={() => updatesQuery.refetch()} />;
  }

  const items: ServerUpdateItem[] = updatesQuery.data?.data ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<RefreshCcw className="h-12 w-12 text-content-muted mx-auto mb-4" />}
        title="Обновлений пока нет"
        description="Выпуски версий сервера появятся здесь."
      />
    );
  }

  return (
    <div className="space-y-4">
      {items.map((u) => (
        <article key={u.id} className="rounded-card border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-strong">
              v{u.version}
            </span>
            <h3 className="font-semibold">{u.title}</h3>
            <span className="ml-auto text-xs text-content-muted">
              {formatDateShort(u.publishedAt)}
            </span>
          </div>
          {u.changelog ? (
            <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-content-secondary">
              {u.changelog}
            </p>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/* ============================== Отзывы ============================== */

function Stars({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`Оценка ${value} из 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn("h-4 w-4", i <= Math.round(value) ? "fill-accent text-accent" : "text-content-muted")}
        />
      ))}
    </span>
  );
}

function ReviewsSection({
  slug,
  serverId,
  serverName,
}: {
  slug: string;
  serverId: string;
  serverName: string;
}) {
  const { isAuthenticated } = useAuthStore();
  const qc = useQueryClient();

  const reviewsQuery = useQuery({
    queryKey: ["server-reviews", slug],
    queryFn: () => fetchServerReviews(slug, 1),
  });

  const eligibilityQuery = useQuery({
    queryKey: ["review-eligibility", slug],
    queryFn: () => fetchReviewEligibility(slug),
    enabled: isAuthenticated(),
  });

  // Форма
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const reviewMut = useMutation({
    mutationFn: () => createServerReview(slug, Number(rating), comment.trim() || null),
    onSuccess: () => {
      setComment("");
      setFormError(null);
      qc.invalidateQueries({ queryKey: ["server-reviews", slug] });
      qc.invalidateQueries({ queryKey: ["server", slug] });
      qc.invalidateQueries({ queryKey: ["review-eligibility", slug] });
    },
    onError: (err) => setFormError(getErrorMessage(err, "Не удалось отправить отзыв")),
  });

  // Активация токена из игры (делает отзыв «подтверждённым»).
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const claimMut = useMutation({
    mutationFn: () => claimReviewToken(slug, token.trim()),
    onSuccess: () => {
      setToken("");
      setTokenError(null);
      eligibilityQuery.refetch();
    },
    onError: (err) => setTokenError(getErrorMessage(err, "Не удалось активировать токен")),
  });

  // Жалобы
  const [reportTarget, setReportTarget] = useState<
    { type: "REVIEW" | "SERVER"; id: string; label: string } | null
  >(null);

  const stats = reviewsQuery.data?.stats;
  const reviews: ServerReviewItem[] = reviewsQuery.data?.data ?? [];
  const eligibility = eligibilityQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-1.5">
            <Star className="h-4 w-4 fill-accent text-accent" />
            <span className="font-semibold">{stats?.averageRating ?? "—"}</span>
            <span className="text-content-secondary">средняя оценка</span>
          </span>
          <span className="text-content-secondary">{stats?.total ?? 0} отзывов</span>
          <span className="inline-flex items-center gap-1 text-ok">
            <BadgeCheck className="h-4 w-4" />
            {stats?.verifiedCount ?? 0} подтверждённых
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReportTarget({ type: "SERVER", id: serverId, label: `сервер «${serverName}»` })}
        >
          <Flag className="mr-2 h-4 w-4" />
          Пожаловаться на сервер
        </Button>
      </div>

      {/* Форма отзыва */}
      <Card>
        <CardHeader>
          <CardTitle>Оставить отзыв</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isAuthenticated() ? (
            <p className="text-sm text-content-secondary">
              Чтобы оставить отзыв, войдите в аккаунт. Отзывы доступны только игрокам с подтверждённым
              взаимодействием с сервером.
              <Link href="/auth/login" className="ml-2 text-accent hover:text-accent-strong">
                Войти
              </Link>
            </p>
          ) : eligibilityQuery.isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : eligibility?.eligible ? (
            <div className="space-y-3">
              <div className="w-40">
                <Select aria-label="Оценка" value={rating} onChange={(e) => setRating(e.target.value)}>
                  {[5, 4, 3, 2, 1].map((v) => (
                    <option key={v} value={v}>
                      {v} — {["ужасно", "плохо", "нормально", "хорошо", "отлично"][v - 1]}
                    </option>
                  ))}
                </Select>
              </div>
              <Textarea
                rows={3}
                placeholder="Расскажите об игре на сервере..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                maxLength={4000}
              />
              {formError ? (
                <p role="alert" className="text-sm text-bad">
                  {formError}
                </p>
              ) : null}
              <Button onClick={() => reviewMut.mutate()} disabled={reviewMut.isPending}>
                {reviewMut.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Отправляем...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Отправить отзыв
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="flex items-start gap-2 text-sm text-content-secondary">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-content-muted" />
                {eligibility?.reason ||
                  "Отзывы доступны только игрокам с подтверждённым взаимодействием с сервером (токен из игры)."}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="Токен отзыва из игры"
                  aria-label="Токен отзыва из игры"
                  className="h-10 flex-1 rounded-md border border-line-strong bg-surface-raised px-3 text-sm text-content placeholder:text-content-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
                <Button
                  variant="outline"
                  onClick={() => claimMut.mutate()}
                  disabled={claimMut.isPending || !token.trim()}
                >
                  {claimMut.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <BadgeCheck className="mr-2 h-4 w-4" />
                  )}
                  Активировать токен
                </Button>
              </div>
              {tokenError ? (
                <p role="alert" className="text-sm text-bad">
                  {tokenError}
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Список отзывов */}
      {reviewsQuery.isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-card" />
          ))}
        </div>
      ) : reviewsQuery.error ? (
        <ErrorState error={reviewsQuery.error} onRetry={() => reviewsQuery.refetch()} />
      ) : reviews.length === 0 ? (
        <EmptyState
          icon={<Star className="h-12 w-12 text-content-muted mx-auto mb-4" />}
          title="Отзывов пока нет"
          description="Станьте первым, кто оценит этот сервер."
        />
      ) : (
        <ul className="space-y-4">
          {reviews.map((r) => (
            <li key={r.id}>
              <ReviewRow
                review={r}
                onReport={() =>
                  setReportTarget({
                    type: "REVIEW",
                    id: r.id,
                    label: `отзыв от ${r.author?.displayName || r.author?.username || "игрока"}`,
                  })
                }
              />
            </li>
          ))}
        </ul>
      )}

      <ReportDialog target={reportTarget} onClose={() => setReportTarget(null)} />
    </div>
  );
}

function ReviewRow({ review, onReport }: { review: ServerReviewItem; onReport: () => void }) {
  const author = review.author;
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar src={author?.avatar} name={author?.displayName || author?.username || "Игрок"} size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-medium">
              {author?.username ? (
                <Link href={`/profile/${author.username}`} className="hover:text-accent">
                  {author.displayName || author.username}
                </Link>
              ) : (
                author?.displayName || "Игрок"
              )}
            </p>
            <p className="text-xs text-content-muted">{formatDateShort(review.createdAt)}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <Stars value={review.rating} />
            {review.verifiedInteraction ? (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok"
                title="Взаимодействие с сервером подтверждено токеном из игры"
              >
                <BadgeCheck className="h-3 w-3" />
                Подтверждённое взаимодействие
              </span>
            ) : null}
          </div>
        </div>
        {review.comment ? (
          <p className="mt-3 whitespace-pre-wrap text-sm text-content-secondary">{review.comment}</p>
        ) : null}
        <div className="mt-3 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onReport}>
            <Flag className="mr-1.5 h-4 w-4" />
            Пожаловаться
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================== Сообщество ============================== */

function CommunitySection({ slug, privacy }: { slug: string; privacy: ServerDetail["privacy"] }) {
  const membersQuery = useQuery({
    queryKey: ["server-community-members", slug],
    queryFn: () => fetchServerCommunityMembers(slug),
    enabled: privacy.showCommunity,
  });

  const threadsQuery = useQuery({
    queryKey: ["server-community-threads", slug],
    queryFn: () => fetchServerCommunityThreads(slug, 1),
    enabled: privacy.showCommunity,
  });

  if (!privacy.showCommunity) {
    return (
      <EmptyState
        icon={<Users className="h-12 w-12 text-content-muted mx-auto mb-4" />}
        title="Сообщество скрыто"
        description="Владелец сервера отключил публичный раздел сообщества."
      />
    );
  }

  const members = membersQuery.data?.data ?? [];
  const threads = threadsQuery.data?.data ?? [];

  return (
    <div className="space-y-8">
      <Card>
        <CardHeader>
          <CardTitle>Участники</CardTitle>
          <CardDescription>
            {membersQuery.data
              ? `${membersQuery.data.followerCount.toLocaleString("ru-RU")} подписчиков · ${members.length} в сообществе`
              : "Подписчики сервера"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {membersQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : membersQuery.error ? (
            <ErrorState error={membersQuery.error} onRetry={() => membersQuery.refetch()} />
          ) : members.length === 0 ? (
            <EmptyState
              icon={<Users className="h-10 w-10 text-content-muted mx-auto mb-3" />}
              title="В сообществе пока никого нет"
              description="Подпишитесь на сервер, чтобы появиться здесь."
            />
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {members.map((m) => (
                <li
                  key={m.userId}
                  className="flex items-center gap-3 rounded-card border border-line bg-surface-raised p-3"
                >
                  <Avatar src={m.avatar} name={m.displayName || m.username || "Игрок"} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.username ? (
                        <Link href={`/profile/${m.username}`} className="hover:text-accent">
                          {m.displayName || m.username}
                        </Link>
                      ) : (
                        m.displayName || "Игрок"
                      )}
                    </p>
                    <p className="text-xs text-content-muted">С {formatDateShort(m.joinedAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Обсуждения</CardTitle>
          <CardDescription>Темы форума, связанные с сервером.</CardDescription>
        </CardHeader>
        <CardContent>
          {threadsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : threadsQuery.error ? (
            <ErrorState error={threadsQuery.error} onRetry={() => threadsQuery.refetch()} />
          ) : threads.length === 0 ? (
            <EmptyState
              icon={<MessageSquare className="h-10 w-10 text-content-muted mx-auto mb-3" />}
              title="Обсуждений пока нет"
              description="Обсуждения новостей и обновлений появятся здесь."
            />
          ) : (
            <ul className="space-y-3">
              {threads.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/community/forum/thread/${t.id}`}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface-raised p-4 transition-colors hover:bg-surface-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{t.title}</span>
                      <span className="mt-0.5 block text-xs text-content-muted">
                        {t.replyCount} ответов
                        {t.lastPostAt ? ` · активность ${formatDateShort(t.lastPostAt)}` : ""}
                      </span>
                    </span>
                    <MessageSquare className="h-4 w-4 flex-shrink-0 text-content-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================== Жалобы ============================== */

function ReportDialog({
  target,
  onClose,
}: {
  target: { type: "REVIEW" | "SERVER"; id: string; label: string } | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Сброс при смене цели.
  useEffect(() => {
    setReason("");
    setDone(false);
    setError(null);
  }, [target?.type, target?.id]);

  const mut = useMutation({
    mutationFn: () => createReport(target!.type, target!.id, reason.trim()),
    onSuccess: () => setDone(true),
    onError: (err) => setError(getErrorMessage(err, "Не удалось отправить жалобу")),
  });

  if (!target) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Жалоба"
        className="w-full max-w-md rounded-card border border-line bg-surface p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Жалоба</h2>
        {done ? (
          <>
            <p className="text-sm text-content-secondary">
              Жалоба отправлена. Модераторы рассмотрят её в ближайшее время. Спасибо!
            </p>
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={onClose}>
                Закрыть
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-content-secondary">
              Объект: {target.label}. Опишите причину — например, спам, оскорбления или вводящую в
              заблуждение информацию.
            </p>
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина жалобы"
              maxLength={1000}
              aria-label="Причина жалобы"
            />
            {error ? (
              <p role="alert" className="text-sm text-bad">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={mut.isPending}>
                Отмена
              </Button>
              <Button
                size="sm"
                onClick={() => mut.mutate()}
                disabled={mut.isPending || reason.trim().length < 3}
              >
                {mut.isPending ? "Отправляем..." : "Отправить"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
