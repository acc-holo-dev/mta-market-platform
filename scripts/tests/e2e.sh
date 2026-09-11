#!/usr/bin/env bash
# Browser E2E (Playwright). Requires dev servers running: python3 startup.py dev
# Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/../.."
pnpm test:e2e:admin
exec pnpm test:e2e
