// spike_luac — regenerate the `protected.luac` fixture for the DRM spike
// test (tests/module/runtime/scripts/096_drm_spike.lua).
//
// The old mta-market-module repository referenced an offline "spike_luac"
// tool that was never committed; the fixture lived only in a local build/
// directory, so `sdk_tests` failed with "missing build/protected.luac
// fixture" on any fresh checkout (pre-existing gap, fixed during PLAN-010).
//
// The tool writes a minimal Lua 5.1 binary chunk of the single statement
//
//     spike_bytecode_marker = "bytecode ran"
//
// encoded for the MTA-patched Lua runtime (module/third_party/lua):
//   - little-endian, 4-byte int, 4-byte Instruction, 8-byte lua_Number;
//   - the header claims sizeof(size_t) == 4: lundump.c LoadHeader() forces
//     the host header's size_t byte down to SIZE_T_PRECOMPILED_CHUNK (4)
//     before comparing, and LoadString() reads string sizes as 4-byte
//     values on hosts where sizeof(size_t) > 4 (x86-64);
//   - string constants are stored NUL-terminated, size includes the NUL.
//
// It is intentionally self-contained (no Lua linkage) so the fixture can be
// regenerated on any platform the module builds for.

#include <array>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace
{

void put_u8(std::vector<unsigned char> &out, unsigned char v) { out.push_back(v); }

void put_u32(std::vector<unsigned char> &out, std::uint32_t v)
{
    for (int i = 0; i < 4; ++i) out.push_back(static_cast<unsigned char>((v >> (8 * i)) & 0xFF));
}

void put_i32(std::vector<unsigned char> &out, std::int32_t v)
{
    put_u32(out, static_cast<std::uint32_t>(v));
}

// Lua 5.1 LoadString(): 4-byte size (including trailing NUL) + bytes + NUL.
void put_string(std::vector<unsigned char> &out, const std::string &s)
{
    put_u32(out, static_cast<std::uint32_t>(s.size() + 1));
    for (const char raw : s) out.push_back(static_cast<unsigned char>(raw));
    out.push_back(0);
}

// iABx: opcode bits 0-5, A bits 6-13, Bx bits 14-30.
std::uint32_t instr_abx(std::uint32_t opcode, std::uint32_t a, std::uint32_t bx)
{
    return opcode | (a << 6) | (bx << 14);
}

// iAB: opcode bits 0-5, A bits 6-13, C bits 14-22, B bits 23-31.
std::uint32_t instr_ab(std::uint32_t opcode, std::uint32_t a, std::uint32_t b, std::uint32_t c)
{
    return opcode | (a << 6) | (c << 14) | (b << 23);
}

} // namespace

int main(int argc, char **argv)
{
    if (argc != 2)
    {
        std::cerr << "usage: spike_luac <output.luac>\n";
        return 2;
    }

    // The marker chunk the 096 spike test expects to run.
    const std::string k_string = "bytecode ran";
    const std::string k_global = "spike_bytecode_marker";

    std::vector<unsigned char> out;

    // --- 12-byte header (matches luaU_header with size_t forced to 4) ------
    for (unsigned char c : std::array<unsigned char, 4>{0x1B, 'L', 'u', 'a'}) put_u8(out, c);
    put_u8(out, 0x51); // LUAC_VERSION
    put_u8(out, 0x00); // LUAC_FORMAT
    put_u8(out, 0x01); // little-endian
    put_u8(out, 0x04); // sizeof(int)
    put_u8(out, 0x04); // sizeof(size_t) — SIZE_T_PRECOMPILED_CHUNK
    put_u8(out, 0x04); // sizeof(Instruction)
    put_u8(out, 0x08); // sizeof(lua_Number)
    put_u8(out, 0x00); // lua_Number is not integral

    // --- top-level prototype ------------------------------------------------
    put_string(out, "@fixture"); // chunk name (source)
    put_i32(out, 0);             // linedefined
    put_i32(out, 0);             // lastlinedefined
    put_u8(out, 0);              // nups
    put_u8(out, 0);              // numparams
    put_u8(out, 2);              // is_vararg (main chunk)
    put_u8(out, 2);              // maxstacksize

    // Code: LOADK R0 K0; SETGLOBAL R0 K1; RETURN R0 (B=1).
    put_i32(out, 3);
    put_u32(out, instr_abx(1, 0, 0));  // OP_LOADK
    put_u32(out, instr_abx(7, 0, 1));  // OP_SETGLOBAL
    put_u32(out, instr_ab(30, 0, 1, 0)); // OP_RETURN

    // Constants: k[0] = "bytecode ran" (string, LUA_TSTRING = 4),
    //            k[1] = "spike_bytecode_marker".
    put_i32(out, 2);
    put_u8(out, 4);
    put_string(out, k_string);
    put_u8(out, 4);
    put_string(out, k_global);

    // Nested prototypes: none (the chunk is a flat top-level assignment).
    put_i32(out, 0);

    // Debug info: lineinfo (one int per instruction), locvars, upvalues.
    put_i32(out, 3);
    put_i32(out, 1);
    put_i32(out, 1);
    put_i32(out, 1);
    put_i32(out, 0); // locvars
    put_i32(out, 0); // upvalues

    std::ofstream fh(argv[1], std::ios::binary);
    if (!fh)
    {
        std::cerr << "spike_luac: cannot open " << argv[1] << " for writing\n";
        return 1;
    }
    fh.write(reinterpret_cast<const char *>(out.data()), static_cast<std::streamsize>(out.size()));
    fh.close();
    if (!fh)
    {
        std::cerr << "spike_luac: failed to write " << argv[1] << "\n";
        return 1;
    }
    std::cout << "spike_luac: wrote " << argv[1] << " (" << out.size() << " bytes)\n";
    return 0;
}
