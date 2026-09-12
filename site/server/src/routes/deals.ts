// Protected deal rooms (PLAN-018 L): bounded transaction workspace; user + admin surfaces.
//
// Root-mounted router (app.ts mounts it at "/") with ABSOLUTE paths:
//   /deals/*        — user surface (parties only; outsiders get 404)
//   /admin/deals/*  — admin queue + audited overrides
// There is no "deals" feature flag in features.yaml — the surface is always on.
import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { validate } from "../middleware/validate.js";
import { validateCuid } from "../middleware/validateCuid.js";
import {
  createDealRoom,
  getDealRoom,
  dealRole,
  transitionDealRoom,
  addDealMessage,
  listDealMessages,
  addDealEvidence,
  listDealEvidence,
  listDealRoomsForUser,
  listDealRoomsForAdmin,
  DEAL_EVIDENCE_KINDS,
  DealError,
  type DealRoomRow,
  type DealAction,
  type DealEvidenceKind,
} from "../lib/deals.js";

const router: Router = Router();

const ADMIN_ROLES = ["ADMIN", "SUPERADMIN"];

function isAdminUser(req: AuthRequest): boolean {
  return Boolean(req.user && ADMIN_ROLES.includes(req.user.role));
}

function mapError(req: Request, res: Response, error: unknown): void {
  if (error instanceof Error && error.name === "DealError") {
    const e = error as Error & { status: number; code: string };
    res.status(e.status).json({ error: e.message, code: e.code });
    return;
  }
  reqLog(req).error("deal_route_failed", { error });
  res.status(500).json({ error: "Internal server error" });
}

/**
 * Loads the room for the actor: parties + admin only. Outsiders (and unknown
 * rooms) are answered 404 — existence hiding (L-002).
 */
async function loadRoomForActor(req: AuthRequest, res: Response): Promise<DealRoomRow | null> {
  const room = await getDealRoom(req.params.id as string);
  if (!room || !dealRole(room, req.user!.userId, isAdminUser(req))) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return room;
}

// ---------------------------------------------------------------------------
// POST /deals — create a room. Either party creates; the counterparty is
// auto-member. Body: {counterpartyId, counterpartyRole? ("BUYER"|"SELLER",
// default "BUYER" = caller is the buyer), subjectType?, subjectId?, title,
// amountMinor}.
// ---------------------------------------------------------------------------
const createSchema = z.object({
  counterpartyId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "must be a valid domain ID (UUID)"),
  counterpartyRole: z.enum(["BUYER", "SELLER"]).optional(),
  subjectType: z.enum(["resource", "service", "server"]).optional(),
  subjectId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .optional(),
  title: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().min(1),
});

router.post("/deals", authenticate, validate(createSchema), async (req: AuthRequest, res: Response) => {
  try {
    const b = req.body as {
      counterpartyId: string;
      counterpartyRole?: "BUYER" | "SELLER";
      subjectType?: string;
      subjectId?: string;
      title: string;
      amountMinor: number;
    };
    const callerIsBuyer = (b.counterpartyRole ?? "BUYER") === "BUYER";
    const room = await createDealRoom({
      buyerId: callerIsBuyer ? req.user!.userId : b.counterpartyId,
      sellerId: callerIsBuyer ? b.counterpartyId : req.user!.userId,
      subjectType: b.subjectType ?? null,
      subjectId: b.subjectId ?? null,
      title: b.title,
      amountMinor: b.amountMinor,
      actorId: req.user!.userId,
    });
    res.status(201).json({ room });
  } catch (error) {
    mapError(req, res, error);
  }
});

// GET /deals/mine?status= — rooms where the caller is a party.
const listQuerySchema = z.object({
  status: z.enum(["CREATED", "FUNDED", "DELIVERING", "DELIVERED", "ACCEPTED", "DISPUTED", "RESOLVED", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

router.get("/deals/mine", authenticate, validate(listQuerySchema, "query"), async (req: AuthRequest, res: Response) => {
  try {
    const q = req.query as unknown as { status?: string; page?: number; limit?: number };
    const result = await import("../lib/deals.js").then((m) =>
      m.listDealRoomsForUser(req.user!.userId, { status: q.status }, q.page ?? 1, q.limit ?? 20)
    );
    res.json(result);
  } catch (error) {
    mapError(req, res, error);
  }
});

// GET /deals/:id — room detail (parties + admin; 404 for outsiders).
router.get("/deals/:id", authenticate, validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    const room = await loadRoom(req, res);
    if (!room) return;
    res.json({ room, role: dealRole(room, req.user!.userId, isAdminUser(req)) });
  } catch (error) {
    mapError(req, res, error);
  }
});

async function loadRoom(req: AuthRequest, res: Response) {
  const room = await getDealRoom(req.params.id as string);
  if (!room || !dealRole(room, req.user!.userId, isAdminUser(req))) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return room;
}

// ---------------------------------------------------------------------------
// POST /deals/:id/transition {action, note?, disputeId?, orderId?,
// resolveAndClose?} — party-guarded state machine. `resolve` is admin-only.
// ---------------------------------------------------------------------------
const transitionSchema = z.object({
  action: z.enum(["mark_funded", "start_delivery", "mark_delivered", "accept", "open_dispute", "resolve", "close"]),
  note: z.string().max(500).optional(),
  disputeId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .optional(),
  orderId: z
    .string()
    .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    .optional(),
  resolveAndClose: z.boolean().optional(),
});

router.post("/deals/:id/transition", authenticate, validateCuid("id"), validate(transitionSchema), async (req: AuthRequest, res: Response) => {
  try {
    const room = await loadRoom(req, res);
    if (!room) return;
    const body = req.body as {
      action: DealAction;
      note?: string;
      disputeId?: string;
      orderId?: string;
      resolveAndClose?: boolean;
    };
    const result = await transitionDealRoom({
      roomId: room.id,
      action: body.action,
      actorId: req.user!.userId,
      isAdmin: isAdminUser(req),
      note: body.note ?? null,
      disputeId: body.disputeId ?? null,
      orderId: body.orderId ?? null,
      resolveAndClose: body.resolveAndClose === true,
    });
    res.json(result);
  } catch (error) {
    mapError(req, res, error);
  }
});

// POST /deals/:id/messages {body} — parties only (admin posts are not in scope).
router.post("/deals/:id/messages", authenticate, validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    const room = await loadRoom(req, res);
    if (!room) return;
    const role = dealRole(room, req.user!.userId, isAdminUser(req));
    if (role === "admin" || role === null) {
      // Admins read but do not chat inside the parties' workspace.
      res.status(role === "admin" ? 403 : 404).json({ error: role === "admin" ? "Only deal parties can post messages" : "Not found" });
      return;
    }
    const body = (req.body ?? {}).body;
    if (typeof body !== "string") {
      res.status(400).json({ error: "body must be a string" });
      return;
    }
    const message = await addDealMessage(room.id, req.user!.userId, body);
    res.status(201).json({ message });
  } catch (error) {
    mapError(req, res, error);
  }
});

