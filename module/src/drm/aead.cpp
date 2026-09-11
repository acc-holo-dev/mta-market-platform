#include <drm/aead.hpp>

#include <openssl/evp.h>
#include <openssl/rand.h>

#include <cstring>
#include <memory>

namespace mta::drm
{
namespace
{
constexpr std::size_t kKeyBytes = 32;
constexpr std::size_t kNonceBytes = 12;
constexpr std::size_t kTagBytes = 16;

struct CipherContextDeleter
{
    void operator()(EVP_CIPHER_CTX *ctx) const
    {
        if (ctx != nullptr)
            EVP_CIPHER_CTX_free(ctx);
    }
};
using CipherContextPtr = std::unique_ptr<EVP_CIPHER_CTX, CipherContextDeleter>;

} // namespace

std::optional<AeadSeal> aead_encrypt(const std::vector<std::uint8_t> &key,
                                     const std::vector<std::uint8_t> &plaintext)
{
    if (key.size() != kKeyBytes)
        return std::nullopt;

    CipherContextPtr ctx(EVP_CIPHER_CTX_new());
    if (!ctx)
        return std::nullopt;

    AeadSeal seal;
    seal.nonce.resize(kNonceBytes);
    if (RAND_bytes(seal.nonce.data(), static_cast<int>(seal.nonce.size())) != 1)
        return std::nullopt;

    if (EVP_EncryptInit_ex(ctx.get(), EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1)
        return std::nullopt;
    if (EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_SET_IVLEN, kNonceBytes, nullptr) != 1)
        return std::nullopt;
    if (EVP_EncryptInit_ex(ctx.get(), nullptr, nullptr, key.data(), seal.nonce.data()) != 1)
        return std::nullopt;

    seal.ciphertext.resize(plaintext.size());
    int out_len = 0;
    if (!plaintext.empty())
    {
        if (EVP_EncryptUpdate(ctx.get(), seal.ciphertext.data(), &out_len, plaintext.data(),
                              static_cast<int>(plaintext.size())) != 1)
            return std::nullopt;
    }
    int final_len = 0;
    if (EVP_EncryptFinal_ex(ctx.get(), seal.ciphertext.data() + out_len, &final_len) != 1)
        return std::nullopt;
    seal.ciphertext.resize(static_cast<std::size_t>(out_len) + static_cast<std::size_t>(final_len));

    seal.tag.resize(kTagBytes);
    if (EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_GET_TAG, kTagBytes, seal.tag.data()) != 1)
        return std::nullopt;
    return seal;
}

std::optional<std::vector<std::uint8_t>> aead_decrypt(const std::vector<std::uint8_t> &key,
                                                      const AeadSeal &seal)
{
    if (key.size() != kKeyBytes || seal.nonce.size() != kNonceBytes || seal.tag.size() != kTagBytes)
        return std::nullopt;

    CipherContextPtr ctx(EVP_CIPHER_CTX_new());
    if (!ctx)
        return std::nullopt;

    if (EVP_DecryptInit_ex(ctx.get(), EVP_aes_256_gcm(), nullptr, nullptr, nullptr) != 1)
        return std::nullopt;
    if (EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_SET_IVLEN, kNonceBytes, nullptr) != 1)
        return std::nullopt;
    if (EVP_DecryptInit_ex(ctx.get(), nullptr, nullptr, key.data(), seal.nonce.data()) != 1)
        return std::nullopt;

    std::vector<std::uint8_t> plaintext(seal.ciphertext.size());
    int out_len = 0;
    if (!seal.ciphertext.empty())
    {
        if (EVP_DecryptUpdate(ctx.get(), plaintext.data(), &out_len, seal.ciphertext.data(),
                              static_cast<int>(seal.ciphertext.size())) != 1)
            return std::nullopt;
    }
    if (EVP_CIPHER_CTX_ctrl(ctx.get(), EVP_CTRL_GCM_SET_TAG, kTagBytes,
                            const_cast<std::uint8_t *>(seal.tag.data())) != 1)
        return std::nullopt;

    int final_len = 0;
    // DecryptFinal fails when the authentication tag does not match.
    if (EVP_DecryptFinal_ex(ctx.get(), plaintext.data() + out_len, &final_len) != 1)
        return std::nullopt;
    plaintext.resize(static_cast<std::size_t>(out_len) + static_cast<std::size_t>(final_len));
    return plaintext;
}

} // namespace mta::drm
