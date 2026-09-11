-- STAGE 0 SPIKE: DRM feasibility (see source/functions/drm/spike.cpp).
--
--   encrypted payload -> native module -> decrypt -> load -> pcall
--   -> the chunk runs INSIDE THIS VM (globals are shared).
--
-- "Encryption" here is the byte complement (255 - b), an involution, so
-- the Lua side can produce encrypted payloads with plain 5.1 arithmetic:
-- encrypted_byte = 255 - plain_byte, as two lowercase hex digits.

local function encrypt(source)
    local bytes = {}
    for i = 1, #source do
        bytes[#bytes + 1] = string.format("%02x", 255 - string.byte(source, i))
    end
    return table.concat(bytes)
end

-- 1. Plain Lua SOURCE payload executes in the calling VM.
local ok, err = spike_drm_load(encrypt('spike_source_marker = "source ran"'))
test_assert(ok, "source payload should load: " .. tostring(err))
test_assert(spike_source_marker == "source ran", "source chunk ran in the caller VM")

-- 2. Lua BYTECODE payload (what the real build pipeline ships).
--    Compiled offline by the spike_luac tool from the same vendored Lua;
--    the runtime itself cannot dump bytecode (WITH_STRING_DUMP is off in
--    the module build -- an anti-decompile property worth keeping).
local bytecode_path = nil
for _, candidate in ipairs({ "build/protected.luac", "../build/protected.luac" }) do
    local probe = io.open(candidate, "rb")
    if probe then
        bytecode_path = candidate
        probe:close()
    end
end
if bytecode_path then
    local fh = assert(io.open(bytecode_path, "rb"))
    local bytecode = fh:read("*a")
    fh:close()

    ok, err = spike_drm_load(encrypt(bytecode))
    test_assert(ok, "bytecode payload should load: " .. tostring(err))
    test_assert(spike_bytecode_marker == "bytecode ran", "bytecode chunk ran in the caller VM")
else
    -- Bytecode fixture not built; source loading above still proves the
    -- mechanism. Fail loudly so CI notices the missing fixture.
    test_assert(false, "missing build/protected.luac fixture (run spike_luac)")
end

-- 3. The chunk sees and mutates this VM's globals (no sandbox).
ok = spike_drm_load(encrypt('spike_shared = (spike_shared or 0) + 1'))
ok = spike_drm_load(encrypt('spike_shared = (spike_shared or 0) + 1'))
test_assert(ok, "second source execution should succeed")
test_assert(spike_shared == 2, "loaded chunks share the caller VM globals, got " .. tostring(spike_shared))

-- 4. Corrupted/tampered payload fails loudly instead of executing.
ok, err = spike_drm_load("not-valid-hex!")
test_assert(not ok, "invalid hex must fail")

ok, err = spike_drm_load(encrypt('syntax error here ---'))
test_assert(not ok, "syntactically invalid payload must fail")
test_assert(type(err) == "string" and #err > 0, "load failure reports a message")

-- 5. Runtime errors inside the protected chunk surface as (false, msg).
ok, err = spike_drm_load(encrypt('error("boom inside protected")'))
test_assert(not ok, "runtime error inside the chunk must fail")
test_assert(err and err:find("boom inside protected", 1, true), "error message propagates")
