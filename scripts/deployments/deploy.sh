#!/usr/bin/env bash
# MTA Market deployment (PLAN-004 K-004/K-006/K-007), migrated to the
# monorepo. Sequence (C-001): backup → migrate → deploy → health gate.
# Usage: scripts/deployments/deploy.sh [environment] [image-tag]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
ENVIRONMENT=${1:-production}
IMAGE_TAG=${2:-latest}
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infrastructure/docker/compose/production.yml}"

echo "🚀 Deploying MTA Market to $ENVIRONMENT (image tag: $IMAGE_TAG)..."
[ -f "$ROOT/.env" ] || { echo "❌ .env not found (copy .env.example and configure it)"; exit 1; }
if [ ! -d "$ROOT/infrastructure/nginx/ssl" ]; then
  echo "⚠️  SSL certificates not found in infrastructure/nginx/ssl/"
  read -p "Continue anyway? (y/N) " -n 1 -r; echo
  [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
fi

PREVIOUS_TAG=$(docker inspect --format '{{index .Config.Labels "org.opencontainers.image.version"}}' mta-market-backend 2>/dev/null || true)
PREVIOUS_TAG=${PREVIOUS_TAG:-unknown}
echo "🔖 Previous backend tag: $PREVIOUS_TAG"

echo "💾 Pre-deploy backup (C-001: no backup, no migration)..."
bash "$ROOT/scripts/database/backup.sh"

echo "🗄️  Migrations (formal path)..."
bash "$ROOT/scripts/database/migrate.sh"

echo "📦 Pulling images (tag: $IMAGE_TAG)..."
IMAGE_TAG="$IMAGE_TAG" docker compose -f "$COMPOSE_FILE" pull
docker compose -f "$COMPOSE_FILE" down
echo "▶️  Starting (health-gated, K-006)..."
IMAGE_TAG="$IMAGE_TAG" docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout 180 || {
  echo "❌ Health gate failed. Rolling back to $PREVIOUS_TAG"
  if [ "$PREVIOUS_TAG" != "unknown" ]; then
    IMAGE_TAG="$PREVIOUS_TAG" docker compose -f "$COMPOSE_FILE" up -d --wait --wait-timeout 120 \
      && echo "↩️  Rollback complete." || echo "🚨 Rollback FAILED — manual intervention required."
  fi
  docker compose -f "$COMPOSE_FILE" logs --tail 100
  exit 1
}

docker image prune -f --filter "until=168h" >/dev/null
echo "✅ Deployment complete. tag=$IMAGE_TAG previous=$PREVIOUS_TAG"
docker compose -f "$COMPOSE_FILE" ps
