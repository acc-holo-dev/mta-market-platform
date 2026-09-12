// Protected deal rooms (PLAN-018 L-001/L-002/L-003): a bounded transaction
// workspace between a buyer and a seller with explicit protected states and
// strict access control.
//
// Status machine (contract DealStatus):
//   CREATED → FUNDED → DELIVERING → DELIVERED → ACCEPTED → CLOSED
//                                   (any party) → DISPUTED → RESOLVED → CLOSED
//
// Semantics:
//   - mark_funded (buyer): the buyer asserts the amount is secured OUTSIDE
//     this workspace (external payment reference note). Bounded bookkeeping —
//     NOT a new payment rail; orderId optionally links a real commerce Order.
//   - start_delivery / mark_delivered (seller); accept (buyer, optionally
//     auto-RESOLVED+CLOSED); open_dispute (either party; optional disputeId
//     link recorded as DISPUTE_EVENT evidence + audit); resolve (admin only);
//     close (either party after RESOLVED; admin may force-close from any
//     non-CLOSED state).
//   - Every transition is a compare-and-set on the observed status, audited
//     (recordAudit) and mirrored into SystemLog.
//   - Access control: buyer/seller membership or admin; outsiders get 404
//     (existence hiding) on every route; a wrong-party transition is 403.
import { db } from "../prisma/db.js";
import { affectedCount } from "./ledger.js";
import { recordAudit } from "./audit.js";
import { logSystem } from "./systemLog.js";

export class DealError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DealError";
  }
}

export const DEAL_STATUSES = [
  "CREATED",
  "FUNDED",
  "DELIVERING",
  "DELIVERED",
  "ACCEPTED",
  "DISPUTED",
  "RESOLVED",
  "CLOSED",
] as const;

export type DealStatus = (typeof DEAL_STATUSES)[number];

export const DEAL_EVIDENCE_KINDS = ["MESSAGE", "FILE", "DELIVERY", "DISPUTE_EVENT"] as const;
export type DealEvidenceKind = (typeof DEAL_EVIDENCE_KINDS)[number];

const SUBJECT_TYPES = ["resource", "service", "server"] as const;

export type DealRole = "buyer" | "seller" | "admin" | null;

