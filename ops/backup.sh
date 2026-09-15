#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — nightly backup: Postgres + clinic files.
# ---------------------------------------------------------------------------
# Writes to a HOST directory (BACKUP_DIR, default /var/backups/medbook), not
# into MinIO. The previous version pushed the dump into the same MinIO it was
# meant to protect — circular, and a dead disk took both copies with it. A host
# directory is trivial to pull off-box (rsync/scp) and survives any container
# or MinIO failure.
#
# Two artefacts per run, in a dated folder:
#   pg-<db>-<ts>.sql.gz    — full logical dump (restore: ops/restore.sh)
#   files-<ts>.tar.gz      — clinic file objects from the MinIO bucket
#                            (documents, chat attachments, handouts)
#
# ⚠️ This is still SAME-BOX storage. It protects against DB corruption, a bad
# migration, an accidental wipe or a botched deploy — NOT against losing the
# server. Copy the folder off-box regularly (see docs/operations/RUNBOOK.md).
#
# Cron (installed on the Hetzner host):
#   0 3 * * * cd /opt/neurofax && ./ops/backup.sh >> /var/log/medbook-backup.log 2>&1
#
set -euo pipefail

if [[ -f .env ]]; then
  # shellcheck disable=SC2046,SC1091
  set -a; . ./.env; set +a
fi

: "${POSTGRES_DB:=medbook}"
: "${POSTGRES_USER:=medbook}"
: "${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY required}"
: "${MINIO_SECRET_KEY:?MINIO_SECRET_KEY required}"
: "${MINIO_BUCKET:=medbook}"
: "${BACKUP_DIR:=/var/backups/medbook}"
: "${BACKUP_RETENTION_DAYS:=14}"
# Compose project network — the mc container needs to reach the minio service.
: "${DOCKER_NETWORK:=medbook_default}"

TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
DAY=$(date -u +%F)
DEST="${BACKUP_DIR}/${DAY}"
mkdir -p "$DEST"

log() { echo "[backup] $(date -u +%FT%TZ) $*"; }
fail() { log "FAILED: $*"; exit 1; }

# ── 1. Postgres ────────────────────────────────────────────────────────────
DUMP="${DEST}/pg-${POSTGRES_DB}-${TS}.sql.gz"
log "dumping ${POSTGRES_DB}"
# `set -o pipefail` turns a failed pg_dump into a hard error instead of a
# valid-looking gzip wrapped around a truncated stream.
docker compose exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -Fp --no-owner --no-acl "$POSTGRES_DB" \
  | gzip -9 > "$DUMP" || fail "pg_dump"

DUMP_SIZE=$(stat -c %s "$DUMP" 2>/dev/null || stat -f %z "$DUMP")
# A tiny dump means pg_dump emitted an error page or hit an empty database —
# keeping it would quietly rotate good backups out during retention.
[[ "$DUMP_SIZE" -gt 10240 ]] || fail "dump suspiciously small (${DUMP_SIZE} bytes)"
log "postgres OK ($(numfmt --to=iec "$DUMP_SIZE" 2>/dev/null || echo "${DUMP_SIZE}B"))"

# ── 2. Clinic files from MinIO ─────────────────────────────────────────────
# Mirrored at object level rather than by tarring MinIO's volume, so the
# archive stays restorable even if MinIO's on-disk layout changes on upgrade.
FILES="${DEST}/files-${TS}.tar.gz"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

log "mirroring MinIO bucket '${MINIO_BUCKET}'"
# `--entrypoint sh` is required: the image's entrypoint is `mc` itself, so a
# bare `sh -c …` argument list gets parsed as an mc subcommand and fails with
# "`sh` is not a recognized command".
docker run --rm --network "$DOCKER_NETWORK" \
  -e MC_HOST_src="http://${MINIO_ACCESS_KEY}:${MINIO_SECRET_KEY}@minio:9000" \
  -v "${STAGE}:/stage" \
  --entrypoint sh minio/mc:latest \
  -c "mc mirror --overwrite src/${MINIO_BUCKET} /stage" \
  >/dev/null || fail "mc mirror"   # per-object lines would swamp the cron log

tar -czf "$FILES" -C "$STAGE" . || fail "tar clinic files"
FILES_SIZE=$(stat -c %s "$FILES" 2>/dev/null || stat -f %z "$FILES")
log "files OK ($(numfmt --to=iec "$FILES_SIZE" 2>/dev/null || echo "${FILES_SIZE}B"))"

# ── 3. Off-box copy ────────────────────────────────────────────────────────
# Everything above still lives on the same disk as production: a dead disk or
# a locked instance takes the database, the clinic's files AND every retained
# backup at once. That is ~100 patients and hundreds of signed conclusions,
# which are legally irreplaceable.
#
# Set BACKUP_REMOTE to an rsync target to close that hole, e.g.
#   BACKUP_REMOTE=u12345@u12345.your-storagebox.de:medbook   (Hetzner Storage Box)
#   BACKUP_REMOTE=backup@1.2.3.4:/srv/medbook-backups        (any second host)
# Key-based auth only — cron has nobody to type a password.
#
# A failure here is loud but NOT fatal: a broken remote must not make a good
# local backup look failed, nor stop retention from running.
if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  log "copying off-box → ${BACKUP_REMOTE}"
  if rsync -az --timeout=300 \
      -e "ssh -o StrictHostKeyChecking=accept-new -o BatchMode=yes" \
      "$DEST" "${BACKUP_REMOTE}/" 2>/tmp/backup-offbox.err; then
    log "off-box OK"
  else
    log "OFF-BOX FAILED — local copy is fine, remote is NOT. See /tmp/backup-offbox.err"
    # Surface it the way the watchdog surfaces outages, when configured.
    if [[ -n "${ALERT_TG_TOKEN:-}" && -n "${ALERT_TG_CHAT_ID:-}" ]]; then
      curl -fsS --max-time 15 \
        "https://api.telegram.org/bot${ALERT_TG_TOKEN}/sendMessage" \
        -d "chat_id=${ALERT_TG_CHAT_ID}" \
        -d "text=⚠️ MedBook: off-box backup FAILED on $(hostname). Local copy present, remote NOT." \
        >/dev/null 2>&1 || true
    fi
  fi
else
  log "BACKUP_REMOTE unset — backups exist only on this disk"
fi

# ── 4. Retention ───────────────────────────────────────────────────────────
# Pruned only after the artefacts of THIS run landed — a failing run must not
# delete history while adding nothing.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+${BACKUP_RETENTION_DAYS}" \
  -exec rm -rf {} + 2>/dev/null || true

TOTAL=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
KEPT=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
log "done → ${DEST} (kept ${KEPT} days, ${TOTAL} total)"
