// drm/aead -- AES-256-GCM authenticated encryption for DRM artifact
// payloads (PLAN G-005). The 12-byte nonce is always fresh per encryption;
// the 16-byte auth tag travels with the payload. Any tampering with the
// ciphertext, nonce or tag fails decryption.

#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace mta::drm
{

struct AeadSeal
{
    std::vector<std::uint8_t> nonce;     // 12 bytes (fresh per call)
    std::vector<std::uint8_t> tag;       // 16 bytes
    std::vector<std::uint8_t> ciphertext;
};

/// Encrypts plaintext under a 32-byte key. Returns nullopt on OpenSSL failure.
std::optional<AeadSeal> aead_encrypt(const std::vector<std::uint8_t> &key,
                                     const std::vector<std::uint8_t> &plaintext);

/// Decrypts a sealed payload. Returns nullopt when authentication fails
/// (tampered ciphertext/nonce/tag) or inputs are malformed.
std::optional<std::vector<std::uint8_t>> aead_decrypt(const std::vector<std::uint8_t> &key,
                                                      const AeadSeal &seal);

} // namespace mta::drm
