// PLAN-003 A-002/A-005: public media serving for resource covers/screenshots.
//
// Only `media-<64hex>.<png|jpg|jpeg|webp|gif>` names are served (see
// isMediaName / resolveLocalMediaPath). Paid artifacts use plain random
// names, so this route can never serve them.
//
// PLAN-004 B-002: production media delivery strategy —
// - local storage: bytes are streamed from UPLOAD_DIR;
// - S3/R2 storage: if MEDIA_PUBLIC_BASE_URL is configured, the route issues a
//   302 redirect to the controlled public/CDN media URL (same `/media/<name>`
//   path, e.g. a bucket/CDN host mirroring the `media/` prefix); otherwise
//   the object is fetched from the private bucket and streamed by the
//   backend. Arbitrary external URLs remain forbidden — the name policy
//   applies in every mode, and paid artifacts (plain random names) are
//   unreachable through this route.
import { Router, Response } from "express";
import fs from "fs";
import { isMediaName, resolveLocalMediaPath, MEDIA_MIME_BY_EXTENSION } from "../lib/media";
import path from "path";
import { standardRateLimit } from "../lib/rateLimit";
import { reqLog } from "../middleware/requestId";
import { S3_ENABLED, s3GetObject } from "../lib/s3";

const router: Router = Router();

// Controlled public media base (CDN/object URL). Must not have a trailing
// slash; delivery paths are appended as `/media/<name>`.
const MEDIA_PUBLIC_BASE_URL = (process.env.MEDIA_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

const MIME_BY_EXT = (name: string): string =>
  MEDIA_MIME_BY_EXTENSION[path.extname(name).toLowerCase()] ?? "application/octet-stream";

router.get("/:name", standardRateLimit, async (req, res: Response) => {
  const name = req.params.name as string;

  // Name policy is storage-independent: opaque media names only.
  if (!isMediaName(name)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // S3/R2 mode: controlled public delivery.
  if (S3_ENABLED) {
    if (MEDIA_PUBLIC_BASE_URL) {
      // 302 to the CDN/public object URL. Images are immutable
      // (content-addressed by random name) — cache the redirect too.
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.redirect(302, `${MEDIA_PUBLIC_BASE_URL}/media/${name}`);
      return;
    }
    try {
      const buffer = await s3GetObject(`media/${name}`);
      res.setHeader("Content-Type", MIME_BY_EXT(name));
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.status(200).send(buffer);
    } catch {
      reqLog(req).warn("media_s3_get_failed", { name });
      res.status(404).json({ error: "Not found" });
    }
    return;
  }

  // Local mode: serve from UPLOAD_DIR.
  const filePath = resolveLocalMediaPath(name);
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Images are immutable content-addressed-by-name files; cache them hard.
  res.setHeader("Content-Type", MIME_BY_EXT(name));
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(filePath, (err) => {
    if (err) {
      reqLog(req).warn("media_send_failed", { name });
      if (!res.headersSent) {
        res.status(404).json({ error: "Not found" });
      }
    }
  });
});

export default router;
