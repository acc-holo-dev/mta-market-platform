// PLAN-017 H §50–§51: premium entitlement foundation.
// An entitlement is a real capability grant (never a UI-only badge) bound to
// a subject (USER | RESOURCE | SERVER). Grants are idempotent while an
// active grant exists; revocation is a CAS on revokedAt; expiry is honest
// (expiresAt in the past means not entitled, even before revocation).
import { db } from "../prisma/db.js";
import { recordAudit } from "./audit.js";
import { affectedCount } from "./ledger.js";
import { logSystemEvent } from "./advertising.js";

export type EntitlementSubjectType = "USER" | "RESOURCE" | "SERVER";
export type EntitlementKind =
  | "CREATOR_PREMIUM"
  | "SERVER_PREMIUM"
  | "MARKETPLACE_PREMIUM"
  | "ADVERTISING_PREMIUM"
  | "ANALYTICS_PREMIUM";

export const ENTITLEMENT_SUBJECT_TYPES: EntitlementSubjectType[] = ["USER", "RESOURCE", "SERVER"];
export const ENTITLEMENT_KINDS: EntitlementKind[] = [
  "CREATOR_PREMIUM",
  "SERVER_PREMIUM",
  "MARKETPLACE_PREMIUM",
  "ADVERTISING_PREMIUM",
  "ANALYTICS_PREMIUM",
];

export interface EntitlementRow {
  id: string;
  subjectType: EntitlementSubjectType;
  subjectId: string;
  kind: EntitlementKind;
  source: string;
  grantedById: string | null;
  note: string | null;
  grantedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedById: string | null;
  [key: string]: unknown;
}

/** Thrown when the entitlement subject does not exist (routes map to 404). */
export class EntitlementSubjectNotFoundError extends Error {
  constructor(subjectType: string, subjectId: string) {
    super(`Entitlement subject ${subjectType} ${subjectId} not found`);
    this.name = "EntitlementSubjectNotFoundError";
  }
}

export interface GrantEntitlementInput {
  subjectType: EntitlementSubjectType;
  subjectId: string;
  kind: EntitlementKind;
  source: string;
  grantedById?: string | null;
  note?: string | null;
  expiresAt?: string | null;
}

export interface GrantResult {
  entitlement: EntitlementRow;
  created: boolean;
}

/** True when the subject row exists (existence only — admin may grant to any). */
export async function subjectExists(subjectType: EntitlementSubjectType, subjectId: string): Promise<boolean> {
  if (subjectType === "USER") {
    return Boolean(await db.orm.public.User.where({ id: subjectId } as any).first());
  }
  if (subjectType === "RESOURCE") {
    return Boolean(await db.orm.public.Resource.where({ id: subjectId } as any).first());
  }
  return Boolean(await db.orm.public.Server.where({ id: subjectId } as any).first());
}

/**
 * Idempotent grant: when an ACTIVE (revokedAt null) entitlement already
 * exists for (subjectType, subjectId, kind) it is returned unchanged and
 * nothing is audited. Otherwise the grant is created and audited.
 * Throws EntitlementSubjectNotFoundError when the subject does not exist.
 */
export async function grantEntitlement(input: GrantEntitlementInput): Promise<GrantResult> {
  const { subjectType, subjectId, kind, source, grantedById, note, expiresAt } = input;
  if (!(await subjectExists(subjectType, subjectId))) {
    throw new EntitlementSubjectNotFoundError(subjectType, subjectId);
  }
  const existing = (await db.orm.public.Entitlement
    .where({ subjectType, subjectId, kind, revokedAt: null } as any)
    .first()) as EntitlementRow | null;
  if (existing) {
    return { entitlement: existing, created: false };
  }
  const created = (await db.orm.public.Entitlement.create({
    subjectType,
    subjectId,
    kind,
    source,
    grantedById: grantedById ?? null,
    note: note ?? null,
    expiresAt: expiresAt ?? null,
  } as any)) as unknown as EntitlementRow;
  if (grantedById) {
    await recordAudit({
      actorId: grantedById,
      action: "premium_entitlement_granted",
      targetType: "entitlement",
      targetId: created.id,
      before: null,
      after: {
        subjectType,
        subjectId,
        kind,
        source,
        note: note ?? null,
        expiresAt: expiresAt ?? null,
      },
    });
    await logSystemEvent({
      message: "premium_entitlement_granted",
      meta: { entitlementId: created.id, subjectType, subjectId, kind, actorId: grantedById },
    });
  }
  return { entitlement: created, created: true };
}

export interface RevokeResult {
  entitlement: EntitlementRow;
  revoked: boolean;
}

/**
 * CAS revocation: only an ACTIVE (revokedAt null) entitlement can be
 * revoked; concurrent revocations converge on the first writer. Revoking an
 * already-revoked entitlement returns it unchanged (revoked: false).
 */
