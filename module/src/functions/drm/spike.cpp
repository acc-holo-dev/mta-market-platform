// STAGE 0 SPIKE — DRM feasibility (see marketplace document/12_ROADMAP.md).
//
// Question this spike answers:
//
//   "Can a native module load an encrypted Lua payload and execute it
//    inside the CALLING resource's VM, exactly like a protected
//    resource would?"
//
// Proven by 096_drm_spike.lua against the embedded Lua 5.1 harness:
//   1. an encrypted Lua SOURCE payload loads and runs in the caller VM;
//   2. an encrypted Lua BYTECODE payload (string.dump format) also loads
//      and runs -- bytecode is what the real build pipeline ships;
//   3. the executed chunk sees the caller's globals (same VM, same
//      environment -- no isolated sandbox VM);
//   4. a corrupted/tampered payload fails loudly instead of executing.
//
// Demo cipher: byte complement (~byte). The production stack is
// AES-256-GCM via libsodium, which is standard and NOT the open
// feasibility question -- the MTA lifecycle behaviour is. The
// complement stands in so payloads really are stored non-plaintext.

#include <mta/sdk.hpp>

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>

namespace
{
int hex_value(char digit)
{
    if (digit >= '0' && digit <= '9')
        return digit - '0';
    if (digit >= 'a' && digit <= 'f')
        return digit - 'a' + 10;
    if (digit >= 'A' && digit <= 'F')
        return digit - 'A' + 10;
    return -1;
}

// Hex decode -> complement ("decrypt") the payload bytes.
bool spike_decrypt(std::string_view hex, std::string &out)
{
    if (hex.size() % 2 != 0)
    {
        return false;
    }
    out.clear();
    out.reserve(hex.size() / 2);
    for (std::size_t i = 0; i < hex.size(); i += 2)
    {
        const int hi = hex_value(hex[i]);
        const int lo = hex_value(hex[i + 1]);
        if (hi < 0 || lo < 0)
        {
            return false;
        }
        const auto byte = static_cast<std::uint8_t>(hi * 16 + lo);
        out.push_back(static_cast<char>(~byte & 0xFF));
    }
    return true;
}
} // namespace

// Decrypts the hex payload and executes it in the CALLING resource VM.
// Returns true on success; false + message otherwise.
MTA_LUA_FUNCTION("spike_drm_load",
    "STAGE 0 SPIKE: decrypt a hex payload and execute it in the calling VM.")
{
    auto [hex_payload] = mta::lua::args<std::string>(L);

    std::string payload;
    if (!spike_decrypt(hex_payload, payload))
    {
        mta::lua::push_results(L, false, "payload is not valid hex");
        return 2;
    }

    // Executes in this VM: the very claim the whole DRM architecture
    // depends on. lua_pcall propagates the chunk's own globals -- no
    // sandbox, no second environment.
    if (luaL_loadbuffer(L, payload.data(), payload.size(), "=protected_payload") != 0)
    {
        // Copy BEFORE the pop: lua_tostring points into the stack.
        const std::string error = lua_tostring(L, -1) != nullptr ? lua_tostring(L, -1) : "load failed";
        lua_pop(L, 1);
        mta::lua::push_results(L, false, error);
        return 2;
    }
    if (lua_pcall(L, 0, 0, 0) != 0)
    {
        const std::string error = lua_tostring(L, -1) != nullptr ? lua_tostring(L, -1) : "runtime error";
        lua_pop(L, 1);
        mta::lua::push_results(L, false, error);
        return 2;
    }

    mta::lua::push_results(L, true);
    return 1;
}

// Debug helper: decrypt WITHOUT executing -- proves the payload pipeline
// (hex -> bytes -> decrypt) is faithful for binary payloads.
MTA_LUA_FUNCTION("spike_drm_decrypt",
    "STAGE 0 SPIKE debug: decrypt a hex payload without executing it.")
{
    auto [hex_payload] = mta::lua::args<std::string>(L);

    std::string payload;
    if (!spike_decrypt(hex_payload, payload))
    {
        mta::lua::push_results(L, false, "payload is not valid hex");
        return 2;
    }
    lua_pushlstring(L, payload.data(), payload.size());
    return 1;
}
