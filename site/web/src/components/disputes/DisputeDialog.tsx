"use client";

// Dispute dialog: opens a dispute for a PURCHASE or SERVICE_PURCHASE (task 5).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { createDispute, getErrorMessage } from "@/lib/api-ext";

interface Props {
  targetType: "PURCHASE" | "SERVICE_PURCHASE";
  purchaseId?: string;
  servicePurchaseId?: string;
}

export function DisputeDialog({ targetType, purchaseId, servicePurchaseId }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      createDispute(
        targetType === "PURCHASE"
          ? { targetType, purchaseId, reason }
          : { targetType, servicePurchaseId, reason }
      ),
    onSuccess: () => {
      setDone(true);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["my-disputes"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось открыть спор")),
  });

  if (done) {
    return (
      <Button variant="outline" size="sm" onClick={() => (window.location.href = "/disputes")}>
        Спор открыт — перейти к спорам
      </Button>
    );
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Открыть спор
      </Button>
    );
  }

  return (
    <div className="border border-slate-300 dark:border-slate-700 rounded-lg p-4 space-y-3">
      <p className="text-sm font-medium">Причина спора</p>
      <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Опишите проблему" />
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!reason.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Отправка..." : "Отправить"}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
