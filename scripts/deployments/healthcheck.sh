#!/usr/bin/env bash
# Quick health probe of a running stack (defaults: local dev).
# Usage: scripts/deployments/healthcheck.sh [base-url]
set -euo pipefail
BASE="${1:-http://localhost:3001}"
for path in /health /live /ready; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE$path" || true)
  echo "$path -> $code"
done
