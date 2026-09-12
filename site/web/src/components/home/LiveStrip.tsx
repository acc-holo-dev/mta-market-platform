// PLAN-015 §14: компактная live-полоса экосистемы на Home.
// Только реальные агрегаты GET /activity (B-002); честные zero/empty на
// холодном старте (J-001). Компактна, с местом под будущие тренды/график.
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchActivity, type ActivitySnapshot } from "@/lib/api-ext";
import { Skeleton } from "@/components/ui/Skeleton";
import { ArrowRight } from "lucide-react";

export const ACTIVITY_QUERY_KEY = ["activity", "snapshot"] as const;

function Metric({
  value,
  label,
  live,
}: {
  value: number;
  label: string;
  live?: boolean;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      {live ? (
        <span className="relative flex h-2 w-2 self-center">
          <span className="mta-anim-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
        </span>
      ) : null}
      {/* Значение и подпись — прямые текстовые узлы одного элемента:
          innerText матча = «N игроков онлайн» (контракт E2E plan006). */}
      <span className="text-sm text-content-secondary">
        <b className="text-base font-bold tabular-nums text-content">
          {value.toLocaleString("ru-RU")}
        </b>{" "}
        {label}
      </span>
    </span>
  );
}

export function LiveStrip({ snapshot }: { snapshot?: ActivitySnapshot }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ACTIVITY_QUERY_KEY,
    queryFn: fetchActivity,
    refetchInterval: 60_000,
    enabled: snapshot === undefined,
  });
  const snap = snapshot ?? data;

  if (!snapshot && isLoading) {
    return <Skeleton className="h-14 w-full rounded-card" />;
  }
  if (!snapshot && (isError || !snap)) {
    // Честное состояние: агрегаты недоступны — не рисуем цифры.
    return (
      <div className="flex items-center justify-between rounded-card border border-line bg-surface px-4 py-3 text-sm text-content-secondary">
        <span>Данные онлайна недоступны</span>
        <button type="button" onClick={() => refetch()} className="text-accent-strong hover:underline">
          Повторить
        </button>
      </div>
    );
  }
  if (!snap) return null;

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-card border border-line bg-surface px-4 py-3"
      title={`Обновлено: ${new Date(snap.live.computedAt).toLocaleTimeString("ru-RU")}`}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Metric value={snap.live.playersOnline} label="игроков онлайн" live />
        <Metric value={snap.live.serversOnline} label="серверов онлайн" />
      </div>
      <Link
        href="/servers?sort=players"
        className="inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline"
      >
        Все серверы
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}
