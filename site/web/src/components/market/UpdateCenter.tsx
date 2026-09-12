// PLAN-018 Wave-6 D-005 + A-005: блок «Лицензии и обновления» на /account.
// Update Center (GET /me/updates — постранично, ≤50) + «Мои транзакции»
// (GET /payments/transactions/mine, bounded 50, вкладки Платежи/Возвраты).
// Честные пустые состояния; никаких выдуманных действий: «Обновить» ведёт на
// страницу ресурса, «Changelog» раскрывает опубликованные версии (cursor API).
"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  fetchMyUpdates,
  fetchChangelog,
  fetchTransactionsMine,
  type UpdateCenterRow,
} from "@/lib/api/resources";
import { formatRub, getErrorMessage, type Pagination } from "@/lib/api-ext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { ChevronDown, ChevronUp, Download, RefreshCw, ReceiptText, Undo2 } from "lucide-react";
import { formatDate } from "@/lib/domain";
import { cn } from "@/lib/utils";

// namespaced keys (замороженный lib/queries.ts — инлайн-неймспейсы Wave-6)
export const updatesKey = (page: number) => ["updates", "center", page] as const;
export const changelogKey = (resourceId: string) => ["updates", "changelog", resourceId] as const;
export const transactionsMineKey = () => ["payments", "transactions", "mine"] as const;

/** Семантический chip статуса платежа/возврата (StatusBadge не знает этих enum'ов). */
function MoneyStatusChip({ status }: { status: string | null | undefined }) {
  const meta: Record<string, { label: string; cls: string }> = {
    // Payment statuses
    SUCCEEDED: { label: "Успешно", cls: "bg-ok-soft text-ok" },
    PENDING: { label: "Ожидает", cls: "bg-warn-soft text-warn" },
    FAILED: { label: "Неуспешно", cls: "bg-bad-soft text-bad" },
    CANCELED: { label: "Отменён", cls: "bg-surface-hover text-content-muted" },
    // Refund statuses
    PROCESSED: { label: "Выполнен", cls: "bg-ok-soft text-ok" },
    REJECTED: { label: "Отклонён", cls: "bg-bad-soft text-bad" },
  };
  if (!status) {
    return <span className="text-xs text-content-muted">—</span>;
  }
  const m = meta[status] ?? { label: status, cls: "bg-surface-hover text-content-secondary" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium border border-line",
        m.cls
      )}
    >
      {m.label}
    </span>
  );
}

/** Chip совместимости (VERIFIED/PARTIAL/UNKNOWN/FAILED/null). */
function CompatChip({ result }: { result: string | null | undefined }) {
  if (!result) {
    return <span className="text-xs text-content-muted">нет данных</span>;
  }
  const meta: Record<string, { label: string; cls: string }> = {
    VERIFIED: { label: "Совместим", cls: "bg-ok-soft text-ok" },
    PARTIAL: { label: "Частично", cls: "bg-warn-soft text-warn" },
    UNKNOWN: { label: "Нет данных", cls: "bg-surface-hover text-content-secondary" },
    FAILED: { label: "Несовместим", cls: "bg-bad-soft text-bad" },
  };
  const m = meta[result] ?? { label: result, cls: "bg-surface-hover text-content-secondary" };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium border border-line",
        m.cls
      )}
    >
      {m.label}
    </span>
  );
}

