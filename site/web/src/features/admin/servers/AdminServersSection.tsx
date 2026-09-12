// Серверы — перенесено из app/admin/page.tsx (PLAN-017 §36).
// Ключи ["admin-servers", lifecycle] и ["admin-server-detail", id] сохранены.
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Server } from "lucide-react";
import {
  adminServerLifecycle,
  adminServerVerification,
  fetchAdminServers,
  getErrorMessage,
  type AdminServerRow,
} from "@/lib/api/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";
import { LifecycleChip, MonitoringChip, VerificationChip } from "@/components/admin/chips";
import { LIFECYCLE_LABELS, SERVER_LIFECYCLE_FILTERS } from "@/components/admin/labels";
import { formatDate } from "@/lib/domain";
import { AdminServerDetailPanel } from "./AdminServerDetailPanel";

export function AdminServersSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState("all");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-servers", lifecycle],
    queryFn: () => fetchAdminServers(lifecycle === "all" ? undefined : lifecycle),
  });

  const lifecycleMutation = useMutation({
    mutationFn: ({ id, next, reason }: { id: string; next: string; reason?: string }) =>
      adminServerLifecycle(id, next, reason),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-servers"] });
      qc.invalidateQueries({ queryKey: ["admin-server-detail"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось изменить состояние сервера")),
  });

  const verificationMutation = useMutation({
    mutationFn: ({ id, verification, note }: { id: string; verification: string; note?: string }) =>
      adminServerVerification(id, verification, note),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-servers"] });
      qc.invalidateQueries({ queryKey: ["admin-server-detail"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось изменить верификацию сервера")),
  });

  const list: AdminServerRow[] = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5 text-accent" /> Серверы
        </CardTitle>
        <CardDescription>Проверка верификации и модерация жизненного цикла</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs">
          <Select
            value={lifecycle}
            onChange={(e) => setLifecycle(e.target.value)}
            aria-label="Фильтр жизненного цикла сервера"
          >
            {SERVER_LIFECYCLE_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {value === "all" ? label : LIFECYCLE_LABELS[value] ?? value}
              </option>
            ))}
          </Select>
        </div>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка серверов..." />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Server className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Серверов нет"
            description="Зарегистрированные серверы появятся здесь"
          />
        ) : (
          list.map((s) => (
            <div
              key={s.id}
              className="p-4 rounded-card border border-line bg-surface-raised space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/servers/${s.slug}`} className="font-medium hover:text-accent-strong">
                    {s.name}
                  </Link>
                  <p className="text-xs text-content-muted">
                    Владелец: {s.owner?.displayName || s.owner?.username || s.ownerId}
                  </p>
                  <p className="text-[11px] font-mono text-content-muted/70">{s.id}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <LifecycleChip lifecycle={s.lifecycle} />
                  <VerificationChip verification={s.verification} />
                  <MonitoringChip state={s.monitoring} />
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-secondary">
                <span>
                  Игроки:{" "}
                  {s.playerCount != null
                    ? `${s.playerCount}${s.maxPlayers != null ? `/${s.maxPlayers}` : ""}`
                    : "—"}
                </span>
                <span>Подписчиков: {s.followerCount ?? 0}</span>
                <span>Проверен: {s.verifiedAt ? formatDate(s.verifiedAt) : "—"}</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetailFor(detailFor === s.id ? null : s.id)}
                >
                  {detailFor === s.id ? "Скрыть проверку" : "Проверить"}
                </Button>
              </div>
              <Input
                value={reasons[s.id] ?? ""}
                onChange={(e) => setReasons((m) => ({ ...m, [s.id]: e.target.value }))}
                placeholder="Причина / примечание (используется действиями ниже)"
                aria-label={`Причина для ${s.name}`}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  disabled={verificationMutation.isPending}
                  onClick={() =>
                    verificationMutation.mutate({
                      id: s.id,
                      verification: "VERIFIED",
                      note: reasons[s.id] || undefined,
                    })
                  }
                >
                  Подтвердить верификацию
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={verificationMutation.isPending}
                  onClick={() =>
                    verificationMutation.mutate({
                      id: s.id,
                      verification: "FAILED",
                      note: reasons[s.id] || "Проверка не пройдена",
                    })
                  }
                >
                  Отклонить верификацию
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={lifecycleMutation.isPending}
                  onClick={() =>
                    lifecycleMutation.mutate({
                      id: s.id,
                      next: "SUSPENDED",
                      reason: reasons[s.id] || undefined,
                    })
                  }
                >
                  Приостановить
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={lifecycleMutation.isPending}
                  onClick={() => lifecycleMutation.mutate({ id: s.id, next: "VERIFIED" })}
                >
                  Восстановить
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={lifecycleMutation.isPending}
                  onClick={() =>
                    lifecycleMutation.mutate({
                      id: s.id,
                      next: "ARCHIVED",
                      reason: reasons[s.id] || undefined,
                    })
                  }
                >
                  Архивировать
                </Button>
              </div>
              <p className="text-xs text-content-muted">действие фиксируется в журнале аудита</p>
              {detailFor === s.id ? <AdminServerDetailPanel serverId={s.id} /> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}