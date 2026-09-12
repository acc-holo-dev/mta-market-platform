// PLAN-017 G §46: advertising domain labels (RU) + tone helpers.
// Local to the advertising feature: components/admin/labels.ts is a shared
// file outside this wave's ownership, so the advertising enums live here.
import { getErrorMessage } from "@/lib/api/advertising";

export const AD_PLACEMENT_LABELS: Record<string, string> = {
  HOME_HERO: "Главный экран (hero)",
  HOME_RAIL_SECONDARY: "Главная — вторичный рельс",
  MARKET_FEATURED: "Маркет — рекомендуемое",
  SERVER_FEATURED: "Серверы — рекомендуемое",
  COMMUNITY_FEATURED: "Сообщество — рекомендуемое",
};

export const AD_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Черновик",
  SCHEDULED: "Запланирована",
  ACTIVE: "Активна",
  PAUSED: "Пауза",
  EXPIRED: "Истекла",
  CANCELLED: "Отменена",
};

export const AD_REVIEW_LABELS: Record<string, string> = {
  PENDING: "На рассмотрении",
  APPROVED: "Одобрена",
  REJECTED: "Отклонена",
};

export const AD_PLACEMENT_FILTERS: [string, string][] = [
  ["all", "Все размещения"],
  ...Object.entries(AD_PLACEMENT_LABELS),
];

export const AD_STATUS_FILTERS: [string, string][] = [
  ["all", "Все статусы"],
  ...Object.entries(AD_STATUS_LABELS),
];

export const AD_REVIEW_FILTERS: [string, string][] = [
  ["all", "Всё ревью"],
  ...Object.entries(AD_REVIEW_LABELS),
];

export function adPlacementLabel(placement: string | null | undefined): string {
  if (!placement) return "—";
  return AD_PLACEMENT_LABELS[placement] ?? placement;
}

export function adStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return AD_STATUS_LABELS[status] ?? status;
}

export function adReviewLabel(review: string | null | undefined): string {
  if (!review) return "—";
  return AD_REVIEW_LABELS[review] ?? review;
}

export type AdminChipTone = "ok" | "warn" | "bad" | "info" | "muted";

export function adStatusTone(status: string | null | undefined): AdminChipTone {
  if (status === "ACTIVE") return "ok";
  if (status === "SCHEDULED") return "info";
  if (status === "PAUSED") return "warn";
  if (status === "CANCELLED") return "bad";
  return "muted";
}

export function adReviewTone(review: string | null | undefined): AdminChipTone {
  if (review === "APPROVED") return "ok";
  if (review === "PENDING") return "warn";
  if (review === "REJECTED") return "bad";
  return "muted";
}

/** Content edits allowed only while DRAFT/PAUSED or review REJECTED (409 otherwise). */
export function campaignEditable(campaign: { status?: string | null; reviewStatus?: string | null }): boolean {
  return (
    campaign.status === "DRAFT" ||
    campaign.status === "PAUSED" ||
    campaign.reviewStatus === "REJECTED"
  );
}

/** DELETE is allowed only for DRAFT/REJECTED (mirrors the server guard). */
export function campaignDeletable(campaign: { status?: string | null }): boolean {
  return campaign.status === "DRAFT" || campaign.status === "REJECTED";
}

const TRANSITION_GUARD_RULES: [RegExp, (raw: string) => string][] = [
  [/^Only PENDING campaigns can be approved/i, () => "Одобрить можно только кампанию на рассмотрении."],
  [/^Only PENDING campaigns can be rejected/i, () => "Отклонить можно только кампанию на рассмотрении."],
  [
    /^Campaign must be APPROVED and DRAFT\|SCHEDULED\|PAUSED to activate/i,
    () => "Активировать можно только одобренную кампанию в статусе черновика, паузы или запланированной.",
  ],
  [/^Campaign window already ended/i, () => "Окно кампании уже закончилось (окончание в прошлом)."],
  [/^Only ACTIVE campaigns can be paused/i, () => "Паузу можно поставить только активной кампании."],
  [/^Only PAUSED campaigns can be resumed/i, () => "Возобновить можно только кампанию на паузе."],
  [/^Campaign is already (CANCELLED|EXPIRED)/i, () => "Кампания уже завершена — переход недоступен."],
  [/^Campaign state changed concurrently/i, () => "Статус кампании изменился параллельно; повторите попытку."],
  [/^Campaign is not editable in status/i, () => "Кампания недоступна для редактирования в текущем статусе."],
  [/^Only DRAFT or REJECTED campaigns can be deleted/i, () => "Удалить можно только черновик или отклонённую кампанию."],
  [/^endsAt must be after startsAt/i, () => "Окончание показа должно быть позже начала."],
  [/^Nothing to update/i, () => "Нет изменений для сохранения."],
  [/^reason is required to reject/i, () => "Укажите причину отклонения."],
];

/**
 * Humanize campaign transition/edit errors: known state-guard texts get RU
 * wording, everything else goes through getErrorMessage + the action fallback.
 */
export function humanizeCampaignError(e: unknown, fallback: string): string {
  const raw = getErrorMessage(e, "");
  if (raw) {
    for (const [pattern, message] of TRANSITION_GUARD_RULES) {
      if (pattern.test(raw)) return message(raw);
    }
  }
  return getErrorMessage(e, fallback);
}