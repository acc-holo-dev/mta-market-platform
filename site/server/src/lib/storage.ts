// Storage abstraction for artifact pipelines (PLAN B-001/B-002).
// Loads artifact bytes from the storage referenced by a version's fileUrl:
// - S3 mode: fileUrl is the private object key;
// - local mode: fileUrl is an /uploads/<filename> reference, confined to
//   UPLOAD_DIR (never served statically — see TASK A-009).
import fs from "fs";
import { S3_ENABLED, s3GetObject } from "./s3";
import { resolveLocalUploadPath } from "./upload";

/**
 * Load the artifact buffer for a stored file reference.
 * Returns null when the reference cannot be resolved to an existing file.
 */
export async function loadArtifactBuffer(fileRef: string): Promise<Buffer | null> {
  if (S3_ENABLED) {
    try {
      return await s3GetObject(fileRef);
    } catch {
      return null;
    }
  }

  const localPath = resolveLocalUploadPath(fileRef);
  if (!localPath || !fs.existsSync(localPath)) {
    return null;
  }
  return fs.readFileSync(localPath);
}