// PLAN-017 §36: compact stats strip kept above tabs on every admin tab
// (preserves the visual behavior of the former StatsCards row outside tabs).
// Ключ ["admin-stats"] сохранён — инвалидации продолжают работать.
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAdminStats } from "@/lib/api/admin";
import { Card, CardContent } from "@/components/ui/Card";

export function StatsStrip({ className = "" }: { className?: string }) {
  const { data } = useQuery({ queryKey: ["admin-stats"], queryFn: fetchAdminStats });

  const cards: { label: string; value: string | number; hint?: string; accent?: boolean }[] = [
    {
      label: "Пользователи",
      value: data?.users.total ?? "—",
      hint: data ? `активных: ${data.users.active}` : undefined,
    },
    {
      label: "Ресурсы",
      value: data?.resources.total ?? "—",
      hint: data ? `опубликовано: ${data.resources.published}` : undefined,
    },
    {
      label: "На модерации",
      value: data?.resources.pendingReview ?? "—",
      accent: true,
    },
    {
      label: "Отзывы",
      value: data?.reviews.total ?? "—",
      hint: data?.reviews.averageRating != null ? `средняя: ${data.reviews.averageRating.toFixed(1)}` : undefined,
    },
  ];

  return (
    <div className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${className}`}>
      {cards.map((c) => (
        <Card key={c.label} className={c.accent ? "border-accent/40 shadow-accent" : "shadow-card"}>
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">{c.label}</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold tabular-nums">{c.value}</span>
              {c.hint ? <span className="truncate text-xs text-content-muted">{c.hint}</span> : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}