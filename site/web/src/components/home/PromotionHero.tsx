// PLAN-015 §13/§38: переиспользуемый promotional/featured компонент —
// placement-архитектура, а не хардкод одной рекламы.
//
// Контракт плейсмента (совместим с будущим рекламным доменом §38):
//   kind — тип контента (server/resource/news/event/campaign)
//   placement — слот (home_hero, home_rail_secondary, market_featured, …)
//   priority — порядок ротации (меньше = выше)
//   startAt/endAt — активное окно кампании (ISO); вне окна не показывается
//   status — показывается только active
//   creative — заголовок/описание/метрики/CTA/обложка
//
// Сейчас элементы выводятся из РЕАЛЬНЫХ данных платформы (популярный сервер,
// популярный ресурс, свежие события) с честной меткой «Рекомендуем».
// Метка «Sponsored» появится только с реальным рекламным доменом.
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Users, Package, Newspaper, CalendarDays, Sparkles } from "lucide-react";
import { mediaUrl } from "@/lib/api-ext";
import { cn } from "@/lib/utils";

export type PlacementSlot =
  | "home_hero"
  | "home_rail_secondary"
  | "market_featured"
  | "server_featured"
  | "community_event"
  | "search_promotion"
  | "creator_promotion";

export type PlacementKind = "server" | "resource" | "news" | "event" | "campaign";

export interface PromotionCreative {
  eyebrow: string;
  title: string;
  description?: string;
  meta?: { label: string; value: string }[];
  ctaLabel: string;
  ctaHref: string;
  coverUrl?: string | null;
}

export interface PromotionItem {
  id: string;
  kind: PlacementKind;
  placement: PlacementSlot;
  priority: number;
  status: "active" | "paused";
  startAt?: string;
  endAt?: string;
  creative: PromotionCreative;
}

const KIND_ICONS: Record<PlacementKind, typeof Users> = {
  server: Users,
  resource: Package,
  news: Newspaper,
  event: CalendarDays,
  campaign: Sparkles,
};

function isActiveNow(item: PromotionItem, now: number): boolean {
  if (item.status !== "active") return false;
  if (item.startAt && new Date(item.startAt).getTime() > now) return false;
  if (item.endAt && new Date(item.endAt).getTime() < now) return false;
  return true;
}

/** Выбор активных плейсментов слота по priority (§38: campaign/placement/priority/window). */
export function selectPlacements(
  items: PromotionItem[],
  placement: PlacementSlot,
  limit = 3
): PromotionItem[] {
  const now = Date.now();
  return items
    .filter((item) => item.placement === placement && isActiveNow(item, now))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, limit);
}

function Slide({ item, compact }: { item: PromotionItem; compact?: boolean }) {
  const cover = mediaUrl(item.creative.coverUrl ?? null);
  const Icon = KIND_ICONS[item.kind] ?? Sparkles;

  return (
    <div
      className={cn(
        "relative flex h-full flex-col justify-between gap-4 overflow-hidden rounded-card border border-line bg-surface-raised p-5 shadow-card",
        compact ? "min-h-[8.5rem]" : "min-h-[11rem]"
      )}
    >
      {cover ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cover}
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-20"
            loading="lazy"
          />
          <div
            className="absolute inset-0 bg-gradient-to-r from-surface-raised via-surface-raised/90 to-surface-raised/40"
            aria-hidden
          />
        </>
      ) : (
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(640px_220px_at_85%_-40px,hsl(var(--primary)/0.14),transparent_70%)]"
          aria-hidden
        />
      )}

      <div className="relative">
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-pill bg-accent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-strong ring-1 ring-inset ring-line-accent/30">
          <Icon className="h-3 w-3" aria-hidden />
          {item.creative.eyebrow}
        </p>
        <h3 className={cn("font-bold tracking-tight", compact ? "text-base" : "text-xl")}>
          {item.creative.title}
        </h3>
        {item.creative.description ? (
          <p className="mt-1 max-w-2xl text-sm text-content-secondary">{item.creative.description}</p>
        ) : null}
        {item.creative.meta?.length ? (
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1">
            {item.creative.meta.map((m) => (
              <span key={m.label} className="text-xs text-content-secondary">
                <span className="font-bold tabular-nums text-content">{m.value}</span> {m.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="relative">
        <Link
          href={item.creative.ctaHref}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors duration-fast hover:bg-accent-strong"
        >
          {item.creative.ctaLabel}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </div>
  );
}

export function PromotionHero({
  items,
  placement = "home_hero",
  compact = false,
}: {
  items: PromotionItem[];
  placement?: PlacementSlot;
  compact?: boolean;
}) {
  const active = useMemo(() => selectPlacements(items, placement), [items, placement]);
  const [index, setIndex] = useState(0);

  // Сдержанная ротация (§45): без авто-прокрутки при reduced motion.
  useEffect(() => {
    if (active.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % active.length), 8000);
    return () => clearInterval(timer);
  }, [active.length]);

  if (active.length === 0) return null;
  const current = active[Math.min(index, active.length - 1)];

  return (
    <section aria-label="Рекомендуемое">
      <div className="relative">
        <Slide item={current} compact={compact} />
        {active.length > 1 ? (
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
            {active.map((item, i) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Показать: ${item.creative.title}`}
                aria-pressed={i === index}
                onClick={() => setIndex(i)}
                className={cn(
                  "h-1.5 rounded-pill transition-all duration-fast",
                  i === index ? "w-5 bg-accent" : "w-1.5 bg-line-strong hover:bg-content-muted"
                )}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
