// Споры — перенесено из app/admin/page.tsx (PLAN-017 §36).
// Ключ ["admin-disputes"] сохранён; переписка — отдельный AdminDisputeMessages.
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gavel } from "lucide-react";
import {
  adminTransitionDispute,
  fetchAdminDisputes,
  getErrorMessage,
  type Dispute,
} from "@/lib/api/admin";
import { disputeTargetLabel } from "@/lib/disputeLabels";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";
import { AdminDisputeMessages } from "./AdminDisputeMessages";

const DISPUTE_TRANSITIONS: [string, string][] = [
  ["UNDER_REVIEW", "На рассмотрении"],
  ["RESOLVED_BUYER", "Решён в пользу покупателя"],
  ["RESOLVED_SELLER", "Решён в пользу продавца"],
  ["PARTIAL_REFUND", "Частичный возврат"],
  ["CLOSED", "Закрыт"],
];

export function DisputesSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-disputes"],
    queryFn: () => fetchAdminDisputes(),
  });

  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => adminTransitionDispute(id, status),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-disputes"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось изменить статус спора")),
  });

  const list: Dispute[] = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="h-5 w-5 text-accent" /> Споры
        </CardTitle>
        <CardDescription>Все споры и переходы статусов</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка споров..." />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Gavel className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Споров нет"
            description="Открытые споры покупателей появятся здесь"
          />
        ) : (
          list.map((d) => (
            <div
              key={d.id}
              className="p-4 rounded-card border border-line bg-surface-raised space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    Спор #{d.id.slice(0, 8)} · {disputeTargetLabel(d.targetType)}
                  </p>
                  <p className="text-xs text-content-muted">
                    {new Date(d.createdAt).toLocaleString("ru-RU")}
                  </p>
                  <p className="text-sm text-content-secondary mt-1">{d.reason}</p>
                </div>
                <StatusBadge status={d.status} />
              </div>
              <div className="flex gap-2 flex-wrap">
                {DISPUTE_TRANSITIONS.filter(([t]) => t !== d.status).map(([t, label]) => (
                  <Button
                    key={t}
                    variant="outline"
                    size="sm"
                    disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: d.id, status: t })}
                  >
                    {label}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={() => setOpen(open === d.id ? null : d.id)}>
                  Переписка
                </Button>
              </div>
              {open === d.id ? <AdminDisputeMessages disputeId={d.id} /> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}