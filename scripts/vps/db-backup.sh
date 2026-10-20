#!/usr/bin/env bash
# Nightly PostgreSQL backup: pg_dump -> gzip -> /var/backups/<project>/ with
# rotation, plus an optional off-server copy to S3-compatible storage (the
# uploader activates itself only when SPACES_* is configured in backend/.env).
# Runs from the repo checkout on the server; self-locates the project dir.
set -euo pipefail
export PATH="/root/.bun/bin:$PATH"

APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PROJECT="$(basename "$APP_DIR")"
DB_NAME="seriya" # adjust if the database was renamed at bootstrap
DB_USER="superuser"
RETENTION_DAYS=30
BACKUP_DIR="/var/backups/$PROJECT"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET="$BACKUP_DIR/$DB_NAME-$STAMP.sql.gz"
TMP="$TARGET.partial"
trap 'rm -f "$TMP"' EXIT

CONTAINER="$(cd "$APP_DIR" && docker compose ps -q postgres)"
if [ -z "$CONTAINER" ]; then
  echo "ERROR: postgres container is not running" >&2
  exit 1
fi

docker exec "$CONTAINER" pg_dump -U "$DB_USER" "$DB_NAME" | gzip >"$TMP"

# An interrupted dump can still be a valid gzip stream; require pg_dump's own
# completion marker before promoting the file.
if ! gunzip -c "$TMP" | tail -n 20 | grep -q "PostgreSQL database dump complete"; then
  echo "ERROR: dump completion marker missing, refusing to keep the file" >&2
  exit 1
fi
gzip -t "$TMP"
mv "$TMP" "$TARGET"
trap - EXIT
echo "Backup written: $TARGET ($(du -h "$TARGET" | cut -f1))"

find "$BACKUP_DIR" -name "*.sql.gz" -mtime +"$RETENTION_DAYS" -delete

# Off-server copy. cwd=backend so Bun auto-loads backend/.env with SPACES_*.
(cd "$APP_DIR/backend" && bun ../scripts/vps/db-backup-upload.ts "$TARGET") ||
  echo "WARN: cloud upload failed; the local backup is intact" >&2
