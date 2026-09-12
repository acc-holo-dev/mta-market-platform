// Активные сессии (PLAN-019 L-003): список устройств/входов текущего
// пользователя с отзывом по одному и «отозвать все прочие». Токены никогда
// не показываются — только метаданные устройства.
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MonitorSmartphone, LogOut } from "lucide-react";
import {
  fetchSessions,
  revokeSession,
  revokeAllSessions,
} from "@/lib/api/identity";
import { getErrorMessage } from "@/lib/api-ext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { formatDateTime } from "@/components/admin/labels";

function deviceLabel(userAgent: string | null): string {
  if (!userAgent) return "Неизвестное устройство";
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\//.test(userAgent)) return "Opera";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Chrome\//.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return "Браузер";
}

export function SessionsCard() {
  const qc = useQueryClient();
  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
    staleTime: 30_000,
    retry: false,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["sessions"] });
  };

  const revokeOne = useMutation({
    mutationFn: (id: string) => revokeSession(id),
    onSuccess: invalidate,
  });
  const revokeAll = useMutation({
    mutationFn: revokeAllSessions,
    onSuccess: invalidate,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MonitorSmartphone className="h-4 w-4 text-content-muted" aria-hidden />
          Активные сессии
        </CardTitle>
        <CardDescription>
          Устройства, с которых выполнен вход в аккаунт. Отзыв сессии завершает
          её на этом устройстве.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sessionsQuery.isLoading ? (
          <LoadingSpinner label="Загрузка сессий…" />
        ) : sessionsQuery.isError ? (
          <ErrorState error={sessionsQuery.error} onRetry={() => void sessionsQuery.refetch()} />
        ) : !sessionsQuery.data || sessionsQuery.data.length === 0 ? (
          <EmptyState
            icon={<MonitorSmartphone className="h-10 w-10 text-content-muted mx-auto mb-3" />}
            title="Нет активных сессий"
            description="Активных сессий не найдено."
          />
        ) : (
          <div className="space-y-2">
            {sessionsQuery.data.map((session) => (
              <div
                key={session.id}
                className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface-inset px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-content">
                    {deviceLabel(session.userAgent)}
                    {session.current ? (
                      <span className="ml-2 rounded-pill bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent-strong">
                        текущая
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-content-muted">
                    Вход: {formatDateTime(session.createdAt)}
                    {session.ipAddress ? ` · IP: ${session.ipAddress}` : ""}
                  </p>
                </div>
                {!session.current ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => revokeOne.mutate(session.id)}
                    disabled={revokeOne.isPending}
                    aria-label="Завершить сессию"
                  >
                    Завершить
                  </Button>
                ) : null}
              </div>
            ))}
            {sessionsQuery.data.length > 1 ? (
              <div className="pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => revokeAll.mutate()}
                  disabled={revokeAll.isPending}
                >
                  <LogOut className="mr-1.5 h-4 w-4" aria-hidden />
                  Завершить все прочие сессии
                </Button>
              </div>
            ) : null}
            {revokeOne.isError ? (
              <p className="text-sm text-bad" role="alert">
                {getErrorMessage(revokeOne.error)}
              </p>
            ) : null}
            {revokeAll.isError ? (
              <p className="text-sm text-bad" role="alert">
                {getErrorMessage(revokeAll.error)}
              </p>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
