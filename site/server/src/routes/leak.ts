// Leak radar investigation surface (PLAN-018 O-004). Mounted at /admin/leak-cases
// (router paths are relative to that mount):
//   GET  /admin/leak-cases?status=          — queue with fingerprint + confidence + evidence
//   POST /admin/leak-cases                  — open a case on a fingerprint
//   POST /admin/leak-cases/:id/transition   — confirm|dismiss|mark_false_positive|resolve (audited)
//   POST /admin/leak-cases/scan/:versionId  — refresh fingerprint for a version's artifact;
//                                             auto-open a case when confidence ≥ 0.6
import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../lib/auth.js";
import { standardRateLimit } from "../lib/rateLimit.js";
import { validate } from "../middleware/validate.js";
import { requirePermission } from "../lib/permissions.js";
import { db } from "../prisma/db.js";
import { reqLog } from "../middleware/requestId.js";
import { recordAudit } from "../lib/audit.js";
import { logSystem } from "../lib/systemLog.js";
import {
  fingerprintArtifact,
  evidenceFor,
  confidenceFor,
} from "../lib/artifact/fingerprint.js";
import { loadArtifactBuffer } from "../lib/storage.js";
import crypto from "crypto";

const router: Router = Router();

// All leak-radar surfaces are system-level admin operations.
router.use(authenticate, requirePermission("system.manage"), standardRateLimit);

const openCaseSchema = z.object({
  fingerprintId: z.string().min(1),
  notes: z.string().max(2000).optional(),
});

const transitionSchema = z.object({
  action: z.enum(["confirm", "dismiss", "mark_false_positive", "resolve"]),
  resolutionNote: z.string().max(1000).optional(),
});

const TARGET_STATUS: Record<string, string> = {
  confirm: "CONFIRMED",
  dismiss: "DISMISSED",
  mark_false_positive: "FALSE_POSITIVE",
  resolve: "RESOLVED",
};

// GET /leak-cases — queue with fingerprint + confidence + evidence count.
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const where = status ? { status: status as never } : {};
    const cases = await db.orm.public.LeakCase.where(where).all();

    const data = [];
    for (const leakCase of cases.slice(0, 100)) {
      const fingerprint = await db.orm.public.ArtifactFingerprint
        .where({ id: leakCase.fingerprintId })
        .first();
      const confidence = fingerprint ? await confidenceFor(fingerprint) : leakCase.confidence;
      data.push({
        id: leakCase.id,
        status: leakCase.status,
        confidence,
        evidenceCount: leakCase.evidenceCount,
        evidence: leakCase.evidence ?? null,
        notes: leakCase.notes ?? null,
        resolutionNote: leakCase.resolutionNote ?? null,
        resolvedAt: leakCase.resolvedAt ?? null,
        createdAt: leakCase.createdAt,
        fingerprint: fingerprint
          ? {
              id: fingerprint.id,
              artifactHash: fingerprint.artifactHash,
              family: fingerprint.family,
              sizeBytes: fingerprint.sizeBytes,
              fromVersionId: fingerprint.fromVersionId,
            }
          : null,
      });
    }
    res.json({ data });
  } catch (error) {
    reqLog(req).error("leak_case_queue_failed", { error });
    res.status(500).json({ error: "Failed to fetch leak cases" });
  }
});

// POST /leak-cases — OPEN a case on a fingerprint (evidence computed at open).
router.post("/", validate(openCaseSchema), async (req: AuthRequest, res: Response) => {
  try {
    const body = req.body as z.infer<typeof openCaseSchema>;
    const fingerprint = await db.orm.public.ArtifactFingerprint
      .where({ id: body.fingerprintId })
      .first();
    if (!fingerprint) {
      res.status(404).json({ error: "Fingerprint not found" });
      return;
    }

    const evidence = await evidenceFor(fingerprint);
    const confidence = await confidenceFor(fingerprint);
    const leakCase = await db.orm.public.LeakCase.create({
      fingerprintId: fingerprint.id,
      status: "OPEN",
      confidence,
      evidenceCount: evidence.installationCount + evidence.familyCount,
      evidence: evidence as never,
      notes: body.notes ?? null,
      openedById: req.user!.userId,
    });
    await logSystem({
      level: "INFO",
      service: "leak-radar",
      message: "leak_case_opened",
      meta: { caseId: leakCase.id, fingerprintId: fingerprint.id, confidence },
    });
    res.status(201).json({
      id: leakCase.id,
      status: leakCase.status,
      confidence,
      evidenceCount: leakCase.evidenceCount,
    });
  } catch (error) {
    reqLog(req).error("leak_case_open_failed", { error });
    res.status(500).json({ error: "Failed to open leak case" });
  }
});

