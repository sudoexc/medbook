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
# Both modes load with `psql -v ON_ERROR_STOP=1 --single-transaction` and then
# compare row counts of the key tables with the COPY blocks in the dump
# (audit INF-15). Plain psql keeps going after an SQL error and exits 0, so a
# dump missing a table or a constraint used to print «restorable» / «done»
# over a half-loaded database. Now the first error rolls the whole load back
# and the script exits non-zero.
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

# Scratch files (honours TMPDIR, /tmp on the server).
CHECK_ERR="${TMPDIR:-/tmp}/restore-check.err"

# Tables whose row counts must match the dump after loading.
CHECK_TABLES="Patient Appointment VisitNote Document"

# One pass over the dump: does it end with pg_dump's trailer, and how many
# COPY rows does it carry per check table? A stream cut short (pg_dump killed
# under a gzip that still closed cleanly) has no trailer, and psql would load
# its last COPY block as if it were whole. COPY text format escapes newlines,
# so one data line is one row.
DUMP_FACTS="$(gunzip -c "$DUMP" | awk -v tables="$CHECK_TABLES" '
  BEGIN {
    n = split(tables, t, " ")
    for (i = 1; i <= n; i++) { want["public.\"" t[i] "\""] = t[i]; c[t[i]] = 0 }
  }
  inblk { if ($0 == "\\.") inblk = 0; else c[cur]++; next }
  $1 == "COPY" && ($2 in want) { cur = want[$2]; inblk = 1; next }
  /^-- PostgreSQL database dump complete/ { complete = 1 }
  END {
    print "complete", complete + 0
    for (i = 1; i <= n; i++) print t[i], c[t[i]]
  }')"
if ! grep -qx "complete 1" <<< "$DUMP_FACTS"; then
  echo "[restore] FAILED: dump has no pg_dump end marker (truncated?)." >&2
  exit 1
fi
EXPECTED_COUNTS="$(grep -v '^complete ' <<< "$DUMP_FACTS")"

# Load the dump into database $1. ON_ERROR_STOP makes psql exit non-zero on
# the first SQL error; --single-transaction (which needs -f, hence `-f -` for
# stdin) rolls everything back with it, so a failed load leaves no half-state.
load_dump() {
  gunzip -c "$DUMP" | docker compose exec -T postgres \
    psql -q -v ON_ERROR_STOP=1 --single-transaction \
    -U "$POSTGRES_USER" -d "$1" -f -
}

# Compare restored row counts in database $1 with the dump. Prints a table,
# returns non-zero on any mismatch. `</dev/null` keeps docker from eating the
# loop's here-string.
verify_counts() {
  local db="$1" ok=0 table want got
  echo "[restore] row counts (dump → restored):"
  while read -r table want; do
    got="$(docker compose exec -T postgres psql -At -U "$POSTGRES_USER" -d "$db" \
      -c "select count(*) from \"${table}\";" </dev/null 2>/dev/null)" || got="error"
    got="${got//[[:space:]]/}"
    if [[ "$got" == "$want" ]]; then
      printf '          %-12s %8s → %8s\n' "$table" "$want" "$got"
    else
      printf '          %-12s %8s → %8s   MISMATCH\n' "$table" "$want" "$got"
      ok=1
    fi
  done <<< "$EXPECTED_COUNTS"
  return "$ok"
}

# ── Dry run: load into a scratch database and report ───────────────────────
if [[ "$DRY_RUN" == "1" ]]; then
  CHECK_DB="${POSTGRES_DB}_restore_check"
  echo "[restore] DRY RUN → ${CHECK_DB} (production untouched)"
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
    -c "DROP DATABASE IF EXISTS ${CHECK_DB};" >/dev/null
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
    -c "CREATE DATABASE ${CHECK_DB};" >/dev/null
  drop_check_db() {
    docker compose exec -T postgres psql -U "$POSTGRES_USER" -d postgres \
      -c "DROP DATABASE IF EXISTS ${CHECK_DB};" >/dev/null </dev/null || true
  }
  if ! load_dump "$CHECK_DB" >/dev/null 2>"$CHECK_ERR" \
    || grep -q "ERROR" "$CHECK_ERR"; then
    echo "[restore] FAILED to load, this dump is NOT restorable:" >&2
    grep -m 5 "ERROR" "$CHECK_ERR" >&2 || tail -5 "$CHECK_ERR" >&2
    echo "          full log: ${CHECK_ERR}" >&2
    drop_check_db
    exit 1
  fi
  if ! verify_counts "$CHECK_DB"; then
    echo "[restore] FAILED: restored row counts differ from the dump." >&2
    drop_check_db
    exit 1
  fi
  drop_check_db
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
SAFETY="${TMPDIR:-/tmp}/pre-restore-$(date -u +%Y-%m-%dT%H-%M-%SZ).sql.gz"
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
if ! load_dump "$POSTGRES_DB"; then
  echo "[restore] FAILED: the load stopped at the first error above and was" >&2
  echo "          rolled back. ${POSTGRES_DB} is EMPTY now. Fix the cause and" >&2
  echo "          rerun, or put the previous state back from the rollback dump:" >&2
  echo "          gunzip -c ${SAFETY} | docker compose exec -T postgres psql -v ON_ERROR_STOP=1 --single-transaction -U ${POSTGRES_USER} -d ${POSTGRES_DB} -f -" >&2
  exit 1
fi
if ! verify_counts "$POSTGRES_DB"; then
  echo "[restore] FAILED: restored row counts differ from the dump. Do not start" >&2
  echo "          the app on this database. Rollback dump: ${SAFETY}" >&2
  exit 1
fi

echo "[restore] done."
echo "          rollback dump: ${SAFETY}"
echo "          next: docker compose run --rm worker npx prisma migrate deploy"
echo "          then: docker compose up -d --no-deps --force-recreate app worker"
