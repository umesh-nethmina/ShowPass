#!/bin/sh
# NFR-16: daily database backup, kept for 30 days.
# Runs inside a postgres:16-alpine container (see docker-compose.prod.yml).
set -eu

BACKUP_DIR=${BACKUP_DIR:-/backups}
RETENTION_DAYS=${RETENTION_DAYS:-30}
INTERVAL_SECONDS=${INTERVAL_SECONDS:-86400}

mkdir -p "$BACKUP_DIR"

while true; do
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  file="$BACKUP_DIR/showpass-$stamp.dump"
  echo "[backup] starting $file"
  if pg_dump --format=custom --no-owner --file="$file.partial"; then
    mv "$file.partial" "$file"
    echo "[backup] done $(du -h "$file" | cut -f1)"
  else
    echo "[backup] FAILED" >&2
    rm -f "$file.partial"
  fi
  find "$BACKUP_DIR" -name 'showpass-*.dump' -type f -mtime +"$RETENTION_DAYS" -print -delete
  sleep "$INTERVAL_SECONDS"
done
