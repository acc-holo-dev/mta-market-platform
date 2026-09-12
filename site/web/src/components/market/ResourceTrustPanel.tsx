// PLAN-018 Wave-6 C-001..C-003: компактная панель «Доверие» на странице
// ресурса — верификация (chip), совместимость (строка + chip результата)
// и здоровье (число + список факторов с вкладом). Один GET /trust/resource/:slug,
// lazy (enabled после загрузки ресурса), staleTime 60s, честный skeleton.
// Факторы с value=null — «нет данных» (сервер честно не придумывает оценки).
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchResourceTrust, type TrustFactor } from "@/lib/api/resources";
import { Card, CardContent } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { BadgeCheck, ShieldAlert, ShieldQuestion, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

// namespaced query key (lib/queries.ts factory заморожен для воли Wave-6)
export const resourceTrustKey = (slug: string) => ["trust", "resource", slug] as const;

const VERIFICATION_META: Record<string, { label: string; cls: string }> = {
  VERIFIED: { label: "Проверен", cls: "bg-ok-soft text-ok" },
  UNVERIFIED: { label: "Не проверен", cls: "bg-surface-hover text-content-secondary" },
  FAILED: { label: "Ошибка проверки", cls: "bg-bad-soft text-bad" },
};

const COMPAT_META: Record<string, { label: string; cls: string }> = {
  VERIFIED: { label: "Совместим", cls: "bg-ok-soft text-ok" },
  PARTIAL: { label: "Частично", cls: "bg-warn-soft text-warn" },
  UNKNOWN: { label: "Нет данных", cls: "bg-surface-hover text-content-secondary" },
  FAILED: { label: "Несовместим", cls: "bg-bad-soft text-bad" },
};

// Human names of the server trust factors (lib/trust.ts). Unknown names
// fall back to the raw factor name — no invented labels.
const FACTOR_LABELS: Record<string, string> = {
  moderation: "Модерация",
  compatibility: "Совместимость",
  installation: "Установки",
  refunds: "Возвраты",
  cadence: "Частота обновлений",
};

function factorLabel(name: string): string {
  return FACTOR_LABELS[name] ?? name;
}

function FactorRow({ factor }: { factor: TrustFactor }) {
  const noData = factor.value == null;
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className="text-content-secondary">{factorLabel(factor.name)}</span>
      <span className="flex items-center gap-2">
        <span className="w-16 text-right text-xs text-content-muted tabular-nums">
          вес {factor.weight}
        </span>
        <span
          className={cn(
            "w-20 text-right font-medium tabular-nums",
            noData ? "text-content-muted text-xs" : "text-content"
          )}
        >
          {noData ? "нет данных" : `+${Number(factor.contribution ?? 0).toFixed(1)}`}
        </span>
      </span>
    </li>
  );
}

export function ResourceTrustPanel({ slug, enabled }: { slug: string; enabled: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: resourceTrustKey(slug),
    queryFn: () => fetchResourceTrust(slug),
    enabled,
    staleTime: 60_000,
    retry: false,
  });

  if (!enabled || isLoading) {
    return (
      <Card>
        <CardContent className="pt-6 space-y-3" aria-busy="true" aria-label="Загрузка данных доверия">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <div className="space-y-2 pt-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Trust data is derived read-model — on error the panel honestly says so
  // without blocking the rest of the page.
  if (error || !data) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-content-muted">Данные доверия временно недоступны.</p>
        </CardContent>
      </Card>
    );
  }

  const verification = data.verification ?? {};
  const compatibility = data.compatibility ?? {};
  const health = data.health ?? {};

  const vMeta = VERIFICATION_META[verification.state ?? ""] ?? {
    label: verification.state ?? "Нет данных",
    cls: "bg-surface-hover text-content-secondary",
  };
  const compatResult = compatibility.result ?? null;
  const cMeta = compatResult
    ? (COMPAT_META[compatResult] ?? { label: compatResult, cls: "bg-surface-hover text-content-secondary" })
    : null;

  const arch = compatibility.arch ?? compatibility.architecture ?? null;
  const compatParts = [
    compatibility.mtaVersion ? `MTA ${compatibility.mtaVersion}` : null,
    compatibility.os ?? null,
    arch ?? null,
  ].filter(Boolean) as string[];

  const healthScore = typeof health.score === "number" ? health.score : null;

  return (
    <Card>
      <CardContent className="pt-6 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Доверие</p>

        {/* Verification */}
        <div className="flex items-center gap-2">
          {verification.state === "VERIFIED" ? (
            <BadgeCheck className="h-4 w-4 text-ok flex-shrink-0" aria-hidden />
          ) : verification.state === "FAILED" ? (
            <ShieldAlert className="h-4 w-4 text-bad flex-shrink-0" aria-hidden />
          ) : (
            <ShieldQuestion className="h-4 w-4 text-content-muted flex-shrink-0" aria-hidden />
          )}
          <span
            className={cn("inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium", vMeta.cls)}
          >
            {vMeta.label}
          </span>
          <span className="text-xs text-content-muted">
            {verification.state === "VERIFIED"
              ? "модерация + совместимость подтверждены"
              : verification.state === "FAILED"
                ? "проверка совместимости не пройдена"
                : "ресурс прошёл модерацию, артефакт не проверен"}
          </span>
        </div>

        {/* Compatibility */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-content-secondary">Совместимость:</span>
            {cMeta ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium",
                  cMeta.cls
                )}
              >
                {cMeta.label}
              </span>
            ) : (
              <span className="text-xs text-content-muted">отчётов нет</span>
            )}
          </div>
          <p className="text-xs text-content-secondary">
            {compatParts.length > 0
              ? compatParts.join(" · ")
              : "Платформа/версия MTA не проверялись."}
          </p>
          {compatibility.notes ? (
            <p className="text-xs text-content-muted line-clamp-2">{compatibility.notes}</p>
          ) : null}
        </div>

        {/* Health */}
        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent flex-shrink-0" aria-hidden />
            <span className="text-sm font-medium">
              Здоровье:{" "}
              {healthScore != null ? (
                <span className="tabular-nums">{healthScore.toFixed(0)} / 100</span>
              ) : (
                <span className="text-content-muted text-sm">нет данных</span>
              )}
            </span>
          </div>
          {Array.isArray(health.factors) && health.factors.length > 0 ? (
            <ul className="space-y-1.5">
              {health.factors.map((f) => (
                <FactorRow key={f.name} factor={f} />
              ))}
            </ul>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
