// PLAN-017 G §46–§49: advertising control center — campaigns table with
// filters (status/placement/reviewStatus) + pager, row expand with details,
// lifecycle/review transitions, edit dialog (AdminCampaignDialog), delete
// confirm and bounded analytics (totals + CTR + byDay CSS bars, no chart
// libs). Query keys: ["admin","advertising",…]; mutations invalidate the
// list and the admin overview. Flag-off (404 "Not found") renders an honest
// disabled notice instead of an error.
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronUp,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Plus,
  ShieldAlert,
  Trash,
} from "lucide-react";
import {
  deleteAdminCampaign,
  fetchAdminCampaignAnalytics,
  fetchAdminCampaigns,
  isFeatureDisabledError,
  transitionAdminCampaign,
  type AdminAdCampaign,
  type AdminCampaignTransitionAction,
} from "@/lib/api/advertising";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { AdminChip } from "@/components/admin/chips";
import { AdminReasonDialog } from "@/components/admin/AdminReasonDialog";
import { formatDateTime, shortId } from "@/components/admin/labels";
import { TablePager } from "@/features/admin/shared/TablePager";
import { AdminCampaignDialog } from "./AdminCampaignDialog";
import {
  AD_PLACEMENT_FILTERS,
  AD_REVIEW_FILTERS,
  AD_STATUS_FILTERS,
  adPlacementLabel,
  adReviewLabel,
  adReviewTone,
  adStatusLabel,
  adStatusTone,
  campaignDeletable,
  campaignEditable,
  humanizeCampaignError,
} from "./labels";

const PAGE_LIMIT = 20;
const ANALYTICS_DAYS_OPTIONS: [number, string][] = [
  [7, "7 дней"],
  [14, "14 дней"],
  [30, "30 дней"],
];

const TRANSITION_FALLBACKS: Record<AdminCampaignTransitionAction, string> = {
  approve: "Не удалось одобрить кампанию",
  reject: "Не удалось отклонить кампанию",
  activate: "Не удалось активировать кампанию",
  pause: "Не удалось поставить кампанию на паузу",
  resume: "Не удалось возобновить кампанию",
  cancel: "Не удалось отменить кампанию",
};

/** Доступные переходы по состоянию (зеркалит серверную машину состояний). */
function availableTransitions(campaign: AdminAdCampaign): AdminCampaignTransitionAction[] {
  const status = campaign.status ?? null;
  const review = campaign.reviewStatus ?? null;
  const actions: AdminCampaignTransitionAction[] = [];
  if (review === "PENDING") {
    actions.push("approve", "reject");
  }
  if (review === "APPROVED" && (status === "DRAFT" || status === "SCHEDULED" || status === "PAUSED")) {
    actions.push("activate");
  }
  if (status === "ACTIVE") actions.push("pause");
  if (status === "PAUSED") actions.push("resume");
  if (status !== "CANCELLED" && status !== "EXPIRED") actions.push("cancel");
  return Array.from(new Set(actions));
}

