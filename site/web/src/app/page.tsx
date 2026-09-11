// Homepage (PLAN-006 F): Home = живой вход в экосистему — главный вопрос
// «Что происходит в MTA прямо сейчас?» (DAILY-EXPERIENCE §2/§49).
// Структура (F-001): «Сейчас в MTA» (live line) → «Активность» (high-value
// events) → «Популярное» (реальные метрики) → маркетплейс-секции PLAN-003
// (Новинки/Популярное/Бесплатные) — сохранены ниже (§3: marketplace остаётся
// частью daily experience, а не всей платформой). Всё доступно Guest (§29).
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchHomepage, type Resource } from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { ResourceCard } from "@/components/ui/ResourceCard";
import { ResourceCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { LiveLine } from "@/components/home/LiveLine";
import { ActivityFeed } from "@/components/home/ActivityFeed";
import { PopularSection } from "@/components/home/PopularSection";
import { ArrowRight, Search, ShieldCheck, Sparkles, Store } from "lucide-react";

export default function HomePage() {
  const router = useRouter();
  const [q, setQ] = useState("");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["resources", "homepage"],
    queryFn: fetchHomepage,
  });

  // J-001: секция New использует реальный createdAt (server-side ordering).
  const sections: {
    title: string;
    description: string;
    items: Resource[];
    href: string;
  }[] = [
    {
      title: "Новинки",
      description: "Свежие публикации, прошедшие модерацию",
      items: data?.newest ?? [],
      href: "/resources?sort=newest",
    },
    {
      title: "Популярное у покупателей",
      description: "Ресурсы, которые реально покупают",
      items: data?.popular ?? [],
      href: "/resources?sort=popular",
    },
    {
      title: "Бесплатные ресурсы",
      description: "Попробуйте качественные материалы без оплаты",
      items: data?.free ?? [],
      href: "/resources?price=free",
    },
  ];

  const isEmpty =
    !isLoading &&
    !error &&
    (!data || (data.newest.length === 0 && data.popular.length === 0 && data.free.length === 0));

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const query = q.trim();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  };

  return (
    <div>
      {/* Hero — «Сейчас в MTA» (F-002): live line prominent, discovery-first */}
      <section className="border-b border-line bg-gradient-to-b from-surface-raised to-background">
        <div className="mx-auto max-w-7xl px-4 py-14 md:py-20">
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-content-secondary">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            Сейчас в MTA
          </p>
          <h1 className="max-w-3xl text-4xl md:text-5xl font-bold leading-tight tracking-tight">
            Что происходит в MTA{" "}
            <span className="text-accent-strong">прямо сейчас?</span>
          </h1>
          <div className="mt-6">
            <LiveLine />
          </div>
          <form onSubmit={submitSearch} className="mt-8 flex max-w-xl gap-2" role="search">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Найти сервер, ресурс или обсуждение…"
              aria-label="Поиск по MTA Market"
              className="w-full rounded-card border border-line bg-surface px-4 py-3 text-sm outline-none placeholder:text-content-muted focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button type="submit" size="lg" aria-label="Искать">
              <Search className="h-5 w-5" />
            </Button>
          </form>
          <div className="mt-4 flex flex-col sm:flex-row gap-3">
            <Link href="/servers">
              <Button size="lg" variant="primary" className="w-full sm:w-auto">
                Серверы
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <Link href="/resources">
              <Button size="lg" variant="outline" className="w-full sm:w-auto">
                <Search className="mr-2 h-5 w-5" />
                Открыть Маркетплейс
              </Button>
            </Link>
          </div>

          <div className="mt-12 grid gap-4 sm:grid-cols-3 max-w-3xl">
            {[
              {
                icon: ShieldCheck,
                title: "Лицензия и DRM",
                text: "Покупка выдаёт лицензию, привязанную к вашему серверу",
              },
              {
                icon: Sparkles,
                title: "Модерация ресурсов",
                text: "Каждая публикация проверяется командой площадки",
              },
              {
                icon: Store,
                title: "Поддержка авторов",
                text: "Покупайте напрямую у разработчиков и оставляйте отзывы",
              },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-card border border-line bg-surface p-4">
                <Icon className="h-5 w-5 text-accent mb-2" />
                <p className="text-sm font-semibold">{title}</p>
                <p className="mt-1 text-xs text-content-secondary">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Активность (F-001.2): high-value events с deep links (§43) */}
      <section className="mx-auto max-w-7xl px-4 py-12">
        <SectionHeader
          title="Активность"
          description="Обновления серверов, релизы, обсуждения и отзывы за последние дни"
        />
        <ActivityFeed />
      </section>

      {/* Популярное (F-001.3): реальные метрики, без fake trending */}
      <section className="mx-auto max-w-7xl px-4 pb-4">
        <SectionHeader
          title="Популярное"
          description="Серверы с живым онлайном и обсуждения с реальной активностью"
        />
        <PopularSection />
      </section>

      {/* Маркетплейс (F-001.4): существующие секции PLAN-003 сохранены */}
      <section className="mx-auto max-w-7xl px-4 py-12 space-y-12">
        {isLoading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <ResourceCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : isEmpty ? (
          <div className="text-center py-16">
            <h2 className="text-2xl font-bold">Маркетплейс скоро наполнится</h2>
            <p className="mt-2 text-content-secondary max-w-xl mx-auto">
              Ресурсы появляются здесь сразу после прохождения модерации. Загляните позже или
              станьте первым продавцом.
            </p>
            <Link href="/seller" className="inline-block mt-6">
              <Button variant="outline">
                <Store className="mr-2 h-4 w-4" />
                Стать продавцом
              </Button>
            </Link>
          </div>
        ) : (
          sections
            .filter((s) => s.items.length > 0)
            .map((section) => (
              <div key={section.title}>
                <SectionHeader title={section.title} description={section.description} />
                <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                  {section.items.slice(0, 4).map((r) => (
                    <ResourceCard key={r.id} resource={r} />
                  ))}
                </div>
                <div className="mt-5">
                  <Link
                    href={section.href}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                  >
                    Смотреть всё
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              </div>
            ))
        )}
      </section>

      {/* Seller CTA (D-004): заметный, но не доминирующий */}
      <section className="border-t border-line bg-surface/40">
        <div className="mx-auto max-w-7xl px-4 py-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Вы разработчик ресурсов для MTA:SA?</h2>
            <p className="mt-1 text-sm text-content-secondary">
              Откройте магазин, публикуйте ресурсы и получайте продажи с защитой лицензий.
            </p>
          </div>
          <Link href="/seller" className="flex-shrink-0">
            <Button variant="outline">
              Стать продавцом
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>
    </div>
  );
}
