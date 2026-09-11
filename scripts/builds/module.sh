#!/usr/bin/env bash
# Configure + build + test the native module (module/). Run from repo root.
# Usage: scripts/builds/module.sh [--no-tests]
set -euo pipefail
cd "$(dirname "$0")/../.."
require() { command -v "$1" >/dev/null || { echo "missing tool: $1 (see documents/module/BUILD.md)" >&2; exit 2; }; }
require cmake; require ninja; require g++
cmake --preset linux-gcc -S module
cmake --build --preset linux-gcc -S module
if [ "${1:-}" != "--no-tests" ]; then
  ctest --preset linux-gcc --test-dir module --output-on-failure
fi