export function AdvertisingSection() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [placement, setPlacement] = useState("all");
  const [reviewStatus, setReviewStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dialogCampaign, setDialogCampaign] = useState<AdminAdCampaign | "new" | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AdminAdCampaign | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AdminAdCampaign | null>(null);

  // Фильтры сбрасывают страницу и раскрытие.
  useEffect(() => {
    setPage(1);
    setExpandedId(null);
  }, [status, placement, reviewStatus]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "advertising", "list", { status, placement, reviewStatus, page }],
    queryFn: () =>
      fetchAdminCampaigns({
        status: status === "all" ? undefined : status,
        placement: placement === "all" ? undefined : placement,
        reviewStatus: reviewStatus === "all" ? undefined : reviewStatus,
        page,
        limit: PAGE_LIMIT,
      }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    // Флаг выключен (404 "Not found") — ретраи не помогут, показываем disabled-стейт сразу.
    retry: (failureCount, err) => !isFeatureDisabledError(err) && failureCount < 2,
  });

  const disabled = error ? isFeatureDisabledError(error) : false;
  const campaigns: AdminAdCampaign[] = data?.campaigns ?? [];

  const invalidateAdvertising = () => {
    qc.invalidateQueries({ queryKey: ["admin", "advertising"] });
    qc.invalidateQueries({ queryKey: ["admin", "overview"] });
  };

  const transition = useMutation({
    mutationFn: (p: { id: string; action: AdminCampaignTransitionAction; reason?: string }) =>
      transitionAdminCampaign(p.id, p.action, p.reason),
    onSuccess: () => invalidateAdvertising(),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteAdminCampaign(id),
    onSuccess: () => {
      setDeleteTarget(null);
      invalidateAdvertising();
    },
    onError: () => {
      // Диалог закрываем, ошибка остаётся видимой в списке.
      setDeleteTarget(null);
    },
  });

  const transitionPendingId = transition.isPending ? (transition.variables?.id ?? null) : null;
  const transitionErrorText =
    transition.error && transition.variables
      ? humanizeCampaignError(transition.error, TRANSITION_FALLBACKS[transition.variables.action])
      : null;

  function doTransition(
    campaign: AdminAdCampaign,
    action: AdminCampaignTransitionAction,
    reason?: string
  ) {
    transition.mutate({ id: campaign.id, action, reason });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-accent" aria-hidden /> Реклама
        </CardTitle>
        <CardDescription>
          Центр управления кампаниями: ревью, жизненный цикл, аналитика
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled ? (
          <div
            className="flex items-start gap-3 rounded-md border border-line bg-surface-raised p-4"
            role="status"
          >
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
            <div>
              <p className="text-sm font-medium text-content">
                Модуль отключён конфигурацией feature-флагов
              </p>
              <p className="mt-0.5 text-xs text-content-secondary">
                Раздел рекламы недоступен: включите feature-флаг advertising, чтобы управлять
                кампаниями. Данные не загружаются и кнопки управления скрыты.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div className="flex flex-wrap gap-2">
                <div className="w-44">
                  <Select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    aria-label="Фильтр статуса"
                  >
                    {AD_STATUS_FILTERS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-56">
                  <Select
                    value={placement}
                    onChange={(e) => setPlacement(e.target.value)}
                    aria-label="Фильтр размещения"
                  >
                    {AD_PLACEMENT_FILTERS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="w-44">
                  <Select
                    value={reviewStatus}
                    onChange={(e) => setReviewStatus(e.target.value)}
                    aria-label="Фильтр ревью"
                  >
                    {AD_REVIEW_FILTERS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <Button size="sm" onClick={() => setDialogCampaign("new")}>
                <Plus className="mr-1 h-4 w-4" aria-hidden /> Новая кампания
              </Button>
            </div>

            {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

            {isLoading ? (
              <LoadingSpinner label="Загрузка кампаний..." />
            ) : campaigns.length === 0 && !error ? (
              <EmptyState
                icon={<Megaphone className="mx-auto mb-4 h-12 w-12 text-content-muted" />}
                title="Кампаний нет"
                description="Создайте кампанию или измените фильтры"
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-content-muted">
                      <th className="py-2 pr-3 font-semibold">Кампания</th>
                      <th className="py-2 pr-3 font-semibold">Размещение</th>
                      <th className="py-2 pr-3 font-semibold">Статус</th>
                      <th className="py-2 pr-3 font-semibold">Ревью</th>
                      <th className="py-2 pr-3 font-semibold">Приоритет</th>
                      <th className="py-2 pr-3 font-semibold">Окно</th>
                      <th className="py-2 pr-3 font-semibold">Показы / клики</th>
                      <th className="py-2 pr-3 font-semibold">Рекламодатель</th>
                      <th className="py-2 pr-3 font-semibold">
                        <span className="sr-only">Действия</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((campaign) => (
                      <TableRowGroup
                        key={campaign.id}
                        campaign={campaign}
                        expanded={expandedId === campaign.id}
                        onToggle={() =>
                          setExpandedId(expandedId === campaign.id ? null : campaign.id)
                        }
                        pendingAction={transitionPendingId === campaign.id}
                        onEdit={() => setDialogCampaign(campaign)}
                        onReject={() => {
                          setRejectReason("");
                          setRejectTarget(campaign);
                        }}
                        onTransition={(action) => doTransition(campaign, action)}
                        onDelete={() => setDeleteTarget(campaign)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {transitionErrorText ? (
              <p className="text-sm text-bad" role="alert">
                {transitionErrorText}
              </p>
            ) : null}
            {remove.error ? (
              <p className="text-sm text-bad" role="alert">
                {humanizeCampaignError(remove.error, "Не удалось удалить кампанию")}
              </p>
            ) : null}

            <TablePager
              page={data?.page ?? page}
              limit={data?.limit ?? PAGE_LIMIT}
              total={data?.total ?? 0}
              onPage={setPage}
              disabled={isFetching}
            />
          </>
        )}
      </CardContent>

      {dialogCampaign ? (
        <AdminCampaignDialog
          key={dialogCampaign === "new" ? "new" : dialogCampaign.id}
          campaign={dialogCampaign === "new" ? null : dialogCampaign}
          onClose={() => setDialogCampaign(null)}
        />
      ) : null}

      <AdminReasonDialog
        open={rejectTarget !== null}
        title="Отклонить кампанию"
        description="Причина обязательна: она сохраняется как reviewNote и видна рекламодателю."
        confirmLabel="Отклонить"
        danger
        busy={transition.isPending}
        reason={rejectReason}
        onReasonChange={setRejectReason}
        reasonPlaceholder="Причина отклонения (фиксируется в аудите)"
        onConfirm={() => {
          if (rejectTarget) doTransition(rejectTarget, "reject", rejectReason.trim());
          setRejectTarget(null);
        }}
        onCancel={() => setRejectTarget(null)}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить кампанию"
        description={
          deleteTarget
            ? `Кампания «${deleteTarget.name ?? shortId(deleteTarget.id)}» и её метрики будут удалены безвозвратно.`
            : undefined
        }
        confirmLabel="Удалить"
        danger
        busy={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </Card>
  );
}

// --------------------------------------------------------------------------
// Строка таблицы + раскрывающаяся панель (details + actions + analytics).
// --------------------------------------------------------------------------
function TableRowGroup({
  campaign,
  expanded,
  onToggle,
  pendingAction,
  onEdit,
  onReject,
  onTransition,
  onDelete,
}: {
  campaign: AdminAdCampaign;
  expanded: boolean;
  onToggle: () => void;
  pendingAction: boolean;
  onEdit: () => void;
  onReject: () => void;
  onTransition: (action: AdminCampaignTransitionAction) => void;
  onDelete: () => void;
}) {
  const advertiser = campaign.advertiser ?? null;
  return (
    <>
      <tr className="border-b border-line/60 align-top">
        <td className="py-2.5 pr-3">
          <p className="font-medium">{campaign.name ?? "—"}</p>
          <p className="text-xs text-content-secondary">{campaign.title ?? "—"}</p>
          <p className="font-mono text-[11px] text-content-muted/70">{shortId(campaign.id)}</p>
        </td>
        <td className="py-2.5 pr-3 text-xs text-content-secondary">
          {adPlacementLabel(campaign.placement)}
        </td>
        <td className="py-2.5 pr-3">
          <AdminChip tone={adStatusTone(campaign.status)}>{adStatusLabel(campaign.status)}</AdminChip>
        </td>
        <td className="py-2.5 pr-3">
          <AdminChip tone={adReviewTone(campaign.reviewStatus)}>
            {adReviewLabel(campaign.reviewStatus)}
          </AdminChip>
        </td>
        <td className="py-2.5 pr-3 tabular-nums">{campaign.priority ?? "—"}</td>
        <td className="py-2.5 pr-3 text-xs text-content-secondary">
          <p>{formatDateTime(campaign.startsAt)}</p>
          <p>→ {formatDateTime(campaign.endsAt)}</p>
        </td>
        <td className="py-2.5 pr-3 text-xs tabular-nums">
          {campaign.metrics?.impressions ?? "—"} / {campaign.metrics?.clicks ?? "—"}
        </td>
        <td className="py-2.5 pr-3 text-xs">
          {advertiser?.username ? (
            <p>@{advertiser.username}</p>
          ) : advertiser?.displayName ? (
            <p>{advertiser.displayName}</p>
          ) : (
            <p className="text-content-muted">—</p>
          )}
          {advertiser?.id ? (
            <p className="font-mono text-[11px] text-content-muted/70">{shortId(advertiser.id)}</p>
          ) : null}
        </td>
        <td className="py-2.5 pr-3">
          <Button variant="outline" size="sm" onClick={onToggle}>
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4" aria-hidden /> Закрыть
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4" aria-hidden /> Детали
              </>
            )}
          </Button>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-line/60">
          <td colSpan={9} className="bg-surface-raised/60 p-4">
            <CampaignExpanded
              campaign={campaign}
              pendingAction={pendingAction}
              onEdit={onEdit}
              onReject={onReject}
              onTransition={onTransition}
              onDelete={onDelete}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function CampaignExpanded({
  campaign,
  pendingAction,
  onEdit,
  onReject,
  onTransition,
  onDelete,
}: {
  campaign: AdminAdCampaign;
  pendingAction: boolean;
  onEdit: () => void;
  onReject: () => void;
  onTransition: (action: AdminCampaignTransitionAction) => void;
  onDelete: () => void;
}) {
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const transitions = availableTransitions(campaign);
  const editable = campaignEditable(campaign);
  const deletable = campaignDeletable(campaign);

  return (
    <div className="space-y-4">
      {campaign.reviewNote ? (
        <p className="rounded-md border border-bad/30 bg-bad/10 p-2.5 text-xs text-bad">
          Причина отклонения: {campaign.reviewNote}
        </p>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2">
        {campaignDetailRows(campaign).map(([label, value]) => (
          <div
            key={label}
            className="grid grid-cols-[140px,1fr] gap-3 rounded-md border border-line p-2.5"
          >
            <span className="text-content-muted">{label}</span>
            <span className="break-all text-content-secondary">{value}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!editable || pendingAction} onClick={onEdit}>
          <Pencil className="mr-1 h-4 w-4" aria-hidden /> Изменить
        </Button>
        {transitions.includes("approve") ? (
          <Button variant="outline" size="sm" disabled={pendingAction} onClick={() => onTransition("approve")}>
            <Check className="mr-1 h-4 w-4 text-ok" aria-hidden /> Одобрить
          </Button>
        ) : null}
        {transitions.includes("reject") ? (
          <Button variant="outline" size="sm" disabled={pendingAction} onClick={onReject}>
            <Ban className="mr-1 h-4 w-4 text-bad" aria-hidden /> Отклонить
          </Button>
        ) : null}
        {transitions.includes("activate") ? (
          <Button variant="outline" size="sm" disabled={pendingAction} onClick={() => onTransition("activate")}>
            <Play className="mr-1 h-4 w-4 text-ok" aria-hidden /> Активировать
          </Button>
        ) : null}
        {transitions.includes("pause") ? (
          <Button variant="outline" size="sm" disabled={pendingAction} onClick={() => onTransition("pause")}>
            <Pause className="mr-1 h-4 w-4 text-warn" aria-hidden /> Пауза
          </Button>
        ) : null}
        {transitions.includes("resume") ? (
          <Button variant="outline" size="sm" disabled={pendingAction} onClick={() => onTransition("resume")}>
            <Play className="mr-1 h-4 w-4 text-ok" aria-hidden /> Возобновить
          </Button>
        ) : null}
        {transitions.includes("cancel") ? (
          <Button variant="outline" size="sm" disabled={pendingAction} onClick={() => onTransition("cancel")}>
            <Ban className="mr-1 h-4 w-4 text-bad" aria-hidden /> Отменить
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAnalyticsOpen((open) => !open)}
          aria-expanded={analyticsOpen}
        >
          <ChartColumn className="mr-1 h-4 w-4" aria-hidden />
          {analyticsOpen ? "Скрыть аналитику" : "Аналитика"}
        </Button>
        {deletable ? (
          <Button variant="danger" size="sm" disabled={pendingAction} onClick={onDelete}>
            <Trash className="mr-1 h-4 w-4" aria-hidden /> Удалить
          </Button>
        ) : null}
        {pendingAction ? <span className="text-xs text-content-muted">Применяю переход...</span> : null}
      </div>

      {analyticsOpen ? <CampaignAnalyticsPanel campaignId={campaign.id} /> : null}
    </div>
  );
}

// Детали кампании — каждое поле читается defensively («—» при отсутствии).
function campaignDetailRows(campaign: AdminAdCampaign): [string, React.ReactNode][] {
  return [
    ["Заголовок", campaign.title ?? "—"],
    ["Текст", campaign.body ?? "—"],
    [
      "Картинка",
      campaign.imageUrl ? (
        <a
          href={campaign.imageUrl}
          target="_blank"
          rel="noreferrer"
          className="break-all text-accent hover:underline"
        >
          {campaign.imageUrl}
        </a>
      ) : (
        "—"
      ),
    ],
    [
      "Кнопка (CTA)",
      campaign.ctaLabel || campaign.ctaUrl ? (
        <span className="break-all">
          {campaign.ctaLabel ?? "—"}
          {campaign.ctaUrl ? (
            <>
              {" · "}
              <a
                href={campaign.ctaUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-accent hover:underline"
              >
                {campaign.ctaUrl}
              </a>
            </>
          ) : null}
        </span>
      ) : (
        "—"
      ),
    ],
    ["Размещение", adPlacementLabel(campaign.placement)],
    ["Статус", adStatusLabel(campaign.status)],
    ["Ревью", adReviewLabel(campaign.reviewStatus)],
    ["Приоритет", campaign.priority != null ? String(campaign.priority) : "—"],
    ["Начало", formatDateTime(campaign.startsAt)],
    ["Окончание", formatDateTime(campaign.endsAt)],
    ["Создана", formatDateTime(campaign.createdAt)],
    ["Обновлена", formatDateTime(campaign.updatedAt)],
    [
      "Рекламодатель",
      campaign.advertiser?.username
        ? `@${campaign.advertiser.username}`
        : (campaign.advertiser?.displayName ?? campaign.advertiserId ?? "—"),
    ],
  ];
}

// --------------------------------------------------------------------------
// Аналитика кампании: totals + CTR + byDay CSS-бары (без chart-библиотек).
// --------------------------------------------------------------------------
const CTR_PERCENT = new Intl.NumberFormat("ru-RU", {
  style: "percent",
  maximumFractionDigits: 1,
});

function CampaignAnalyticsPanel({ campaignId }: { campaignId: string }) {
  const [days, setDays] = useState(7);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "advertising", "analytics", campaignId, days],
    queryFn: () => fetchAdminCampaignAnalytics(campaignId, days),
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingSpinner label="Загрузка аналитики..." className="py-6" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const totals = data?.totals ?? { impressions: 0, clicks: 0, ctr: 0 };
  const byDay = data?.byDay ?? [];
  const maxImpressions = byDay.reduce((max, day) => Math.max(max, day.impressions), 0);

  return (
    <div className="space-y-3 rounded-md border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
          Аналитика кампании
        </p>
        <div className="w-32">
          <Select
            value={String(days)}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Период аналитики"
          >
            {ANALYTICS_DAYS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        <span className="text-content-secondary">
          Показы:{" "}
          <span className="font-medium tabular-nums text-content">{totals.impressions}</span>
        </span>
        <span className="text-content-secondary">
          Клики:{" "}
          <span className="font-medium tabular-nums text-content">{totals.clicks}</span>
        </span>
        <span className="text-content-secondary">
          CTR:{" "}
          <span className="font-medium tabular-nums text-content">
            {CTR_PERCENT.format(totals.ctr)}
          </span>
        </span>
      </div>

      {byDay.length === 0 ? (
        <EmptyState title="Данных пока нет" description="Показы и клики появятся после публикации" />
      ) : (
        <div className="space-y-1">
          {byDay.map((day) => {
            const width =
              maxImpressions > 0
                ? Math.max((day.impressions / maxImpressions) * 100, day.impressions > 0 ? 2 : 0)
                : 0;
            return (
              <div key={day.date} className="flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 tabular-nums text-content-muted">
                  {day.date.slice(5)}
                </span>
                <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover">
                  <div className="h-full rounded-full bg-accent/80" style={{ width: `${width}%` }} />
                </div>
                <span className="w-28 shrink-0 text-right tabular-nums text-content-secondary">
                  {day.impressions} / {day.clicks}
                </span>
              </div>
            );
          })}
          <p className="pt-1 text-[11px] text-content-muted">
            Полоса — показы за день (UTC); справа — показы / клики
          </p>
        </div>
      )}
    </div>
  );
}