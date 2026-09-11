/**
 * PLAN G-005: artifact encryption — envelope-encrypted per-version DEKs.
 *
 * - every resource version gets a unique DEK (32 bytes);
 * - the DEK itself is wrapped (AES-256-GCM) under the server master key
 *   (DRM_MASTER_KEY env, base64) and stored in ArtifactEncryption;
 * - the raw master key never leaves the server; the unwrapped DEK is only
 *   released through the lease-gated /drm/v2/versions/:id/dek endpoint;
 * - payload encryption uses AES-256-GCM (authenticated) with a fresh nonce.
 */

import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from "crypto";
import {
  DEK_ALGORITHM,
  DEK_KEY_BYTES,
  DEK_WRAP_NONCE_BYTES,
  DRM_MASTER_KEY_ENV,
} from "../drm/protocol";

export class EncryptionNotConfiguredError extends Error {
  constructor() {
    super("Artifact encryption is not configured (missing DRM_MASTER_KEY)");
    this.name = "EncryptionNotConfiguredError";
  }
}

function loadMasterKey(): Buffer {
  const raw = process.env[DRM_MASTER_KEY_ENV];
  if (!raw) {
    throw new EncryptionNotConfiguredError();
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== DEK_KEY_BYTES) {
    throw new Error(`DRM_MASTER_KEY must be ${DEK_KEY_BYTES} bytes (base64)`);
  }
  return key;
}

export interface VersionDek {
  dekId: string;
  dek: Buffer;
}

/** Generate a fresh per-version DEK. */
export function generateVersionDek(): VersionDek {
  return { dekId: randomUUID(), dek: randomBytes(DEK_KEY_BYTES) };
}

export interface WrappedDek {
  wrappedDek: string; // base64 ciphertext
  wrapNonce: string; // base64 GCM nonce
  wrapTag: string; // base64 GCM auth tag
}

/** Wrap (encrypt) a DEK under the server master key. */
export function wrapDek(dek: Buffer): WrappedDek {
  const masterKey = loadMasterKey();
  const nonce = randomBytes(DEK_WRAP_NONCE_BYTES);
  const cipher = createCipheriv(DEK_ALGORITHM, masterKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    wrappedDek: ciphertext.toString("base64"),
    wrapNonce: nonce.toString("base64"),
    wrapTag: cipher.getAuthTag().toString("base64"),
  };
}

/** Unwrap a DEK (server-side only). */
export function unwrapDek(wrapped: WrappedDek): Buffer {
  const masterKey = loadMasterKey();
  const decipher = createDecipheriv(DEK_ALGORITHM, masterKey, Buffer.from(wrapped.wrapNonce, "base64"));
  decipher.setAuthTag(Buffer.from(wrapped.wrapTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(wrapped.wrappedDek, "base64")),
    decipher.final(),
  ]);
}

export interface EncryptedPayload {
  algorithm: string;
  nonce: string; // base64
  tag: string; // base64
  ciphertext: string; // base64
}

/** Authenticated encryption of a version payload under its DEK. */
export function encryptWithDek(dek: Buffer, plaintext: Buffer): EncryptedPayload {
  const nonce = randomBytes(DEK_WRAP_NONCE_BYTES);
  const cipher = createCipheriv(DEK_ALGORITHM, dek, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    algorithm: DEK_ALGORITHM,
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

/** Authenticated decryption; throws on any payload tampering. */
export function decryptWithDek(dek: Buffer, payload: EncryptedPayload): Buffer {
  const decipher = createDecipheriv(DEK_ALGORITHM, dek, Buffer.from(payload.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
}
