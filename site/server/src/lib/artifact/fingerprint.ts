// PLAN-018 O-001/O-002/O-003: artifact fingerprinting service.
//
// FINGERPRINT → FAMILY → EVIDENCE → CONFIDENCE, with an honesty contract:
// confidence is a weighted heuristic score, capped at 0.9. It is NEVER 1.0 —
// a low-confidence structural match is never proof of a leaked artifact;
// only human review (LeakCase transitions) confirms or dismisses.
import crypto from "crypto";
import { db } from "../../prisma/db.js";
import { parseAssetMetadata } from "./metadata.js";
import { logger } from "../logger.js";

export interface FingerprintInput {
  artifactHash: string; // sha256 of the released artifact (already computed upstream)
  sizeBytes?: number | null;
  entryNames?: string[] | null;
  fromVersionId?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FingerprintRow = any; // ORM row type is not nameable across pnpm store paths (TS2742)

/**
 * Deterministic family key: sorted top-5 entry BASENAMES (lowercased), sha256
 * prefix. Two artifacts sharing the same dominant file names land in the same
 * family — re-uploads of the same asset pack with small edits group together.
 */
export function deriveFamilyKey(entryNames?: string[] | null): string | null {
  if (!entryNames || entryNames.length === 0) return null;
  const basenames = Array.from(
    new Set(
      entryNames
        .map((n) => (n.replace(/\\/g, "/").split("/").pop() ?? n).toLowerCase())
        .filter((n) => n.length > 0 && n !== "meta.xml" && !n.startsWith("__macosx"))
    )
  )
    .sort()
    .slice(0, 5);
  if (basenames.length === 0) return null;
  return crypto.createHash("sha256").update(basenames.join("\n")).digest("hex").slice(0, 16);
}

/** Jaccard similarity of two entry-name sets. */
export function entryNameJaccard(a?: string[] | null, b?: string[] | null): number {
  if (!a?.length || !b?.length) return 0;
  const sa = new Set(a.map((n) => n.replace(/\\/g, "/").toLowerCase()));
  const sb = new Set(b.map((n) => n.replace(/\\/g, "/").toLowerCase()));
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter += 1;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Upsert a fingerprint by artifactHash (unique). When the hash already
 * exists the row is refreshed (size/entries/version pointer) — the operation
 * is idempotent: calling it twice with the same input returns the same row
 * and does not duplicate anything.
 */
export async function fingerprintArtifact(input: FingerprintInput): Promise<FingerprintRow> {
  const family = deriveFamilyKey(input.entryNames);

  const existing = await db.orm.public.ArtifactFingerprint
    .where({ artifactHash: input.artifactHash })
    .first();

  if (existing) {
    const updated = await db.orm.public.ArtifactFingerprint
      .where({ id: existing.id })
      .update({
        family,
        sizeBytes: input.sizeBytes ?? existing.sizeBytes,
        entryNames: (input.entryNames ?? null) as never,
        fromVersionId: input.fromVersionId ?? existing.fromVersionId,
      });
    logger.info("fingerprint_updated", { hash: input.artifactHash.slice(0, 12), family });
    return updated ?? existing;
  }

  const created = await db.orm.public.ArtifactFingerprint.create({
    artifactHash: input.artifactHash,
    family,
    sizeBytes: input.sizeBytes ?? null,
    entryNames: (input.entryNames ?? null) as never,
    fromVersionId: input.fromVersionId ?? null,
  });
  logger.info("fingerprint_created", { hash: input.artifactHash.slice(0, 12), family });
  return created;
}

export interface FingerprintEvidence {
  /** Distinct licenses issued on the origin version (installation evidence). */
  installationCount: number;
  /** Number of other artifacts in the same family. */
  familyCount: number;
  /** External sources checked (none integrated yet — honest zero). */
  externalCount: number;
}

/** Evidence bundle for a fingerprint (O-002): bounded DB reads. */
export async function evidenceFor(fingerprint: FingerprintRow): Promise<FingerprintEvidence> {
  let installationCount = 0;
  if (fingerprint.fromVersionId) {
    const licenses = await db.orm.public.License
      .where({ versionId: fingerprint.fromVersionId })
      .all();
    installationCount = licenses.length;
  }

  let familyCount = 0;
  if (fingerprint.family) {
    const sameFamily = await db.orm.public.ArtifactFingerprint
      .where({ family: fingerprint.family })
      .all();
    familyCount = Math.max(0, sameFamily.length - 1);
  }

  return { installationCount, familyCount, externalCount: 0 };
}

/**
 * Weighted confidence (O-003). Weights:
 *   ≥2 same-family matches          → 0.4
 *   ≥1 installation overlap         → 0.3
 *   exact size match with a family peer → 0.1
 *   entry-name Jaccard ≥ 0.8        → 0.2
 * Capped at 0.9 — NEVER 1.0: structural similarity is not proof.
 */
export function computeConfidence(params: {
  familyCount: number;
  installationCount: number;
  sizeMatch: boolean;
  jaccard: number;
}): number {
  let score = 0;
  if (params.familyCount >= 2) score += 0.4;
  if (params.installationCount >= 1) score += 0.3;
  if (params.sizeMatch) score += 0.1;
  if (params.jaccard >= 0.8) score += 0.2;
  return Math.min(score, 0.9);
}

/** Confidence for a fingerprint against its family peers (used by scan). */
export async function confidenceFor(fingerprint: FingerprintRow): Promise<number> {
  const evidence = await evidenceFor(fingerprint);

  let sizeMatch = false;
  let jaccard = 0;
  if (fingerprint.family) {
    const peers = (await db.orm.public.ArtifactFingerprint
      .where({ family: fingerprint.family })
      .all()) as FingerprintRow[];
    for (const peer of peers) {
      if (peer.id === fingerprint.id) continue;
      if (
        !sizeMatch &&
        fingerprint.sizeBytes != null &&
        peer.sizeBytes != null &&
        Number(peer.sizeBytes) === Number(fingerprint.sizeBytes)
      ) {
        sizeMatch = true;
      }
      jaccard = Math.max(jaccard, entryNameJaccard(fingerprint.entryNames, peer.entryNames));
    }
  }

  return computeConfidence({
    familyCount: evidence.familyCount,
    installationCount: evidence.installationCount,
    sizeMatch,
    jaccard,
  });
}

/** Structural stats via the pure parser (best-effort, honest nulls). */
export async function structuralStatsFor(
  fileName: string,
  buffer: Buffer
): Promise<Record<string, unknown>> {
  try {
    return (await parseAssetMetadata(fileName, buffer)) as unknown as Record<string, unknown>;
  } catch (error) {
    logger.warn("fingerprint_structural_stats_failed", { error });
    return { format: "unknown" };
  }
}
