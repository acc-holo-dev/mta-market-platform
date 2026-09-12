// PLAN-017 §36: очередь модерации — перенесено из app/admin/page.tsx
// (behavior preserved; api-ext импорты заменены на façade lib/api/admin).
// Ключи react-query сохранены: ["admin-resources", status], ["admin-resource-detail", id],
// ["moderation-events", id], инвалидации ["admin-stats"].
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import {
  adminSetResourceStatus,
  fetchAdminResources,
  formatRub,
  getErrorMessage,
} from "@/lib/api/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ResourceCover } from "@/components/ui/ResourceCover";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";
import { typeLabel, formatDate } from "@/lib/domain";
import { ModerationProductView } from "./ModerationProductView";
import { ModerationEvents } from "./ModerationEvents";

export function ModerationSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [eventsFor, setEventsFor] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-resources", "PENDING_REVIEW"],
    queryFn: () => fetchAdminResources("PENDING_REVIEW", 1),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason?: string }) =>
      adminSetResourceStatus(id, status, reason),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-resources"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["moderation-events"] });
      setDetailFor(null);
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось изменить статус")),
  });

  const list = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Очередь модерации</CardTitle>
        <CardDescription>Полная продуктовая карточка каждого ресурса</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка очереди..." />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Очередь пуста."
            description="Все отправленные ресурсы обработаны"
          />
        ) : (
          list.map((r) => (
            <div
              key={r.id}
              className="p-4 rounded-card border border-line bg-surface-raised space-y-3 transition-colors duration-fast hover:border-line-strong"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  {/* M-001/M-002: модератор видит тот же product view, что и покупатель */}
                  <div className="w-28 flex-shrink-0">
                    <ResourceCover
                      coverUrl={r.coverUrl}
                      type={r.type}
                      title={r.title}
                      className="aspect-video rounded-md border border-line"
                    />
                  </div>
                  <div>
                    <p className="font-medium">{r.title}</p>
                    <p className="text-sm text-content-secondary">
                      {typeLabel(r.type)} · /{r.slug} ·{" "}
                      {r.price === 0 ? "бесплатно" : formatRub(r.price)} · отправлен{" "}
                      {formatDate(r.createdAt)}
                    </p>
                    {r.seller?.displayName || r.seller?.username ? (
                      <p className="text-xs text-content-muted">
                        Продавец: {r.seller?.displayName || r.seller?.username}
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm text-content-secondary line-clamp-2 max-w-xl">
                      {r.description}
                    </p>
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button size="sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ id: r.id, status: "PUBLISHED" })}>
                  Опубликовать
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate({
                      id: r.id,
                      status: "SUSPENDED",
                      reason: reasons[r.id] || "Отклонено модератором",
                    })
                  }
                >
                  Отклонить
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDetailFor(detailFor === r.id ? null : r.id)}>
                  {detailFor === r.id ? "Скрыть товар" : "Проверить товар"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEventsFor(eventsFor === r.id ? null : r.id)}>
                  История модерации
                </Button>
              </div>

              <Input
                value={reasons[r.id] ?? ""}
                onChange={(e) => setReasons((m) => ({ ...m, [r.id]: e.target.value }))}
                placeholder="Причина (для отклонения)"
                aria-label={`Причина отклонения для ${r.title}`}
              />

              {detailFor === r.id ? <ModerationProductView resourceId={r.id} /> : null}
              {eventsFor === r.id ? <ModerationEvents resourceId={r.id} /> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}