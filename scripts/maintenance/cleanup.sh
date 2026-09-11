#!/usr/bin/env bash
# Remove local build artifacts and caches (keeps logs). Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf site/server/dist site/web/.next module/build build
rm -rf node_modules/.cache .turbo test-results playwright-report
find . -name "*.tsbuildinfo" -not -path "./node_modules/*" -delete 2>/dev/null || true
find . -name "__pycache__" -type d -not -path "./node_modules/*" -prune -exec rm -rf {} + 2>/dev/null || true
echo "cleaned."