export async function revokeEntitlement(
  entitlementId: string,
  revokedById: string,
  reason?: string | null
): Promise<RevokeResult> {
  const entitlement = (await db.orm.public.Entitlement.where({ id: entitlementId } as any).first()) as EntitlementRow | null;
  if (!entitlement) {
    return { entitlement: undefined as unknown as EntitlementRow, revoked: false };
  }
  if (entitlement.revokedAt) {
    return { entitlement, revoked: false };
  }
  const revokedAt = new Date().toISOString();
  const cas = await db.orm.public.Entitlement
    .where({ id: entitlementId, revokedAt: null } as any)
    .updateAndCount({ revokedAt, revokedById } as any);
  if (affectedCount(cas) !== 1) {
    const current = (await db.orm.public.Entitlement.where({ id: entitlementId } as any).first()) as EntitlementRow;
    return { entitlement: current, revoked: false };
  }
  const revoked = { ...entitlement, revokedAt, revokedById } as EntitlementRow;
  await recordAudit({
    actorId: revokedById,
    action: "premium_entitlement_revoked",
    targetType: "entitlement",
    targetId: entitlementId,
    before: { revokedAt: null, kind: entitlement.kind, subjectType: entitlement.subjectType, subjectId: entitlement.subjectId },
    after: { revokedAt, reason: reason ?? null },
  });
  await logSystemEvent({
    message: "premium_entitlement_revoked",
    meta: { entitlementId, kind: entitlement.kind, subjectType: entitlement.subjectType, subjectId: entitlement.subjectId, actorId: revokedById },
  });
  return { entitlement: revoked, revoked: true };
}

/** True when the subject holds an ACTIVE, non-expired entitlement of `kind`. */
export async function hasEntitlement(
  subjectType: EntitlementSubjectType,
  subjectId: string,
  kind: EntitlementKind
): Promise<boolean> {
  const rows = (await db.orm.public.Entitlement
    .where({ subjectType, subjectId, kind, revokedAt: null } as any)
    .all()) as EntitlementRow[];
  const now = Date.now();
  return rows.some((row) => !row.expiresAt || new Date(row.expiresAt).getTime() > now);
}

export interface ListEntitlementsFilters {
  subjectType?: EntitlementSubjectType;
  subjectId?: string;
  kind?: EntitlementKind;
  /** true -> only ACTIVE (not revoked, not expired); false -> only revoked; absent -> all. */
  active?: boolean;
}

export interface ListEntitlementsResult {
  data: EntitlementRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

/**
 * Paginated entitlement list (grantedAt DESC). The `active` filter needs
 * OR semantics on (revokedAt, expiresAt) which this codebase's typed ORM
 * surface does not express, so ACTIVE filtering happens in JS over a
 * bounded fetch (1_000 rows) — entitlements are admin-granted and bounded.
 */
export async function listEntitlements(
  filters: ListEntitlementsFilters,
  page = 1,
  limit = 20
): Promise<ListEntitlementsResult> {
  const safePage = Math.max(page, 1);
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const where: Record<string, unknown> = {};
  if (filters.subjectType) where.subjectType = filters.subjectType;
  if (filters.subjectId) where.subjectId = filters.subjectId;
  if (filters.kind) where.kind = filters.kind;

  const now = Date.now();
  const isActive = (e: EntitlementRow): boolean =>
    !e.revokedAt && (!e.expiresAt || new Date(e.expiresAt).getTime() > now);

  let rows: EntitlementRow[];
  let total: number;
  if (filters.active === true) {
    // OR semantics on (revokedAt, expiresAt) are not expressible on this
    // typed ORM surface -> fetch not-revoked rows (bounded) and JS-filter.
    const candidates = (await db.orm.public.Entitlement
      .where({ ...where, revokedAt: null } as any)
      .orderBy((e: any) => e.grantedAt.desc())
      .limit(1000)
      .all()) as EntitlementRow[];
    const filtered = candidates.filter(isActive);
    total = filtered.length;
    rows = filtered.slice((safePage - 1) * safeLimit, safePage * safeLimit);
  } else {
    const base = db.orm.public.Entitlement.where(where as any);
    const scoped = filters.active === false ? base.where((e: any) => e.revokedAt.isNotNull()) : base;
    const agg = await scoped.aggregate((a: any) => ({ total: a.count() }));
    total = Number(agg.total ?? 0);
    rows = (await scoped
      .orderBy((e: any) => e.grantedAt.desc())
      .limit(safeLimit)
      .offset((safePage - 1) * safeLimit)
      .all()) as EntitlementRow[];
  }
  return {
    data: rows,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit),
    },
  };
}

/**
 * Resolve the user who should be notified about a subject's entitlement:
 * the user itself, the resource seller, or the server owner. Returns null
 * when the subject is gone or has no owner.
 */
export async function resolveSubjectOwnerId(
  subjectType: EntitlementSubjectType,
  subjectId: string
): Promise<string | null> {
  if (subjectType === "USER") {
    const user = (await db.orm.public.User.where({ id: subjectId } as any).first()) as { id: string } | null;
    return user?.id ?? null;
  }
  if (subjectType === "RESOURCE") {
    const resource = (await db.orm.public.Resource.where({ id: subjectId } as any).first()) as { sellerId: string } | null;
    return resource?.sellerId ?? null;
  }
  const server = (await db.orm.public.Server.where({ id: subjectId } as any).first()) as { ownerId: string } | null;
  return server?.ownerId ?? null;
}