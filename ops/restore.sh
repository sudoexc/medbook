#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — restore Postgres from a MinIO backup.
# ---------------------------------------------------------------------------
# Usage:
#   ./ops/restore.sh pg-medbook-2026-04-22T03-00-00Z.sql.gz
#
# The argument is the filename inside `${BACKUP_BUCKET}/backups/`.
#
# WARNING: this DROPS existing data. Take a fresh dump first if you want a
# rollback path.
#
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <dump-filename>" >&2
  exit 2
fi
DUMPFILE="$1"

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

: "${POSTGRES_DB:=medbook}"
: "${POSTGRES_USER:=medbook}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY required}"
: "${BACKUP_BUCKET:=medbook-backups}"

TMPPATH="/tmp/${DUMPFILE}"

echo "[restore] fetching ${DUMPFILE} from MinIO…"
docker run --rm --network medbook_default \
  -e MC_HOST_backup="http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000" \
  -v "/tmp:/tmp:rw" \
  minio/mc:latest sh -c "mc cp backup/${BACKUP_BUCKET}/backups/${DUMPFILE} /tmp/${DUMPFILE}"

read -rp "DROP database ${POSTGRES_DB} and restore from ${DUMPFILE}? [type YES] " confirm
if [[ "$confirm" != "YES" ]]; then
  echo "aborted."; exit 1
fi

echo "[restore] dropping + recreating schema…"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE ${POSTGRES_DB};"

echo "[restore] streaming dump back…"
gunzip -c "$TMPPATH" | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

rm -f "$TMPPATH"
echo "[restore] done. Run: docker compose exec app npx prisma migrate deploy"
