#!/usr/bin/env bash
# Build the site components (web + server) via turbo. Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/../.."
exec pnpm build "$@"
