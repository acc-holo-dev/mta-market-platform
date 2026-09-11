#!/usr/bin/env bash
# Unit tests only (no DB required). Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec pnpm exec vitest run tests/unit