/** Раскрывающийся changelog одной лицензии (cursor-пагинация nextCursor). */
function ChangelogCell({ resourceId }: { resourceId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: changelogKey(resourceId),
    queryFn: () => fetchChangelog(resourceId),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-content-secondary transition-colors duration-fast hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden />}
        Changelog
      </button>
      {open ? (
        <div className="rounded-md border border-line bg-surface-inset p-3">
          {isLoading ? (
            <p className="text-xs text-content-muted">Загрузка версий…</p>
          ) : error ? (
            <p className="text-xs text-bad" role="alert">
              {getErrorMessage(error, "Не удалось загрузить changelog")}
            </p>
          ) : (data?.data?.length ?? 0) === 0 ? (
            <p className="text-xs text-content-muted">Опубликованных версий пока нет.</p>
          ) : (
            <ol className="space-y-2">
              {data!.data.map((v) => (
                <li key={v.id} className="text-xs">
                  <span className="font-semibold tabular-nums">v{v.version}</span>
                  {v.channel ? (
                    <span className="ml-2 rounded-pill bg-surface-hover px-1.5 py-0.5 text-[10px] text-content-secondary">
                      {v.channel}
                    </span>
                  ) : null}
                  {v.publishedAt ? (
                    <span className="ml-2 text-content-muted">{formatDate(v.publishedAt)}</span>
                  ) : null}
                  {v.changelog ? (
                    <p className="mt-0.5 text-content-secondary whitespace-pre-line">{v.changelog}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}

function UpdateRow({ row }: { row: UpdateCenterRow }) {
  const canOpenResource = Boolean(row.slug);
  return (
    <div className="rounded-lg border border-line bg-surface p-4 space-y-2 transition-colors duration-fast hover:border-line-strong">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {canOpenResource ? (
            <Link
              href={`/resources/${row.slug}`}
              className="font-semibold transition-colors duration-fast hover:text-accent-strong"
            >
              {row.title ?? row.slug}
            </Link>
          ) : (
            <span className="font-semibold">{row.title ?? "Ресурс недоступен"}</span>
          )}
          {row.licenseStatus ? (
            <p className="text-xs text-content-muted">Лицензия: {row.licenseStatus}</p>
          ) : null}
        </div>
        {row.updateAvailable ? (
          <span className="inline-flex items-center gap-1 rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">
            <RefreshCw className="h-3 w-3" aria-hidden /> Обновление доступно
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-content-muted">Установлена</dt>
          <dd className="tabular-nums">{row.installedVersion ? `v${row.installedVersion}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-content-muted">Последняя</dt>
          <dd className="tabular-nums">{row.latestVersion ? `v${row.latestVersion}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-content-muted">Совместимость</dt>
          <dd>
            <CompatChip result={row.compatibility?.result} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-content-muted">Здоровье</dt>
          <dd className="tabular-nums">
            {typeof row.health?.score === "number" ? row.health.score.toFixed(0) : "—"}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-4">
        {row.actions?.canUpdate !== false && canOpenResource ? (
          <Link
            href={`/resources/${row.slug}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            <Download className="h-4 w-4" aria-hidden />
            Обновить
          </Link>
        ) : null}
        {row.resourceId ? <ChangelogCell resourceId={row.resourceId} /> : null}
      </div>
    </div>
  );
}

export function UpdateCenterSection() {
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: updatesKey(page),
    queryFn: () => fetchMyUpdates(page),
    staleTime: 30_000,
  });

  const pagination: Pagination | undefined = data?.pagination;
  const rows = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5 text-accent" aria-hidden /> Центр обновлений
        </CardTitle>
        <CardDescription>
          Установленные версии ваших лицензий и доступные обновления
          {pagination && pagination.total > 0
            ? ` · ${pagination.total} всего`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <LoadingSpinner label="Загрузка лицензий…" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Download className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Пока нет лицензий"
            description="Приобретённые ресурсы появятся здесь вместе с версиями и обновлениями."
            action={
              <Link href="/resources">
                <Button variant="primary" size="sm">
                  На Маркетплейс
                </Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="space-y-3">
              {rows.map((row) => (
                <UpdateRow key={row.purchaseId ?? row.resourceId ?? row.slug} row={row} />
              ))}
            </div>
            {pagination && pagination.pages > 1 ? (
              <div className="flex items-center justify-between text-sm">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Назад
                </Button>
                <span className="text-content-muted tabular-nums">
                  Стр. {pagination.page} из {pagination.pages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.pages || isFetching}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Вперёд
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type MoneyTab = "payments" | "refunds";

export function TransactionsSection() {
  const [tab, setTab] = useState<MoneyTab>("payments");
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: transactionsMineKey(),
    queryFn: fetchTransactionsMine,
    staleTime: 30_000,
  });

  const payments = data?.payments ?? [];
  const refunds = data?.refunds ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptText className="h-5 w-5 text-accent" aria-hidden /> Мои транзакции
        </CardTitle>
        <CardDescription>
          Последние 50 платежей и возвратов по вашим покупкам
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <LoadingSpinner label="Загрузка транзакций…" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : (
          <>
            <Tabs<MoneyTab>
              value={tab}
              onChange={setTab}
              tabs={[
                ["payments", `Платежи (${payments.length})`],
                ["refunds", `Возвраты (${refunds.length})`],
              ]}
            />
            {tab === "payments" ? (
              payments.length === 0 ? (
                <EmptyState
                  icon={<ReceiptText className="h-10 w-10 text-content-muted mx-auto mb-3" />}
                  title="Платежей пока нет"
                  description="Здесь появятся попытки оплаты ваших покупок."
                />
              ) : (
                <ul className="divide-y divide-line">
                  {payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <ReceiptText className="h-4 w-4 flex-shrink-0 text-content-muted" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate font-medium tabular-nums">
                            {formatRub(Number(p.amount ?? 0))}
                          </span>
                          <span className="block text-xs text-content-muted">
                            {p.provider ? `${p.provider} · ` : ""}
                            {p.createdAt ? formatDate(p.createdAt) : ""}
                            {p.succeededAt ? ` · подтверждён ${formatDate(p.succeededAt)}` : ""}
                          </span>
                        </span>
                      </span>
                      <MoneyStatusChip status={p.status ?? null} />
                    </li>
                  ))}
                </ul>
              )
            ) : refunds.length === 0 ? (
              <EmptyState
                icon={<Undo2 className="h-10 w-10 text-content-muted mx-auto mb-3" />}
                title="Возвратов нет"
                description="Если средства вернутся на баланс, это отразится здесь."
              />
            ) : (
              <ul className="divide-y divide-line">
                {refunds.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <Undo2 className="h-4 w-4 flex-shrink-0 text-content-muted" aria-hidden />
                      <span className="min-w-0">
                        <span className="block truncate font-medium tabular-nums">
                          {formatRub(Number(r.amount ?? 0))}
                        </span>
                        <span className="block text-xs text-content-muted">
                          {r.createdAt ? formatDate(r.createdAt) : ""}
                          {r.processedAt ? ` · обработан ${formatDate(r.processedAt)}` : ""}
                          {r.reason ? ` · ${r.reason}` : ""}
                        </span>
                      </span>
                    </span>
                    <MoneyStatusChip status={r.status ?? null} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
