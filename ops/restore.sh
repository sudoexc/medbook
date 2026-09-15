#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — restore Postgres from a backup.
# ---------------------------------------------------------------------------
# Reads from the HOST directory `ops/backup.sh` actually writes to
# (`/var/backups/medbook/<date>/`). The previous version fetched from a MinIO
# bucket that backup.sh never wrote to and that `BACKUP_BUCKET` never named —
# so the documented recovery path failed on its first command. Under
# `set -euo pipefail` it died before touching the database, which is the only
# reason this cost an hour rather than the data.
#
# Usage:
#   ./ops/restore.sh                      # restore the newest dump
#   ./ops/restore.sh <path-or-filename>   # restore a specific one
#   DRY_RUN=1 ./ops/restore.sh            # verify a dump into a scratch DB
#
# DRY_RUN loads into `<db>_restore_check` and leaves production untouched —
# use it to prove a backup is restorable BEFORE you need it to be.
#
# WARNING: a real run DROPS the current database. It takes a safety dump first.
#
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

: "${POSTGRES_DB:=medbook}"
: "${POSTGRES_USER:=medbook}"
: "${BACKUP_DIR:=/var/backups/medbook}"
DRY_RUN="${DRY_RUN:-0}"

# ── Locate the dump ────────────────────────────────────────────────────────
if [[ $# -ge 1 ]]; then
  ARG="$1"
  if [[ -f "$ARG" ]]; then
    DUMP="$ARG"
  else
    # Accept a bare filename and find it anywhere under BACKUP_DIR.
    DUMP="$(find "$BACKUP_DIR" -name "$(basename "$ARG")" -type f 2>/dev/null | head -1)"
  fi
else
  DUMP="$(find "$BACKUP_DIR" -name 'pg-*.sql.gz' -type f 2>/dev/null | sort | tail -1)"
fi

if [[ -z "${DUMP:-}" || ! -f "$DUMP" ]]; then
  echo "[restore] no dump found." >&2
  echo "          looked in: ${BACKUP_DIR}" >&2
  echo "          available:" >&2
  find "$BACKUP_DIR" -name 'pg-*.sql.gz' -type f 2>/dev/null | sort | tail -10 >&2 || true
  exit 1
fi

SIZE=$(stat -c %s "$DUMP" 2>/dev/null || stat -f %z "$DUMP")
echo "[restore] dump:  $DUMP"
echo "[restore] size:  $(( SIZE / 1024 / 1024 )) MB"
echo "[restore] taken: $(date -r "$DUMP" -u +%FT%TZ 2>/dev/null || echo '?')"

# A gzip that will not decompress is not a backup — find out now, not after
# the DROP.
if ! gunzip -t "$DUMP" 2>/dev/null; then
  echo "[restore] FAILED: dump is not a valid gzip archive." >&2
  exit 1
fi

# ── Dry run: load into a scratch database and report ───────────────────────
if [[ "$DRY_RUN" == "1" ]]; then
  CHECK_DB="${POSTGRES_DB}_restore_check"
  echo "[restore] DRY RUN → ${CHECK_DB} (production untouched)"
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS ${CHECK_DB};" >/dev/null
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
    -c "CREATE DATABASE ${CHECK_DB};" >/dev/null
  if ! gunzip -c "$DUMP" \
    | docker compose exec -T postgres psql -q -U "$POSTGRES_USER" -d "$CHECK_DB" \
      >/dev/null 2>/tmp/restore-check.err; then
    echo "[restore] FAILED to load. See /tmp/restore-check.err" >&2
    exit 1
  fi
  echo "[restore] loaded. Row counts in the restored copy:"
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$CHECK_DB" -c \
    "select
       (select count(*) from \"Patient\")     as patients,
       (select count(*) from \"Appointment\") as appointments,
       (select count(*) from \"VisitNote\")   as visit_notes,
       (select count(*) from \"Document\")    as documents;"
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE ${CHECK_DB};" >/dev/null
  echo "[restore] dry run OK — this dump is restorable. Scratch DB removed."
  exit 0
fi

# ── Real restore ───────────────────────────────────────────────────────────
read -rp "DROP database ${POSTGRES_DB} and restore from $(basename "$DUMP")? [type YES] " confirm
if [[ "$confirm" != "YES" ]]; then
  echo "aborted."; exit 1
fi

# Safety dump of the CURRENT state — restoring the wrong file must not be
# terminal.
SAFETY="/tmp/pre-restore-$(date -u +%Y-%m-%dT%H-%M-%SZ).sql.gz"
echo "[restore] safety dump of current data → ${SAFETY}"
if ! docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -Fp --no-owner --no-acl "$POSTGRES_DB" \
  | gzip -9 > "$SAFETY"; then
  echo "[restore] could not dump current state — aborting." >&2
  exit 1
fi

echo "[restore] dropping + recreating ${POSTGRES_DB}…"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
  -c "DROP DATABASE IF EXISTS ${POSTGRES_DB};"
docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
  -c "CREATE DATABASE ${POSTGRES_DB};"

echo "[restore] streaming dump back…"
gunzip -c "$DUMP" | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"

echo "[restore] done."
echo "          rollback dump: ${SAFETY}"
echo "          next: docker compose run --rm worker npx prisma migrate deploy"
echo "          then: docker compose up -d --no-deps --force-recreate app worker"
