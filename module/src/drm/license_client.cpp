#include <drm/license_client.hpp>

#include <drm/base64.hpp>

#include <openssl/rand.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <ctime>
#include <thread>

namespace mta::drm
{
namespace
{

constexpr int kLeaseProtocolVersion = 2;
constexpr int kClockSkewSeconds = 90;

std::string generate_nonce_hex()
{
    // 32 random bytes, hex-encoded (64 chars) -- the protocol nonce format.
    static const char *digits = "0123456789abcdef";
    unsigned char bytes[32];
    if (RAND_bytes(bytes, sizeof(bytes)) != 1)
        return {};
    std::string hex;
    hex.reserve(64);
    for (const unsigned char byte : bytes)
    {
        hex.push_back(digits[byte >> 4]);
        hex.push_back(digits[byte & 0x0F]);
    }
    return hex;
}

struct UrlParts
{
    std::string host;
    std::uint16_t port;
};

UrlParts split_url(const std::string &base_url)
{
    // Accepts https://host[:port]; http is rejected -- HTTPS only (H-002).
    const std::string scheme = "https://";
    if (base_url.rfind(scheme, 0) != 0)
        return {};
    const std::string rest = base_url.substr(scheme.size());
    const std::size_t colon = rest.find(':');
    const std::size_t slash = rest.find('/');
    const std::string host = rest.substr(0, std::min(colon, slash) == std::string::npos
                                                 ? rest.size()
                                                 : std::min(colon, slash));
    std::uint16_t port = 443;
    if (colon != std::string::npos && (slash == std::string::npos || colon < slash))
    {
        port = static_cast<std::uint16_t>(std::atoi(rest.substr(colon + 1).c_str()));
    }
    return {host, port};
}

} // namespace

LicenseClient::LicenseClient(LicenseClientConfig config, std::atomic<bool> *abort_flag)
    : config_(std::move(config)), abort_flag_(abort_flag), key_store_(config_.key_store_dir)
{
}

bool LicenseClient::ensureIdentity()
{
    if (private_key_.size() == 32)
        return true;
    const auto stored = key_store_.load();
    if (stored && stored->size() == 32)
    {
        private_key_ = *stored;
        const auto public_key = ed25519_public_from_private(private_key_);
        if (!public_key)
            return false;
        public_key_ = *public_key;
        installation_public_key_base64_ = base64_encode(public_key_);
        return true;
    }
    const auto pair = ed25519_generate();
    if (!pair)
        return false;
    private_key_ = pair->private_key;
    public_key_ = pair->public_key;
    installation_public_key_base64_ = base64_encode(public_key_);
    if (!key_store_.save(private_key_))
        return false;
    return true;
}

bool LicenseClient::hasIdentity() const
{
    return private_key_.size() == 32;
}

std::string LicenseClient::publicKeyBase64() const
{
    return installation_public_key_base64_;
}

std::optional<Json> LicenseClient::post(const std::string &target, const std::string &body,
                                        const std::string *bearer, HttpClientError &error)
{
    HttpClient::Options options;
    options.allow_self_signed = config_.allow_self_signed;
    HttpClient client{abort_flag_, options};

    HttpRequest request;
    const UrlParts parts = split_url(config_.base_url);
    if (parts.host.empty())
    {
        error = {HttpClientError::Kind::Protocol, 0, "base_url must be https://host[:port]"};
        return std::nullopt;
    }
    request.host = parts.host;
    request.port = parts.port;
    request.target = target;
    request.method = "POST";
    request.body = body;
    if (bearer != nullptr)
        request.headers["Authorization"] = "Bearer " + *bearer;

    auto response = client.send(request, error);
    if (!response)
        return std::nullopt;
    return Json::parse(response->body);
}

std::optional<Json> LicenseClient::get(const std::string &target, HttpClientError &error)
{
    HttpClient::Options options;
    options.allow_self_signed = config_.allow_self_signed;
    HttpClient client{abort_flag_, options};

    HttpRequest request;
    const UrlParts parts = split_url(config_.base_url);
    if (parts.host.empty())
    {
        error = {HttpClientError::Kind::Protocol, 0, "base_url must be https://host[:port]"};
        return std::nullopt;
    }
    request.host = parts.host;
    request.port = parts.port;
    request.target = target;
    request.method = "GET";

    auto response = client.send(request, error);
    if (!response)
        return std::nullopt;
    return Json::parse(response->body);
}

std::optional<std::string> LicenseClient::registerInstallation(const std::string &bearer_token,
                                                               const std::string &mta_version,
                                                               const std::string &module_version,
                                                               HttpClientError &error)
{
    if (!ensureIdentity())
    {
        error = {HttpClientError::Kind::Io, 0, "identity setup failed"};
        return std::nullopt;
    }

    Json body = Json::make_object();
    // Json is an aggregate-ish value; build members explicitly.
    body.object = Json::Members{
        {"publicKey", Json::make_string(installation_public_key_base64_)},
        {"licenseId", Json::make_string(config_.license_id)},
        {"mtaVersion", Json::make_string(mta_version)},
        {"moduleVersion", Json::make_string(module_version)},
    };

    auto response = post("/drm/v2/installations", body.compact(), &bearer_token, error);
    if (!response)
        return std::nullopt;
    const Json *id = response->find("installationId");
    const Json *challenge = response->find("challenge");
    if (!id || !challenge || id->type != Json::Type::String ||
        challenge->type != Json::Type::String)
    {
        error = {HttpClientError::Kind::Protocol, 0, "invalid registration response"};
        return std::nullopt;
    }
    installation_id_ = id->string_value;
    return challenge->string_value;
}

bool LicenseClient::verifyInstallation(const std::string &installation_id,
                                       const std::string &challenge, HttpClientError &error)
{
    // PLAN-004 F-002 (audit P0-1): the challenge is a base64 string encoding
    // 32 raw bytes; the server verifies the Ed25519 signature over the
    // DECODED challenge bytes (lib/drm/crypto.ts verifyChallengeResponse
    // verifies Buffer.from(challenge, "base64")), and the protocol spec says
    // "signature over the raw challenge bytes". Signing the ASCII base64
    // text instead made every live verify fail with 401
    // DRM_INVALID_CHALLENGE_RESPONSE while both local test suites stayed
    // green. Decode first, then sign the raw bytes.
    std::vector<std::uint8_t> challenge_bytes;
    if (!base64_decode(challenge, challenge_bytes) || challenge_bytes.empty())
    {
        return false;
    }
    const auto signature = ed25519_sign(private_key_, challenge_bytes);
    if (!signature)
        return false;

    Json body = Json::make_object();
    body.object = Json::Members{
        {"challengeResponse", Json::make_string(base64_encode(*signature))},
    };
    auto response = post("/drm/v2/installations/" + installation_id + "/verify", body.compact(),
                         nullptr, error);
    if (!response)
        return false;
    const Json *verified = response->find("verified");
    return verified != nullptr && verified->type == Json::Type::Bool && verified->boolean;
}

std::optional<Json> LicenseClient::activate(HttpClientError &error)
{
    // Fresh nonce per activation: the server rejects reuse (replay protection).
    const std::string nonce = generate_nonce_hex();
    if (nonce.empty())
    {
        error = {HttpClientError::Kind::Io, 0, "nonce generation failed"};
        return std::nullopt;
    }

    Json body = Json::make_object();
    body.object = Json::Members{
        {"licenseId", Json::make_string(config_.license_id)},
        {"installationId", Json::make_string(installation_id_)},
        {"nonce", Json::make_string(nonce)},
    };

    auto response = post("/drm/v2/activate", body.compact(), nullptr, error);
    if (!response)
        return std::nullopt;

    // Verify before trusting: signature over canonical JSON (signature
    // stripped) using the trusted server key referenced by serverKeyId.
    if (!trusted_keys_loaded_)
    {
        auto keys = get("/drm/v2/public-keys", error);
        if (!keys)
            return std::nullopt;
        const Json *key_list = keys->find("keys");
        if (key_list != nullptr && key_list->type == Json::Type::Array)
        {
            for (const Json &key : key_list->array)
            {
                const Json *key_id = key.find("keyId");
                const Json *public_key = key.find("publicKey");
                if (key_id && public_key && key_id->type == Json::Type::String &&
                    public_key->type == Json::Type::String)
                {
                    const auto der = base64_decode(public_key->string_value);
                    if (der.empty())
                        continue;
                    const auto raw = ed25519_public_from_spki_der(der);
                    if (raw)
                        trusted_keys_.emplace(key_id->string_value, *raw);
                }
            }
        }
        trusted_keys_loaded_ = true;
    }

    const Json *server_key_id = response->find("serverKeyId");
    if (!server_key_id || server_key_id->type != Json::Type::String)
    {
        error = {HttpClientError::Kind::Protocol, 0, "lease without serverKeyId"};
        return std::nullopt;
    }
    const auto trusted = trusted_keys_.find(server_key_id->string_value);
    if (trusted == trusted_keys_.end())
    {
        error = {HttpClientError::Kind::Protocol, 0,
                 "lease signed by an unknown/revoked server key (DRM_SERVER_KEY_REVOKED)"};
        return std::nullopt;
    }

    const Json *signature = response->find("signature");
    if (!signature || signature->type != Json::Type::String)
    {
        error = {HttpClientError::Kind::Protocol, 0, "lease without signature"};
        return std::nullopt;
    }
    const auto sig_bytes = base64_decode(signature->string_value);
    const auto message_bytes = base64_decode(response->canonical(/*strip_signature=*/true));
    if (sig_bytes.empty() || message_bytes.empty() ||
        !ed25519_verify(trusted->second, message_bytes, sig_bytes))
    {
        error = {HttpClientError::Kind::Protocol, 0, "lease signature verification failed"};
        return std::nullopt;
    }

    lease_ = *response;
    return lease_;
}

bool LicenseClient::verifyStoredLease() const
{
    if (!lease_ || lease_->type != Json::Type::Object)
        return false;
    const Json *version = lease_->find("protocolVersion");
    const Json *expires_at = lease_->find("expiresAt");
    if (!version || version->type != Json::Type::Number ||
        version->number != std::to_string(kLeaseProtocolVersion))
        return false;
    if (!expires_at || expires_at->type != Json::Type::String)
        return false;

    // Expiry with the tolerated clock skew (G-001).
    std::tm expiry{};
    const std::string stamp = expires_at->string_value;
    // ISO-8601 timestamps from the server end with 'Z'.
    if (stamp.size() < 20 || stamp.back() != 'Z')
        return false;
    if (sscanf(stamp.c_str(), "%4d-%2d-%2dT%2d:%2d:%2d", &expiry.tm_year, &expiry.tm_mon,
               &expiry.tm_mday, &expiry.tm_hour, &expiry.tm_min, &expiry.tm_sec) != 6)
        return false;
    expiry.tm_year -= 1900;
    expiry.tm_mon -= 1;
    const std::time_t expiry_time = timegm(&expiry);
    const std::time_t now = std::time(nullptr);
    return now <= expiry_time + kClockSkewSeconds;
}

std::optional<bool> LicenseClient::heartbeat(std::uint64_t uptime_seconds, HttpClientError &error)
{
    if (!lease_)
        return std::nullopt;
    const Json *resource = lease_->find("resourceId");
    if (!resource || resource->type != Json::Type::String)
        return std::nullopt;

    Json body = Json::make_object();
    body.object = Json::Members{
        {"installationId", Json::make_string(installation_id_)},
        {"resourceId", Json::make_string(resource->string_value)},
        {"uptime", Json::make_number(std::to_string(uptime_seconds))},
    };
    auto response = post("/drm/v2/heartbeat", body.compact(), nullptr, error);
    if (!response)
        return std::nullopt;
    const Json *valid = response->find("leaseValid");
    if (!valid || valid->type != Json::Type::Bool)
        return std::nullopt;
    return valid->boolean;
}

std::optional<std::vector<std::uint8_t>> LicenseClient::fetchVersionDek(
    const std::string &version_id, HttpClientError &error)
{
    // Requires an unexpired stored lease covering this exact version (G-004:
    // a lease for resource A must not unlock resource B).
    if (!verifyStoredLease())
    {
        error = {HttpClientError::Kind::Protocol, 0, "no valid stored lease"};
        return std::nullopt;
    }
    const Json *lease_version = lease_->find("resourceVersionId");
    if (!lease_version || lease_version->string_value != version_id)
    {
        error = {HttpClientError::Kind::Protocol, 0, "lease does not cover this version"};
        return std::nullopt;
    }

    const std::string nonce = generate_nonce_hex();
    const std::string proof_ascii = "dek:" + version_id + ":" + nonce;
    const auto signature =
        ed25519_sign(private_key_, std::vector<std::uint8_t>(proof_ascii.begin(), proof_ascii.end()));
    if (!signature)
        return std::nullopt;

    Json body = Json::make_object();
    body.object = Json::Members{
        {"installationId", Json::make_string(installation_id_)},
        {"nonce", Json::make_string(nonce)},
        {"signature", Json::make_string(base64_encode(*signature))},
    };
    auto response = post("/drm/v2/versions/" + version_id + "/dek", body.compact(), nullptr, error);
    if (!response)
        return std::nullopt;
    const Json *dek = response->find("dek");
    if (!dek || dek->type != Json::Type::String)
        return std::nullopt;
    return base64_decode(dek->string_value);
}

std::optional<std::vector<std::uint8_t>> LicenseClient::decryptProtectedPayload(
    const std::vector<std::uint8_t> &version_dek, const AeadSeal &seal)
{
    return aead_decrypt(version_dek, seal);
}

const Json *LicenseClient::storedLease() const
{
    return lease_ ? &*lease_ : nullptr;
}

} // namespace mta::drm
