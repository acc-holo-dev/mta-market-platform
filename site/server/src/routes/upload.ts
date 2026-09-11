// File upload routes
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit, strictRateLimit } from "../lib/rateLimit";
import { upload, deleteFile } from "../lib/upload";
import { uploadToS3, S3_ENABLED } from "../lib/s3";
import {
  MEDIA_MAX_BYTES,
  validateImageBuffer,
  mediaFilename,
  sniffImageType,
} from "../lib/media";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { reqLog } from "../middleware/requestId";

const router: Router = Router();

// PLAN-003 A-005: media uploads get their own multer instance — strict size
// limit and image-only storage naming (opaque media-<hex><ext> names, so a
// media upload can never shadow an artifact file).
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, process.env.UPLOAD_DIR || "./uploads"),
    filename: (_req, _file, cb) => {
      // Temporary name during validation; renamed to the opaque media- name
      // after magic-byte validation passes.
      cb(null, `tmp-${crypto.randomBytes(16).toString("hex")}`);
    },
  }),
  limits: { fileSize: MEDIA_MAX_BYTES },
});

/**
 * PLAN-004 B-001: store validated media bytes under the unified contract —
 * opaque `media-<hex>` name, object under `media/` in S3 mode, local file
 * renamed in place in local mode. Returns the bare media filename; callers
 * respond with the controlled public URL `/media/<name>`.
 */
async function storeMediaObject(
  buffer: Buffer,
  file: Express.Multer.File,
  sniffed: { mime: string; extension: string }
): Promise<string> {
  const name = mediaFilename(sniffed.extension);
  if (S3_ENABLED) {
    await uploadToS3({
      buffer,
      originalName: file.originalname,
      mimeType: sniffed.mime,
      key: `media/${name}`,
    });
    return name;
  }
  const target = path.resolve(process.env.UPLOAD_DIR || "./uploads", name);
  fs.renameSync(file.path, target);
  return name;
}

/**
 * POST /upload/media — upload a cover/screenshot image (authenticated).
 * PLAN-003 A-002/A-005: magic-byte sniffed validation, opaque naming,
 * 5 MB limit. Returns the public URL used by the resource media endpoints.
 */
router.post(
  "/media",
  authenticate,
  strictRateLimit,
  mediaUpload.single("file"),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      const buffer = fs.readFileSync(req.file.path);
      const rejection = validateImageBuffer(buffer, req.file.mimetype, req.file.originalname);
      if (rejection) {
        deleteFile(req.file.filename);
        res.status(400).json({ error: rejection });
        return;
      }

      const sniffed = sniffImageType(buffer);
      if (!sniffed) {
        deleteFile(req.file.filename);
        res.status(400).json({ error: "Unsupported image format" });
        return;
      }

      // PLAN-004 B-001: unified media storage contract. The stored URL is
      // the controlled public delivery path `/media/<name>` in every storage
      // mode. Absolute S3 URLs are never returned (they broke the resource
      // media contract and bypassed the media route's name policy).
      const name = await storeMediaObject(buffer, req.file, sniffed);
      deleteFile(req.file.filename);

      res.status(201).json({
        url: `/media/${name}`,
        mimeType: sniffed.mime,
        sizeBytes: buffer.length,
        storage: S3_ENABLED ? "s3" : "local",
      });
    } catch (error) {
      reqLog(req).error("media_upload_failed", { error });

      // Cleanup the temp upload file when it still exists.
      if (req.file) {
        deleteFile(req.file.filename);
      }

      res.status(500).json({ error: "Failed to upload media" });
    }
  }
);

