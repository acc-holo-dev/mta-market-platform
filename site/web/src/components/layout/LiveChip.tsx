// PLAN-015 §14: компактный live-чип экосистемы в topbar.
// Только реальные агрегаты GET /activity (playersOnline/serversOnline);
// честное скрытие при ошибке — никаких выдуманных онлайнов (§14/§41).
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchActivity } from "@/lib/api-ext";

export function LiveChip({ compact = true }: { compact?: boolean }) {
  const { data, isError, isLoading } = useQuery({
    queryKey: ["activity", "live"],
    queryFn: fetchActivity,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
    select: (snap) => snap.live,
  });

  if (isLoading || isError || !data) return null;

  return (
    <span
      title={`Сейчас на платформе: ${data.playersOnline.toLocaleString("ru-RU")} игроков, ${data.serversOnline} серверов онлайн`}
      className="hidden items-center gap-2 rounded-pill border border-line bg-surface px-3 py-1.5 text-xs font-medium tabular-nums text-content-secondary md:inline-flex"
    >
      <span className="relative flex h-2 w-2">
        <span className="mta-anim-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
      </span>
      {data.playersOnline.toLocaleString("ru-RU")}
      {compact ? " онлайн" : " игроков онлайн"}
    </span>
  );
}
