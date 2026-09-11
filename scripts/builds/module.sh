#!/usr/bin/env bash
# Configure + build + test the native module (module/). Run from repo root.
# Usage: scripts/builds/module.sh [--no-tests]
set -euo pipefail
cd "$(dirname "$0")/../.."
require() { command -v "$1" >/dev/null || { echo "missing tool: $1 (see documents/module/BUILD.md)" >&2; exit 2; }; }
require cmake; require ninja; require g++
( cd module
cmake --preset linux-gcc
cmake --build --preset linux-gcc
if [ "${1:-}" != "--no-tests" ]; then
  ctest --preset linux-gcc --output-on-failure
fi )
