// Публичный профиль (PLAN-005 O/P): единая идентичность пользователя —
// бейджи, серверы, ресурсы и активность на форуме. Публичная страница:
// гости допускаются; приватные данные (email, покупки, баланс) сервер
// не отдаёт — /profiles/:username возвращает только публичную поверхность.
"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchProfile, mediaUrl } from "@/lib/api-ext";
import { ResourceCard } from "@/components/ui/ResourceCard";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";
import { Avatar } from "@/components/ui/Avatar";
import { VerificationBadge } from "@/components/servers/ServerCard";
import { formatDate, categoryLabel } from "@/lib/domain";
import { Server, ShieldCheck, Store, User, Users, MessageSquare, Package, FileText } from "lucide-react";

// P: бейджи отражают реальные, проверяемые условия (без инфляции).
const BADGE_META: Record<string, { label: string; icon: typeof Server }> = {
  SERVER_OWNER: { label: "Server Owner", icon: Server },
  VERIFIED_SERVER: { label: "Verified Server", icon: ShieldCheck },
  VERIFIED_SELLER: { label: "Verified Seller", icon: Store },
};

/** Точка мониторинга в стиле MonitoringPill: ONLINE — зелёная, OFFLINE — красная, UNKNOWN — серая. */
function MonitoringDot({ state }: { state: string }) {
  const cls =
    state === "ONLINE" ? "bg-ok" : state === "OFFLINE" ? "bg-bad" : "bg-line-strong";
  const label = state === "ONLINE" ? "Онлайн" : state === "OFFLINE" ? "Оффлайн" : "Нет данных";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium text-content-secondary"
      title={label}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cls}`} aria-hidden />
      {label}
    </span>
  );
}

export default function PublicProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = use(params);
  const decoded = decodeURIComponent(username);

  const { data, isLoading, error } = useQuery({
    queryKey: ["profile", decoded],
    queryFn: () => fetchProfile(decoded),
    retry: false,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {/* Хлебные крошки */}
      <nav aria-label="Хлебные крошки" className="mb-8 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">{data?.profile.displayName ?? decoded}</span>
      </nav>

      {isLoading ? (
        <LoadingSpinner label="Загрузка профиля..." />
      ) : error || !data ? (
        <EmptyState
          className="py-20"
          icon={<User className="h-12 w-12 text-content-muted mx-auto mb-4" />}
          title="Профиль не найден"
          description="Пользователь не существует, скрыт или больше не активен."
        />
      ) : (
        <>
          {/* O: профильная карточка-шапка */}
          <header className="rounded-card border border-line bg-gradient-to-br from-accent-soft via-surface-raised to-surface p-6 md:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-5">
              <Avatar
                src={data.profile.avatar}
                name={data.profile.displayName || data.profile.username}
                size="lg"
                className="h-20 w-20 text-2xl"
              />
              <div className="min-w-0">
                <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                  {data.profile.displayName}
                </h1>
                <p className="text-sm text-content-secondary">@{data.profile.username}</p>
                <p className="mt-1 text-xs text-content-muted">
                  На MTA Market с {formatDate(data.profile.memberSince)}
                </p>
                {data.badges.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {data.badges
                      .filter((b) => BADGE_META[b] != null)
                      .map((b) => {
                        const meta = BADGE_META[b];
                        const Icon = meta.icon;
                        return (
                          <span
                            key={b}
                            className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok"
                            title={meta.label}
                          >
                            <Icon className="h-3 w-3" />
                            {meta.label}
                          </span>
                        );
                      })}
                  </div>
                ) : null}
              </div>
            </div>
          </header>

          {/* P: публичные серверы владельца (только VERIFIED/ACTIVE) */}
          <section className="mt-10">
            <h2 className="text-lg font-semibold mb-5">Серверы</h2>
            {data.servers.length === 0 ? (
              <div className="rounded-card border border-dashed border-line p-10 text-center">
                <Server className="h-10 w-10 text-content-muted mx-auto mb-3" />
                <p className="font-medium">Серверов пока нет</p>
                <p className="mt-1 text-sm text-content-secondary">
                  Опубликованные серверы пользователя появятся здесь.
                </p>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {data.servers.map((s) => {
                  const banner = mediaUrl(s.bannerUrl);
                  const logo = mediaUrl(s.logoUrl);
                  return (
                    <Link
                      key={s.id}
                      href={`/servers/${s.slug}`}
                      className="group block overflow-hidden rounded-card border border-line bg-surface-raised transition-colors hover:border-line-strong"
                    >
                      <div className="relative h-24 w-full overflow-hidden bg-surface-hover">
                        {banner ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={banner} alt="" loading="lazy" className="h-full w-full object-cover" />
                        ) : (
                          <div className="h-full w-full bg-gradient-to-r from-surface-hover to-surface-raised" />
                        )}
                        {logo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={logo}
                            alt={s.name}
                            loading="lazy"
                            className="absolute bottom-2 left-3 h-12 w-12 rounded-xl border border-line object-cover bg-surface"
                          />
                        ) : (
                          <div className="absolute bottom-2 left-3 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface text-sm font-bold text-content-secondary">
                            {s.name.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="absolute right-2 top-2">
                          <MonitoringDot state={s.monitoring} />
                        </div>
                      </div>
                      <div className="p-4">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate font-semibold">{s.name}</h3>
                          <VerificationBadge verification={s.verification} />
                        </div>
                        <div className="mt-3 flex items-center gap-3 text-xs text-content-muted">
                          {s.playerCount != null ? (
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3.5 w-3.5" />
                              {s.playerCount}
                              {s.maxPlayers != null ? `/${s.maxPlayers}` : ""}
                            </span>
                          ) : null}
                          <span>{s.followerCount.toLocaleString("ru-RU")} подписчиков</span>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* P: публичные ресурсы маркетплейса */}
          <section className="mt-10">
            <h2 className="text-lg font-semibold mb-5">Ресурсы</h2>
            {data.resources.length === 0 ? (
              <div className="rounded-card border border-dashed border-line p-10 text-center">
                <Package className="h-10 w-10 text-content-muted mx-auto mb-3" />
                <p className="font-medium">Пока нет опубликованных ресурсов</p>
                <p className="mt-1 text-sm text-content-secondary">
                  Товары появятся здесь после прохождения модерации.
                </p>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {data.resources.map((r) => (
                  <ResourceCard key={r.id} resource={r} />
                ))}
              </div>
            )}
          </section>

          {/* PLAN-007 E-003: опубликованные статьи автора */}
          <section className="mt-10">
            <h2 className="text-lg font-semibold mb-5">Статьи</h2>
            {(data.articles?.length ?? 0) === 0 ? (
              <div className="rounded-card border border-dashed border-line p-8 text-center">
                <FileText className="h-8 w-8 text-content-muted mx-auto mb-3" />
                <p className="text-sm text-content-secondary">Опубликованных статей пока нет.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.articles!.map((a) => (
                  <Link
                    key={a.slug}
                    href={`/content/articles/${a.slug}`}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 hover:border-accent/40"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.title}</span>
                      <span className="block truncate text-xs text-content-secondary">{a.excerpt}</span>
                    </span>
                    <span className="flex-shrink-0 text-xs text-content-muted">{categoryLabel(a.category)}</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* P: публичная активность на форуме (только счётчики) */}
          <section className="mt-10">
            <h2 className="text-lg font-semibold mb-5">Активность</h2>
            <div className="grid max-w-lg gap-4 sm:grid-cols-2">
              <div className="p-4 rounded-card border border-line bg-surface-raised">
                <p className="flex items-center gap-2 text-sm text-content-secondary">
                  <MessageSquare className="h-4 w-4" />
                  Темы на форуме
                </p>
                <p className="mt-1 text-2xl font-bold">{data.forumActivity.threadCount}</p>
              </div>
              <div className="p-4 rounded-card border border-line bg-surface-raised">
                <p className="flex items-center gap-2 text-sm text-content-secondary">
                  <MessageSquare className="h-4 w-4" />
                  Сообщения
                </p>
                <p className="mt-1 text-2xl font-bold">{data.forumActivity.postCount}</p>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
