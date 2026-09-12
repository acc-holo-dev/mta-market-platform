// PLAN-016 A-009 §9: OAuth provider token encryption at rest.
// Round-trip encrypt→store→read→decrypt, nullable/legacy passthrough,
// tamper detection. OAUTH_TOKEN_ENCRYPTION_KEY is read per call (no module
// caching) — env stubbing works without resetModules.
import { describe, it, expect, afterEach, vi } from "vitest";

import {
  encryptProviderToken,
  decryptProviderToken,
  isEncryptedProviderToken,
} from "@server/lib/tokenCrypto";

const KEY = Buffer.alloc(32, 42).toString("base64");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("A-009: provider token encryption at rest", () => {
  it("round-trips encrypt→decrypt and produces the v1 envelope", () => {
    vi.stubEnv("OAUTH_TOKEN_ENCRYPTION_KEY", KEY);
    const stored = encryptProviderToken("ya29.super-secret-oauth-token");
    expect(stored).not.toBeNull();
    expect(stored!.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("super-secret");
    expect(decryptProviderToken(stored)).toBe("ya29.super-secret-oauth-token");
  });

  it("passes null/empty through untouched", () => {
    vi.stubEnv("OAUTH_TOKEN_ENCRYPTION_KEY", KEY);
    expect(encryptProviderToken(null)).toBeNull();
    expect(encryptProviderToken("")).toBeNull();
    expect(decryptProviderToken(null)).toBeNull();
    expect(decryptProviderToken("")).toBeNull();
  });

  it("stores plaintext when the deployment key is absent (dev honesty) and decrypt tolerates it", () => {
    vi.stubEnv("OAUTH_TOKEN_ENCRYPTION_KEY", "");
    const stored = encryptProviderToken("legacy-plain-token");
    expect(stored).toBe("legacy-plain-token");
    expect(isEncryptedProviderToken(stored)).toBe(false);
    expect(decryptProviderToken(stored)).toBe("legacy-plain-token");
  });

  it("passes legacy plaintext rows through decryption unchanged", () => {
    vi.stubEnv("OAUTH_TOKEN_ENCRYPTION_KEY", KEY);
    expect(decryptProviderToken("legacy-plain-token")).toBe("legacy-plain-token");
  });

  it("returns null on a tampered ciphertext (GCM auth)", () => {
    vi.stubEnv("OAUTH_TOKEN_ENCRYPTION_KEY", KEY);
    const stored = encryptProviderToken("sensitive-token")!;
    const parts = stored.split(":");
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 0xff; // flip a ciphertext byte
    const tampered = [
      parts[0],
      iv.toString("base64"),
      tag.toString("base64"),
      ct.toString("base64"),
    ].join(":");
    expect(decryptProviderToken(tampered)).toBeNull();
  });

  it("rejects a malformed envelope instead of guessing", () => {
    vi.stubEnv("OAUTH_TOKEN_ENCRYPTION_KEY", KEY);
    expect(decryptProviderToken("v1:not-an-envelope")).toBeNull();
  });
});