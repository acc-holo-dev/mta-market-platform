#!/usr/bin/env bash
# Full local test pass: unit + integration + contract. Run from repo root.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
bash "$DIR/unit.sh"
bash "$DIR/integration.sh"
bash "$DIR/contract.sh"
