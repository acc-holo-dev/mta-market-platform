// drm/base64 -- minimal, dependency-free Base64 (RFC 4648) used by the DRM
// client to decode/encode the protocol fields (Ed25519 public keys in SPKI
// DER, signatures, challenges, DEKs, AEAD blobs).
//
// Decode is strict: rejects characters outside the alphabet, wrong padding
// and embedded whitespace. Encode always emits padding (the server protocol
// uses standard padded Base64).

#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace mta::drm
{

/// Decodes standard Base64. Returns false on any malformed input.
bool base64_decode(std::string_view input, std::vector<std::uint8_t> &out);

/// Convenience overload returning an empty vector on malformed input.
std::vector<std::uint8_t> base64_decode(std::string_view input);

/// Encodes bytes as standard padded Base64.
std::string base64_encode(const std::uint8_t *data, std::size_t size);

/// Convenience overload for byte containers (std::string works too).
template <typename Container>
std::string base64_encode(const Container &data)
{
    return base64_encode(reinterpret_cast<const std::uint8_t *>(data.data()), data.size());
}

} // namespace mta::drm
