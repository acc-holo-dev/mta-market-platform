// PLAN-017 §36: системные журналы — GET /admin/system-logs.
// Фильтры (level, service, requestId, route, errorCode, дата) + пагинация +
// раскрываемые meta (JSON выводится как текст). Поля читаются defensively.
"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Terminal } from "lucide-react";
import { fetchAdminSystemLogs } from "@/lib/api/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { LogLevelChip } from "@/components/admin/chips";
import { LOG_LEVEL_FILTERS, formatDateTime } from "@/components/admin/labels";
import { TablePager } from "@/features/admin/shared/TablePager";
import { useDebouncedValue } from "@/features/admin/shared/useDebouncedValue";
import { pickString, prettyJson, type UnknownRow } from "@/features/admin/shared/fields";

const PAGE_LIMIT = 20;

export function LogsSection() {
  const [level, setLevel] = useState("all");
  const [service, setService] = useState("");
  const [route, setRoute] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [requestId, setRequestId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);

  const serviceQ = useDebouncedValue(service.trim(), 350);
  const routeQ = useDebouncedValue(route.trim(), 350);
  const requestIdQ = useDebouncedValue(requestId.trim(), 350);
  const errorCodeQ = useDebouncedValue(errorCode.trim(), 350);

  useEffect(() => {
    setPage(1);
    setExpanded(null);
  }, [level, serviceQ, routeQ, errorCodeQ, requestIdQ, from, to]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: [
      "admin",
      "logs",
      { level, service: serviceQ, route: routeQ, errorCode: errorCodeQ, requestId: requestIdQ, from, to, page },
    ],
    queryFn: () =>
      fetchAdminSystemLogs({
        level: level === "all" ? undefined : level,
        service: serviceQ || undefined,
        route: routeQ || undefined,
        errorCode: errorCodeQ || undefined,
        requestId: requestIdQ || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        limit: PAGE_LIMIT,
      }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const logs = data?.logs ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-accent" aria-hidden /> Системные журналы
        </CardTitle>
        <CardDescription>Ошибки и события сервисов платформы</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 md:grid-cols-3 lg:grid-cols-6">
          <div>
            <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Уровень журнала">
              {LOG_LEVEL_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {value === "all" ? label : value}
                </option>
              ))}
            </Select>
          </div>
          <Input
            value={service}
            onChange={(e) => setService(e.target.value)}
            placeholder="Сервис"
            aria-label="Фильтр: сервис"
          />
          <Input
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            placeholder="Маршрут"
            aria-label="Фильтр: маршрут"
          />
          <Input
            value={errorCode}
            onChange={(e) => setErrorCode(e.target.value)}
            placeholder="Код ошибки"
            aria-label="Фильтр: код ошибки"
          />
          <Input
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            placeholder="requestId"
            aria-label="Фильтр: requestId"
          />
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Дата с" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Дата по" />
          </div>
        </div>

        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

        {isLoading ? (
          <LoadingSpinner label="Загрузка журналов..." />
        ) : logs.length === 0 && !error ? (
          <EmptyState title="Записей нет" description="Журналы появятся здесь" />
        ) : (
          <div className="space-y-1.5 text-sm">
            {logs.map((log, i) => {
              const key = `${data?.page ?? page}-${i}`;
              const isOpen = expanded === key;
              const levelValue = pickString(log, ["level", "severity"]) ?? "—";
              return (
                <div key={key} className="rounded-md border border-line">
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-1 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <LogLevelChip level={levelValue} />
                        <span className="text-content-secondary">
                          <span className="text-content-muted">Сервис:</span>{" "}
                          {pickString(log, ["service", "module"]) ?? "—"}
                        </span>
                        {pickString(log, ["route", "path"]) ? (
                          <span className="text-content-secondary">
                            <span className="text-content-muted">Маршрут:</span>{" "}
                            <span className="font-mono text-xs">{pickString(log, ["route", "path"])}</span>
                          </span>
                        ) : null}
                        {pickString(log, ["errorCode", "code"]) ? (
                          <span className="font-mono text-xs text-warn">
                            {pickString(log, ["errorCode", "code"])}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 break-words text-content-secondary">
                        {pickString(log, ["message", "msg", "text"]) ?? "—"}
                      </p>
                      <p className="mt-0.5 text-xs text-content-muted">
                        {formatDateTime(pickString(log, ["createdAt", "at", "ts", "timestamp"]))}
                        {pickString(log, ["requestId"]) ? ` · req ${pickString(log, ["requestId"])}` : ""}
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
                      Meta
                    </Button>
                  </div>
                  {isOpen ? (
                    <div className="border-t border-line p-3">
                      <MetaView log={log as UnknownRow} />
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

function MetaView({ log }: { log: UnknownRow }) {
  const meta = log.meta ?? log.details ?? log.context ?? null;
  if (meta != null) return <MetaBlock value={meta} />;
  // Нет выделенного meta — показываем остаток записи без служебных полей.
  const rest: UnknownRow = { ...log };
  for (const key of ["meta", "details", "context", "id", "level", "severity", "service", "module", "route", "path", "errorCode", "code", "message", "msg", "text", "requestId", "createdAt", "at", "ts", "timestamp"]) {
    delete rest[key];
  }
  if (Object.keys(rest).length === 0) {
    return <p className="text-xs text-content-muted">Метаданных нет.</p>;
  }
  return <MetaBlock value={rest} />;
}

function MetaBlock({ value }: { value: unknown }) {
  return (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Meta</p>
      <MetaPre value={value} />
    </>
  );
}

function MetaPre({ value }: { value: unknown }) {
  return (
    <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-line bg-surface-inset p-3 text-xs text-content-secondary">
      {prettyJson(value)}
    </pre>
  );
}