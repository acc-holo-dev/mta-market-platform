// ReportDialog (PLAN-005 F-00x): компактный управляемый диалог жалобы.
// Переиспользуется для тем (THREAD), сообщений (POST), новостей (NEWS),
// серверов (SERVER). Для гостя — редирект на вход (жалобы требуют сессии).
// PLAN-013: unified overlay на токенах — raised-поверхность, shadow-raised,
// accent-soft иконка; поведение (open/close/submit) не изменено.
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, Flag } from "lucide-react";
import { createReport, getErrorMessage } from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { useFocusTrap, rememberTrigger, restoreTrigger } from "@/components/ui/focusTrap";

export function ReportDialog({
  targetType,
  targetId,
  label = "Пожаловаться",
  className,
}: {
  targetType: string;
  targetId: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const submit = useMutation({
    mutationFn: () => createReport(targetType, targetId, reason.trim()),
    onSuccess: () => {
      setError(null);
      setSent(true);
      // Короткое подтверждение — затем закрываем и сбрасываем форму.
      setTimeout(() => {
        setOpen(false);
        setSent(false);
        setReason("");
      }, 1400);
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось отправить жалобу")),
  });

  // PLAN-016 D-004: Esc + Tab-цикл внутри диалога; фокус возвращается на
  // триггер после закрытия.
  useEffect(() => {
    if (open) rememberTrigger(document.activeElement as HTMLElement | null);
  }, [open]);
  useFocusTrap(open, dialogRef, {
    onEscape: () => {
      if (!submit.isPending) {
        setOpen(false);
        setError(null);
      }
    },
    autofocus: open,
  });
  useEffect(() => {
    if (!open) restoreTrigger();
  }, [open]);

  const openDialog = () => {
    if (!isAuthenticated()) {
      router.push("/auth/login");
      return;
    }
    setError(null);
    setSent(false);
    setOpen(true);
  };

  return (
    <>
      <Button variant="ghost" size="sm" className={className} onClick={openDialog}>
        <Flag className="mr-1.5 h-3.5 w-3.5" aria-hidden />
        {label}
      </Button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
          onClick={() => {
            if (!submit.isPending) setOpen(false);
          }}
          role="presentation"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Жалоба"
            className="w-full max-w-md space-y-4 rounded-lg border border-line bg-surface-raised p-6 shadow-raised"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent-strong">
                <Flag className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-content">Пожаловаться</h2>
                <p className="mt-0.5 text-sm text-content-secondary">
                  Опишите проблему — жалобу увидит модерация платформы.
                </p>
              </div>
            </div>

            {sent ? (
              <p className="flex items-center gap-2 rounded-card border border-ok/30 bg-ok-soft px-4 py-3 text-sm text-ok">
                <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden />
                Жалоба отправлена
              </p>
            ) : (
              <>
                <Textarea
                  aria-label="Причина жалобы"
                  placeholder="Что не так с этим материалом?"
                  value={reason}
                  rows={4}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={submit.isPending}
                />
                {error ? <p className="text-sm text-bad">{error}</p> : null}
                <div className="flex justify-end gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setOpen(false)}
                    disabled={submit.isPending}
                  >
                    Отмена
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => submit.mutate()}
                    disabled={submit.isPending || reason.trim().length === 0}
                  >
                    {submit.isPending ? "Отправка..." : "Отправить"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}