// PLAN L-002: permission model.
// Central place deciding WHO may do WHAT. Roles group permissions: a plain
// USER gains seller capabilities through an APPROVED SellerProfile (L-001);
// ADMIN/MODERATOR carry platform privileges. Route handlers call these
// helpers instead of scattering role checks.
//
// PLAN-017 §36–§41: typed permission catalog + role bundles for the admin
// platform. The UserRole enum is now USER|SELLER|MODERATOR|SUPPORT|FINANCE|
// ADMIN|SUPERADMIN; every staff role resolves to a flat permission set.

import { db } from "../prisma/db.js";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AuthRequest } from "./auth.js";

export type Actor = {
  userId: string;
  role: "USER" | "ADMIN" | "MODERATOR";
};

export function isAdminOrModerator(actor: Pick<Actor, "role">): boolean {
  return actor.role === "ADMIN" || actor.role === "MODERATOR";
}

export function isAdmin(actor: Pick<Actor, "role">): boolean {
  return actor.role === "ADMIN";
}

/**
 * L-001: seller publish/create capability. A user can create and submit
 * resources/services only with an APPROVED seller profile (moderators and
 * admins are always allowed — they moderate the marketplace).
 */
export async function canCreateListings(actor: Actor): Promise<boolean> {
  if (isAdminOrModerator(actor)) return true;
  const profile = await db.orm.public.SellerProfile
    .where({ userId: actor.userId, status: "APPROVED" })
    .first();
  return profile != null;
}

/** Human-readable reason for a denied listing action (for API responses). */
export function sellerGateMessage(): string {
  return "Seller approval required. Apply at POST /seller/apply and wait for moderation.";
}

/**
 * K-001: a purchase is a valid review basis only when the buyer is not the
 * seller of the resource (self-purchase review fraud).
 */
export async function isSelfPurchase(purchaseId: string, buyerId: string): Promise<boolean> {
  const purchase = await db.orm.public.Purchase.where({ id: purchaseId }).first();
  if (!purchase) return false;
  const resource = await db.orm.public.Resource
    .where({ id: purchase.resourceId })
    .first();
  return resource?.sellerId === buyerId;
}

// ---------------------------------------------------------------------------
// PLAN-017 §36: permission catalog (dot-notation keys, ru labels).
// ---------------------------------------------------------------------------

