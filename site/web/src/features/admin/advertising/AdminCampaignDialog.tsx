// PLAN-017 G §46–§48: create/edit campaign dialog for the advertising control
// center. Follows the ConfirmDialog/AdminReasonDialog pattern (focus trap, Esc,
// overlay click, focus restore). Create → POST, edit → PATCH (advertiserId is
// not editable server-side, so it is only offered in create mode).
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createAdminCampaign,
  updateAdminCampaign,
  type AdminAdCampaign,
} from "@/lib/api/advertising";
import { useFocusTrap, rememberTrigger, restoreTrigger } from "@/components/ui/focusTrap";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { EntityPicker } from "@/components/admin/EntityPicker";
import { AD_PLACEMENT_LABELS, campaignEditable, humanizeCampaignError } from "./labels";

const PRIORITY_MIN = -10_000;
const PRIORITY_MAX = 10_000;

/** ISO datetime → datetime-local input value (local time, minutes precision). */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local input value → ISO (UTC), undefined when empty/invalid. */
function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function AdminCampaignDialog({
  campaign,
  onClose,
}: {
  /** null = create mode; otherwise edit mode for this campaign. */
  campaign: AdminAdCampaign | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const ref = useRef<HTMLDivElement>(null);
  const isEdit = campaign !== null;
  const editable = !isEdit || campaignEditable(campaign);

  const [name, setName] = useState(campaign?.name ?? "");
  const [placement, setPlacement] = useState(campaign?.placement ?? "HOME_HERO");
  const [title, setTitle] = useState(campaign?.title ?? "");
  const [body, setBody] = useState(campaign?.body ?? "");
  const [imageUrl, setImageUrl] = useState(campaign?.imageUrl ?? "");
  const [ctaLabel, setCtaLabel] = useState(campaign?.ctaLabel ?? "");
  const [ctaUrl, setCtaUrl] = useState(campaign?.ctaUrl ?? "");
  const [priority, setPriority] = useState(
    campaign?.priority != null ? String(campaign.priority) : "0"
  );
  const [startsAt, setStartsAt] = useState(isoToLocalInput(campaign?.startsAt));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(campaign?.endsAt));
  const [advertiserId, setAdvertiserId] = useState("");

  // Глобальное закрытие по Esc/фокус-ловушка (как в ConfirmDialog).
  useEffect(() => {
    rememberTrigger(document.activeElement as HTMLElement | null);
  }, []);
  useFocusTrap(true, ref, { onEscape: onClose, autofocus: true });
  useEffect(() => {
    return () => restoreTrigger();
  }, []);

  const startsIso = localInputToIso(startsAt);
  const endsIso = localInputToIso(endsAt);
  const priorityValue = priority.trim() === "" ? null : Number(priority);
  const priorityInvalid =
    priorityValue !== null &&
    (!Number.isFinite(priorityValue) ||
      !Number.isInteger(priorityValue) ||
      priorityValue < PRIORITY_MIN ||
      priorityValue > PRIORITY_MAX);
  const windowInvalid = Boolean(startsIso && endsIso && new Date(endsIso).getTime() <= new Date(startsIso).getTime());
  const requiredMissing = !name.trim() || !title.trim() || !body.trim() || !placement;
  const submitDisabled = requiredMissing || priorityInvalid || windowInvalid;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin", "advertising"] });
    qc.invalidateQueries({ queryKey: ["admin", "overview"] });
  };

  const create = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        placement,
        title: title.trim(),
        body: body.trim(),
        ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        ...(ctaLabel.trim() ? { ctaLabel: ctaLabel.trim() } : {}),
        ...(ctaUrl.trim() ? { ctaUrl: ctaUrl.trim() } : {}),
        ...(priorityValue !== null && Number.isFinite(priorityValue)
          ? { priority: Math.trunc(priorityValue) }
          : {}),
        ...(startsIso ? { startsAt: startsIso } : {}),
        ...(endsIso ? { endsAt: endsIso } : {}),
        ...(advertiserId.trim() ? { advertiserId: advertiserId.trim() } : {}),
      };
      return createAdminCampaign(payload);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const update = useMutation({
    mutationFn: () => {
      if (!campaign) {
        // Диалог создаётся только с кампанией (см. ключ в AdvertisingSection).
        throw new Error("Campaign is not selected");
      }
      const payload = {
        name: name.trim(),
        placement,
        title: title.trim(),
        body: body.trim(),
        ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
        ...(ctaLabel.trim() ? { ctaLabel: ctaLabel.trim() } : {}),
        ...(ctaUrl.trim() ? { ctaUrl: ctaUrl.trim() } : {}),
        ...(priorityValue !== null && Number.isFinite(priorityValue)
          ? { priority: Math.trunc(priorityValue) }
          : {}),
        ...(startsIso ? { startsAt: startsIso } : {}),
        ...(endsIso ? { endsAt: endsIso } : {}),
      };
      return updateAdminCampaign(campaign.id, payload);
    },
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const busy = create.isPending || update.isPending;
  const mutationError =
    create.error ?? update.error
      ? humanizeCampaignError(
          create.error ?? update.error,
          isEdit ? "Не удалось сохранить кампанию" : "Не удалось создать кампанию"
        )
      : null;

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
        aria-label={isEdit ? "Изменение кампании" : "Новая кампания"}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-content">
          {isEdit ? "Изменение кампании" : "Новая рекламная кампания"}
        </h2>
        {isEdit && !editable ? (
          <p className="mt-2 rounded-md border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn" role="alert">
            Кампания недоступна для редактирования в статусе «
            {campaign.status ?? "—"}/{campaign.reviewStatus ?? "—"}» — менять содержимое можно только
            в черновике, на паузе или после отклонения ревью.
          </p>
        ) : null}

        <div className="mt-4 space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              Название кампании *
            </span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!editable || busy}
              maxLength={120}
              placeholder="Внутреннее название"
              aria-label="Название кампании"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Размещение *
              </span>
              <Select
                value={placement}
                onChange={(e) => setPlacement(e.target.value)}
                disabled={!editable || busy}
                aria-label="Размещение"
              >
                {Object.entries(AD_PLACEMENT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Приоритет ({PRIORITY_MIN}…{PRIORITY_MAX})
              </span>
              <Input
                type="number"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                disabled={!editable || busy}
                min={PRIORITY_MIN}
                max={PRIORITY_MAX}
                step={1}
                aria-label="Приоритет"
                aria-invalid={priorityInvalid}
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              Заголовок объявления *
            </span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!editable || busy}
              maxLength={120}
              aria-label="Заголовок объявления"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              Текст объявления *
            </span>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={!editable || busy}
              maxLength={500}
              rows={3}
              aria-label="Текст объявления"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Ссылка на картинку
              </span>
              <Input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                disabled={!editable || busy}
                maxLength={500}
                placeholder="https://…"
                aria-label="Ссылка на картинку"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Надпись кнопки (CTA)
              </span>
              <Input
                value={ctaLabel}
                onChange={(e) => setCtaLabel(e.target.value)}
                disabled={!editable || busy}
                maxLength={60}
                aria-label="Надпись кнопки"
              />
            </label>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
              Ссылка кнопки (CTA)
            </span>
            <Input
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              disabled={!editable || busy}
              maxLength={500}
              placeholder="https://…"
              aria-label="Ссылка кнопки"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Начало показа
              </span>
              <Input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                disabled={!editable || busy}
                aria-label="Начало показа"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Окончание показа
              </span>
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                disabled={!editable || busy}
                aria-label="Окончание показа"
                aria-invalid={windowInvalid}
              />
            </label>
          </div>

          {isEdit ? (
            <div className="rounded-md border border-line bg-surface-raised p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Рекламодатель
              </p>
              <p className="mt-1 font-mono text-xs text-content-secondary">
                {campaign.advertiser?.username
                  ? `@${campaign.advertiser.username}`
                  : campaign.advertiser?.displayName || campaign.advertiserId || "—"}
              </p>
              <p className="mt-1 text-xs text-content-muted">Рекламодатель не меняется после создания.</p>
            </div>
          ) : (
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Рекламодатель
              </span>
              <EntityPicker
                entityType="user"
                value={advertiserId}
                onChange={setAdvertiserId}
                placeholder="Поиск рекламодателя (необязательно — по умолчанию вы)"
                ariaLabel="Рекламодатель"
              />
            </div>
          )}

          {priorityInvalid ? (
            <p className="text-xs text-bad" role="alert">
              Приоритет — целое число от {PRIORITY_MIN} до {PRIORITY_MAX}.
            </p>
          ) : null}
          {windowInvalid ? (
            <p className="text-xs text-bad" role="alert">
              Окончание показа должно быть позже начала.
            </p>
          ) : null}
          {mutationError ? (
            <p className="text-sm text-bad" role="alert">
              {mutationError}
            </p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={() => (isEdit ? update.mutate() : create.mutate())}
            disabled={busy || !editable || submitDisabled}
          >
            {busy ? "Сохраняю..." : isEdit ? "Сохранить" : "Создать кампанию"}
          </Button>
        </div>
      </div>
    </div>
  );
}