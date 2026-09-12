// Жалобы — перенесено из app/admin/page.tsx (PLAN-017 §36).
// Ключ ["admin-reports", status] сохранён.
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import {
  adminResolveReport,
  fetchAdminReports,
  getErrorMessage,
  type AdminReport,
} from "@/lib/api/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Input";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";
import { AdminChip } from "@/components/admin/chips";
import { REPORT_TARGET_LABELS } from "@/components/admin/labels";
import { formatDate } from "@/lib/domain";

export function ReportsSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("OPEN");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["admin-reports", status],
    queryFn: () => fetchAdminReports(status),
  });

  const resolve = useMutation({
    mutationFn: ({
      id,
      decision,
      resolution,
    }: {
      id: string;
      decision: "RESOLVED" | "DISMISSED";
      resolution?: string;
    }) => adminResolveReport(id, decision, resolution),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось обработать жалобу")),
  });

  const list: AdminReport[] = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flag className="h-5 w-5 text-accent" /> Жалобы
        </CardTitle>
        <CardDescription>Очередь обращений пользователей</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус жалоб">
            <option value="OPEN">Открытые</option>
            <option value="RESOLVED">Меры приняты</option>
            <option value="DISMISSED">Отклонённые</option>
            <option value="ALL">Все</option>
          </Select>
        </div>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка жалоб..." />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Flag className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Жалоб нет"
            description="Новые обращения пользователей появятся здесь"
          />
        ) : (
          list.map((r) => (
            <div
              key={r.id}
              className="p-4 rounded-card border border-line bg-surface-raised space-y-3 transition-colors duration-fast hover:border-line-strong"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminChip tone="muted">{REPORT_TARGET_LABELS[r.targetType] ?? r.targetType}</AdminChip>
                    <span className="text-xs text-content-muted">
                      Статус:{" "}
                      {r.status === "OPEN"
                        ? "открыта"
                        : r.status === "RESOLVED"
                          ? "меры приняты"
                          : "отклонена"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-content-muted">{r.targetId}</p>
                  <p className="mt-1 text-sm text-content-secondary">{r.reason}</p>
                  <p className="mt-1 text-xs text-content-muted">
                    Автор: {r.reporter?.displayName || r.reporter?.username || "—"} ·{" "}
                    {formatDate(r.createdAt)}
                  </p>
                  {r.resolution ? (
                    <p className="mt-1 text-xs text-content-secondary">Решение: {r.resolution}</p>
                  ) : null}
                </div>
              </div>
              {r.status === "OPEN" ? (
                <>
                  <Textarea
                    value={resolutions[r.id] ?? ""}
                    onChange={(e) => setResolutions((m) => ({ ...m, [r.id]: e.target.value }))}
                    placeholder="Решение (необязательно)"
                    aria-label={`Решение по жалобе ${r.id}`}
                    rows={2}
                  />
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({
                          id: r.id,
                          decision: "RESOLVED",
                          resolution: resolutions[r.id] || undefined,
                        })
                      }
                    >
                      Меры приняты
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({
                          id: r.id,
                          decision: "DISMISSED",
                          resolution: resolutions[r.id] || undefined,
                        })
                      }
                    >
                      Отклонить
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}