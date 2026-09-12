// PLAN-018 L: Deal rooms — список сделок + создание (Wave-6 frontend).
// Роутер /deals на бэкенде сейчас может отдавать 404 { error: "Not found" }
// (флаг выключен / ручки ещё нет) — список честно деградирует: «модуль
// недоступен», без «сломанного» UI.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Handshake, Plus } from "lucide-react";
import {
  fetchDeals,
  createDeal,
  isFeatureDisabledError,
  type DealRole,
  type DealSummary,
} from "@/lib/api/finance";
import { getErrorMessage, formatRub } from "@/lib/api-ext";
import { formatDate } from "@/lib/domain";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { useFocusTrap, rememberTrigger, restoreTrigger } from "@/components/ui/focusTrap";

const DEAL_STATUS_LABELS: Record<string, string> = {
  CREATED: "Создана",
  FUNDED: "Оплачена",
  DELIVERING: "Доставка",
  DELIVERED: "Доставлена",
  ACCEPTED: "Принята",
  DISPUTED: "Оспорена",
  RESOLVED: "Решена",
  CLOSED: "Закрыта",
};

const STATUS_FILTERS: [string, string][] = [
  ["", "Все статусы"],
  ["CREATED", "Создана"],
  ["FUNDED", "Оплачена"],
  ["DELIVERING", "Доставка"],
  ["DELIVERED", "Доставлена"],
  ["ACCEPTED", "Принята"],
  ["DISPUTED", "Оспорена"],
  ["RESOLVED", "Решена"],
  ["CLOSED", "Закрыта"],
];