export interface DealRoomRow {
  id: string;
  buyerId: string;
  sellerId: string;
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  amountMinor: number;
  currency: string;
  status: string;
  orderId: string | null;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

export interface DealMessageRow {
  id: string;
  roomId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export interface DealEvidenceRow {
  id: string;
  roomId: string;
  kind: DealEvidenceKind;
  url: string | null;
  body: string | null;
  createdBy: string;
  createdAt: string;
}

export interface CreateDealRoomInput {
  buyerId: string;
  sellerId: string;
  subjectType?: string | null;
  subjectId?: string | null;
  title: string;
  amountMinor: number;
  orderId?: string | null;
  actorId: string;
}

/**
 * Creates a deal room (L-001). Either party may create it; the counterparty
 * is automatically a member (both ids live on the room — no separate
 * membership table). Status starts at CREATED.
 */
export async function createDealRoom(input: CreateDealRoomInput): Promise<DealRoomRow> {
  const { buyerId, sellerId, actorId } = input;
  const title = input.title.trim();
  if (buyerId === sellerId) {
    throw new DealError(400, "self_deal", "Buyer and seller must be different users");
  }
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new DealError(400, "invalid_amount", "amountMinor must be a positive integer");
  }
  if (!title || title.length > 200) {
    throw new DealError(400, "invalid_title", "Title must be 1..200 characters");
  }
  if (input.subjectType) {
    if (!(SUBJECT_TYPES as readonly string[]).includes(input.subjectType)) {
      throw new DealError(400, "invalid_subject_type", `subjectType must be one of: ${SUBJECT_TYPES.join(", ")}`);
    }
    if (!input.subjectId) {
      throw new DealError(400, "invalid_subject", "subjectId is required when subjectType is set");
    }
  }
  for (const userId of [buyerId, sellerId]) {
    const exists = (await db.orm.public.User.where({ id: userId }).select("id").first()) as { id: string } | null;
    if (!exists) {
      throw new DealError(404, "user_not_found", "Deal counterparty not found");
    }
  }
  const created = (await db.orm.public.DealRoom.create({
    buyerId,
    sellerId,
    subjectType: input.subjectType ?? null,
    subjectId: input.subjectId ?? null,
    title,
    amountMinor: input.amountMinor,
    currency: "RUB",
    status: "CREATED",
    orderId: input.orderId ?? null,
  } as any)) as unknown as DealRoomRow;
  await recordAudit({
    actorId,
    action: "deal_room_created",
    targetType: "dealRoom",
    targetId: created.id,
    before: null,
    after: {
      buyerId,
      sellerId,
      title: created.title,
      amountMinor: created.amountMinor,
      subjectType: created.subjectType,
      subjectId: created.subjectId,
    },
  });
  await logSystem({
    level: "INFO",
    service: "api",
    message: "deal_room_created",
    meta: { dealRoomId: created.id, buyerId, sellerId, amountMinor: created.amountMinor },
  });
  return created;
}

export async function getDealRoom(id: string): Promise<DealRoomRow | null> {
  return (await db.orm.public.DealRoom.where({ id } as any).first()) as DealRoomRow | null;
}

/** Buyer/seller membership or admin; null for outsiders (routes answer 404). */
export function dealRole(room: DealRoomRow, userId: string | null, isAdmin: boolean): DealRole {
  if (!userId) return null;
  if (isAdmin) return "admin";
  if (room.buyerId === userId) return "buyer";
  if (room.sellerId === userId) return "seller";
  return null;
}

export type DealAction =
  | "mark_funded"
  | "start_delivery"
  | "mark_delivered"
  | "accept"
  | "open_dispute"
  | "resolve"
  | "close";

export interface DealTransitionInput {
  roomId: string;
  action: DealAction;
  actorId: string;
  isAdmin: boolean;
  note?: string | null;
  disputeId?: string | null;
  orderId?: string | null;
  resolveAndClose?: boolean;
  ip?: string | null;
  requestId?: string | null;
}

export interface DealTransitionResult {
  room: DealRoomRow;
  from: string;
  to: string;
}

/** Party-guarded state machine: role(s), allowed source state, target. */
const PARTY_TRANSITIONS: Record<string, { roles: Array<"buyer" | "seller">; from: string; to: string }> = {
  mark_funded: { roles: ["buyer"], from: "CREATED", to: "FUNDED" },
  start_delivery: { roles: ["seller"], from: "FUNDED", to: "DELIVERING" },
  mark_delivered: { roles: ["seller"], from: "DELIVERING", to: "DELIVERED" },
  accept: { roles: ["buyer"], from: "DELIVERED", to: "ACCEPTED" },
};

interface TransitionMeta {
  actorId: string;
  action: string;
  ip?: string | null;
  requestId?: string | null;
}

/** CAS on the observed status; a lost race is a 409 unless the target was reached. */
async function casTransition(room: DealRoomRow, from: string, to: string, meta: TransitionMeta): Promise<DealTransitionResult> {
  const cas = await db.orm.public.DealRoom
    .where({ id: room.id, status: from } as any)
    .updateAndCount({ status: to } as any);
  if (affectedCount(cas) !== 1) {
    const current = (await db.orm.public.DealRoom.where({ id: room.id } as any).first()) as DealRoomRow | null;
    if (current?.status === to) {
      return { room: current, from, to };
    }
    throw new DealError(409, "state_conflict", `Deal state changed concurrently (now ${current?.status ?? "unknown"})`);
  }
  const updated = (await db.orm.public.DealRoom.where({ id: room.id } as any).first()) as DealRoomRow;
  await recordAudit({
    actorId: meta.actorId,
    action: "deal_transitioned",
    targetType: "dealRoom",
    targetId: room.id,
    before: { status: from },
    after: { status: to, action: meta.action },
    ip: meta.ip ?? null,
    requestId: meta.requestId ?? null,
  });
  await logSystem({
    level: "INFO",
    service: "api",
    message: "deal_transitioned",
    meta: { dealRoomId: room.id, from, to, action: meta.action, actorId: meta.actorId },
  });
  return { room: updated, from, to };
}

/** System-side evidence row for transition notes (MESSAGE/DELIVERY/DISPUTE_EVENT). */
async function appendSystemEvidence(
  roomId: string,
  createdBy: string,
  kind: DealEvidenceKind,
  body: string
): Promise<DealEvidenceRow> {
  return (await db.orm.public.DealEvidence.create({
    roomId,
    kind,
    url: null,
    body,
    createdBy,
  } as any)) as unknown as DealEvidenceRow;
}

/**
 * Applies one guarded, CAS-protected transition (L-002). Wrong party → 403,
 * wrong state → 409; the outsider 404 is enforced by dealRole in the route.
 * Admins may perform every action through the admin surface (audited).
 */
export async function transitionDealRoom(input: DealTransitionInput): Promise<DealTransitionResult> {
  const room = await getDealRoom(input.roomId);
  if (!room) {
    throw new DealError(404, "deal_not_found", "Deal room not found");
  }
  const role = dealRole(room, input.actorId, input.isAdmin);
  if (!role) {
    // Existence hiding: outsiders are answered as if the room did not exist.
    throw new DealError(404, "deal_not_found", "Deal room not found");
  }
  const meta: TransitionMeta = {
    actorId: input.actorId,
    action: input.action,
    ip: input.ip ?? null,
    requestId: input.requestId ?? null,
  };
  const action = input.action;

  if (action === "resolve") {
    if (role !== "admin") {
      throw new DealError(403, "admin_only", "Only admins can resolve a disputed deal");
    }
    if (room.status !== "DISPUTED") {
      throw new DealError(409, "invalid_state", `resolve requires DISPUTED (now ${room.status})`);
    }
    const result = await casTransition(room, "DISPUTED", "RESOLVED", meta);
    if (input.note) {
      await appendSystemEvidence(room.id, input.actorId, "DISPUTE_EVENT", `Спор урегулирован: ${input.note}`);
    } else if (input.disputeId) {
      await appendSystemEvidence(room.id, input.actorId, "DISPUTE_EVENT", `disputeId: ${input.disputeId}`);
    }
    return result;
  }

  if (action === "close") {
    if (room.status === "CLOSED") {
      throw new DealError(409, "invalid_state", "Deal room is already CLOSED");
    }
    if (role !== "admin" && room.status !== "RESOLVED") {
      throw new DealError(409, "invalid_state", `Parties can close only after RESOLVED (now ${room.status})`);
    }
    return casTransition(room, room.status, "CLOSED", meta);
  }

  if (action === "open_dispute") {
    if (role === "admin") {
      // Opening a dispute is a party act; admins drive resolve/close.
      throw new DealError(403, "party_only", "Only the buyer or the seller can open a dispute");
    }
    if (!["CREATED", "FUNDED", "DELIVERING", "DELIVERED", "ACCEPTED"].includes(room.status)) {
      throw new DealError(409, "invalid_state", `open_dispute is not available in ${room.status}`);
    }
    const result = await casTransition(room, room.status, "DISPUTED", meta);
    const note = input.note ? `Спор открыт: ${input.note}` : input.disputeId ? `Спор открыт (disputeId: ${input.disputeId})` : "Спор открыт";
    await appendSystemEvidence(room.id, input.actorId, "DISPUTE_EVENT", note);
    return result;
  }

  const spec = PARTY_TRANSITIONS[action];
  if (!spec) {
    throw new DealError(400, "unknown_action", `Unknown deal action: ${action}`);
  }
  if (role !== "admin" && !spec.roles.includes(role as "buyer" | "seller")) {
    throw new DealError(403, "wrong_party", `Only the ${spec.roles.join("/")} can ${action}`);
  }
  if (room.status !== spec.from) {
    throw new DealError(409, "invalid_state", `${action} requires ${spec.from} (now ${room.status})`);
  }

  // mark_funded optionally links a real commerce Order (a reference, never a rail).
  if (action === "mark_funded" && input.orderId && !room.orderId) {
    await db.orm.public.DealRoom.where({ id: room.id, orderId: null } as any)
      .updateAndCount({ orderId: input.orderId } as any);
  }

  let result = await casTransition(room, spec.from, spec.to, meta);

  if (action === "mark_funded" && input.note) {
    await appendSystemEvidence(room.id, input.actorId, "MESSAGE", `Оплата подтверждена покупателем: ${input.note}`);
  }
  if (action === "mark_delivered" && input.note) {
    await appendSystemEvidence(room.id, input.actorId, "DELIVERY", input.note);
  }

  if (action === "accept" && input.resolveAndClose) {
    const resolved = await casTransition(result.room, "ACCEPTED", "RESOLVED", meta);
    result = await casTransition(resolved.room, "RESOLVED", "CLOSED", meta);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Messages (L-003): parties only post; parties + admin read.
// ---------------------------------------------------------------------------

export async function addDealMessage(roomId: string, authorId: string, body: string): Promise<DealMessageRow> {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 2000) {
    throw new DealError(400, "invalid_body", "Message body must be 1..2000 characters");
  }
  return (await db.orm.public.DealMessage.create({
    roomId,
    authorId,
    body: trimmed,
  } as any)) as unknown as DealMessageRow;
}

export async function listDealMessages(roomId: string, limit = 200): Promise<DealMessageRow[]> {
  return (await db.orm.public.DealMessage
    .where({ roomId } as any)
    .orderBy((m: any) => m.createdAt.asc())
    .limit(limit)
    .all()) as DealMessageRow[];
}

// ---------------------------------------------------------------------------
// Evidence (L-003): parties add; parties + admin read. FILE evidence stores
// the url only (no inline content); MESSAGE evidence requires a body.
// ---------------------------------------------------------------------------

export interface AddDealEvidenceInput {
  roomId: string;
  createdBy: string;
  kind: DealEvidenceKind;
  url?: string | null;
  body?: string | null;
}

export async function addDealEvidence(input: AddDealEvidenceInput): Promise<DealEvidenceRow> {
  const url = input.url?.trim() || null;
  const body = input.body?.trim() || null;
  if (input.kind === "FILE") {
    if (!url) {
      throw new DealError(400, "url_required", "FILE evidence requires a url (stored as a reference only)");
    }
    if (url.length > 500) {
      throw new DealError(400, "invalid_url", "url must be at most 500 characters");
    }
  } else if (input.kind === "MESSAGE") {
    if (!body) {
      throw new DealError(400, "body_required", "MESSAGE evidence requires a body");
    }
  }
  if (!url && !body) {
    throw new DealError(400, "empty_evidence", "Evidence requires a url or a body");
  }
  // FILE evidence stores the url ONLY (no inline content); MESSAGE evidence
  // is body-only. DELIVERY/DISPUTE_EVENT may carry either.
  const storedUrl = input.kind === "FILE" ? url : input.kind === "MESSAGE" ? null : url;
  const storedBody = input.kind === "FILE" ? null : body;
  return (await db.orm.public.DealEvidence.create({
    roomId: input.roomId,
    kind: input.kind,
    url: storedUrl,
    body: storedBody,
    createdBy: input.createdBy,
  } as any)) as unknown as DealEvidenceRow;
}

export async function listDealEvidence(roomId: string, limit = 200): Promise<DealEvidenceRow[]> {
  return (await db.orm.public.DealEvidence
    .where({ roomId } as any)
    .orderBy((e: any) => e.createdAt.asc())
    .limit(limit)
    .all()) as DealEvidenceRow[];
}

// ---------------------------------------------------------------------------
// Lists. The typed ORM surface has no OR combinator (no usage anywhere in
// src/), so "rooms where I am a party" is the union of two bounded ordered
// queries (buyer side + seller side, 500 each) merged in JS — the same honest
// bounded-fetch pattern as lib/entitlements.ts.
// ---------------------------------------------------------------------------

export interface DealListFilters {
  status?: string;
}

export interface DealListResult {
  data: DealRoomRow[];
  pagination: { page: number; limit: number; total: number; pages: number };
}

export async function listDealRoomsForUser(
  userId: string,
  filters: DealListFilters,
  page = 1,
  limit = 20
): Promise<DealListResult> {
  const safePage = Math.max(page, 1);
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const buyerSide = (await db.orm.public.DealRoom
    .where({ buyerId: userId } as any)
    .orderBy((r: any) => r.updatedAt.desc())
    .limit(500)
    .all()) as DealRoomRow[];
  const sellerSide = (await db.orm.public.DealRoom
    .where({ sellerId: userId } as any)
    .orderBy((r: any) => r.updatedAt.desc())
    .limit(500)
    .all()) as DealRoomRow[];
  const byId = new Map<string, DealRoomRow>();
  for (const row of [...buyerSide, ...sellerSide]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  let merged = Array.from(byId.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  if (filters.status) {
    merged = merged.filter((r) => r.status === filters.status);
  }
  const total = merged.length;
  return {
    data: merged.slice((safePage - 1) * safeLimit, safePage * safeLimit),
    pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
  };
}

export async function listDealRoomsForAdmin(
  filters: DealListFilters,
  page = 1,
  limit = 20
): Promise<DealListResult> {
  const safePage = Math.max(page, 1);
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  const scoped = db.orm.public.DealRoom.where(where as any);
  const agg = await scoped.aggregate((a: any) => ({ total: a.count() }));
  const total = Number(agg.total ?? 0);
  const rows = (await scoped
    .orderBy((r: any) => r.updatedAt.desc())
    .limit(safeLimit)
    .offset((safePage - 1) * safeLimit)
    .all()) as DealRoomRow[];
  return {
    data: rows,
    pagination: { page: safePage, limit: safeLimit, total, pages: Math.ceil(total / safeLimit) },
  };
}
