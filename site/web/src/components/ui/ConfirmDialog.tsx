// ConfirmDialog: минимальный модальный диалог подтверждения (PLAN-002 B-003).
"use client";

import { useEffect, useRef } from "react";
import { useFocusTrap, rememberTrigger, restoreTrigger } from "@/components/ui/focusTrap";
import { Button } from "@/components/ui/Button";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  danger = false,
  busy = false,
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
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  // PLAN-016 D-004: Esc + Tab-цикл внутри диалога; фокус возвращается на
  // триггер после закрытия.
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-card border border-line bg-surface p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-content">{title}</h2>
        {description ? <p className="text-sm text-content-secondary">{description}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            size="sm"
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "..." : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