export default function DealsPage() {
  const [role, setRole] = useState<DealRole>("buyer");
  const [status, setStatus] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading, error: listError, refetch } = useQuery({
    queryKey: ["deals", "list", role, status],
    queryFn: () => fetchDeals({ role, ...(status ? { status } : {}) }),
    retry: false,
  });

  const deals: DealSummary[] = data?.deals ?? [];

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight">
            <Handshake className="h-7 w-7 text-accent" aria-hidden /> Сделки
          </h1>
          <p className="mt-1 text-sm text-content-secondary">
            Защищённые комнаты сделок: оплата, доставка, приёмка и споры в одном месте
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Создать сделку
        </Button>
      </div>

      {/* Фильтры: роль + статус */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Роль в сделках"
          className="flex flex-wrap gap-1 rounded-md border border-line p-1"
        >
          {(
            [
              ["buyer", "Мои покупки"],
              ["seller", "Мои продажи"],
            ] as [DealRole, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={role === value}
              onClick={() => setRole(value)}
              className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast ${
                role === value
                  ? "bg-accent text-on-accent"
                  : "text-content-secondary hover:bg-surface-hover hover:text-content"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Select
          aria-label="Статус сделки"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-fit"
        >
          {STATUS_FILTERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <LoadingSpinner label="Загрузка сделок..." />
      ) : listError ? (
        isFeatureDisabledError(listError) ? (
          <EmptyState
            icon={<Handshake className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Сделки временно недоступны"
            description="Модуль защищённых сделок ещё не включён на сервере. Зайдите позже — интерфейс уже готов."
          />
        ) : (
          <ErrorState error={listError} onRetry={() => refetch()} />
        )
      ) : deals.length === 0 ? (
        <EmptyState
          icon={<Handshake className="h-12 w-12 text-content-muted mx-auto mb-4" />}
          title={role === "buyer" ? "Сделок-покупок пока нет" : "Сделок-продаж пока нет"}
          description="Создайте сделку или договоритесь с контрагентом — комнату увидят оба участника"
          action={
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> Создать сделку
            </Button>
          }
        />
      ) : (
        <div className="space-y-4">
          {deals.map((deal) => (
            <Link key={deal.id} href={`/deals/${deal.id}`} className="block group">
              <Card className="transition-colors duration-fast group-hover:border-line-strong group-hover:shadow-raised">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <CardTitle className="text-base">
                        {deal.title ?? `Сделка #${deal.id.slice(0, 8)}`}
                      </CardTitle>
                      <CardDescription>
                        Контрагент:{" "}
                        {deal.counterparty?.displayName ??
                          deal.counterparty?.username ??
                          (deal.counterparty?.id
                            ? `#${deal.counterparty.id.slice(0, 8)}`
                            : "—")}
                        {deal.createdAt ? ` · ${formatDate(deal.createdAt)}` : ""}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold tabular-nums">
                        {formatRub(deal.amountMinor)}
                      </span>
                      <StatusBadge status={deal.status ?? ""}>
                        {DEAL_STATUS_LABELS[deal.status ?? ""] ?? deal.status ?? "—"}
                      </StatusBadge>
                    </div>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <CreateDealDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

// ---------- Создание сделки ----------

const SUBJECT_TYPES: [string, string][] = [
  ["", "Без привязки"],
  ["RESOURCE", "Ресурс"],
  ["SERVICE", "Услуга"],
];

function CreateDealDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [counterpartyId, setCounterpartyId] = useState("");
  const [subjectType, setSubjectType] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [title, setTitle] = useState("");
  const [amountRub, setAmountRub] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const amountMinor = (() => {
    const normalized = amountRub.trim().replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
    return Math.round(parseFloat(normalized) * 100);
  })();

  const valid =
    counterpartyId.trim().length > 0 &&
    title.trim().length > 0 &&
    amountMinor !== null &&
    amountMinor > 0;

  const mutation = useMutation({
    mutationFn: () =>
      createDeal({
        counterpartyId: counterpartyId.trim(),
        ...(subjectType ? { subjectType } : {}),
        ...(subjectType && subjectId.trim() ? { subjectId: subjectId.trim() } : {}),
        title: title.trim(),
        amountMinor: amountMinor as number,
      }),
    onSuccess: (room) => {
      setError(null);
      onClose();
      if (room.id) router.push(`/deals/${room.id}`);
    },
    onError: (e) => {
      setError(
        isFeatureDisabledError(e)
          ? "Модуль сделок ещё не включён на сервере — попробуйте позже"
          : getErrorMessage(e, "Не удалось создать сделку")
      );
    },
  });

  useEffect(() => {
    if (open) rememberTrigger(document.activeElement as HTMLElement | null);
  }, [open]);
  useFocusTrap(open, dialogRef, {
    onEscape: () => {
      if (!mutation.isPending) onClose();
    },
    autofocus: open,
  });
  useEffect(() => {
    if (!open) restoreTrigger();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 p-4"
      onClick={() => {
        if (!mutation.isPending) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Создать сделку"
        className="w-full max-w-md rounded-card border border-line bg-surface p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-content">Создать сделку</h2>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label
              htmlFor="deal-counterparty"
              className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
            >
              Контрагент (userId)
            </label>
            <Input
              id="deal-counterparty"
              value={counterpartyId}
              onChange={(e) => setCounterpartyId(e.target.value)}
              placeholder="ID пользователя"
            />
            <p className="text-xs text-content-muted">
              API поиска по имени пока нет — введите userId напрямую (его можно
              скопировать из профиля контрагента).
            </p>
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="deal-title"
              className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
            >
              Название сделки
            </label>
            <Input
              id="deal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Скрипт для гонок"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="deal-subject-type"
                className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
              >
                Предмет сделки
              </label>
              <Select
                id="deal-subject-type"
                value={subjectType}
                onChange={(e) => {
                  setSubjectType(e.target.value);
                  if (!e.target.value) setSubjectId("");
                }}
              >
                {SUBJECT_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            {subjectType ? (
              <div className="space-y-1.5">
                <label
                  htmlFor="deal-subject-id"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  ID предмета
                </label>
                <Input
                  id="deal-subject-id"
                  value={subjectId}
                  onChange={(e) => setSubjectId(e.target.value)}
                  placeholder={subjectType === "RESOURCE" ? "slug или ID ресурса" : "ID услуги"}
                />
              </div>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="deal-amount"
              className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
            >
              Сумма, ₽
            </label>
            <Input
              id="deal-amount"
              value={amountRub}
              onChange={(e) => setAmountRub(e.target.value)}
              placeholder="1000.00"
              inputMode="decimal"
            />
            {amountRub.trim() !== "" && amountMinor === null ? (
              <p className="text-xs text-bad">Введите сумму до копеек, например 1000.50</p>
            ) : null}
          </div>
        </div>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button
            size="sm"
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Создание..." : "Создать"}
          </Button>
        </div>
      </div>
    </div>
  );
}