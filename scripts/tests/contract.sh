#!/usr/bin/env bash
# Contract tests: validate contracts/ files + DRM/module schema conformance.
# Run from repo root. (Schemas are exercised by tests/integration/api/drm-*
# and the module ctest vectors; this gate validates the YAML/JSON syntax.)
set -euo pipefail
cd "$(dirname "$0")/../.."
exec bash scripts/maintenance/verify-contracts.sh
