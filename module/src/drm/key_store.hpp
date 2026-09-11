// drm/key_store -- secure local storage for the installation private key
// (PLAN H-003).
//
// Threat model (documented per the plan's fallback rule): on Linux the key
// is stored ENCRYPTED at rest under a machine-derived key. This protects
// against casual copying of the key file (backup exfiltration, archive
// scraping) but NOT against a fully privileged local attacker who can read
// both the machine-id and the salt file and wait for the module to load the
// key. On Windows the key is protected with DPAPI (user-scoped), which ties
// decryption to the user account -- implemented behind _WIN32, exercised by
// CI on Windows (not buildable in this environment).
//
// Layout:
//   $MTA_MARKET_HOME (default: ~/.mta-market)/
//     installation.key    -- AES-256-GCM(private_key) {nonce(12)||ciphertext||tag(16)}, 0600
//     machine.salt        -- 16 random bytes created on first use, 0600
// The machine key is HKDF-free simple SHA-256(machine-id || salt); this is
// the documented fallback, not a KMS.

#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace mta::drm
{

class KeyStore
{
public:
    explicit KeyStore(std::string home_directory);

    /// Writes (or overwrites) the installation private key. The directory is
    /// created with 0700 and files with 0600.
    bool save(const std::vector<std::uint8_t> &private_key);

    /// Loads and decrypts the installation private key.
    std::optional<std::vector<std::uint8_t>> load();

    /// Removes the stored key material (both files stay valid).
    bool clear();

private:
    std::string home_;
};

} // namespace mta::drm
