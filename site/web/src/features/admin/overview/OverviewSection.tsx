// PLAN-017 §36: дашборд обзора — GET /admin/overview.
// Метрики + системная строка (database ok/unavailable, uptime).
// Токены, компактная плотность (p-4), RU-подписи.
"use client";

import { useQuery } from "@tanstack/react-query";
import { Database, LayoutDashboard } from "lucide-react";
import { fetchAdminOverview, formatRub, type AdminOverview } from "@/lib/api/admin";
import { Card, CardContent } from "@/components/ui/Card";
import { LoadingSpinner, ErrorState } from "@/components/ui/States";
import { AdminChip } from "@/components/admin/chips";
import { formatUptime } from "@/components/admin/labels";

function dash(value: number | null | undefined): string | number {
  return value ?? "—";
}

function MetricCard({
  label,
  value,
  hint,
  accent = false,
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Card className={accent ? "border-accent/40 shadow-accent" : "shadow-card"}>
      <CardContent className="p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
          {icon}
          {label}
        </p>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        {hint ? <p className="mt-0.5 truncate text-xs text-content-muted">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function SystemRow({ system }: { system: AdminOverview["system"] | undefined }) {
  const ok = system?.database === "ok";
  return (
    <Card className="shadow-card">
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 text-sm">
        <span className="inline-flex items-center gap-2">
          <Database className="h-4 w-4 text-content-muted" aria-hidden />
          <span className="text-content-secondary">База данных:</span>
          <AdminChip tone={ok ? "ok" : "bad"}>{ok ? "ок" : "недоступна"}</AdminChip>
        </span>
        <span className="text-content-secondary">
          <span className="text-content-muted">Uptime:</span>{" "}
          <span className="tabular-nums">{formatUptime(system?.uptimeSeconds)}</span>
        </span>
      </CardContent>
    </Card>
  );
}

export function OverviewSection() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "overview"],
    queryFn: fetchAdminOverview,
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingSpinner label="Загрузка обзора..." />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard
          icon={<LayoutDashboard className="h-4 w-4" aria-hidden />}
          label="Пользователи"
          value={dash(data?.users.total)}
          hint={data ? `активных: ${data.users.active} · приостановлено: ${data.users.suspended}` : undefined}
        />
        <MetricCard
          label="Ресурсы"
          value={dash(data?.resources.total)}
          hint={data ? `опубликовано: ${data.resources.published}` : undefined}
        />
        <MetricCard label="На модерации" value={dash(data?.resources.pendingReview)} accent />
        <MetricCard
          label="Серверы"
          value={dash(data?.servers.total)}
          hint={data ? `верифицировано: ${data.servers.verified} · ожидают: ${data.servers.pending}` : undefined}
        />
        <MetricCard label="Жалобы (открытые)" value={dash(data?.reports.open)} />
        <MetricCard label="Споры (открытые)" value={dash(data?.disputes.open)} />
        <MetricCard label="Продажи 30д" value={dash(data?.sales.count30d)} />
        <MetricCard
          label="Выручка 30д"
          value={data?.sales.revenueMinor30d != null ? formatRub(data.sales.revenueMinor30d) : "—"}
        />
        <MetricCard label="Активные кампании" value={dash(data?.advertising.activeCampaigns)} />
        <MetricCard label="Премиум-энтайтлменты" value={dash(data?.premium.activeEntitlements)} />
      </div>
      <SystemRow system={data?.system} />
    </div>
  );
}