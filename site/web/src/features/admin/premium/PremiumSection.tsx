// PLAN-017 H §50–§51: premium entitlements admin tab — plans catalog cards
// (honest available/enabled chips + note) and the entitlements table with
// filters (subjectType/kind/active) + pager, grant dialog (AdminGrantDialog,
// idempotent → «уже выдан» notice) and reason-required revocation
// (AdminReasonDialog). Keys: ["admin","premium",…]; mutations invalidate the
// list and the admin overview. Flag-off entitlements (404 "Not found")
// degrade to an honest notice — plans always render.
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Gift, ShieldAlert, Undo2, X } from "lucide-react";
import {
  fetchAdminPremiumEntitlements,
  fetchAdminPremiumPlans,
  getErrorMessage,
  isFeatureDisabledError,
  revokeAdminPremiumEntitlement,
  type AdminPremiumEntitlement,
} from "@/lib/api/advertising";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { AdminChip } from "@/components/admin/chips";
import { AdminReasonDialog } from "@/components/admin/AdminReasonDialog";
import { formatDateTime, shortId } from "@/components/admin/labels";
import { TablePager } from "@/features/admin/shared/TablePager";
import {
  AdminGrantDialog,
  PREMIUM_KIND_LABELS,
  PREMIUM_SUBJECT_TYPE_LABELS,
} from "./AdminGrantDialog";

const PAGE_LIMIT = 20;

const SUBJECT_TYPE_FILTERS: [string, string][] = [
  ["all", "Все субъекты"],
  ...Object.entries(PREMIUM_SUBJECT_TYPE_LABELS),
];

const KIND_FILTERS: [string, string][] = [
  ["all", "Все планы"],
  ...Object.entries(PREMIUM_KIND_LABELS),
];

const ACTIVE_FILTERS: [string, string][] = [
  ["all", "Все выдачи"],
  ["true", "Активные"],
  ["false", "Отозванные"],
];

const PREMIUM_SOURCE_LABELS: Record<string, string> = {
  ADMIN_GRANT: "Админ-выдача",
};

function premiumSourceLabel(source: string | null | undefined): string {
  if (!source) return "—";
  return PREMIUM_SOURCE_LABELS[source] ?? source;
}

function premiumKindLabel(kind: string | null | undefined): string {
  if (!kind) return "—";
  return PREMIUM_KIND_LABELS[kind] ?? kind;
}

function premiumSubjectTypeLabel(subjectType: string | null | undefined): string {
  if (!subjectType) return "—";
  return PREMIUM_SUBJECT_TYPE_LABELS[subjectType] ?? subjectType;
}

type ResultBanner = { tone: "ok" | "info"; text: string } | null;