// POST /:id/transition — audited investigation decision.
router.post(
  "/:id/transition",
  validate(transitionSchema),
  async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body as z.infer<typeof transitionSchema>;
      const leakCase = await db.orm.public.LeakCase
        .where({ id: req.params.id as string })
        .first();
      if (!leakCase) {
        res.status(404).json({ error: "Leak case not found" });
        return;
      }
      const nextStatus = TARGET_STATUS[body.action];
      const updated = await db.orm.public.LeakCase.where({ id: leakCase.id }).update({
        status: nextStatus as never,
        resolutionNote: body.resolutionNote ?? null,
        resolvedAt: ["CONFIRMED", "RESOLVED", "DISMISSED", "FALSE_POSITIVE"].includes(nextStatus)
          ? new Date().toISOString()
          : leakCase.resolvedAt,
      });
      await recordAudit({
        actorId: req.user!.userId,
        action: "leak_case_transitioned",
        targetType: "leak_case",
        targetId: leakCase.id,
        before: { status: leakCase.status, confidence: leakCase.confidence },
        after: { status: nextStatus, action: body.action, note: body.resolutionNote ?? null },
        ip: req.ip,
        requestId: req.id ?? null,
      });
      await logSystem({
        level: "INFO",
        service: "leak-radar",
        message: "leak_case_transitioned",
        meta: { caseId: leakCase.id, action: body.action, status: nextStatus },
      });
      res.json(updated);
    } catch (error) {
      reqLog(req).error("leak_case_transition_failed", { error });
      res.status(500).json({ error: "Failed to transition leak case" });
    }
  }
);

// POST /leak-cases/scan/:versionId — compute/refresh the fingerprint for a
// version's artifact; auto-open a case when confidence ≥ 0.6.
router.post("/scan/:versionId", async (req: AuthRequest, res: Response) => {
  try {
    const version = await db.orm.public.ResourceVersion
      .where({ id: req.params.versionId as string })
      .first();
    if (!version) {
      res.status(404).json({ error: "Version not found" });
      return;
    }

    const buffer = await loadArtifactBuffer(version.fileUrl);
    if (!buffer) {
      res.status(409).json({ error: "Artifact bytes unavailable for this version" });
      return;
    }

    const entryNames = await listEntryNames(buffer).catch(() => null);
    const fingerprint = await fingerprintArtifact({
      artifactHash: crypto.createHash("sha256").update(buffer).digest("hex"),
      sizeBytes: buffer.length,
      entryNames,
      fromVersionId: version.id,
    });

    const confidence = await confidenceFor(fingerprint);
    let openedCaseId: string | null = null;
    if (confidence >= 0.6) {
      // Auto-open: one OPEN case per fingerprint (never duplicates).
      const existing = await db.orm.public.LeakCase
        .where({ fingerprintId: fingerprint.id })
        .all();
      const open = existing.find((c: { status: string }) => c.status === "OPEN");
      if (open) {
        openedCaseId = open.id;
      } else {
        const evidence = await evidenceFor(fingerprint);
        const leakCase = await db.orm.public.LeakCase.create({
          fingerprintId: fingerprint.id,
          status: "OPEN",
          confidence,
          evidenceCount: evidence.installationCount + evidence.familyCount,
          evidence: evidence as never,
          openedById: req.user!.userId,
          notes: "auto-opened by scan (confidence >= 0.6)",
        });
        openedCaseId = leakCase.id;
      }
    }

    res.json({
      fingerprint: {
        id: fingerprint.id,
        artifactHash: fingerprint.artifactHash,
        family: fingerprint.family,
      },
      confidence,
      openedCaseId,
    });
  } catch (error) {
    reqLog(req).error("leak_scan_failed", { error });
    res.status(500).json({ error: "Failed to scan version" });
  }
});

/** Bounded zip entry-name listing for scan (reuses the pure parser). */
async function listEntryNames(buffer: Buffer): Promise<string[] | null> {
  const { extractEntryNames } = await import("../lib/artifact/metadata.js");
  const listing = await extractEntryNames(buffer);
  return listing.total === 0 ? null : listing.names;
}

export const leakRoutes: Router = router;
export default leakRoutes;
