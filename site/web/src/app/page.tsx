// Homepage (PLAN-015 §12): Home = Discover-поверхность экосистемы.
// Последовательность: Sponsored/Featured → Live MTA → Популярное →
// Новые ресурсы → Новости + Обсуждения → Активность. Правый рельс:
// активные авторы + активность + вторичный плейсмент.
// Все данные реальные (§38/§41): /resources/homepage, /activity, /news, /community.
// Заголовки «Активность» и «Популярное» стабильны (Playwright E2E).
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  fetchActivity,
  fetchHomepage,
  fetchNewsFeed,
  fetchCommunityHub,
  mediaUrl,
  formatRub,
  type ActivitySnapshot,
  type Resource,
} from "@/lib/api-ext";
import { ResourceCard } from "@/components/ui/ResourceCard";
import { ResourceCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { LiveStrip, ACTIVITY_QUERY_KEY } from "@/components/home/LiveStrip";
import { ActivityFeed } from "@/components/home/ActivityFeed";
import { PopularSection } from "@/components/home/PopularSection";
import { PromotionHero, type PromotionItem } from "@/components/home/PromotionHero";
import { RightRail } from "@/components/home/RightRail";
import { ArrowRight, Newspaper, MessagesSquare, ShieldCheck, Store, Sparkles } from "lucide-react";

function buildPromotions(
  homepage: { newest: Resource[]; popular: Resource[]; free: Resource[] } | undefined,
  activity: ActivitySnapshot | undefined
): PromotionItem[] {
  const items: PromotionItem[] = [];
  const now = new Date();
  const in7d = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  // Featured server: самый populous онлайн-сервер из реального снапшота.
  const topServer = activity?.popular?.servers?.[0];
  if (topServer) {
    items.push({
      id: `server-${topServer.slug}`,
      kind: "server",
      placement: "home_hero",
      priority: 10,
      status: "active",
      startAt: now.toISOString(),
      endAt: in7d.toISOString(),
      creative: {
        eyebrow: "Рекомендуем сервер",
        title: topServer.name,
        description: "Живой онлайн прямо сейчас. Загляните на страницу сервера.",
        meta: [
          { label: "игроков сейчас", value: String(topServer.playerCount ?? 0) },
          { label: "слотов", value: String(topServer.maxPlayers ?? "?") },
        ],
        ctaLabel: "Открыть сервер",
        ctaHref: `/servers/${topServer.slug}`,
        coverUrl: topServer.logoUrl ?? null,
      },
    });
  }

  // Featured resource: самый популярный реальный ресурс.
  const topResource = homepage?.popular?.[0];
  if (topResource) {
    items.push({
      id: `resource-${topResource.slug}`,
      kind: "resource",
      placement: "home_hero",
      priority: 20,
      status: "active",
      startAt: now.toISOString(),
      endAt: in7d.toISOString(),
      creative: {
        eyebrow: topResource.price === 0 ? "Бесплатный ресурс" : "Популярный ресурс",
        title: topResource.title,
        description: topResource.description?.slice(0, 140),
        meta: [
          { label: "цена", value: topResource.price === 0 ? "Бесплатно" : formatRub(topResource.price) },
          ...(topResource.rating != null ? [{ label: "рейтинг", value: topResource.rating.toFixed(1) }] : []),
        ],
        ctaLabel: "Открыть",
        ctaHref: `/resources/${topResource.slug}`,
        coverUrl: topResource.coverUrl ?? null,
      },
    });
  }

  // Secondary rail placement — второй популярный сервер (если есть).
  const railServer = activity?.popular?.servers?.[1] ?? activity?.popular?.servers?.[0];
  if (railServer) {
    items.push({
      id: `server-rail-${railServer.slug}`,
      kind: "server",
      placement: "home_rail_secondary",
      priority: 30,
      status: "active",
      creative: {
        eyebrow: "Рекомендуем сервер",
        title: railServer.name,
        meta: [{ label: "игроков сейчас", value: String(railServer.playerCount ?? 0) }],
        ctaLabel: "Открыть",
        ctaHref: `/servers/${railServer.slug}`,
        coverUrl: railServer.logoUrl ?? null,
      },
    });
  }

  return items;
}

export default function HomePage() {
  const homepageQuery = useQuery({
    queryKey: ["resources", "homepage"],
    queryFn: fetchHomepage,
  });
  const activityQuery = useQuery({
    queryKey: ACTIVITY_QUERY_KEY,
    queryFn: fetchActivity,
    refetchInterval: 60_000,
  });
  const newsQuery = useQuery({
    queryKey: ["news", "home"],
    queryFn: () => fetchNewsFeed("all", 1),
    staleTime: 120_000,
  });
  const communityQuery = useQuery({
    queryKey: ["community", "hub", "home"],
    queryFn: fetchCommunityHub,
    staleTime: 120_000,
  });

  const homepage = homepageQuery.data;
  const snapshot = activityQuery.data;
  const promotions = buildPromotions(homepage, snapshot);

  const sections: { title: string; description: string; items: Resource[]; href: string }[] = [
    {
      title: "Новинки",
      description: "Свежие публикации, прошедшие модерацию",
      items: homepage?.newest ?? [],
      href: "/resources?sort=newest",
    },
    {
      title: "Популярное у покупателей",
      description: "Ресурсы, которые реально покупают",
      items: homepage?.popular ?? [],
      href: "/resources?sort=popular",
    },
    {
      title: "Бесплатные ресурсы",
      description: "Качественные материалы без оплаты",
      items: homepage?.free ?? [],
      href: "/resources?price=free",
    },
  ];

  const marketEmpty =
    !homepageQuery.isLoading &&
    !homepageQuery.error &&
    (!homepage || (homepage.newest.length === 0 && homepage.popular.length === 0 && homepage.free.length === 0));

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      {/* Hero: «Что происходит в MTA прямо сейчас?» (§12) */}
      <section className="mta-hero-surface mb-6 rounded-card border border-line px-6 py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 rounded-pill bg-accent-soft px-3 py-1 text-xs font-semibold text-accent-strong ring-1 ring-inset ring-line-accent/30">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Сейчас в MTA
            </p>
            <h1 className="text-3xl font-extrabold leading-tight tracking-tight xl:text-4xl">
              Что происходит в MTA{" "}
              <span className="mta-brand-text-gradient">прямо сейчас?</span>
            </h1>
            <p className="mt-2 text-sm text-content-secondary">
              Ресурсы, серверы, услуги и сообщество MTA:SA — единая площадка с проверкой,
              лицензиями и DRM-защитой.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/resources">
                <Button size="md">Открыть маркет</Button>
              </Link>
              <Link href="/servers">
                <Button size="md" variant="outline">
                  Каталог серверов
                </Button>
              </Link>
            </div>
          </div>
          {/* Live MTA strip (§14) */}
          <div className="w-full max-w-md shrink-0 lg:w-[22rem]">
            <LiveStrip snapshot={snapshot} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-content-secondary">
              <span className="flex items-center gap-1.5 rounded-md border border-line bg-surface/60 px-2 py-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-verified" aria-hidden />
                Верификация
              </span>
              <span className="flex items-center gap-1.5 rounded-md border border-line bg-surface/60 px-2 py-1.5">
                <Store className="h-3.5 w-3.5 text-accent-strong" aria-hidden />
                Маркет
              </span>
              <span className="flex items-center gap-1.5 rounded-md border border-line bg-surface/60 px-2 py-1.5">
                <Sparkles className="h-3.5 w-3.5 text-accent-strong" aria-hidden />
                DRM-лицензии
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Sponsored / Featured placement (§13/§38) + правый рельс (§12) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-10">
          <PromotionHero items={promotions} placement="home_hero" />

          {/* Популярное (E2E heading) — реальные метрики (F-001.3) */}
          <section aria-labelledby="popular-heading">
            <div id="popular-heading" className="mb-4">
              <SectionHeader
                title="Популярное"
                description="Серверы с живым онлайном и обсуждения с реальной активностью"
              />
            </div>
            <PopularSection snapshot={snapshot} />
          </section>

          {/* Маркетплейс-секции (F-001.4) */}
          <section aria-label="Маркетплейс">
            {homepageQuery.isLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <ResourceCardSkeleton key={i} />
                ))}
              </div>
            ) : homepageQuery.error ? (
              <ErrorState error={homepageQuery.error} onRetry={() => homepageQuery.refetch()} />
            ) : marketEmpty ? (
              <div className="rounded-card border border-line bg-surface p-8 text-center">
                <h2 className="text-xl font-bold">Маркетплейс скоро наполнится</h2>
                <p className="mt-2 text-sm text-content-secondary">
                  Ресурсы появляются здесь сразу после прохождения модерации.
                </p>
                <Link href="/seller" className="mt-4 inline-block">
                  <Button variant="outline">
                    <Store className="mr-2 h-4 w-4" aria-hidden />
                    Стать продавцом
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-10">
                {sections
                  .filter((s) => s.items.length > 0)
                  .map((section) => (
                    <div key={section.title}>
                      <SectionHeader
                        title={section.title}
                        description={section.description}
                        action={
                          <Link
                            href={section.href}
                            className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-accent-strong hover:underline"
                          >
                            Смотреть всё
                            <ArrowRight className="h-4 w-4" aria-hidden />
                          </Link>
                        }
                      />
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {section.items.slice(0, 4).map((r) => (
                          <ResourceCard key={r.id} resource={r} />
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </section>

          {/* Новости + Обсуждения (F-001.5) */}
          <section aria-label="Новости и обсуждения" className="grid gap-4 xl:grid-cols-2">
            <div className="rounded-card border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
                  <Newspaper className="h-3.5 w-3.5" aria-hidden />
                  Новости серверов
                </h3>
                <Link href="/news" className="text-sm font-medium text-accent-strong hover:underline">
                  Все
                </Link>
              </div>
              <ul className="space-y-2">
                {(newsQuery.data?.data ?? []).slice(0, 4).map((n) => (
                  <li key={`${n.kind}-${n.id}`}>
                    <Link
                      href={n.server ? `/servers/${n.server.slug}/news/${n.id}` : `/news`}
                      className="flex items-center gap-3 rounded-md px-2 py-2 transition-colors duration-fast hover:bg-surface-hover"
                    >
                      {n.coverUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={mediaUrl(n.coverUrl) ?? ""}
                          alt=""
                          className="h-9 w-14 flex-shrink-0 rounded object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex h-9 w-14 flex-shrink-0 items-center justify-center rounded bg-surface-inset text-content-muted">
                          <Newspaper className="h-4 w-4" aria-hidden />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-content">{n.title}</span>
                        <span className="text-xs text-content-muted">
                          {n.server?.name ?? "Платформа"} ·{" "}
                          {new Date(n.publishedAt).toLocaleDateString("ru-RU")}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
                {newsQuery.isLoading ? <Skeleton className="h-20 w-full" /> : null}
              </ul>
            </div>
            <div className="rounded-card border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
                  <MessagesSquare className="h-3.5 w-3.5" aria-hidden />
                  Обсуждения
                </h3>
                <Link href="/community" className="text-sm font-medium text-accent-strong hover:underline">
                  Всё сообщество
                </Link>
              </div>
              <ul className="space-y-1">
                {(communityQuery.data?.latest ?? []).slice(0, 5).map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/community/forum/thread/${t.id}`}
                      className="flex items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors duration-fast hover:bg-surface-hover"
                    >
                      <span className="min-w-0 truncate text-sm text-content">{t.title}</span>
                      <span className="flex-shrink-0 text-xs tabular-nums text-content-muted">
                        {t.replyCount} ответов
                      </span>
                    </Link>
                  </li>
                ))}
                {communityQuery.isLoading ? <Skeleton className="h-20 w-full" /> : null}
              </ul>
            </div>
          </section>

          {/* Активность (E2E heading, F-001.2) */}
          <section aria-labelledby="activity-heading">
            <div id="activity-heading">
              <SectionHeader
                title="Активность"
                description="Обновления серверов, релизы, обсуждения и отзывы за последние дни"
              />
            </div>
            <ActivityFeed snapshot={snapshot} />
          </section>
        </div>

        {/* Правый рельс (§12): плейсмент + авторы + активность */}
        <RightRail snapshot={snapshot} snapshotLoading={activityQuery.isLoading} promotions={promotions} />
      </div>
    </div>
  );
}
