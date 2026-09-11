#!/usr/bin/env bash
# Integration tests (need the test postgres on :5433 and redis on :6379).
# Start infra: docker compose -f infrastructure/docker/compose/tests.yml up -d
set -euo pipefail
cd "$(dirname "$0")/../.."
docker compose -f infrastructure/docker/compose/tests.yml up -d --wait
cd site/server
npx prisma contract emit
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5433/postgres?schema=public" \
  npx prisma db update --confirm postgres
cd ../..
exec pnpm exec vitest run tests/integration
