// PLAN-017 §36: shared admin label maps + small formatters.
// Moved from app/admin/page.tsx (LIFECYCLE_LABELS / REPORT_TARGET_LABELS /
// SERVER_LIFECYCLE_FILTERS / MODERATION_ID_REGEX) and extended for the new
// users/roles/logs sections. Token-safe, no colors here.

// ---------- Lifecycle / server domain (PLAN-005 Q) ----------
export const LIFECYCLE_LABELS: Record<string, string> = {
  CREATED: "Создан",
  PENDING_VERIFICATION: "Ожидает проверки",
  VERIFIED: "Верифицирован",
  ACTIVE: "Активен",
  SUSPENDED: "Приостановлен",
  ARCHIVED: "Архивирован",
};

export const SERVER_LIFECYCLE_FILTERS: [string, string][] = [
  ["all", "Все"],
  ["CREATED", "Создан"],
  ["PENDING_VERIFICATION", "Ожидает проверки"],
  ["VERIFIED", "Верифицирован"],
  ["ACTIVE", "Активен"],
  ["SUSPENDED", "Приостановлен"],
  ["ARCHIVED", "Архивирован"],
];

// ---------- Reports (PLAN-005 R) ----------
export const REPORT_TARGET_LABELS: Record<string, string> = {
  THREAD: "Тема форума",
  POST: "Сообщение",
  REVIEW: "Отзыв",
  NEWS: "Новость",
  SERVER: "Сервер",
  PROFILE: "Профиль",
};

// ---------- Users / roles (PLAN-017 §36) ----------
export const ROLE_LABELS: Record<string, string> = {
  USER: "Пользователь",
  SELLER: "Продавец",
  MODERATOR: "Модератор",
  ADMIN: "Администратор",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

/** Ранг роли для определения «повышения» (и требуемого подтверждения). */
export const ROLE_RANK: Record<string, number> = {
  USER: 0,
  SELLER: 1,
  MODERATOR: 2,
  ADMIN: 3,
};

export const USER_ROLE_FILTERS: [string, string][] = [
  ["all", "Все роли"],
  ["USER", "Пользователи"],
  ["SELLER", "Продавцы"],
  ["MODERATOR", "Модераторы"],
  ["ADMIN", "Администраторы"],
];

export const USER_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Активен",
  SUSPENDED: "Приостановлен",
  BANNED: "Заблокирован",
};

export function userStatusLabel(status: string): string {
  return USER_STATUS_LABELS[status] ?? status;
}

export const USER_STATUS_FILTERS: [string, string][] = [
  ["all", "Все статусы"],
  ["ACTIVE", "Активные"],
  ["SUSPENDED", "Приостановленные"],
  ["BANNED", "Заблокированные"],
];

export const LOG_LEVEL_FILTERS: [string, string][] = [
  ["all", "Все уровни"],
  ["ERROR", "ERROR"],
  ["WARN", "WARN"],
  ["WARNING", "WARNING"],
  ["INFO", "INFO"],
  ["DEBUG", "DEBUG"],
];

/** PLAN-016 D-002: UUID v4 validation (в т.ч. ручной ввод ID в EntityPicker). */
export const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- Formatters ----------

/** Дата+время по-русски; "—" для пустых/битных значений (defensive). */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("ru-RU");
}

/** humanize uptime: 5д 3ч 12м. */
export function formatUptime(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const s = Math.floor(totalSeconds);
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}д`);
  if (hours > 0) parts.push(`${hours}ч`);
  if (parts.length === 0 || minutes > 0) parts.push(`${minutes}м`);
  return parts.join(" ");
}

/** Короткий UUID для таблиц: первые 8 символов + моно-шрифт на стороне UI. */
export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 8 ? id.slice(0, 8) : id;
}