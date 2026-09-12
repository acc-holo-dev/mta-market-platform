// PLAN-018 S-005: controlled beta-feedback dialog (Wave-6 frontend).
// Follows the AdminReasonDialog/ConfirmDialog overlay pattern (focus trap,
// Esc, overlay click, focus restore) — a self-contained dialog WITHOUT its
// own trigger: the single trigger point is the AccountMenu row
// «Сообщить о проблеме» (one-place-per-action rule, PLAN-017 §53).
//
// Honest UX: POST /feedback validates description min 10 chars server-side —
// the submit button mirrors that; success shows «Отправлено, спасибо» and the
// own-submissions list is deliberately NOT built (per scope).
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, MessageSquareWarning } from "lucide-react";
import { submitFeedback, type FeedbackCategory, type FeedbackSeverity } from "@/lib/api/finance";
import { getErrorMessage } from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { useFocusTrap, rememberTrigger, restoreTrigger } from "@/components/ui/focusTrap";

const CATEGORY_OPTIONS: [FeedbackCategory, string][] = [
  ["BUG", "Ошибка / баг"],
  ["UX", "Удобство использования"],
  ["BILLING", "Платежи и баланс"],
  ["CONTENT", "Контент или модерация"],
  ["OTHER", "Другое"],
];

const SEVERITY_OPTIONS: [FeedbackSeverity, string][] = [
  ["LOW", "Низкая"],
  ["MEDIUM", "Средняя"],
  ["HIGH", "Высокая"],
  ["CRITICAL", "Критическая"],
];

export function FeedbackDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<FeedbackCategory>("BUG");
  const [severity, setSeverity] = useState<FeedbackSeverity>("MEDIUM");
  const [description, setDescription] = useState("");
  const [route, setRoute] = useState("");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Prefill the current route each time the dialog opens (browser only).
  useEffect(() => {
    if (open && typeof window !== "undefined") {
      setRoute(window.location.pathname);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      submitFeedback({
        category,
        severity,
        description: description.trim(),
        ...(route.trim() ? { route: route.trim() } : {}),
        ...(screenshotUrl.trim() ? { screenshotUrl: screenshotUrl.trim() } : {}),
      }),
    onSuccess: () => {
      setError(null);
      setSent(true);
      // Короткое честное подтверждение — затем закрытие и сброс формы.
      setTimeout(() => {
        onClose();
        setSent(false);
        setDescription("");
        setScreenshotUrl("");
        setRoute("");
        setSeverity("MEDIUM");
        setCategory("BUG");
      }, 1400);
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось отправить сообщение")),
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

  const descriptionValid = description.trim().length >= 10;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!mutation.isPending) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Сообщить о проблеме"
        className="w-full max-w-md space-y-4 rounded-card border border-line bg-surface-raised p-6 shadow-raised"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
            <MessageSquareWarning className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-content">Сообщить о проблеме</h2>
            <p className="mt-0.5 text-sm text-content-secondary">
              Опишите, что пошло не так — сообщение увидит команда платформы.
            </p>
          </div>
        </div>

        {sent ? (
          <p className="flex items-center gap-2 rounded-card border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden />
            Отправлено, спасибо
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="feedback-category"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Категория
                </label>
                <Select
                  id="feedback-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
                  disabled={mutation.isPending}
                >
                  {CATEGORY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="feedback-severity"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Серьёзность
                </label>
                <Select
                  id="feedback-severity"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as FeedbackSeverity)}
                  disabled={mutation.isPending}
                >
                  {SEVERITY_OPTIONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="feedback-description"
                className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
              >
                Описание
              </label>
              <Textarea
                id="feedback-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Что произошло? Что вы ожидали вместо этого?"
                rows={4}
                disabled={mutation.isPending}
              />
              <p className="text-xs text-content-muted">
                {descriptionValid
                  ? "Можно добавить шаги воспроизведения, если они есть."
                  : "Минимум 10 символов."}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label
                  htmlFor="feedback-route"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Страница (необязательно)
                </label>
                <Input
                  id="feedback-route"
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                  placeholder="/deals"
                  disabled={mutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="feedback-screenshot"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Ссылка на скриншот (необязательно)
                </label>
                <Input
                  id="feedback-screenshot"
                  value={screenshotUrl}
                  onChange={(e) => setScreenshotUrl(e.target.value)}
                  placeholder="https://..."
                  type="url"
                  disabled={mutation.isPending}
                />
              </div>
            </div>

            {error ? <p className="text-sm text-bad">{error}</p> : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={mutation.isPending}
              >
                Отмена
              </Button>
              <Button
                size="sm"
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending || !descriptionValid}
              >
                {mutation.isPending ? "Отправка..." : "Отправить"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}