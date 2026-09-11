#include <drm/ed25519.hpp>

#include <openssl/evp.h>
#include <openssl/x509.h>

#include <drm/base64.hpp>

#include <cstring>
#include <memory>

namespace mta::drm
{
namespace
{

struct PkeyDeleter
{
    void operator()(EVP_PKEY *key) const
    {
        if (key != nullptr)
            EVP_PKEY_free(key);
    }
};
using PkeyPtr = std::unique_ptr<EVP_PKEY, PkeyDeleter>;

struct PkeyContextDeleter
{
    void operator()(EVP_PKEY_CTX *ctx) const
    {
        if (ctx != nullptr)
            EVP_PKEY_CTX_free(ctx);
    }
};
using PkeyContextPtr = std::unique_ptr<EVP_PKEY_CTX, PkeyContextDeleter>;

} // namespace

std::optional<Ed25519Keypair> ed25519_generate()
{
    PkeyContextPtr ctx(EVP_PKEY_CTX_new_id(EVP_PKEY_ED25519, nullptr));
    if (!ctx || EVP_PKEY_keygen_init(ctx.get()) <= 0)
        return std::nullopt;

    EVP_PKEY *raw_key = nullptr;
    if (EVP_PKEY_generate(ctx.get(), &raw_key) <= 0)
        return std::nullopt;
    PkeyPtr key(raw_key);

    Ed25519Keypair pair;
    std::size_t private_len = 32;
    std::size_t public_len = 32;
    pair.private_key.resize(32);
    pair.public_key.resize(32);
    if (EVP_PKEY_get_raw_private_key(key.get(), pair.private_key.data(), &private_len) <= 0 ||
        private_len != 32)
        return std::nullopt;
    if (EVP_PKEY_get_raw_public_key(key.get(), pair.public_key.data(), &public_len) <= 0 ||
        public_len != 32)
        return std::nullopt;
    return pair;
}

std::optional<std::vector<std::uint8_t>> ed25519_public_from_private(
    const std::vector<std::uint8_t> &private_key)
{
    if (private_key.size() != 32)
        return std::nullopt;
    PkeyPtr key(EVP_PKEY_new_raw_private_key(EVP_PKEY_ED25519, nullptr, private_key.data(),
                                            private_key.size()));
    if (!key)
        return std::nullopt;
    std::vector<std::uint8_t> public_key(32);
    std::size_t public_len = 32;
    if (EVP_PKEY_get_raw_public_key(key.get(), public_key.data(), &public_len) <= 0 ||
        public_len != 32)
        return std::nullopt;
    return public_key;
}

std::optional<std::vector<std::uint8_t>> ed25519_sign(const std::vector<std::uint8_t> &private_key,
                                                      const std::vector<std::uint8_t> &message)
{
    if (private_key.size() != 32)
        return std::nullopt;
    PkeyPtr key(EVP_PKEY_new_raw_private_key(EVP_PKEY_ED25519, nullptr, private_key.data(),
                                            private_key.size()));
    if (!key)
        return std::nullopt;

    EVP_MD_CTX *raw_ctx = EVP_MD_CTX_new();
    if (!raw_ctx)
        return std::nullopt;
    struct MdCtxDeleter
    {
        void operator()(EVP_MD_CTX *ctx) const { EVP_MD_CTX_free(ctx); }
    };
    std::unique_ptr<EVP_MD_CTX, MdCtxDeleter> ctx(raw_ctx);

    std::size_t signature_len = 0;
    if (EVP_DigestSignInit(ctx.get(), nullptr, nullptr, nullptr, key.get()) <= 0)
        return std::nullopt;
    if (EVP_DigestSign(ctx.get(), nullptr, &signature_len, message.data(), message.size()) <= 0)
        return std::nullopt;

    std::vector<std::uint8_t> signature(signature_len);
    if (EVP_DigestSign(ctx.get(), signature.data(), &signature_len, message.data(), message.size()) <= 0)
        return std::nullopt;
    signature.resize(signature_len);
    return signature;
}

bool ed25519_verify(const std::vector<std::uint8_t> &public_key,
                    const std::vector<std::uint8_t> &message,
                    const std::vector<std::uint8_t> &signature)
{
    if (public_key.size() != 32)
        return false;
    PkeyPtr key(EVP_PKEY_new_raw_public_key(EVP_PKEY_ED25519, nullptr, public_key.data(),
                                           public_key.size()));
    if (!key)
        return false;

    EVP_MD_CTX *raw_ctx = EVP_MD_CTX_new();
    if (!raw_ctx)
        return false;
    struct MdCtxDeleter
    {
        void operator()(EVP_MD_CTX *ctx) const { EVP_MD_CTX_free(ctx); }
    };
    std::unique_ptr<EVP_MD_CTX, MdCtxDeleter> ctx(raw_ctx);

    if (EVP_DigestVerifyInit(ctx.get(), nullptr, nullptr, nullptr, key.get()) <= 0)
        return false;
    return EVP_DigestVerify(ctx.get(), signature.data(), signature.size(), message.data(),
                            message.size()) == 1;
}

std::optional<std::vector<std::uint8_t>> ed25519_public_from_spki_der(
    const std::vector<std::uint8_t> &spki_der)
{
    const auto *data = spki_der.data();
    PkeyPtr key(d2i_PUBKEY(nullptr, &data, static_cast<long>(spki_der.size())));
    if (!key || EVP_PKEY_id(key.get()) != EVP_PKEY_ED25519)
        return std::nullopt;
    std::vector<std::uint8_t> public_key(32);
    std::size_t public_len = 32;
    if (EVP_PKEY_get_raw_public_key(key.get(), public_key.data(), &public_len) <= 0 ||
        public_len != 32)
        return std::nullopt;
    return public_key;
}

} // namespace mta::drm
