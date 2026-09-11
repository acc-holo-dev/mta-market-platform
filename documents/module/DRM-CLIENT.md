# H-001: Full module inventory (PLAN Block 6)

Date: 2026-09-09
Conclusion: **before this change the DRM area was a Stage-0 spike**; the rest
of the repo is a mature Lua-binding SDK that the DRM client now builds on.

## Verified inventory (every source/include/build file inspected)

- `source/sdk/**` — production-grade module SDK: Lua argument binding
  (`sdk/lua`), events, runtime (timers, scheduler, callbacks), native
  resource/module wrappers, registry, logging, errors, ABI export.
- `source/library/base` — handle map utility.
- `source/functions/**` — Lua-exposed functions grouped by domain (basics,
  async, tables, bench, info, native, raw, state, events, objects) plus the
  DRM spike.
- `source/functions/drm/spike.cpp` — **Stage-0 DRM spike** (kept): a
  hex-complement demo cipher decrypting a payload and executing it in the
  calling resource VM. It answers the feasibility question only: no HTTP
  client, no key storage, no license lifecycle, no real crypto.
- `other/third_party/lua` — vendored Lua 5.x (not modified).
- `other/third_party/mta-sdk` — MTA server SDK headers.
- `config/cmake/**` — build configuration (Linux, MSVC, MinGW platform
  files; module config parsing with its own CMake unit tests).
- `other/tests/**` — Lua harness scripts (010..096 incl. `096_drm_spike.lua`),
  CMake config tests, an MTA server fixture (`other/server`).
- `other/tools` — docgen, mta CLI scripts.
- `other/documents` — module authoring docs.

## What this change adds (Block 6 work)

- `source/drm/json.{hpp,cpp}` — JSON parser + canonical serializer that
  byte-matches the server's canonical form (sorted keys, signature stripped,
  JSON.stringify-compatible escaping, verbatim number tokens).
- `source/drm/base64.{hpp,cpp}` — strict RFC 4648 base64 (pre-existing from
  the interrupted first pass, retained).
- `source/drm/ed25519.{hpp,cpp}` — Ed25519 keypair generation, raw-key
  import/export, sign/verify, SPKI DER public key import (server format).
- `source/drm/aead.{hpp,cpp}` — AES-256-GCM authenticated encryption.
- `source/drm/http_client.{hpp,cpp}` — the minimal authenticated HTTPS
  client (H-002): TLS 1.2+ with certificate validation against the system
  trust store (self-signed override is an explicit dev opt-in), connect/IO
  timeouts, bounded retries (max 3, linear backoff, transport failures only),
  1 MiB response cap, HTTP status validation, secure headers, abort flag,
  chunked-response folding.
- `source/drm/key_store.{hpp,cpp}` — H-003 secure local storage: the
  installation private key is stored encrypted (AES-256-GCM) under a
  machine-derived key with 0600 files; Windows DPAPI variant behind `_WIN32`;
  documented threat model in the header.
- `source/drm/license_client.{hpp,cpp}` — H-004/H-005: the license subsystem
  lifecycle (ensure identity -> register (browser-assisted bearer token) ->
  verify challenge -> activate -> verify lease signature via serverKeyId ->
  heartbeat -> renew with fresh nonce -> fetch version DEK with possession
  proof -> decrypt protected payload in memory).
- `tests_drm/main.cpp` + `source/drm/Makefile` — self-contained unit tests
  (no network): all DRM primitives verified locally; run `make -f
  source/drm/Makefile test`.

## H-006 cross-platform matrix

- Linux x64: built and tested in this environment (g++/OpenSSL; see the
  Makefile target). `ALL TESTS PASSED`.
- Windows x64: build files exist (MSVC + MinGW platform cmake configs, and
  the DPAPI key-store path); compilation and the Lua harness must run in
  Windows CI (`other/tests`, GitHub workflow) — not executable from this
  Linux environment.
- MTA server versions: the runtime contract is exercised through the vendored
  MTA SDK headers; exact MTA:SA server compatibility is verified by loading
  the built module into an MTA server (out of scope for this environment).

## Protocol compatibility

The client implements the frozen DRM Protocol v2 contract served by
`site/server/src/lib/drm/protocol.ts`: endpoints, formats
(64-hex nonce, base64 challenge), canonical lease signing (canonical JSON
with the signature member stripped), Ed25519 signatures, AES-256-GCM DEK
envelope, and the error envelope. Cross-repo compatibility is anchored by the
shared test vectors in `tests_drm/main.cpp` (O-006 groundwork).
