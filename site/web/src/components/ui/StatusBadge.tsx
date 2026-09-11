"use client";

import { cn } from "@/lib/utils";

// PLAN-013: только семантические токены (DESIGN-SYSTEM §2) — сырая палитра
// Tailwind запрещена. Сoft-фон + цветной текст читается на тёмной теме.
const COLORS: Record<string, string> = {
  // purchases / resources — success-семейство
  COMPLETED: "bg-ok-soft text-ok",
  PUBLISHED: "bg-ok-soft text-ok",
  ACTIVE: "bg-ok-soft text-ok",
  ACCEPTED: "bg-ok-soft text-ok",
  APPROVED: "bg-ok-soft text-ok",
  RESOLVED_BUYER: "bg-ok-soft text-ok",
  FREE: "bg-ok-soft text-ok",
  // ожидание / модерация — warning-семейство
  PENDING: "bg-warn-soft text-warn",
  PENDING_REVIEW: "bg-warn-soft text-warn",
  PENDING_PAYMENT: "bg-warn-soft text-warn",
  PARTIAL_REFUND: "bg-warn-soft text-warn",
  // в работе — info-семейство
  IN_PROGRESS: "bg-info-soft text-info",
  UNDER_REVIEW: "bg-info-soft text-info",
  DELIVERED: "bg-info-soft text-info",
  // нейтральные
  DRAFT: "bg-surface-hover text-content-secondary",
  CLOSED: "bg-surface-hover text-content-secondary",
  CANCELLED: "bg-surface-hover text-content-muted",
  // ошибки / опасные состояния — danger-семейство
  REJECTED: "bg-bad-soft text-bad",
  SUSPENDED: "bg-bad-soft text-bad",
  BANNED: "bg-bad-soft text-bad",
  REVOKED: "bg-bad-soft text-bad",
  DISPUTED: "bg-bad-soft text-bad",
  // trust-система — verified-семейство
  RESOLVED_SELLER: "bg-verified-soft text-verified",
};

// PLAN-001 K-001: unified Russian terminology for every visible status.
const LABELS: Record<string, string> = {
  // resource moderation lifecycle
  DRAFT: "Черновик",
  PENDING_REVIEW: "На модерации",
  UNDER_REVIEW: "На модерации",
  PUBLISHED: "Опубликован",
  SUSPENDED: "Приостановлен",
  UNPUBLISHED: "Снят с публикации",
  // seller profile
  PENDING: "На рассмотрении",
  APPROVED: "Одобрен",
  REJECTED: "Отклонён",
  // purchases / licenses
  COMPLETED: "Завершена",
  PENDING_PAYMENT: "Ожидает оплаты",
  ACTIVE: "Активна",
  REVOKED: "Отозвана",
  CANCELLED: "Отменён",
  DISPUTED: "Оспорен",
  PARTIAL_REFUND: "Частичный возврат",
  // service orders
  IN_PROGRESS: "В работе",
  DELIVERED: "Доставлен",
  ACCEPTED: "Принят",
  CLOSED: "Закрыт",
  RESOLVED_BUYER: "Решён в пользу покупателя",
  RESOLVED_SELLER: "Решён в пользу продавца",
  // accounts
  BANNED: "Заблокирован",
  // misc
  FREE: "Бесплатно",
};

export function statusLabel(status: string): string {
  return LABELS[status] ?? status;
}

export function StatusBadge({
  status,
  className,
  children,
}: {
  status: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-block text-xs px-2 py-1 rounded-pill border border-line font-medium",
        COLORS[status] ?? "bg-surface-hover text-content-secondary",
        className
      )}
    >
      {children ?? statusLabel(status)}
    </span>
  );
}

export function ErrorText({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-bad" role="alert">
      {message}
    </p>
  );
}

export function SuccessText({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-ok">{message}</p>
  );
}
