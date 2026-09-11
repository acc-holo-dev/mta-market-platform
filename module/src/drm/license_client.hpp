// drm/license_client -- the DRM license subsystem (PLAN H-004/H-005).
//
// Implements the module side of the frozen DRM Protocol v2:
//   ensure identity -> register (browser-authenticated) -> verify challenge
//   -> activate (signed lease) -> verify lease -> heartbeat -> renew
//   (fresh nonce) -> fetch version DEK -> decrypt artifact payload.
//
// Lifecycle rules (H-004):
// - the installation private key is generated once and kept only in the
//   key store (INV-010: the private key never leaves the installation);
// - registration requires the browser-authenticated user (license owner) to
//   hand the module a short-lived bearer token -- the module itself never
//   stores user credentials;
// - all network operations go through drm/http_client (timeouts, bounded
//   retries, cert validation); nothing blocks without a timeout.
//
// Resource lifecycle (H-005): a protected payload is AES-256-GCM encrypted
// under the version DEK; the DEK is fetched only for versions covered by an
// unexpired lease of this installation; decryption happens in memory right
// before handing the plaintext to the caller (see spike.cpp for the proven
// in-VM execution path) and the plaintext is not persisted.

#pragma once

#include <drm/aead.hpp>
#include <drm/ed25519.hpp>
#include <drm/http_client.hpp>
#include <drm/json.hpp>
#include <drm/key_store.hpp>

#include <atomic>
#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace mta::drm
{

struct LicenseClientConfig
{
    std::string base_url;      // e.g. https://market.example.com
    std::string license_id;    // the license this installation is bound to
    std::string key_store_dir; // key storage home (see drm/key_store)
    /// Dev-only TLS override; leave false in production.
    bool allow_self_signed = false;
};

class LicenseClient
{
public:
    explicit LicenseClient(LicenseClientConfig config, std::atomic<bool> *abort_flag = nullptr);

    /// H-004: loads (or creates) the installation identity from the key store.
    bool ensureIdentity();

    /// True when an identity already exists locally.
    bool hasIdentity() const;

    std::string publicKeyBase64() const;

    /// STEP 1 (browser-assisted): registers the installation public key.
    /// `bearer_token` comes from the owner's browser session; the server
    /// checks license ownership (INV-007). Returns the challenge (base64).
    std::optional<std::string> registerInstallation(const std::string &bearer_token,
                                                    const std::string &mta_version,
                                                    const std::string &module_version,
                                                    HttpClientError &error);

    /// STEP 2: proves possession of the private key by signing the challenge.
    bool verifyInstallation(const std::string &installation_id, const std::string &challenge,
                            HttpClientError &error);

    /// STEP 3: activates the license (fresh nonce) and stores the lease after
    /// verifying its signature against the trusted server keys.
    std::optional<Json> activate(HttpClientError &error);

    /// H-005: verifies the stored lease (signature via serverKeyId, expiry
    /// with 90s skew, protocol version).
    bool verifyStoredLease() const;

    /// STEP 4: reports uptime; returns leaseValid from the server.
    std::optional<bool> heartbeat(std::uint64_t uptime_seconds, HttpClientError &error);

    /// STEP 5 (G-005): fetches the version DEK (possession proof: Ed25519
    /// signature over "dek:<versionId>:<nonce>"). Requires a stored lease
    /// covering that version.
    std::optional<std::vector<std::uint8_t>> fetchVersionDek(const std::string &version_id,
                                                             HttpClientError &error);

    /// H-005: decrypts a protected payload in memory (never persisted).
    std::optional<std::vector<std::uint8_t>> decryptProtectedPayload(
        const std::vector<std::uint8_t> &version_dek, const AeadSeal &seal);

    const Json *storedLease() const;

private:
    std::optional<Json> post(const std::string &target, const std::string &body,
                             const std::string *bearer, HttpClientError &error);
    std::optional<Json> get(const std::string &target, HttpClientError &error);

    LicenseClientConfig config_;
    std::atomic<bool> *abort_flag_;
    KeyStore key_store_;
    std::vector<std::uint8_t> private_key_;
    std::vector<std::uint8_t> public_key_;
    std::string installation_id_;
    std::string installation_public_key_base64_;
    std::optional<Json> lease_;
    std::map<std::string, std::vector<std::uint8_t>> trusted_keys_; // keyId -> raw public
    bool trusted_keys_loaded_ = false;
};

} // namespace mta::drm
