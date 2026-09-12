// PLAN-018 Wave-6 I-003: подписка на события цены ресурса — «Следить за ценой».
// Диалог с тремя чекбоксами событий (PRICE_DROP / DISCOUNT_STARTED /
// VERSION_RELEASED) и опциональной целевой ценой (ввод в рублях, отправка в
// копейках/минорных единицах). PUT /resources/:slug/alert — upsert,
// DELETE — деактивация. Активное состояние честно читается из GET /me/alerts
// (единый кэш ["alerts","mine"] со страницей ресурса).
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { putResourceAlert, deleteResourceAlert, fetchMyAlerts, type PriceAlertEvent } from "@/lib/api/resources";
import { getErrorMessage, formatRub } from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useFocusTrap, rememberTrigger, restoreTrigger } from "@/components/ui/focusTrap";
import { BellRing, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// namespaced query key (общий для диалога и страницы ресурса)
export const myAlertsKey = () => ["alerts", "mine"] as const;

const EVENT_OPTIONS: { event: PriceAlertEvent; label: string; hint: string }[] = [
  { event: "PRICE_DROP", label: "Снижение цены", hint: "уведомим, когда цена упадёт ниже целевой" },
  { event: "DISCOUNT_STARTED", label: "Начало скидки", hint: "уведомим о старте скидочной кампании" },
  { event: "VERSION_RELEASED", label: "Выход новой версии", hint: "уведомим о публикации новой версии" },
];

/** "149.9" / "149,90" → 14990 kopecks; null when empty/invalid. */
function parseRubToKopecks(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".").replace(/\s/g, "");
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function PriceAlertDialog({
  slug,
  open,
  onClose,
  basePriceKopecks,
}: {
  slug: string;
  open: boolean;
  onClose: () => void;
  /** Текущая цена ресурса (копейки) — подсказка в поле целевой цены. */
  basePriceKopecks: number;
}) {
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) rememberTrigger(document.activeElement as HTMLElement | null);
  }, [open]);
  useFocusTrap(open, ref, { onEscape: onClose, autofocus: open });
  useEffect(() => {
    if (!open) restoreTrigger();
  }, [open]);

  const { data: mine } = useQuery({
    queryKey: myAlertsKey(),
    queryFn: fetchMyAlerts,
    enabled: open,
    staleTime: 30_000,
    retry: false,
  });
  const existing = (mine?.data ?? []).find((a) => a.resource?.slug === slug) ?? null;
  const activeNow = Boolean(existing?.active);

  const [events, setEvents] = useState<Set<PriceAlertEvent>>(new Set(["VERSION_RELEASED"]));
  const [priceInput, setPriceInput] = useState("");
  const [formTouched, setFormTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from the server state when the dialog opens (once per open).
  useEffect(() => {
    if (!open) return;
    setFormTouched(false);
    setError(null);
    if (existing) {
      setEvents(new Set(existing.events?.length ? existing.events : ["VERSION_RELEASED"]));
      setPriceInput(
        existing.targetPriceMinor != null ? (existing.targetPriceMinor / 100).toFixed(2).replace(/\.00$/, "") : ""
      );
    } else {
      setEvents(new Set(["VERSION_RELEASED"]));
      setPriceInput("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, existing?.id]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const targetPriceMinor = parseRubToKopecks(priceInput);
      return putResourceAlert(slug, {
        events: [...events],
        ...(targetPriceMinor != null ? { targetPriceMinor } : { targetPriceMinor: null }),
      });
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: myAlertsKey() });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось сохранить оповещение")),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteResourceAlert(slug),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: myAlertsKey() });
      onClose();
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось отключить оповещение")),
  });

  if (!open) return null;

  const toggleEvent = (event: PriceAlertEvent) => {
    setFormTouched(true);
    setEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  };

  const targetKopecks = parseRubToKopecks(priceInput);
  const priceInvalid = priceInput.trim() !== "" && targetKopecks == null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Следить за ценой"
        className="w-full max-w-md rounded-card border border-line bg-surface p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-content">Следить за ценой</h2>
            <p className="text-sm text-content-secondary">
              {activeNow
                ? "Оповещения включены для этого ресурса."
                : "Выберите события — уведомления придут в колокольчик."}
            </p>
          </div>
          {activeNow ? (
            <span className="mt-1 inline-flex flex-shrink-0 items-center gap-1 rounded-pill bg-ok-soft px-2 py-0.5 text-xs font-medium text-ok">
              <BellRing className="h-3 w-3" aria-hidden /> Включено
            </span>
          ) : null}
        </div>

        <div className="space-y-2" role="group" aria-label="События оповещения">
          {EVENT_OPTIONS.map(({ event, label, hint }) => (
            <label
              key={event}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-line px-3 py-2.5 text-sm transition-colors duration-fast has-[:checked]:border-accent has-[:checked]:bg-accent-soft/40"
            >
              <input
                type="checkbox"
                checked={events.has(event)}
                onChange={() => toggleEvent(event)}
                className="mt-0.5 accent-accent"
                aria-label={label}
              />
              <span className="min-w-0">
                <span className="block font-medium text-content">{label}</span>
                <span className="block text-xs text-content-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="target-price"
            className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
          >
            Целевая цена (для «Снижение цены»)
          </label>
          <Input
            id="target-price"
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            value={priceInput}
            onChange={(e) => {
              setFormTouched(true);
              setPriceInput(e.target.value);
            }}
            placeholder={basePriceKopecks > 0 ? formatRub(basePriceKopecks) : "Например, 300"}
            aria-invalid={priceInvalid || undefined}
          />
          <p className="text-xs text-content-muted">
            {priceInvalid
              ? "Введите число больше или равно 0."
              : targetKopecks != null
                ? `Уведомим, когда цена опустится ниже ${formatRub(targetKopecks)}.`
                : "Необязательно — оставьте пустым, чтобы следить только за событиями."}
          </p>
        </div>

        {error ? (
          <p className="text-sm text-bad" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2 pt-1">
          {activeNow ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Отключаем..." : "Отключить оповещения"}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Отмена
            </Button>
            <Button
              size="sm"
              disabled={events.size === 0 || priceInvalid || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? (
                "Сохраняем..."
              ) : (
                <>
                  <Check className="mr-1 h-4 w-4" aria-hidden />
                  Сохранить
                </>
              )}
            </Button>
          </span>
        </div>
        {!formTouched && !activeNow && events.size === 0 ? (
          <p className="text-xs text-content-muted">Выберите хотя бы одно событие.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Иконка-кнопка активного состояния (используется рядом с заголовком). */
export function AlertActiveChip({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-pill bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok"
      )}
      title="Оповещения о цене включены"
    >
      <BellRing className="h-3 w-3" aria-hidden /> Цена
    </span>
  );
}
