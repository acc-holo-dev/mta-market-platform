// PLAN-017 H §50–§51: premium grant dialog (subjectType + EntityPicker for
// the subject id + kind + note + expiresAt). EntityPicker types are fixed
// (user|resource|server|…) — mapped 1:1 from the entitlement subjectType.
// ConfirmDialog-pattern focus trap; the grant is idempotent server-side, a
// created=false answer is surfaced as an honest «уже выдан» result.
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  grantAdminPremiumEntitlement,
  getErrorMessage,
  type AdminEntitlementGrantResult,
  type AdminPremiumKind,
  type AdminPremiumSubjectType,
} from "@/lib/api/advertising";
import { useFocusTrap, rememberTrigger, restoreTrigger } from "@/components/ui/focusTrap";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { EntityPicker } from "@/components/admin/EntityPicker";
import { shortId } from "@/components/admin/labels";

export const PREMIUM_SUBJECT_TYPE_LABELS: Record<string, string> = {
  USER: "Пользователь",
  RESOURCE: "Ресурс",
  SERVER: "Сервер",
};

export const PREMIUM_KIND_LABELS: Record<string, string> = {
  CREATOR_PREMIUM: "Creator Premium",
  SERVER_PREMIUM: "Server Premium",
  MARKETPLACE_PREMIUM: "Marketplace Premium",
  ADVERTISING_PREMIUM: "Advertising Premium",
  ANALYTICS_PREMIUM: "Analytics Premium",
};

const SUBJECT_TYPES = Object.keys(PREMIUM_SUBJECT_TYPE_LABELS) as AdminPremiumSubjectType[];
const KINDS = Object.keys(PREMIUM_KIND_LABELS) as AdminPremiumKind[];

/** subjectType → EntityPicker entityType (фиксированные типы пикера). */
function pickerType(subjectType: AdminPremiumSubjectType): "user" | "resource" | "server" {
  if (subjectType === "RESOURCE") return "resource";
  if (subjectType === "SERVER") return "server";
  return "user";
}

export function AdminGrantDialog({
  onClose,
  onGranted,
}: {
  onClose: () => void;
  /** Вызывается после успешного ответа (в т.ч. idempotent created=false). */
  onGranted: (result: AdminEntitlementGrantResult) => void;
}) {
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);

  const [subjectType, setSubjectType] = useState<AdminPremiumSubjectType>("USER");
  const [subjectId, setSubjectId] = useState("");
  const [kind, setKind] = useState<AdminPremiumKind>("CREATOR_PREMIUM");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  // Смена типа субъекта сбрасывает выбор (ID принадлежит другой таблице).
  useEffect(() => {
    setSubjectId("");
  }, [subjectType]);

  useEffect(() => {
    rememberTrigger(document.activeElement as HTMLElement | null);
  }, []);
  useFocusTrap(true, ref, { onEscape: onClose, autofocus: true });
  useEffect(() => {
    return () => restoreTrigger();
  }, []);

  const expiresIso = expiresAt ? new Date(expiresAt) : null;
  const expiresInvalid = Boolean(expiresAt && (!expiresIso || Number.isNaN(expiresIso.getTime())));

  const grant = useMutation({
    mutationFn: () => {
      const iso = expiresIso && !Number.isNaN(expiresIso.getTime()) ? expiresIso.toISOString() : undefined;
      return grantAdminPremiumEntitlement({
        subjectType,
        subjectId: subjectId.trim(),
        kind,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(iso ? { expiresAt: iso } : {}),
      });
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["admin", "premium"] });
      qc.invalidateQueries({ queryKey: ["admin", "overview"] });
      onGranted(result);
      onClose();
    },
  });

  const submitDisabled = !subjectId.trim() || expiresInvalid || grant.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Выдать премиум-план"
        className="w-full max-w-lg space-y-4 overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-content">Выдать премиум-план</h2>
        <p className="text-sm text-content-secondary">
          Выдача идемпотентна: если активная выдача этого плана субъекту уже существует, ничего не
          изменится.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              Тип субъекта *
            </span>
            <Select
              value={subjectType}
              onChange={(e) => setSubjectType(e.target.value as AdminPremiumSubjectType)}
              disabled={grant.isPending}
              aria-label="Тип субъекта"
            >
              {SUBJECT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PREMIUM_SUBJECT_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              План *
            </span>
            <Select
              value={kind}
              onChange={(e) => setKind(e.target.value as AdminPremiumKind)}
              disabled={grant.isPending}
              aria-label="План"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {PREMIUM_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </label>
        </div>

        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
            Субъект *
          </span>
          <EntityPicker
            key={subjectType}
            entityType={pickerType(subjectType)}
            value={subjectId}
            onChange={setSubjectId}
            placeholder={`Поиск: ${PREMIUM_SUBJECT_TYPE_LABELS[subjectType].toLowerCase()}`}
            ariaLabel="Субъект выдачи"
          />
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
            Заметка
          </span>
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={grant.isPending}
            maxLength={500}
            placeholder="Причина/основание выдачи (необязательно)"
            aria-label="Заметка"
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
            Истекает (необязательно)
          </span>
          <Input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={grant.isPending}
            aria-label="Истекает"
            aria-invalid={expiresInvalid}
          />
        </label>

        {expiresInvalid ? (
          <p className="text-xs text-bad" role="alert">
            Некорректная дата окончания.
          </p>
        ) : null}
        {grant.error ? (
          <p className="text-sm text-bad" role="alert">
            {getErrorMessage(grant.error, "Не удалось выдать премиум-план")}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="min-w-0 truncate font-mono text-[11px] text-content-muted">
            {subjectId ? `ID: ${shortId(subjectId)}` : "Субъект не выбран"}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={grant.isPending}>
              Отмена
            </Button>
            <Button size="sm" onClick={() => grant.mutate()} disabled={submitDisabled}>
              {grant.isPending ? "Выдаю..." : "Выдать"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}