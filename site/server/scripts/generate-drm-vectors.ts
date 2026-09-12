/**
 * Generates deterministic DRM protocol test vectors (PLAN-019 S-003).
 *
 * The vectors are produced with the SERVER's own crypto implementation
 * (src/lib/drm/crypto.ts) over FIXED key material, so the output is
 * byte-stable across runs and can be consumed by:
 *   - site/server unit tests (tests/unit/site/drm-vectors.test.ts)
 *   - the native module's DRM test harness (module side consumes the same
 *     JSON when its Linux toolchain runs — module/src/drm/Makefile test)
 *
 * Run: pnpm --filter @mta-market/server exec tsx scripts/generate-drm-vectors.ts
 * Output: contracts/drm/v2/vectors.json (committed).
 */
import { writeFileSync } from "node:fs";
import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  signChallenge,
  verifyChallengeResponse,
  signLease,
  verifyLeaseSignature,
  isLeaseExpired,
  calculateLeaseExpiry,
} from "../src/lib/drm/crypto.js";
import type { LeasePayload } from "../src/lib/drm/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const outFile = join(root, "contracts", "drm", "v2", "vectors.json");

// Fixed test seed (32 bytes) — Ed25519 PKCS8 DER = prefix + seed.
const SEED_HEX = "3141592653589793238462643383279502884197169399375105820974944592";
const seed = Buffer.from(SEED_HEX, "hex");
if (seed.length !== 32) throw new Error("seed must be 32 bytes");
const pkcs8 = Buffer.concat([
  Buffer.from("302e020100300506032b657004220420", "hex"),
  seed,
]);
const privateKeyObj = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
const publicKeyObj = createPublicKey(privateKeyObj);
const spki = publicKeyObj.export({ type: "spki", format: "der" });
const publicRaw = spki.subarray(spki.length - 32); // raw 32-byte Ed25519 public key

const privateKeyB64 = privateKeyObj.export({ type: "pkcs8", format: "der" }).toString("base64");
const publicKeySpkiB64 = spki.toString("base64");
const publicRawB64 = publicRaw.toString("base64");

// Fixed challenge (32 bytes).
const challenge = Buffer.alloc(32, 0x42).toString("base64");

const validSignature = signChallenge(challenge, privateKeyB64);
const tamperedSignature = Buffer.from(validSignature, "base64");
tamperedSignature[tamperedSignature.length - 1] ^= 0xff;
const tamperedB64 = tamperedSignature.toString("base64");

// Independent cross-check with node:crypto (the lib must agree with the
// platform primitive): Ed25519 signs the raw message.
const nodeSignature = sign(null, Buffer.from(challenge, "base64"), privateKeyObj).toString("base64");

// Fixed lease payload with fixed dates (deterministic across runs).
const issuedAt = "2026-01-01T00:00:00.000Z";
const expiresAt = new Date(new Date(issuedAt).getTime() + 604800 * 1000).toISOString();
const leasePayload = {
  protocolVersion: 2,
  licenseId: "11111111-2222-4333-8444-555555555555",
  installationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  resourceId: "22222222-3333-4444-8555-666666666666",
  resourceVersionId: "33333333-4444-4555-8666-777777777777",
  artifactHash: "aa".repeat(32),
  issuedAt,
  expiresAt,
  nonce: "ab".repeat(32),
  serverKeyId: "test-key-1",
  capabilities: ["run"],
} satisfies LeasePayload & Record<string, unknown>;

const leaseSignature = signLease(leasePayload as unknown as Parameters<typeof signLease>[0], privateKeyB64);
// Determinism proof: signing the SAME fixed payload with the SAME fixed key
// must reproduce the stored signature byte-for-byte on every run.
const reproduced = signLease(leasePayload as unknown as Parameters<typeof signLease>[0], privateKeyB64);
if (reproduced !== leaseSignature) throw new Error("lease signing is not deterministic — aborting");

const expiredLeasePayload = {
  ...leasePayload,
  issuedAt: "2020-01-01T00:00:00.000Z",
  expiresAt: "2020-01-08T00:00:00.000Z",
};
const expiredSignature = signLease(expiredLeasePayload as unknown as Parameters<typeof signLease>[0], privateKeyB64);

const vectors = {
  version: 2,
  generator: "site/server/scripts/generate-drm-vectors.ts (node:crypto + lib/drm/crypto)",
  note: "Deterministic shared vectors for site + module DRM tests (PLAN-019 S-003). Ed25519 base64 (raw 32-byte public key, PKCS8 DER private key).",
  keys: {
    seedHex: SEED_HEX,
    privateKeyPkcs8DerB64: privateKeyB64,
    publicKeySpkiDerB64: publicKeySpkiB64,
    publicKeyRawB64: publicRawB64,
  },
  challenge: {
    challengeB64: challenge,
    validSignatureB64: validSignature,
    tamperedSignatureB64: tamperedB64,
    nodeCrossCheckSignatureB64: nodeSignature,
    wrongKeySignatureB64: (() => {
      // Sign with a DIFFERENT fixed seed.
      const otherSeed = Buffer.from(SEED_HEX.split("").reverse().join(""), "hex").subarray(0, 32);
      const otherPkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), otherSeed]);
      const otherPriv = createPrivateKey({ key: otherPkcs8, format: "der", type: "pkcs8" });
      return sign(null, Buffer.from(challenge, "base64"), otherPriv).toString("base64");
    })(),
  },
  lease: {
    payload: leasePayload,
    validSignatureB64: leaseSignature,
    expired: {
      payload: expiredLeasePayload,
      signatureB64: expiredSignature,
      expectedExpired: true,
    },
  },
};

writeFileSync(outFile, JSON.stringify(vectors, null, 2) + "\n", "utf8");
console.log(`vectors written: ${outFile}`);
const recheck = verifyChallengeResponse(challenge, validSignature, publicKeySpkiB64);
if (!recheck) throw new Error("challenge vector does not verify");
// Lease full-verification is calendar-dependent; the vector test re-signs
// with dynamic dates using the fixed keys and asserts verify passes.
const dynamicLease = {
  ...leasePayload,
  issuedAt: new Date(Date.now() - 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 604800 * 1000).toISOString(),
} as unknown as LeasePayload;
const dynamicSignature = signLease(dynamicLease, privateKeyB64);
const dynamicCheck = verifyLeaseSignature(
  { ...dynamicLease, signature: dynamicSignature } as unknown as Parameters<typeof verifyLeaseSignature>[0],
  publicKeySpkiB64,
);
if (!dynamicCheck.valid) throw new Error(`dynamic lease does not verify: ${dynamicCheck.errors.join("; ")}`);
const expiredCheck = verifyLeaseSignature(
  { ...expiredLeasePayload, signature: expiredSignature } as unknown as Parameters<typeof verifyLeaseSignature>[0],
  publicKeySpkiB64,
);
if (expiredCheck.valid || !expiredCheck.errors.includes("Lease expired")) {
  throw new Error("expired lease vector did not produce the expired error");
}
console.log(`self-check: challenge=${recheck}, dynamicLease=${dynamicCheck.valid}, expiredReject=${expiredCheck.errors.includes("Lease expired")}, determinism=ok`);
