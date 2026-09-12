// PLAN-017 §36: admin chips moved from app/admin/page.tsx (behavior unchanged).
// Только семантические токены (DESIGN-SYSTEM §2) — сырая палитра запрещена.
"use client";

import { LIFECYCLE_LABELS } from "@/components/admin/labels";

export function AdminChip({
  tone = "muted",
  children,
}: {
  tone?: "ok" | "warn" | "bad" | "info" | "muted";
  children: React.ReactNode;
}) {
  const tones = {
    ok: "border-ok/30 bg-ok/10 text-ok",
    warn: "border-warn/30 bg-warn/10 text-warn",
    bad: "border-bad/30 bg-bad/10 text-bad",
    info: "border-info/30 bg-info/10 text-info",
    muted: "border-line bg-surface-hover text-content-muted",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function LifecycleChip({ lifecycle }: { lifecycle: string }) {
  const tone =
    lifecycle === "SUSPENDED"
      ? "bad"
      : lifecycle === "VERIFIED" || lifecycle === "ACTIVE"
        ? "ok"
        : lifecycle === "PENDING_VERIFICATION"
          ? "warn"
          : "muted";
  return <AdminChip tone={tone}>{LIFECYCLE_LABELS[lifecycle] ?? lifecycle}</AdminChip>;
}

export function VerificationChip({ verification }: { verification: string }) {
  if (verification === "VERIFIED") return <AdminChip tone="ok">Проверен</AdminChip>;
  if (verification === "FAILED") return <AdminChip tone="bad">Проверка не пройдена</AdminChip>;
  if (verification === "PENDING") return <AdminChip tone="warn">Ожидает проверки</AdminChip>;
  return <AdminChip tone="muted">{verification}</AdminChip>;
}

export function MonitoringChip({ state }: { state: string }) {
  return (
    <AdminChip tone={state === "ONLINE" ? "ok" : state === "OFFLINE" ? "bad" : "muted"}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          state === "ONLINE" ? "bg-ok" : state === "OFFLINE" ? "bg-bad" : "bg-line-strong"
        }`}
        aria-hidden
      />
      {state === "ONLINE" ? "Онлайн" : state === "OFFLINE" ? "Оффлайн" : "Нет данных"}
    </AdminChip>
  );
}

/** Статус аккаунта пользователя (новые секции users/overview). */
export function UserStatusChip({ status }: { status: string }) {
  const tone = status === "ACTIVE" ? "ok" : status === "BANNED" ? "bad" : status === "SUSPENDED" ? "warn" : "muted";
  const label =
    status === "ACTIVE"
      ? "Активен"
      : status === "SUSPENDED"
        ? "Приостановлен"
        : status === "BANNED"
          ? "Заблокирован"
          : status;
  return <AdminChip tone={tone}>{label}</AdminChip>;
}

/** Уровень системного журнала. */
export function LogLevelChip({ level }: { level: string }) {
  const tone =
    level === "ERROR" || level === "FATAL"
      ? "bad"
      : level === "WARN" || level === "WARNING"
        ? "warn"
        : level === "INFO"
          ? "info"
          : "muted";
  return <AdminChip tone={tone}>{level}</AdminChip>;
}