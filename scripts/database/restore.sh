#!/usr/bin/env bash
# Restore a database dump produced by scripts/database/backup.sh.
# Usage: scripts/database/restore.sh <dump.sql> [--drop]
# Run the staging-clone drill first (documents/operations/BACKUP-RESTORE.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infrastructure/docker/compose/production.yml}"
DUMP="${1:?usage: restore.sh <dump.sql> [--drop]}"
shift || true
[ -f "$DUMP" ] || { echo "dump not found: $DUMP" >&2; exit 1; }
FLAGS=""
for a in "$@"; do [ "$a" = "--drop" ] && FLAGS="$FLAGS -c -f"; done
echo "⏳ Restoring $(basename "$DUMP") into ${POSTGRES_DB:-mtamarket}..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_restore -U "${POSTGRES_USER:-mtamarket}" -d "${POSTGRES_DB:-mtamarket}" $FLAGS \
  --no-owner --role="${POSTGRES_USER:-mtamarket}" < "$DUMP" 2>/dev/null \
  || docker compose -f "$COMPOSE_FILE" exec -T postgres \
     psql -U "${POSTGRES_USER:-mtamarket}" -d "${POSTGRES_DB:-mtamarket}" < "$DUMP"
echo "✅ Restore finished. Verify counts, then run the acceptance checklist."
