// PLAN-003 A-002/A-004/A-005: resource media (cover/screenshots) support.
//
// Security rules (A-005 — frontend validation is never trusted):
// - the image type is determined by SNIFFING MAGIC BYTES, not by the declared
//   MIME type or extension;
// - only an allowlisted set of raster image formats is accepted;
// - the declared mimetype must agree with the sniffed type;
// - uploaded media gets an opaque random name under UPLOAD_DIR;
// - public serving goes exclusively through GET /media/:name, which accepts
//   only `media-<64hex>.<ext>` names (the artifact pipeline uses plain random
//   names, so paid artifacts are unreachable from the media route);
// - deletion is best-effort local file cleanup (A-004: no orphaned media
//   objects where the storage allows safe control).
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { UPLOAD_DIR } from "./upload";
import { S3_ENABLED, deleteFromS3 } from "./s3";

export const MEDIA_MAX_BYTES = 5 * 1024 * 1024; // 5 MB per image
export const MAX_SCREENSHOTS_PER_RESOURCE = 8;

export const MEDIA_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export type SniffedImage = { mime: string; extension: ".png" | ".jpg" | ".jpeg" | ".webp" | ".gif" } | null;

/**
 * Detect the real image format from magic bytes. Returns null for anything
 * that is not one of the allowlisted formats (defense against a renamed
 * archive/executable passing an extension check).
 */
export function sniffImageType(buffer: Buffer): SniffedImage {
  if (buffer.length < 12) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return { mime: "image/png", extension: ".png" };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: "image/jpeg", extension: ".jpg" };
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { mime: "image/webp", extension: ".webp" };
  }

  // GIF: "GIF87a" / "GIF89a"
  const head = buffer.toString("ascii", 0, 6);
  if (head === "GIF87a" || head === "GIF89a") {
    return { mime: "image/gif", extension: ".gif" };
  }

  return null;
}

/**
 * Validate an uploaded image buffer against the declared mimetype.
 * Returns an error message string when the file must be rejected, null when ok.
 */
export function validateImageBuffer(buffer: Buffer, declaredMime: string, originalName: string): string | null {
  const ext = path.extname(originalName).toLowerCase();
  if (!MEDIA_MIME_BY_EXTENSION[ext]) {
    return `Unsupported file extension: ${ext || "(none)"}. Allowed: png, jpg, jpeg, webp, gif.`;
  }

  const sniffed = sniffImageType(buffer);
  if (!sniffed) {
    return "File content is not a supported image (png, jpeg, webp, gif).";
  }

  // The declared mimetype must agree with the actual bytes.
  if (MEDIA_MIME_BY_EXTENSION[ext] !== sniffed.mime) {
    return "File extension does not match the actual image format.";
  }

  // Declared mime must also be an image of the same family. Some browsers
  // send generic types; only a *conflicting* declaration is rejected.
  if (declaredMime && declaredMime !== sniffed.mime && !declaredMime.startsWith(`${sniffed.mime.split("/")[0]}/`)) {
    return "Declared content type does not match the actual image format.";
  }

  return null;
}

/** Opaque local media filename: media-<64hex><ext>. */
export function mediaFilename(extension: string): string {
  return `media-${crypto.randomBytes(32).toString("hex")}${extension}`;
}

const MEDIA_NAME_RE = /^media-[0-9a-f]{64}\.(png|jpg|jpeg|webp|gif)$/;

/** True when `name` is a bare opaque media filename (no path, no traversal). */
export function isMediaName(name: string): boolean {
  return MEDIA_NAME_RE.test(name);
}

/**
 * Resolve a public media URL (/media/<name>) to a path inside UPLOAD_DIR.
 * Only bare `media-<hex>.<ext>` names are accepted — any traversal sequence,
 * separator, absolute path or non-media name returns null (this route must
 * never serve paid artifacts, which live in the same directory).
 */
export function resolveLocalMediaPath(name: string): string | null {
  if (!MEDIA_NAME_RE.test(name)) {
    return null;
  }
  const resolved = path.resolve(UPLOAD_DIR, name);
  const root = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return null;
  }
  return resolved;
}

/** True when the URL references media stored/served by this backend. */
export function isOwnMediaUrl(url: string): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
  if (url.startsWith("/media/")) {
    return MEDIA_NAME_RE.test(url.slice("/media/".length));
  }
  return false;
}

/**
 * Extract the local filename from a public media URL; null when the URL is
 * not a local media URL (e.g. an S3 public URL).
 */
export function localMediaNameFromUrl(url: string): string | null {
  if (!isOwnMediaUrl(url)) return null;
  return url.slice("/media/".length);
}

/**
 * A-004: delete a local media file (best-effort — used when a cover is
 * replaced/removed or a screenshot is deleted). Missing files are ignored;
 * failures are swallowed by callers that log them.
 */
export function deleteLocalMediaByName(name: string | null | undefined): void {
  if (!name) return;
  if (!MEDIA_NAME_RE.test(name)) return;
  const resolved = path.resolve(UPLOAD_DIR, name);
  const root = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(root + path.sep)) return;
  try {
    if (fs.existsSync(resolved)) {
      fs.unlinkSync(resolved);
    }
  } catch {
    // best-effort; a leftover file is preferable to crashing a request
  }
}

/** Extract the local media name from any stored URL, for cleanup. */
export function cleanupMediaUrl(url: string | null | undefined): void {
  if (!url) return;
  const name = localMediaNameFromUrl(url);
  if (!name) return;
  deleteLocalMediaByName(name);

  // PLAN-004 B-001/B-006: in S3 mode the media object lives under the
  // `media/` prefix in the bucket — delete it too (best-effort, async).
  if (S3_ENABLED) {
    void deleteFromS3(`media/${name}`).catch(() => {
      // best-effort: a leftover object is handled by storage lifecycle (B-007)
    });
  }
}
