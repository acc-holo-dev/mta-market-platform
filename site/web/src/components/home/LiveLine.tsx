// PLAN-006 Workstream B/F: the LIVE line — a fast "что происходит сейчас"
// signal on Home (§4). Real aggregates only (B-002); honest zero/empty on
// cold start (§38/J-001). Not a monitor — no graphs here.
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchActivity } from "@/lib/api-ext";
import { Skeleton } from "@/components/ui/Skeleton";

function OnlineChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-medium">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
      </span>
      <span>
        {value.toLocaleString("ru-RU")} {label}
      </span>
    </span>
  );
}

export function LiveLine() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["activity", "live"],
    queryFn: fetchActivity,
    refetchInterval: 60_000,
    select: (snap) => snap.live,
  });

  if (isLoading) {
    return <Skeleton className="h-9 w-72 rounded-full" />;
  }
  if (isError || !data) {
    // J-001: honest empty state — no fabricated numbers.
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-content-secondary">
        Данные онлайн недоступны
      </span>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2" title={`Обновлено: ${new Date(data.computedAt).toLocaleTimeString("ru-RU")}`}>
      <OnlineChip label="игроков онлайн" value={data.playersOnline} />
      <OnlineChip label="серверов онлайн" value={data.serversOnline} />
    </div>
  );
}
