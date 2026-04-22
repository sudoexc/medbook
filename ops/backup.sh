#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — nightly Postgres backup to MinIO.
# ---------------------------------------------------------------------------
# Runs inside the deploy host. Streams pg_dump → gzip → mc cp to the
# `BACKUP_BUCKET` bucket, then prunes objects older than BACKUP_RETENTION_DAYS.
#
# Expected cron entry (see ops/crontab.example):
#   0 3 * * * cd /opt/medbook && ./ops/backup.sh >> /var/log/medbook-backup.log 2>&1
#
# Requirements:
#   - docker compose running (postgres + minio reachable)
#   - mc (MinIO client) alias `backup` pre-configured via `mc alias set`
#     OR env vars MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY
#
set -euo pipefail

# Load env if present (so cron has MINIO_*, POSTGRES_*, etc.).
if [[ -f .env ]]; then
  # shellcheck disable=SC2046,SC1091
  set -a; . ./.env; set +a
fi

: "${POSTGRES_DB:=medbook}"
: "${POSTGRES_USER:=medbook}"
: "${MINIO_ENDPOINT:=http://minio:9000}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY required}"
: "${BACKUP_BUCKET:=medbook-backups}"
: "${BACKUP_RETENTION_DAYS:=30}"

TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
DUMPFILE="pg-${POSTGRES_DB}-${TS}.sql.gz"
TMPPATH="/tmp/${DUMPFILE}"

log() { echo "[backup] $(date -u +%FT%TZ) $*"; }

log "dumping ${POSTGRES_DB} → ${TMPPATH}"
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -Fp --no-owner --no-acl "$POSTGRES_DB" \
  | gzip -9 > "$TMPPATH"

SIZE=$(stat -c %s "$TMPPATH" 2>/dev/null || stat -f %z "$TMPPATH")
log "dump OK (${SIZE} bytes)"

# Configure mc alias idempotently. Uses the minio service inside docker.
docker run --rm --network medbook_default \
  -e MC_HOST_backup="http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000" \
  -v "$TMPPATH:/tmp/${DUMPFILE}:ro" \
  minio/mc:latest sh -c "
    mc --json mb -p backup/${BACKUP_BUCKET} >/dev/null || true
    mc cp /tmp/${DUMPFILE} backup/${BACKUP_BUCKET}/backups/${DUMPFILE}
    mc ilm rule list backup/${BACKUP_BUCKET} >/dev/null 2>&1 || true
    # Prune objects older than BACKUP_RETENTION_DAYS.
    mc find backup/${BACKUP_BUCKET}/backups --older-than ${BACKUP_RETENTION_DAYS}d --exec 'mc rm {}'
  "

rm -f "$TMPPATH"
log "uploaded → backup/${BACKUP_BUCKET}/backups/${DUMPFILE}; pruned >${BACKUP_RETENTION_DAYS}d"
