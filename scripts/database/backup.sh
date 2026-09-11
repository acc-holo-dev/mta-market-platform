#!/usr/bin/env bash
# MTA Market backup script (PLAN O-003 / PLAN-004 C-004, Q-001). Run from
# anywhere; paths resolve from this file's location. Migrated to the
# monorepo: compose file lives in infrastructure/docker/compose/.
#
# Policy (documents/operations/BACKUP-RESTORE.md):
# - RPO 24h / RTO 4h; retention 30 days (override: BACKUP_RETENTION_DAYS);
# - .env is NEVER stored unencrypted (AES-256 with BACKUP_ENCRYPTION_KEY);
# - every artifact gets a SHA-256 entry in SHA256SUMS.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infrastructure/docker/compose/production.yml}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
MANIFEST="$BACKUP_DIR/SHA256SUMS"
# Top-level `name:` in production.yml pins the project name; volume =
# <project>_uploads_data. Override if you renamed the project.
UPLOADS_VOLUME="${UPLOADS_VOLUME:-mta-market-platform_uploads_data}"

echo "💾 Starting backup (retention: ${RETENTION_DAYS} days)..."
mkdir -p "$BACKUP_DIR"
add_checksum() { ( cd "$BACKUP_DIR" && sha256sum "$(basename "$1")" >> "$MANIFEST" ); }

echo "📦 Backing up database..."
DB_FILE="$BACKUP_DIR/db_backup_$DATE.sql"
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-mtamarket}" "${POSTGRES_DB:-mtamarket}" > "$DB_FILE"
add_checksum "$DB_FILE"

echo "📦 Backing up uploads..."
if docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  UPLOADS_FILE="$BACKUP_DIR/uploads_backup_$DATE.tar.gz"
  docker run --rm \
    -v "$UPLOADS_VOLUME":/src:ro \
    -v "$BACKUP_DIR":/out \
    alpine tar -czf "/out/$(basename "$UPLOADS_FILE")" -C /src .
  add_checksum "$UPLOADS_FILE"
elif [ -d "$ROOT/site/server/uploads" ]; then
  UPLOADS_FILE="$BACKUP_DIR/uploads_backup_$DATE.tar.gz"
  tar -czf "$UPLOADS_FILE" -C "$ROOT/site/server" uploads
  add_checksum "$UPLOADS_FILE"
else
  echo "⚠️  SKIPPED uploads backup: no volume $UPLOADS_VOLUME and no site/server/uploads." >&2
fi

if [ -f "$ROOT/.env" ]; then
  if [ -n "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    ENV_FILE="$BACKUP_DIR/env_backup_$DATE.enc"
    openssl enc -aes-256-cbc -pbkdf2 -salt -in "$ROOT/.env" -out "$ENV_FILE" -pass env:BACKUP_ENCRYPTION_KEY
    add_checksum "$ENV_FILE"
  else
    echo "⚠️  SKIPPED .env backup: BACKUP_ENCRYPTION_KEY is not set (secrets are never stored unencrypted)." >&2
  fi
fi

cat <<HINT

✅ Backup complete. Verify before trusting:
   cd $BACKUP_DIR && sha256sum -c SHA256SUMS
Restore drill (staging clone first — C-005): documents/operations/BACKUP-RESTORE.md
HINT

find "$BACKUP_DIR" -name "*.sql" -type f -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "*.tar.gz" -type f -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name "*.enc" -type f -mtime "+$RETENTION_DAYS" -delete
