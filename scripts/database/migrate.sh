#!/usr/bin/env bash
# Formal migration path (production/staging): applies committed migration
# packages via `prisma db migrate`. The quick path `db update` is DEV-ONLY
# (documents/operations/DATABASE-MIGRATIONS.md).
# Usage: scripts/database/migrate.sh [--local]   (local: run on host against .env)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
if [ "${1:-}" = "--local" ]; then
  cd site/server
  exec npx prisma db migrate
fi
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infrastructure/docker/compose/production.yml}"
docker compose -f "$COMPOSE_FILE" run --rm --no-deps \
  -e DATABASE_URL="postgresql://${POSTGRES_USER:-mtamarket}:${POSTGRES_PASSWORD}@postgres:5432/mtamarket" \
  backend node -e "
const { execSync } = require('child_process');
process.env.NODE_ENV = 'production';
execSync('npx prisma db migrate', { stdio: 'inherit', env: process.env });
"
