#!/usr/bin/env sh
set -eu

BACKUP_DIR="${BACKUP_DIR:-$HOME/kindergarten-english-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/kindergarten_english-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
docker compose exec -T postgres pg_dump -U postgres kindergarten_english | gzip > "$FILE"
echo "backup written: $FILE"

if [ -n "${BACKUP_BUCKET:-}" ]; then
  gsutil cp "$FILE" "$BACKUP_BUCKET/"
fi
