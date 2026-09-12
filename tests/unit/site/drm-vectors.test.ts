/**
 * DRM shared test vectors (PLAN-019 S-003).
 *
 * Consumes contracts/drm/v2/vectors.json — the same file the native module's
 * DRM harness consumes when its Linux toolchain runs. Deterministic fixed
 * key material; full-lease verification is calendar-dependent, so the lease
 * vectors prove (a) byte-stable signing determinism over the fixed payload
 * and (b) correct rejection of the fixed expired lease.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  signChallenge,
  verifyChallengeResponse,
  signLease,
  verifyLeaseSignature,
} from "@server/lib/drm/crypto";
import type { LeasePayload, SignedLease } from "@server/lib/drm/types";

const vectorsRoot = path.resolve(__dirname, "../../..");
const vectors = JSON.parse(
  readFileSync(path.join(vectorsRoot, "contracts/drm/v2/vectors.json"), "utf8")
) as {
  keys: { privateKeyPkcs8DerB64: string; publicKeySpkiDerB64: string };
  challenge: {
    challengeB64: string;
    validSignatureB64: string;
    tamperedSignatureB64: string;
    nodeCrossCheckSignatureB64: string;
    wrongKeySignatureB64: string;
  };
  lease: {
    payload: LeasePayload;
    validSignatureB64: string;
    expired: { payload: LeasePayload; signatureB64: string };
  };
};

describe("DRM shared test vectors (contracts/drm/v2/vectors.json)", () => {
  it("verifies the fixed valid challenge signature", () => {
    expect(
      verifyChallengeResponse(
        vectors.challenge.challengeB64,
        vectors.challenge.validSignatureB64,
        vectors.keys.publicKeySpkiDerB64
      )
    ).toBe(true);
  });

  it("matches the node:crypto cross-check signature byte-for-byte", () => {
    const libSignature = signChallenge(
      vectors.challenge.challengeB64,
      vectors.keys.privateKeyPkcs8DerB64
    );
    expect(libSignature).toBe(vectors.challenge.validSignatureB64);
    expect(libSignature).toBe(vectors.challenge.nodeCrossCheckSignatureB64);
  });

  it("rejects the tampered signature", () => {
    expect(
      verifyChallengeResponse(
        vectors.challenge.challengeB64,
        vectors.challenge.tamperedSignatureB64,
        vectors.keys.publicKeySpkiDerB64
      )
    ).toBe(false);
  });

  it("rejects a signature produced by a different key", () => {
    expect(
      verifyChallengeResponse(
        vectors.challenge.challengeB64,
        vectors.challenge.wrongKeySignatureB64,
        vectors.keys.publicKeySpkiDerB64
      )
    ).toBe(false);
  });

  it("reproduces the stored lease signature deterministically", () => {
    const signature = signLease(vectors.lease.payload, vectors.keys.privateKeyPkcs8DerB64);
    expect(signature).toBe(vectors.lease.validSignatureB64);
  });

  it("verifies a dynamically-dated lease signed with the fixed keys", () => {
    const payload: LeasePayload = {
      ...vectors.lease.payload,
      issuedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 604_800 * 1000).toISOString(),
    };
    const signature = signLease(payload, vectors.keys.privateKeyPkcs8DerB64);
    const result = verifyLeaseSignature(
      { ...payload, signature } as unknown as SignedLease,
      vectors.keys.publicKeySpkiDerB64
    );
    expect(result.valid).toBe(true);
  });

  it("rejects the fixed expired lease with the expired error", () => {
    const expired = vectors.lease.expired;
    const result = verifyLeaseSignature(
      { ...expired.payload, signature: expired.signatureB64 } as unknown as SignedLease,
      vectors.keys.publicKeySpkiDerB64
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Lease expired");
  });
});
