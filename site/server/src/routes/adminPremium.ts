// Admin premium entitlements (PLAN-017 H §50–§51): plans catalog, grants,
// revocations. Plans report honestly which kinds are backed by real
// consuming features today; grants/revocations are audited, logged and
// notify the subject's owner.
// Auth: router-level authenticate + ADMIN/SUPERADMIN — premium.manage
// (ADMIN + SUPERADMIN only).
import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { validate } from "../middleware/validate.js";
import { validateCuid } from "../middleware/validateCuid.js";
import { createNotifications } from "../lib/notify.js";
import { isFeatureEnabled } from "../lib/featureFlags.js";
import {
  grantEntitlement,
  revokeEntitlement,
  listEntitlements,
  resolveSubjectOwnerId,
  ENTITLEMENT_SUBJECT_TYPES,
  ENTITLEMENT_KINDS,
  EntitlementSubjectNotFoundError,
  type EntitlementKind,
  type EntitlementSubjectType,
} from "../lib/entitlements.js";

const router: Router = Router();

// ---------------------------------------------------------------------------
// Router guard: authenticate + ADMIN/SUPERADMIN only.
// TODO(permission-engine): replace the inline role check with
// requirePermission("premium.manage") when the permission-engine wave lands.
// ---------------------------------------------------------------------------
router.use(authenticate, (req: AuthRequest, res: Response, next: () => void) => {
  if (req.user?.role !== "ADMIN" && req.user?.role !== "SUPERADMIN") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
});

function premiumDisabled(res: Response): boolean {
  if (isFeatureEnabled("premium")) return false;
  res.status(404).json({ error: "Not found" });
  return true;
}

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), "must be an ISO date-time");

const subjectIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a valid domain ID (UUID)");

const grantSchema = z.object({
  subjectType: z.enum(ENTITLEMENT_SUBJECT_TYPES),
  subjectId: subjectIdSchema,
  kind: z.enum(ENTITLEMENT_KINDS),
  note: z.string().max(500).optional(),
  expiresAt: isoDateTime.optional(),
});

const revokeSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

