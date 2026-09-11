#!/usr/bin/env bash
# Roll the production stack back to a known image tag (K-005).
# Usage: scripts/deployments/rollback.sh <image-tag>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TAG="${1:?usage: rollback.sh <image-tag>}"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infrastructure/docker/compose/production.yml}"
echo "↩️  Rolling back to $TAG..."
IMAGE_TAG="$TAG" docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout 120
docker compose -f "$COMPOSE_FILE" ps
