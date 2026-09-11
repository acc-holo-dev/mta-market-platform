// drm/ed25519 -- Ed25519 signing primitives for the DRM client (PLAN G-002/
// G-003/G-004), implemented over OpenSSL EVP.
//
// The installation identity is a raw Ed25519 keypair: the private key (32
// bytes) never leaves the installation (INV-010) -- it lives in the key
// store (drm/key_store). The server only ever sees the public key, both as
// the raw 32 bytes (registration) and as the SPKI DER form the server
// returns in /drm/v2/public-keys (lease verification by serverKeyId).

#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace mta::drm
{

struct Ed25519Keypair
{
    std::vector<std::uint8_t> private_key; // 32 bytes (raw seed)
    std::vector<std::uint8_t> public_key;  // 32 bytes (raw)
};

/// Generates a fresh Ed25519 keypair. Returns nullopt on OpenSSL failure.
std::optional<Ed25519Keypair> ed25519_generate();

/// Derives the raw public key for a raw private key.
std::optional<std::vector<std::uint8_t>> ed25519_public_from_private(
    const std::vector<std::uint8_t> &private_key);

/// Signs raw bytes with a raw Ed25519 private key; returns the 64-byte signature.
std::optional<std::vector<std::uint8_t>> ed25519_sign(const std::vector<std::uint8_t> &private_key,
                                                      const std::vector<std::uint8_t> &message);

/// Verifies a raw Ed25519 signature over raw bytes with a raw public key.
bool ed25519_verify(const std::vector<std::uint8_t> &public_key,
                    const std::vector<std::uint8_t> &message,
                    const std::vector<std::uint8_t> &signature);

/// Parses a base64-encoded SPKI DER public key (server format) into a raw
/// 32-byte Ed25519 public key.
std::optional<std::vector<std::uint8_t>> ed25519_public_from_spki_der(
    const std::vector<std::uint8_t> &spki_der);

} // namespace mta::drm
