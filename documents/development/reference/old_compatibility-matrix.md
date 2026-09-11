status: current
version: 1.1
last_verified: 2026-09-10


> **Пути (PLAN-011):** этот документ описывает прежнюю трёхрепозиторную
> структуру (frozen). Соответствие старых путей путям монорепо —
> [../../history/MIGRATION.md](../../history/MIGRATION.md); замороженные
> значения не менялись.

# Compatibility matrix

Only verified rows. A new row is added **after** the listed combination has
been verified (test evidence cited in the row), never in advance. When a
frozen contract changes, a new row starts a new line — history is not
rewritten.

## Current

| Site version | REST API | DRM protocol | Module version | Verified | Evidence |
|---|---|---|---|---|---|
| 0.1.x | REST v1 paths (`/auth`, `/resources`, `/purchases`, `/payments`, `/services`, `/seller`, `/disputes`, `/admin`) + `/drm` (v1 license management, 410 on activation) + `/drm/v2` | DRM protocol **2** (`apps/server/src/lib/drm/protocol.ts`: `DRM_PROTOCOL_VERSION = 2`, supported `[2]`) | Module 0.1.x client subsystem (SDK/config `base` 2.1.0, repo `mta-market-module`) — client subsystem built at Block 6 (H-001..H-006) | 2026-09-10 | Server: 254/254 tests, 24 files (`vitest run`) + browser E2E 12/12 (Playwright); module: DRM unit tests → ALL TESTS PASSED (Linux x64, unit level) |

## Component versions inside the current row

| Component | Version / value | Source |
|---|---|---|
| Site (monorepo) | 0.1.0 | `mta-market-site/package.json` |
| apps/server | 0.1.0 | `apps/server/package.json` |
| apps/web | 0.1.x (Next.js 15.1.3, React 19) | `apps/web/package.json` |
| Database schema | contract.prisma, 43 models, UUID ids | `apps/server/src/prisma/contract.prisma` |
| DRM protocol | 2 (lease TTL 7 d, skew 90 s, nonce 32 B hex, challenge 32 B base64, AES-256-GCM DEK envelope) | `apps/server/src/lib/drm/protocol.ts` |
| Artifact manifest | `formatVersion: 1` | `apps/server/src/lib/artifact/types.ts` |
| Module (SDK identity) | `base` 2.1.0 | `mta-market-module/config/module.toml` |
| Module DRM client subsystem | pre-1.0 (H-001..H-006 complete; E2E vs live server not yet run) | `mta-market-module/docs/H-001-inventory.md` |

## Verification status honesty

- The current row is verified by **unit + integration tests on both sides**.
- A documented **end-to-end run of the module against a live site deployment
  does not exist yet**; the first such run is a prerequisite for any future
  row that claims E2E.
- Windows execution of the module DRM client is built in CI
  (`windows-mingw`, `windows-msvc` jobs) but the DRM unit tests have not been
  executed on Windows; the DPAPI key-store path is exercised only by CI build,
  not by tests.

## Rules for future rows

1. A row appears only after verification (test names + date in Evidence).
2. Protocol changes: bump to DRM protocol 3, update
   [drm-protocol-v2.md](old_drm-protocol-v2.md) (this folder) first, then ship
   server and module releases that both appear in the new row.
3. One PREVIOUS server signing key stays trusted across rotations so a site
   upgrade does not invalidate existing leases (G-007).
4. `/drm/v1` remains 410-Gone for activation; there is no dual-activation
   window (A-007).