export const PERMISSIONS = [
  {
    key: "users.view",
    label: "Просмотр пользователей",
    description: "Доступ к списку и профилям пользователей платформы.",
    group: "users",
  },
  {
    key: "users.manage",
    label: "Управление пользователями",
    description: "Изменение профилей и статусов пользователей.",
    group: "users",
  },
  {
    key: "users.suspend",
    label: "Блокировка пользователей",
    description: "Блокировка и разблокировка аккаунтов с отзывом сессий.",
    group: "users",
  },
  {
    key: "resources.view",
    label: "Просмотр ресурсов",
    description: "Доступ к каталогу ресурсов во всех статусах.",
    group: "resources",
  },
  {
    key: "resources.moderate",
    label: "Модерация ресурсов",
    description: "Одобрение, отклонение и скрытие ресурсов.",
    group: "resources",
  },
  {
    key: "resources.publish",
    label: "Публикация ресурсов",
    description: "Перевод ресурсов в статус «Опубликован».",
    group: "resources",
  },
  {
    key: "servers.view",
    label: "Просмотр серверов",
    description: "Доступ к реестру игровых серверов.",
    group: "servers",
  },
  {
    key: "servers.manage",
    label: "Управление серверами",
    description: "Верификация, приостановка и управление серверами.",
    group: "servers",
  },
  {
    key: "services.view",
    label: "Просмотр услуг",
    description: "Доступ к каталогу услуг продавцов.",
    group: "services",
  },
  {
    key: "services.moderate",
    label: "Модерация услуг",
    description: "Одобрение и скрытие услуг.",
    group: "services",
  },
  {
    key: "community.view",
    label: "Просмотр сообщества",
    description: "Доступ к форуму, новостям и обсуждениям.",
    group: "community",
  },
  {
    key: "community.moderate",
    label: "Модерация сообщества",
    description: "Модерация тредов, сообщений и новостей серверов.",
    group: "community",
  },
  {
    key: "content.view",
    label: "Просмотр контента",
    description: "Доступ к статьям и редакционному контенту.",
    group: "content",
  },
  {
    key: "content.moderate",
    label: "Модерация контента",
    description: "Редактирование и публикация статей.",
    group: "content",
  },
  {
    key: "reports.view",
    label: "Просмотр жалоб",
    description: "Доступ к очереди жалоб пользователей.",
    group: "reports",
  },
  {
    key: "reports.resolve",
    label: "Обработка жалоб",
    description: "Разрешение и отклонение жалоб.",
    group: "reports",
  },
  {
    key: "disputes.view",
    label: "Просмотр споров",
    description: "Доступ к спорам по заказам и покупкам.",
    group: "disputes",
  },
  {
    key: "disputes.resolve",
    label: "Разрешение споров",
    description: "Вынесение решений по спорам.",
    group: "disputes",
  },
  {
    key: "finance.view",
    label: "Просмотр финансов",
    description: "Доступ к платежам, выручке и балансам.",
    group: "finance",
  },
  {
    key: "finance.refund",
    label: "Возвраты средств",
    description: "Проведение возвратов по платежам.",
    group: "finance",
  },
  {
    key: "finance.payout",
    label: "Выплаты продавцам",
    description: "Управление выплатами продавцам.",
    group: "finance",
  },
  {
    key: "advertising.view",
    label: "Просмотр рекламы",
    description: "Доступ к рекламным кампаниям и метрикам.",
    group: "advertising",
  },
  {
    key: "advertising.manage",
    label: "Управление рекламой",
    description: "Создание и управление рекламными кампаниями.",
    group: "advertising",
  },
  {
    key: "premium.view",
    label: "Просмотр премиум-доступа",
    description: "Доступ к активным премиум-правам.",
    group: "premium",
  },
  {
    key: "premium.manage",
    label: "Управление премиум-доступом",
    description: "Выдача и отзыв премиум-прав.",
    group: "premium",
  },
  {
    key: "audit.view",
    label: "Просмотр журнала аудита",
    description: "Чтение append-only журнала действий администраторов.",
    group: "audit",
  },
  {
    key: "logs.view",
    label: "Просмотр системных журналов",
    description: "Чтение технических системных журналов платформы.",
    group: "system",
  },
  {
    key: "system.manage",
    label: "Управление системой",
    description: "Системные операции: фичефлаги, обслуживание, ретеншн.",
    group: "system",
  },
  {
    key: "roles.manage",
    label: "Управление ролями",
    description: "Назначение ролей пользователям (с защитой последнего SUPERADMIN).",
    group: "roles",
  },
  // PLAN-017 §40: read access to the role/permission matrix. The §36 key
  // list omits it while the /admin/roles and /admin/permissions routes
  // require it — added as a catalog entry (see route permission mapping).
  {
    key: "roles.view",
    label: "Просмотр ролей",
    description: "Просмотр ролевой модели и каталога прав.",
    group: "roles",
  },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export type PlatformRole =
  | "USER"
  | "SELLER"
  | "MODERATOR"
  | "SUPPORT"
  | "FINANCE"
  | "ADMIN"
  | "SUPERADMIN";

const ALL_PERMISSION_KEYS: string[] = PERMISSIONS.map((p) => p.key);

/** ROLE_PERMISSIONS[role] — explicit bundles per §37/§40. */
export const ROLE_PERMISSIONS: Record<PlatformRole, readonly string[]> = {
  // SUPERADMIN implicitly holds everything (catalog-derived, never stale).
  SUPERADMIN: ALL_PERMISSION_KEYS,
  ADMIN: ALL_PERMISSION_KEYS,
  FINANCE: [
    "finance.view",
    "finance.refund",
    "finance.payout",
    "disputes.view",
    "reports.view",
    "users.view",
    "audit.view",
  ],
  SUPPORT: [
    "users.view",
    "users.suspend",
    "reports.view",
    "reports.resolve",
    "disputes.view",
    "disputes.resolve",
    "community.view",
    "community.moderate",
    "audit.view",
  ],
  MODERATOR: [
    "resources.view",
    "resources.moderate",
    "resources.publish",
    "servers.view",
    "servers.manage",
    "services.view",
    "services.moderate",
    "community.view",
    "community.moderate",
    "content.view",
    "content.moderate",
    "reports.view",
    "reports.resolve",
    "disputes.view",
    "users.view",
    "audit.view",
  ],
  // Platform participants: no admin capabilities.
  SELLER: [],
  USER: [],
};

/** Stable display order of the UserRole enum. */
export const ROLE_ORDER: readonly PlatformRole[] = [
  "USER",
  "SELLER",
  "MODERATOR",
  "SUPPORT",
  "FINANCE",
  "ADMIN",
  "SUPERADMIN",
];

/** Russian role labels (§36). */
export const ROLE_LABELS: Record<PlatformRole, string> = {
  USER: "Пользователь",
  SELLER: "Продавец",
  MODERATOR: "Модератор",
  SUPPORT: "Поддержка",
  FINANCE: "Финансы",
  ADMIN: "Администратор",
  SUPERADMIN: "Суперадминистратор",
};

/** Resolves the flat permission set for a role; unknown roles → USER (empty). */
export function effectivePermissions(role: string): Set<string> {
  const known = (ROLE_PERMISSIONS as Record<string, readonly string[]> | undefined)?.[
    role as PlatformRole
  ];
  return new Set(known ?? ROLE_PERMISSIONS.USER);
}

/** hasPermission("MODERATOR", "reports.resolve") — unknown roles never pass. */
export function hasPermission(role: string, permission: string): boolean {
  return effectivePermissions(role).has(permission);
}

/**
 * Route guard for the admin platform: 401 when unauthenticated, 403 {error}
 * when the role lacks the permission. Mount AFTER `authenticate` — the role
 * arrives in the verified JWT payload (req.user.role), exactly like the
 * legacy adminOnly check in routes/admin.ts.
 */
export function requirePermission(permission: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = (req as AuthRequest).user;
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!hasPermission(user.role, permission)) {
      res.status(403).json({ error: "Forbidden", required: permission });
      return;
    }
    next();
  };
}

/** Catalog projection for GET /admin/permissions. */
export const PERMISSION_CATALOG = PERMISSIONS.map((p) => ({
  key: p.key,
  label: p.label,
  description: p.description,
  group: p.group,
}));