// PLAN-017 §36: dialog with a reason textarea, following the ui/ConfirmDialog
// pattern (focus trap, Esc, overlay click, focus restore). Used by admin
// user actions (suspend / restore / role change).
"use client";

import { useEffect, useRef } from "react";
import { useFocusTrap, rememberTrigger, restoreTrigger } from "@/components/ui/focusTrap";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";

export function AdminReasonDialog({
  open,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  danger = false,
  busy = false,
  reason,
  onReasonChange,
  reasonPlaceholder = "Причина",
  extra,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  reason: string;
  onReasonChange: (value: string) => void;
  reasonPlaceholder?: string;
  /** Дополнительный контент между описанием и причиной (например checkbox). */
  extra?: React.ReactNode;
  /** Отключить кнопку подтверждения (например пока не поставлен checkbox). */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) rememberTrigger(document.activeElement as HTMLElement | null);
  }, [open]);
  useFocusTrap(open, ref, { onEscape: onCancel, autofocus: open });
  useEffect(() => {
    if (!open) restoreTrigger();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-card border border-line bg-surface p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-content">{title}</h2>
        {description ? <p className="text-sm text-content-secondary">{description}</p> : null}
        {extra}
        <Textarea
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder={reasonPlaceholder}
          aria-label="Причина"
          rows={3}
          autoFocus
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
            disabled={busy || confirmDisabled || !reason.trim()}
          >
            {busy ? "..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}