#!/usr/bin/env bash
# Security checks: secret scan + dependency audit gate. Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/../.."
if command -v gitleaks >/dev/null; then
  gitleaks detect --no-git --redact -v || { echo "gitleaks: findings" >&2; exit 1; }
else
  echo "gitleaks not installed locally — secret scan runs in CI; skipping (audit gate still runs)."
fi
exec bash scripts/maintenance/audit.sh
