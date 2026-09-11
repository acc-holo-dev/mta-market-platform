"use client";

import { cn } from "@/lib/utils";

const COLORS: Record<string, string> = {
  // purchases / resources
  COMPLETED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  PUBLISHED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  ACTIVE: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  ACCEPTED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  PENDING: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  PENDING_REVIEW: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  PENDING_PAYMENT: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
  IN_PROGRESS: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  UNDER_REVIEW: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  DELIVERED: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
  DRAFT: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
  CLOSED: "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
  CANCELLED: "bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  SUSPENDED: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  BANNED: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  DISPUTED: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  REVOKED: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  RESOLVED_BUYER: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  RESOLVED_SELLER: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
  PARTIAL_REFUND: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300",
  FREE: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
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
        "inline-block text-xs px-2 py-1 rounded font-medium",
        COLORS[status] ?? "bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300",
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
    <p className="text-sm text-red-600 dark:text-red-400" role="alert">
      {message}
    </p>
  );
}

export function SuccessText({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-green-600 dark:text-green-400">{message}</p>
  );
}
