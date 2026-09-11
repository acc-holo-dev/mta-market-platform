// ReportDialog (PLAN-005 F-00x): компактный управляемый диалог жалобы.
// Переиспользуется для тем (THREAD), сообщений (POST), новостей (NEWS),
// серверов (SERVER). Для гостя — редирект на вход (жалобы требуют сессии).
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Flag } from "lucide-react";
import { createReport, getErrorMessage } from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";

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

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submit.isPending) {
        setOpen(false);
        setError(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, submit.isPending]);

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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!submit.isPending) setOpen(false);
          }}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Жалоба"
            className="w-full max-w-md rounded-card border border-line bg-surface p-6 space-y-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-content">Пожаловаться</h2>
            <p className="text-sm text-content-secondary">
              Опишите проблему — жалобу увидит модерация платформы.
            </p>

            {sent ? (
              <p className="rounded-card border border-line bg-surface-raised px-4 py-3 text-sm text-ok">
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