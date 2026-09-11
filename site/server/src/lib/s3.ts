// S3 client for production file storage
// SECURITY: All paid artifacts MUST be stored in a PRIVATE bucket.
// Downloads are only allowed via short-lived signed URLs (GetObjectCommand).
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import path from "path";

const S3_ENABLED = process.env.S3_ENABLED === "true";
const S3_BUCKET = process.env.S3_BUCKET || "";
const S3_REGION = process.env.S3_REGION || "us-east-1";
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || "";
const S3_SECRET_KEY = process.env.S3_SECRET_KEY || "";
const S3_ENDPOINT = process.env.S3_ENDPOINT; // For Cloudflare R2

// Signed download URL TTL (seconds). Short-lived per audit P0-10.
const SIGNED_URL_TTL = parseInt(process.env.S3_SIGNED_URL_TTL || "300", 10); // 5 minutes

let s3Client: S3Client | null = null;

if (S3_ENABLED) {
  if (!S3_BUCKET || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    throw new Error(
      "FATAL: S3_ENABLED=true but S3_BUCKET, S3_ACCESS_KEY or S3_SECRET_KEY is missing"
    );
  }

  s3Client = new S3Client({
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY,
      secretAccessKey: S3_SECRET_KEY,
    },
    ...(S3_ENDPOINT && { endpoint: S3_ENDPOINT }),
  });
}

export interface UploadToS3Options {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  folder?: string;
  /**
   * PLAN-004 B-001: explicit object key override. Media uploads pass the
   * opaque `media/<media-<hex>.<ext>>` key so the database reference stays
   * the controlled public path (`/media/<name>`) regardless of storage.
   */
  key?: string;
}

export async function uploadToS3(options: UploadToS3Options): Promise<string> {
  if (!s3Client) {
    throw new Error("S3 is not enabled");
  }

  const { buffer, originalName, mimeType, folder = "resources", key } = options;

  if (key) {
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    });
    await s3Client.send(command);
    return key;
  }

  const ext = path.extname(originalName);
  const generatedKey = `${folder}/${crypto.randomBytes(16).toString("hex")}${ext}`;

  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: generatedKey,
    Body: buffer,
    ContentType: mimeType,
  });

  await s3Client.send(command);

  return generatedKey;
}

export async function deleteFromS3(key: string): Promise<void> {
  if (!s3Client) {
    throw new Error("S3 is not enabled");
  }

  const command = new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  await s3Client.send(command);
}

/**
 * Read an object from the private bucket (used to load artifacts for
 * validation/signing — never exposed to clients directly).
 */
export async function s3GetObject(key: string): Promise<Buffer> {
  if (!s3Client) {
    throw new Error("S3 is not enabled");
  }

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  const response = await s3Client.send(command);
  const bytes = await response.Body?.transformToByteArray();
  if (!bytes) {
    throw new Error(`S3 object is empty: ${key}`);
  }
  return Buffer.from(bytes);
}

/**
 * Generate a short-lived signed URL for downloading a private artifact.
 * SECURITY: Uses GetObjectCommand (read-only). Never expose public URLs for paid content.
 */
export async function getS3DownloadUrl(key: string, expiresIn?: number): Promise<string> {
  if (!s3Client) {
    throw new Error("S3 is not enabled");
  }

  const ttl = expiresIn ?? SIGNED_URL_TTL;

  // Hard cap TTL to prevent accidental long-lived URLs
  const safeTtl = Math.min(ttl, 900); // max 15 minutes

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  return await getSignedUrl(s3Client, command, { expiresIn: safeTtl });
}

export { S3_ENABLED, SIGNED_URL_TTL };