const listQuerySchema = z.object({
  subjectType: z.enum(ENTITLEMENT_SUBJECT_TYPES).optional(),
  subjectId: z.string().min(1).optional(),
  kind: z.enum(ENTITLEMENT_KINDS).optional(),
  active: z
    .string()
    .optional()
    .refine((v) => v === undefined || v === "true" || v === "false", "must be true|false"),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// GET /admin/premium/plans — static plans catalog. Always responds (even
// with the premium flag off): it must honestly report which kinds are backed
// by real consuming features today (§50 — never a UI-only badge).
// ---------------------------------------------------------------------------
router.get("/plans", (_req: AuthRequest, res: Response) => {
  const premiumEnabled = isFeatureEnabled("premium");
  const plans = [
    {
      kind: "CREATOR_PREMIUM",
      label: "Премиум креатора",
      description: "Расширенные возможности кабинета автора: аналитика и продвижение публикаций.",
      features: [
        "Расширенная аналитика продаж и аудитории",
        "Приоритетное отображение публикаций",
        "Кастомизация витрины создателя",
      ],
      available: true,
      note: null as string | null,
      enabled: premiumEnabled,
    },
    {
      kind: "SERVER_PREMIUM",
      label: "Премиум сервера",
      description: "Расширенные возможности карточки и мониторинга игрового сервера.",
      features: [
        "Расширенная аналитика сервера",
        "Выделенное оформление карточки сервера",
        "Приоритет в подборках серверов",
      ],
      available: true,
      note: null as string | null,
      enabled: premiumEnabled,
    },
    {
      kind: "MARKETPLACE_PREMIUM",
      label: "Премиум маркетплейса",
      description: "План для расширенных возможностей маркетплейса.",
      features: [] as string[],
      available: false,
      note: "Планируемые функции маркетплейса ещё не реализованы — план появится вместе с реальной функциональностью.",
      enabled: false,
    },
    {
      kind: "ADVERTISING_PREMIUM",
      label: "Премиум рекламы",
      description: "План для расширенных рекламных инструментов.",
      features: [] as string[],
      available: false,
      note: "Рекламные премиум-инструменты ещё не реализованы — план появится вместе с ними.",
      enabled: false,
    },
    {
      kind: "ANALYTICS_PREMIUM",
      label: "Премиум аналитики",
      description: "План расширенной платформенной аналитики.",
      features: [] as string[],
      available: false,
      note: "Расширенная аналитика ещё не реализована — план появится вместе с ней.",
      enabled: false,
    },
  ];
  res.json({
    plans,
    featureEnabled: premiumEnabled,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/premium/entitlements — paginated list with subject labels
// (username / resource title / server name), batched per page — no N+1.
// ---------------------------------------------------------------------------
router.get("/entitlements", validate(listQuerySchema, "query"), async (req: AuthRequest, res: Response) => {
  try {
    if (premiumDisabled(res)) return;
    const q = req.query as unknown as {
      subjectType?: string;
      subjectId?: string;
      kind?: string;
      active?: string;
      page?: number;
      limit?: number;
    };
    const result = await listEntitlements(
      {
        subjectType: q.subjectType as EntitlementSubjectType,
        subjectId: q.subjectId,
        kind: q.kind as EntitlementKind,
        active: q.active === undefined ? undefined : q.active === "true",
      },
      q.page ?? 1,
      q.limit ?? 20
    );

    // Batched subject labels for exactly this page (3 queries max).
    const userIds = result.data.filter((e) => e.subjectType === "USER").map((e) => e.subjectId);
    const resourceIds = result.data.filter((e) => e.subjectType === "RESOURCE").map((e) => e.subjectId);
    const serverIds = result.data.filter((e) => e.subjectType === "SERVER").map((e) => e.subjectId);
    const [users, resources, servers] = await Promise.all([
      userIds.length
        ? (db.orm.public.User.where((u: any) => u.id.in(userIds)).select("id", "username").all() as unknown as Promise<any[]>)
        : Promise.resolve([] as any[]),
      resourceIds.length
        ? (db.orm.public.Resource.where((r: any) => r.id.in(resourceIds)).select("id", "title").all() as unknown as Promise<any[]>)
        : Promise.resolve([] as any[]),
      serverIds.length
        ? (db.orm.public.Server.where((s: any) => s.id.in(serverIds)).select("id", "name").all() as unknown as Promise<any[]>)
        : Promise.resolve([] as any[]),
    ]);
    const userById = new Map(users.map((u) => [u.id as string, u]));
    const resourceById = new Map(resources.map((r) => [r.id as string, r]));
    const serverById = new Map(servers.map((s) => [s.id as string, s]));

    res.json({
      data: result.data.map((e) => {
        let subjectLabel: string | null = null;
        if (e.subjectType === "USER") subjectLabel = (userById.get(e.subjectId) as any)?.username ?? null;
        if (e.subjectType === "RESOURCE") subjectLabel = (resourceById.get(e.subjectId) as any)?.title ?? null;
        if (e.subjectType === "SERVER") subjectLabel = (serverById.get(e.subjectId) as any)?.name ?? null;
        return { ...e, subject: { type: e.subjectType, label: subjectLabel } };
      }),
      pagination: result.pagination,
    });
  } catch (error) {
    reqLog(req).error("admin_premium_entitlements_list_failed", { error });
    res.status(500).json({ error: "Failed to fetch entitlements" });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/premium/entitlements — grant (idempotent) + notification to
// the subject owner (user itself / resource seller / server owner).
// Audit + SystemLog happen inside grantEntitlement (only when newly created).
// ---------------------------------------------------------------------------
router.post("/entitlements", validate(grantSchema), async (req: AuthRequest, res: Response) => {
  try {
    if (premiumDisabled(res)) return;
    const b = req.body as {
      subjectType: EntitlementSubjectType;
      subjectId: string;
      kind: EntitlementKind;
      note?: string;
      expiresAt?: string;
    };
    let result;
    try {
      result = await grantEntitlement({
        subjectType: b.subjectType,
        subjectId: b.subjectId,
        kind: b.kind,
        source: "ADMIN_GRANT",
        grantedById: req.user!.userId,
        note: b.note ?? null,
        expiresAt: b.expiresAt ?? null,
      });
    } catch (error) {
      if (error instanceof EntitlementSubjectNotFoundError) {
        res.status(404).json({ error: "Subject not found" });
        return;
      }
      throw error;
    }
    if (result.created) {
      const ownerId = await resolveSubjectOwnerId(b.subjectType, b.subjectId);
      const subjectTitle =
        b.subjectType === "USER"
          ? "Ваш аккаунт получил премиум-статус"
          : b.subjectType === "RESOURCE"
            ? "Ваш ресурс получил премиум-статус"
            : "Ваш сервер получил премиум-статус";
      await createNotifications([
        {
          recipientId: ownerId ?? "",
          // NotificationType is a closed schema enum; MODERATION is the
          // platform-action channel used until a PREMIUM type ships
          // (contract.prisma is frozen — documented deviation).
          type: "MODERATION",
          title: subjectTitle,
          body: `Назначен план ${b.kind}.`,
          entityType: "entitlement",
          entityId: result.entitlement.id,
        },
      ]);
    }
    res.status(result.created ? 201 : 200).json(result);
  } catch (error) {
    reqLog(req).error("admin_premium_grant_failed", { error });
    res.status(500).json({ error: "Failed to grant entitlement" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/premium/entitlements/:id — CAS revocation with mandatory
// reason; notification to the subject's owner. Audit + SystemLog live in
// lib/entitlements.ts (premium_entitlement_revoked).
// ---------------------------------------------------------------------------
router.delete(
  "/entitlements/:id",
  validateCuid("id"),
  validate(revokeSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      if (premiumDisabled(res)) return;
      const reason = (req.body as { reason: string }).reason;
      const result = await revokeEntitlement(req.params.id as string, req.user!.userId, reason);
      if (!result.entitlement) {
        res.status(404).json({ error: "Entitlement not found" });
        return;
      }
      if (result.revoked) {
        const ownerId = await resolveSubjectOwnerId(result.entitlement.subjectType, result.entitlement.subjectId);
        await createNotifications([
          {
            recipientId: ownerId ?? "",
            type: "MODERATION",
            title: "Премиум-статус отозван",
            body: reason.slice(0, 300),
            entityType: "entitlement",
            entityId: result.entitlement.id,
          },
        ]);
      }
      res.json(result);
    } catch (error) {
      reqLog(req).error("admin_premium_revoke_failed", { error });
      res.status(500).json({ error: "Failed to revoke entitlement" });
    }
  }
);

export default router;