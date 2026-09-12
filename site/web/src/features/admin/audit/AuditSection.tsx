// PLAN-017 §36: журнал аудита — GET /admin/audit-events.
// Фильтры (action, targetType, ip, requestId, дата от/до) + пагинация +
// раскрываемые before/after (JSON выводится как текст, безопасно).
// Колонки читаются defensively (поля маппятся по наличию).
"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, ScrollText } from "lucide-react";
import { fetchAdminAuditEvents } from "@/lib/api/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { AdminChip } from "@/components/admin/chips";
import { formatDateTime } from "@/components/admin/labels";
import { TablePager } from "@/features/admin/shared/TablePager";
import { useDebouncedValue } from "@/features/admin/shared/useDebouncedValue";
import { nestedLabel, pickString, prettyJson, type UnknownRow } from "@/features/admin/shared/fields";

const PAGE_LIMIT = 20;

function actorLabel(row: UnknownRow): string {
  const nested = nestedLabel(row, "actor") ?? nestedLabel(row, "actorInfo");
  if (nested) return nested;
  return pickString(row, ["actorId", "actor", "userId"]) ?? "—";
}

function targetLabel(row: UnknownRow): string {
  const type = pickString(row, ["targetType", "target"]);
  const id = pickString(row, ["targetId", "targetUUID"]);
  if (!type && !id) return "—";
  return [type, id ? id.slice(0, 8) : null].filter(Boolean).join(" · ");
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  if (value == null) return null;
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">{title}</p>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-surface-inset p-3 text-xs text-content-secondary">
        {prettyJson(value)}
      </pre>
    </div>
  );
}

export function AuditSection() {
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [ip, setIp] = useState("");
  const [requestId, setRequestId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const actionQ = useDebouncedValue(action.trim(), 350);
  const targetTypeQ = useDebouncedValue(targetType.trim(), 350);
  const ipQ = useDebouncedValue(ip.trim(), 350);
  const requestIdQ = useDebouncedValue(requestId.trim(), 350);

  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [actionQ, targetTypeQ, ipQ, requestIdQ, from, to]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [
      "admin",
      "audit",
      { action: actionQ, targetType: targetTypeQ, ip: ipQ, requestId: requestIdQ, from, to, page },
    ],
    queryFn: () =>
      fetchAdminAuditEvents({
        action: actionQ || undefined,
        targetType: targetTypeQ || undefined,
        ip: ipQ || undefined,
        requestId: requestIdQ || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        limit: PAGE_LIMIT,
      }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const events = data?.events ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-accent" aria-hidden /> Журнал аудита
        </CardTitle>
        <CardDescription>Действия администраторов и модераторов (before/after)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Действие (action)"
            aria-label="Фильтр: действие"
          />
          <Input
            value={targetType}
            onChange={(e) => setTargetType(e.target.value)}
            placeholder="Тип объекта"
            aria-label="Фильтр: тип объекта"
          />
          <Input
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            placeholder="IP"
            aria-label="Фильтр: IP"
          />
          <Input
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            placeholder="requestId"
            aria-label="Фильтр: requestId"
          />
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Дата с"
          />
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Дата по" />
        </div>

        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

        {isLoading ? (
          <LoadingSpinner label="Загрузка аудита..." />
        ) : events.length === 0 && !error ? (
          <EmptyState title="Событий нет" description="Записи аудита появятся здесь" />
        ) : (
          <div className="space-y-1.5 text-sm">
            {events.map((event, i) => {
              const key = `${data?.page ?? page}-${i}`;
              const isOpen = expanded === key;
              return (
                <div key={key} className="rounded-md border border-line">
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-1 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <AdminChip tone="muted">{pickString(event, ["action", "event", "type"]) ?? "—"}</AdminChip>
                        <span className="text-content-secondary">
                          <span className="text-content-muted">Актер:</span>{" "}
                          <span className="font-mono text-xs">{actorLabel(event)}</span>
                        </span>
                        <span className="text-content-secondary">
                          <span className="text-content-muted">Объект:</span>{" "}
                          {targetLabel(event)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-content-muted">
                        {formatDateTime(pickString(event, ["createdAt", "at", "ts", "timestamp"]))}
                        {pickString(event, ["ip", "ipAddress", "remoteIp"])
                          ? ` · IP ${pickString(event, ["ip", "ipAddress", "remoteIp"])}`
                          : ""}
                        {pickString(event, ["requestId"]) ? ` · req ${pickString(event, ["requestId"])}` : ""}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpanded(isOpen ? null : key)}
                      aria-expanded={isOpen}
                      className="px-2"
                    >
                      {isOpen ? (
                        <ChevronUp className="h-4 w-4" aria-hidden />
                      ) : (
                        <ChevronDown className="h-4 w-4" aria-hidden />
                      )}
                      Детали
                    </Button>
                  </div>
                  {isOpen ? (
                    <div className="grid gap-3 border-t border-line p-3 md:grid-cols-2">
                      <JsonBlock title="Before" value={event.before ?? event.meta ?? null} />
                      <JsonBlock title="After" value={event.after ?? null} />
                      {event.before == null && event.after == null && event.meta == null ? (
                        <p className="text-xs text-content-muted md:col-span-2">
                          Снимки before/after отсутствуют.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <TablePager
          page={data?.page ?? page}
          limit={data?.limit ?? PAGE_LIMIT}
          total={data?.total ?? 0}
          onPage={setPage}
          disabled={isFetching}
        />
      </CardContent>
    </Card>
  );
}