export function PremiumSection() {
  const qc = useQueryClient();
  const [subjectType, setSubjectType] = useState("all");
  const [kind, setKind] = useState("all");
  const [active, setActive] = useState("all");
  const [page, setPage] = useState(1);
  const [grantOpen, setGrantOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AdminPremiumEntitlement | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [banner, setBanner] = useState<ResultBanner>(null);

  useEffect(() => {
    setPage(1);
  }, [subjectType, kind, active]);

  const entitlements = useQuery({
    queryKey: ["admin", "premium", "entitlements", { subjectType, kind, active, page }],
    queryFn: () =>
      fetchAdminPremiumEntitlements({
        subjectType: subjectType === "all" ? undefined : subjectType,
        kind: kind === "all" ? undefined : kind,
        active: active === "all" ? undefined : active === "true",
        page,
        limit: PAGE_LIMIT,
      }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    retry: (failureCount, err) => !isFeatureDisabledError(err) && failureCount < 2,
  });

  const entitlementsDisabled = entitlements.error
    ? isFeatureDisabledError(entitlements.error)
    : false;
  const rows: AdminPremiumEntitlement[] = entitlements.data?.entitlements ?? [];

  const revoke = useMutation({
    mutationFn: (p: { id: string; reason: string }) =>
      revokeAdminPremiumEntitlement(p.id, p.reason),
    onSuccess: (result) => {
      setRevokeTarget(null);
      setBanner({
        tone: "ok",
        text: result.revoked
          ? "Премиум-план отозван"
          : "План уже был отозван ранее — изменений нет",
      });
      qc.invalidateQueries({ queryKey: ["admin", "premium"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    },
  });

  return (
    <div className="space-y-6">
      <PlansCatalog />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-accent" aria-hidden /> Выдачи премиума
          </CardTitle>
          <CardDescription>Активные и отозванные права (entitlements)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {banner ? (
            <div
              className={`flex items-start justify-between gap-3 rounded-md border p-3 ${
                banner.tone === "ok" ? "border-ok/30 bg-ok/10" : "border-info/30 bg-info/10"
              }`}
              role="status"
            >
              <p
                className={`text-sm ${banner.tone === "ok" ? "text-ok" : "text-info"}`}
              >
                {banner.text}
              </p>
              <Button variant="ghost" size="sm" className="px-2" onClick={() => setBanner(null)} aria-label="Скрыть сообщение">
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <div className="w-44">
              <Select
                value={subjectType}
                onChange={(e) => setSubjectType(e.target.value)}
                aria-label="Фильтр типа субъекта"
              >
                {SUBJECT_TYPE_FILTERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-48">
              <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Фильтр плана">
                {KIND_FILTERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-44">
              <Select value={active} onChange={(e) => setActive(e.target.value)} aria-label="Фильтр активности">
                {ACTIVE_FILTERS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex-1" />
            {!entitlementsDisabled ? (
              <Button size="sm" onClick={() => setGrantOpen(true)}>
                <Crown className="mr-1 h-4 w-4" aria-hidden /> Выдать
              </Button>
            ) : null}
          </div>

          {entitlementsDisabled ? (
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
                  Выдачи премиума недоступны: включите feature-флаг premium. Каталог планов выше
                  продолжает показывать реальный статус планов.
                </p>
              </div>
            </div>
          ) : (
            <>
              {entitlements.error ? (
                <ErrorState error={entitlements.error} onRetry={() => entitlements.refetch()} />
              ) : null}

              {entitlements.isLoading ? (
                <LoadingSpinner label="Загрузка выдач..." />
              ) : rows.length === 0 && !entitlements.error ? (
                <EmptyState title="Выдач нет" description="Выданные премиум-планы появятся здесь" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-content-muted">
                        <th className="py-2 pr-3 font-semibold">Субъект</th>
                        <th className="py-2 pr-3 font-semibold">План</th>
                        <th className="py-2 pr-3 font-semibold">Источник</th>
                        <th className="py-2 pr-3 font-semibold">Выдан</th>
                        <th className="py-2 pr-3 font-semibold">Истекает</th>
                        <th className="py-2 pr-3 font-semibold">Отозван</th>
                        <th className="py-2 pr-3 font-semibold">
                          <span className="sr-only">Действия</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((entitlement) => (
                        <tr key={entitlement.id} className="border-b border-line/60 align-top">
                          <td className="py-2.5 pr-3">
                            <p className="font-medium">{entitlement.subjectLabel ?? "—"}</p>
                            <p className="text-xs text-content-muted">
                              {premiumSubjectTypeLabel(entitlement.subjectType)}
                            </p>
                            <p className="font-mono text-[11px] text-content-muted/70">
                              {shortId(entitlement.subjectId ?? entitlement.id)}
                            </p>
                            {entitlement.note ? (
                              <p className="mt-0.5 max-w-xs truncate text-xs text-content-muted">
                                {entitlement.note}
                              </p>
                            ) : null}
                          </td>
                          <td className="py-2.5 pr-3 text-xs">
                            {premiumKindLabel(entitlement.kind)}
                          </td>
                          <td className="py-2.5 pr-3 text-xs text-content-secondary">
                            {premiumSourceLabel(entitlement.source)}
                          </td>
                          <td className="py-2.5 pr-3 text-xs text-content-secondary">
                            {formatDateTime(entitlement.grantedAt)}
                          </td>
                          <td className="py-2.5 pr-3 text-xs text-content-secondary">
                            {formatDateTime(entitlement.expiresAt)}
                          </td>
                          <td className="py-2.5 pr-3 text-xs text-content-secondary">
                            {formatDateTime(entitlement.revokedAt)}
                          </td>
                          <td className="py-2.5 pr-3">
                            {!entitlement.revokedAt ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setRevokeReason("");
                                  setRevokeTarget(entitlement);
                                }}
                              >
                                <Undo2 className="mr-1 h-4 w-4" aria-hidden /> Отозвать
                              </Button>
                            ) : (
                              <span className="text-xs text-content-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <TablePager
                page={entitlements.data?.page ?? page}
                limit={entitlements.data?.limit ?? PAGE_LIMIT}
                total={entitlements.data?.total ?? 0}
                onPage={setPage}
                disabled={entitlements.isFetching}
              />
            </>
          )}
        </CardContent>
      </Card>

      {grantOpen ? (
        <AdminGrantDialog
          onClose={() => setGrantOpen(false)}
          onGranted={(result) => {
            const kindLabel = PREMIUM_KIND_LABELS[result.entitlement.kind ?? ""] ?? result.entitlement.kind ?? "план";
            setBanner(
              result.created
                ? { tone: "ok", text: `План «${kindLabel}» выдан` }
                : {
                    tone: "info",
                    text: `План «${kindLabel}» уже выдан этому субъекту — активная выдача существует, изменений нет`,
                  }
            );
          }}
        />
      ) : null}

      <AdminReasonDialog
        open={revokeTarget !== null}
        title="Отозвать премиум-план"
        description="Причина обязательна: она фиксируется в аудите и отправляется владельцу субъекта."
        confirmLabel="Отозвать"
        danger
        busy={revoke.isPending}
        reason={revokeReason}
        onReasonChange={setRevokeReason}
        reasonPlaceholder="Причина отзыва (фиксируется в аудите)"
        extra={
          revoke.error ? (
            <p className="text-sm text-bad" role="alert">
              {getErrorMessage(revoke.error, "Не удалось отозвать премиум-план")}
            </p>
          ) : null
        }
        onConfirm={() => {
          if (revokeTarget) revoke.mutate({ id: revokeTarget.id, reason: revokeReason.trim() });
        }}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
}

// --------------------------------------------------------------------------
// Каталог планов: честные чипы доступен/включён + note, когда план недоступен.
// --------------------------------------------------------------------------
function PlansCatalog() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "premium", "plans"],
    queryFn: fetchAdminPremiumPlans,
    staleTime: 60_000,
    // Каталог планов отвечает всегда; ретраи нужны только при сбоях сети.
    retry: (failureCount, err) => !isFeatureDisabledError(err) && failureCount < 2,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-accent" aria-hidden /> Premium-планы
        </CardTitle>
        <CardDescription>
          Каталог премиум-планов платформы и их реальный статус (не декоративные бейджи)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

        {isLoading ? <LoadingSpinner label="Загрузка каталога планов..." /> : null}

        {data && data.featureEnabled === false ? (
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
                Premium-флаг выключен: выдача и отзыв недоступны. Планы ниже помечены как
                «отключён».
              </p>
            </div>
          </div>
        ) : null}

        {data && data.plans.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data.plans.map((plan, index) => {
              const available = plan.available === true;
              const enabled = plan.enabled === true;
              const features = plan.features ?? [];
              return (
                <div
                  key={plan.kind ?? `plan-${index}`}
                  className="space-y-2 rounded-card border border-line bg-surface-raised p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{plan.label ?? plan.kind ?? "—"}</p>
                    <AdminChip tone={available ? "ok" : "muted"}>
                      {available ? "доступен" : "недоступен"}
                    </AdminChip>
                    <AdminChip tone={enabled ? "ok" : "warn"}>
                      {enabled ? "включён" : "отключён"}
                    </AdminChip>
                  </div>
                  {plan.description ? (
                    <p className="text-sm text-content-secondary">{plan.description}</p>
                  ) : null}
                  {features.length > 0 ? (
                    <ul className="list-disc space-y-0.5 pl-5 text-sm text-content-secondary">
                      {features.map((feature, i) => (
                        <li key={i}>{feature}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-content-muted">Функции плана пока не описаны</p>
                  )}
                  {plan.note ? (
                    <p className={`text-xs ${available ? "text-content-muted" : "text-warn"}`}>
                      {plan.note}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {!isLoading && !error && data && data.plans.length === 0 ? (
          <EmptyState title="Каталог пуст" description="Планы не описаны на бэкенде" />
        ) : null}
      </CardContent>
    </Card>
  );
}