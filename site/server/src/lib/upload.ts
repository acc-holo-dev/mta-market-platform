// File upload configuration (local storage + S3)
import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";

// Local storage configuration
export const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure multer for local storage
const localStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${crypto.randomBytes(16).toString("hex")}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

// File filter (security)
const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  // Allowed extensions
  const allowedExts = [".lua", ".zip", ".rar", ".7z", ".png", ".jpg", ".jpeg", ".gif"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${ext}`));
  }
};

// Create multer instance
export const upload = multer({
  storage: localStorage,
  fileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB
  },
});

/**
 * Resolve a stored file reference to an absolute path inside UPLOAD_DIR.
 * TASK A-009: local paid artifacts are never served statically; the download
 * route streams them after an entitlement check. Only bare filenames are
 * accepted — any traversal sequence, separator or absolute path is rejected
 * (defense in depth: the reference can never escape UPLOAD_DIR).
 * Returns null when the reference is not a plain filename.
 */
export function resolveLocalUploadPath(fileRef: string): string | null {
  const normalized = fileRef.replace(/\\/g, "/");
  const prefix = "/uploads/";
  const name = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;

  if (!name || name.includes("/") || name.includes("..")) {
    return null;
  }

  const resolved = path.resolve(UPLOAD_DIR, name);
  const root = path.resolve(UPLOAD_DIR);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    return null;
  }
  return resolved;
}

// Helper to delete file
export function deleteFile(filename: string): void {
  const filePath = path.join(UPLOAD_DIR, filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}
