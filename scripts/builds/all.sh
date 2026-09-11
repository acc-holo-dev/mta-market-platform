#!/usr/bin/env bash
# Build everything: site (web+server) and the module. Run from repo root.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
bash "$DIR/builds/site.sh"
bash "$DIR/builds/module.sh"
