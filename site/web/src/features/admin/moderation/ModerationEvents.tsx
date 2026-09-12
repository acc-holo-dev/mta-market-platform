// История модерации ресурса — перенесено из app/admin/page.tsx (PLAN-017 §36).
// Ключ ["moderation-events", id] сохранён (инвалидация из статусов продолжает работать).
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchModerationEvents } from "@/lib/api/admin";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingSpinner } from "@/components/ui/States";
import { formatDate } from "@/lib/domain";

export function ModerationEvents({ resourceId }: { resourceId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["moderation-events", resourceId],
    queryFn: () => fetchModerationEvents(resourceId),
  });

  if (isLoading) return <LoadingSpinner label="Загрузка истории..." className="py-6" />;

  const list = (Array.isArray(data) ? data : ((data as { data?: unknown[] })?.data ?? [])) as {
    fromStatus?: string;
    toStatus?: string;
    reason?: string | null;
    createdAt?: string;
    actorId?: string;
  }[];

  return (
    <div className="p-3 rounded-md bg-surface text-sm">
      <p className="text-xs font-medium mb-2 text-content-secondary">События модерации</p>
      {list.length === 0 ? (
        <p className="text-xs text-content-muted">Событий нет.</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((ev, i) => (
            <li key={i} className="text-xs text-content-secondary">
              {ev.createdAt ? formatDate(ev.createdAt) : "—"}:{" "}
              <StatusBadge status={ev.toStatus ?? "UNKNOWN"} />{" "}
              {ev.reason ? <span className="text-content-muted">— {ev.reason}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}