// GET /deals/:id/messages — parties + admin.
router.get("/deals/:id/messages", authenticate, validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    const room = await loadRoom(req, res);
    if (!room) return;
    const { listDealMessages } = await import("../lib/deals.js");
    res.json({ data: await listDealMessages(room.id) });
  } catch (error) {
    mapError(req, res, error);
  }
});

// POST /deals/:id/evidence {kind, url?, body?} — parties only.
router.post("/deals/:id/evidence", authenticate, validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    const room = await loadRoom(req, res);
    if (!room) return;
    const role = dealRole(room, req.user!.userId, isAdminUser(req));
    if (role === null) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (role === "admin") {
      res.status(403).json({ error: "Only deal parties can add evidence" });
      return;
    }
    const kind = (req.body ?? {}).kind as DealEvidenceKind | undefined;
    if (!kind || !(DEAL_EVIDENCE_KINDS as readonly string[]).includes(kind)) {
      res.status(400).json({ error: `kind must be one of: ${DEAL_EVIDENCE_KINDS.join(", ")}` });
      return;
    }
    const { addDealEvidence } = await import("../lib/deals.js");
    const evidence = await addDealEvidence({
      roomId: room.id,
      createdBy: req.user!.userId,
      kind,
      url: typeof (req.body ?? {}).url === "string" ? (req.body as { url: string }).url : null,
      body: typeof (req.body ?? {}).body === "string" ? (req.body as { body: string }).body : null,
    });
    res.status(201).json({ evidence });
  } catch (error) {
    mapError(req, res, error);
  }
});

// GET /deals/:id/evidence — parties + admin.
router.get("/deals/:id/evidence", authenticate, validateCuid("id"), async (req: AuthRequest, res: Response) => {
  try {
    const room = await loadRoom(req, res);
    if (!room) return;
    const { listDealEvidence } = await import("../lib/deals.js");
    res.json({ data: await listDealEvidence(room.id) });
  } catch (error) {
    mapError(req, res, error);
  }
});

// ---------------------------------------------------------------------------
// Admin surface: queue + audited overrides.
// ---------------------------------------------------------------------------

router.get("/admin/deals", authenticate, validate(listQuerySchema, "query"), async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminUser(req)) {
      res.status(req.user ? 403 : 401).json({ error: req.user ? "Admin access required" : "No token provided" });
      return;
    }
    const q = req.query as unknown as { status?: string; page?: number; limit?: number };
    const result = await listDealsForAdmin({ status: q.status }, q.page ?? 1, q.limit ?? 20);
    res.json(result);
  } catch (error) {
    mapError(req, res, error);
  }
});

async function listDealsForAdmin(filters: { status?: string }, page: number, limit: number) {
  const { listDealRoomsForAdmin } = await import("../lib/deals.js");
  return listDealRoomsForAdmin(filters, page, limit);
}

// POST /admin/deals/:id/transition {action, ...} — admin overrides are audited.
router.post("/admin/deals/:id/transition", authenticate, validateCuid("id"), validate(transitionSchema), async (req: AuthRequest, res: Response) => {
  try {
    if (!isAdminUser(req)) {
      res.status(req.user ? 403 : 401).json({ error: req.user ? "Admin access required" : "No token provided" });
      return;
    }
    const room = await getDealRoom(req.params.id as string);
    if (!room) {
      res.status(404).json({ error: "Deal room not found" });
      return;
    }
    const body = req.body as {
      action: DealAction;
      note?: string;
      disputeId?: string;
      orderId?: string;
      resolveAndClose?: boolean;
    };
    const result = await transitionDealRoom({
      roomId: room.id,
      action: body.action,
      actorId: req.user!.userId,
      isAdmin: true,
      note: body.note ?? null,
      disputeId: body.disputeId ?? null,
      orderId: body.orderId ?? null,
      resolveAndClose: body.resolveAndClose === true,
      ip: req.ip ?? null,
      requestId: req.id ?? null,
    });
    res.json(result);
  } catch (error) {
    mapError(req, res, error);
  }
});

export const dealRoutes: Router = router;

export default router;
