#include <drm/key_store.hpp>

#include <drm/aead.hpp>

#include <openssl/evp.h>
#include <openssl/sha.h>

#ifndef _WIN32
#include <sys/stat.h>
#include <unistd.h>
#endif

#include <cstdio>
#include <cstring>
#include <fstream>
#include <random>

namespace mta::drm
{
namespace
{

constexpr std::size_t kKeyBytes = 32;

std::string read_machine_id()
{
    // Machine identity source on Linux; empty fallback keeps the format.
#ifndef _WIN32
    for (const char *path : {"/etc/machine-id", "/var/lib/dbus/machine-id"})
    {
        std::ifstream file(path);
        if (file)
        {
            std::string id;
            std::getline(file, id);
            if (!id.empty())
                return id;
        }
    }
#endif
    return "unknown-machine";
}

std::vector<std::uint8_t> sha256(const std::vector<std::uint8_t> &data)
{
    std::vector<std::uint8_t> digest(32);
    SHA256(data.data(), data.size(), digest.data());
    return digest;
}

std::vector<std::uint8_t> machine_key(const std::string &home)
{
    std::vector<std::uint8_t> salt(16);
    const std::string salt_path = home + "/machine.salt";
    std::ifstream in(salt_path, std::ios::binary);
    if (in)
    {
        in.read(reinterpret_cast<char *>(salt.data()), static_cast<std::streamsize>(salt.size()));
        if (static_cast<std::size_t>(in.gcount()) == salt.size())
        {
            const std::string machine = read_machine_id();
            std::vector<std::uint8_t> combined(machine.begin(), machine.end());
            combined.insert(combined.end(), salt.begin(), salt.end());
            return sha256(combined);
        }
    }

    // First use: create the salt.
    std::random_device device;
    for (auto &byte : salt)
        byte = static_cast<std::uint8_t>(device());
    std::ofstream out(salt_path, std::ios::binary | std::ios::trunc);
    if (!out)
        return {};
    out.write(reinterpret_cast<const char *>(salt.data()), static_cast<std::streamsize>(salt.size()));
    out.close();
#ifndef _WIN32
    chmod(salt_path.c_str(), 0600);
#endif
    const std::string machine = read_machine_id();
    std::vector<std::uint8_t> combined(machine.begin(), machine.end());
    combined.insert(combined.end(), salt.begin(), salt.end());
    return sha256(combined);
}

bool write_private_file(const std::string &path, const std::vector<std::uint8_t> &data)
{
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    if (!out)
        return false;
    out.write(reinterpret_cast<const char *>(data.data()), static_cast<std::streamsize>(data.size()));
    out.close();
#ifndef _WIN32
    chmod(path.c_str(), 0600);
#endif
    return !out.fail();
}

std::optional<std::vector<std::uint8_t>> read_file(const std::string &path)
{
    std::ifstream in(path, std::ios::binary);
    if (!in)
        return std::nullopt;
    return std::vector<std::uint8_t>((std::istreambuf_iterator<char>(in)),
                                     std::istreambuf_iterator<char>());
}

} // namespace

KeyStore::KeyStore(std::string home_directory) : home_(std::move(home_directory)) {}

bool KeyStore::save(const std::vector<std::uint8_t> &private_key)
{
    if (private_key.size() != kKeyBytes)
        return false;
#ifndef _WIN32
    const std::string home_command = "mkdir -p '" + home_ + "' >/dev/null 2>&1";
    if (std::system(home_command.c_str()) != 0)
        return false;
    chmod(home_.c_str(), 0700);
#endif
    const std::vector<std::uint8_t> key = machine_key(home_);
    if (key.size() != kKeyBytes)
        return false;
    const auto seal = aead_encrypt(key, private_key);
    if (!seal)
        return false;

    std::vector<std::uint8_t> blob = seal->nonce;
    blob.insert(blob.end(), seal->ciphertext.begin(), seal->ciphertext.end());
    blob.insert(blob.end(), seal->tag.begin(), seal->tag.end());
    return write_private_file(home_ + "/installation.key", blob);
}

std::optional<std::vector<std::uint8_t>> KeyStore::load()
{
    const auto blob = read_file(home_ + "/installation.key");
    if (!blob || blob->size() < 12 + 16 + 1)
        return std::nullopt;
    const std::vector<std::uint8_t> key = machine_key(home_);
    if (key.size() != kKeyBytes)
        return std::nullopt;

    AeadSeal seal;
    seal.nonce.assign(blob->begin(), blob->begin() + 12);
    seal.tag.assign(blob->end() - 16, blob->end());
    seal.ciphertext.assign(blob->begin() + 12, blob->end() - 16);
    return aead_decrypt(key, seal);
}

bool KeyStore::clear()
{
    bool ok = true;
    for (const char *name : {"installation.key", "machine.salt"})
    {
        const std::string path = home_ + "/" + name;
        if (std::remove(path.c_str()) != 0 && errno != ENOENT)
            ok = false;
    }
    return ok;
}

} // namespace mta::drm