// POST /upload/resource - Upload resource file (authenticated)
router.post(
  "/resource",
  authenticate,
  strictRateLimit,
  upload.single("file"),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      // Compute checksum BEFORE any cleanup (the local temp file is removed
      // after an S3 upload, so it must be read first).
      const buffer = fs.readFileSync(req.file.path);
      const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

      let fileUrl: string;
      let fileKey: string | null = null;

      // Upload to S3 if enabled, otherwise use local storage
      if (S3_ENABLED) {
        fileKey = await uploadToS3({
          buffer,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          folder: "resources",
        });
        // TASK A-009: store the OBJECT KEY, never a public URL — paid
        // artifacts are downloaded exclusively via short-lived signed URLs.
        fileUrl = fileKey;

        // Delete local file after S3 upload
        deleteFile(req.file.filename);
      } else {
        // Local storage: opaque reference; downloads go through the
        // authorized versions download route (no public static serving).
        fileUrl = `/uploads/${req.file.filename}`;
      }

      res.status(201).json({
        fileUrl,
        fileKey,
        fileName: req.file.originalname,
        fileSize: req.file.size,
        fileChecksum: checksum,
        mimeType: req.file.mimetype,
        storage: S3_ENABLED ? "s3" : "local",
      });
    } catch (error) {
      reqLog(req).error("file_upload_failed", { error });

      // Cleanup on error
      if (req.file) {
        deleteFile(req.file.filename);
      }

      res.status(500).json({ error: "Failed to upload file" });
    }
  }
);

// POST /upload/avatar - Upload user avatar (authenticated)
// PLAN-004 B-001: unified media storage contract — same magic-byte validated
// pipeline as /upload/media (opaque media-<hex> name, /media/<name> delivery
// URL in every storage mode). The avatar itself is still not persisted here.
router.post(
  "/avatar",
  authenticate,
  standardRateLimit,
  mediaUpload.single("avatar"),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      const buffer = fs.readFileSync(req.file.path);
      const rejection = validateImageBuffer(buffer, req.file.mimetype, req.file.originalname);
      if (rejection) {
        deleteFile(req.file.filename);
        res.status(400).json({ error: rejection });
        return;
      }
      const sniffed = sniffImageType(buffer);
      if (!sniffed) {
        deleteFile(req.file.filename);
        res.status(400).json({ error: "Unsupported image format" });
        return;
      }

      const name = await storeMediaObject(buffer, req.file, sniffed);
      deleteFile(req.file.filename);

      // TODO: Update user avatar in database
      // await db.orm.public.User
      //   .where({ id: req.user!.userId })
      //   .update({ avatar: avatarUrl });

      res.status(201).json({
        avatarUrl: `/media/${name}`,
        storage: S3_ENABLED ? "s3" : "local",
      });
    } catch (error) {
      reqLog(req).error("avatar_upload_failed", { error });

      if (req.file) {
        deleteFile(req.file.filename);
      }

      res.status(500).json({ error: "Failed to upload avatar" });
    }
  }
);

// POST /upload/screenshot - Upload resource screenshot (authenticated)
// PLAN-004 B-001: legacy alias of the validated media pipeline (the resource
// media endpoints only accept /media/<name> references, so an absolute URL
// here was unusable in S3 mode and bypassed magic-byte validation in local
// mode).
router.post(
  "/screenshot",
  authenticate,
  standardRateLimit,
  mediaUpload.single("screenshot"),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      const buffer = fs.readFileSync(req.file.path);
      const rejection = validateImageBuffer(buffer, req.file.mimetype, req.file.originalname);
      if (rejection) {
        deleteFile(req.file.filename);
        res.status(400).json({ error: rejection });
        return;
      }
      const sniffed = sniffImageType(buffer);
      if (!sniffed) {
        deleteFile(req.file.filename);
        res.status(400).json({ error: "Unsupported image format" });
        return;
      }

      const name = await storeMediaObject(buffer, req.file, sniffed);
      deleteFile(req.file.filename);

      res.status(201).json({
        screenshotUrl: `/media/${name}`,
        storage: S3_ENABLED ? "s3" : "local",
      });
    } catch (error) {
      reqLog(req).error("screenshot_upload_failed", { error });

      if (req.file) {
        deleteFile(req.file.filename);
      }

      res.status(500).json({ error: "Failed to upload screenshot" });
    }
  }
);

export default router;
