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
# Artefacts per run, in a dated folder:
#   pg-<db>-<ts>.sql.gz    — full logical dump (restore: ops/restore.sh)
#   files-<ts>.tar.gz      — clinic file objects from the MinIO bucket
#                            (documents, chat attachments, handouts)
#   restore-kit-<ts>.tar.gz.gpg
#                          — what a restore needs besides the dump, ENCRYPTED
#                            (audit INF-08): .env with FIELD_ENCRYPTION_KEY and
#                            APP_SECRET, the production docker-compose.yml,
#                            nginx.conf + conf.d (neighbours' vhosts) and
#                            _deploy.sh. Written only when BACKUP_GPG_RECIPIENT
#                            or BACKUP_PASSPHRASE is set; otherwise skipped with
#                            a loud log line. Never stored in plain text.
#
# ⚠️ This is still SAME-BOX storage. It protects against DB corruption, a bad
# migration, an accidental wipe or a botched deploy — NOT against losing the
# server. Copy the folder off-box regularly (see docs/operations/RUNBOOK.md).
#
# Cron (installed on the Hetzner host):
#   0 3 * * * cd /opt/neurofax && ./ops/backup.sh >> /var/log/medbook-backup.log 2>&1
#
set -euo pipefail

# The dump holds every patient's record and the kit holds the keys: nothing
# this script writes is for other local users.
umask 077

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

# ── 3. Restore kit: keys + server config, encrypted ────────────────────────
# Audit INF-08: a dump alone does not restore the clinic. Patient.passport /
# notes, MedicalCase.soapDraft, Prescription.notes and the TOTP secrets are
# encrypted with FIELD_ENCRYPTION_KEY(_V<n>), clinic bot tokens with
# APP_SECRET; both live only in .env. Losing the server without them loses
# those fields for good, and compose / nginx (neighbours' vhosts included) /
# _deploy.sh exist only on this box (skip-worktree or untracked).
#
# The kit is streamed straight from tar into gpg: the plaintext never touches
# the disk. Either
#   BACKUP_GPG_RECIPIENT=<key id or email>  public-key encryption; the private
#                                           key never lives on this server
#                                           (preferred), or
#   BACKUP_PASSPHRASE=<long random string>  symmetric AES256; the passphrase
#                                           must ALSO be kept off this server
#                                           (password manager), or the kit
#                                           cannot be opened after losing it.
# Restore: docs/operations/RUNBOOK.md §4.5.
KIT="${DEST}/restore-kit-${TS}.tar.gz.gpg"
KIT_FILES=()
for f in .env docker-compose.yml nginx/nginx.conf nginx/conf.d _deploy.sh; do
  [[ -e "$f" ]] && KIT_FILES+=("$f")
done

kit_skip() {
  log "⚠️ RESTORE KIT NOT SAVED: $1. Without .env (FIELD_ENCRYPTION_KEY, APP_SECRET) a restored dump cannot decrypt passports, patient notes, SOAP drafts, 2FA secrets or clinic bot tokens. See docs/operations/RUNBOOK.md §4.5."
}

if [[ ${#KIT_FILES[@]} -eq 0 ]]; then
  kit_skip "none of .env, docker-compose.yml, nginx/, _deploy.sh found in $(pwd)"
elif [[ -z "${BACKUP_GPG_RECIPIENT:-}" && -z "${BACKUP_PASSPHRASE:-}" ]]; then
  kit_skip "neither BACKUP_GPG_RECIPIENT nor BACKUP_PASSPHRASE is set"
elif ! command -v gpg >/dev/null 2>&1; then
  kit_skip "gpg is not installed (apt-get install gnupg)"
else
  if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
    kit_mode="gpg recipient ${BACKUP_GPG_RECIPIENT}"
    kit_encrypt() {
      gpg --batch --yes --trust-model always \
        --recipient "$BACKUP_GPG_RECIPIENT" --encrypt --output "$1"
    }
  else
    kit_mode="passphrase"
    # Passed on fd 3, never on the command line (visible in `ps`).
    kit_encrypt() {
      gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 \
        --symmetric --cipher-algo AES256 --output "$1" 3<<<"$BACKUP_PASSPHRASE"
    }
  fi
  if tar -czf - "${KIT_FILES[@]}" | kit_encrypt "${KIT}.partial"; then
    mv "${KIT}.partial" "$KIT"
    log "restore kit OK (${kit_mode}: ${KIT_FILES[*]})"
  else
    rm -f "${KIT}.partial"
    log "RESTORE KIT FAILED (${kit_mode}): dump and files are fine, the keys are NOT backed up"
  fi
fi

# ── 4. Off-box copy ────────────────────────────────────────────────────────
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

# ── 4b. Encrypted copy to a private Telegram channel ───────────────────────
# A second off-box copy that needs no second server: the night's dump, the
# clinic files and the restore kit, packed into ONE archive, encrypted with
# the same BACKUP_PASSPHRASE / BACKUP_GPG_RECIPIENT as the kit, and sent by
# the clinic bot to a private channel only the owner reads. Telegram only
# ever sees ciphertext. Bot API uploads stop at 50 MB, so a bigger archive
# goes out in 45 MB parts (restore: `cat part* > b.gpg; gpg -d b.gpg | tar -xz`).
#
#   BACKUP_TG_CHAT_ID=-100…        the channel (bot must be its admin)
#   BACKUP_TG_BOT_TOKEN=…          optional, defaults to TELEGRAM_BOT_TOKEN
#   BACKUP_TG_PROXY=socks5h://…    optional, when api.telegram.org is blocked
#
# Loud but not fatal, like the rsync copy above.
tg_alert() {
  if [[ -n "${ALERT_TG_TOKEN:-}" && -n "${ALERT_TG_CHAT_ID:-}" ]]; then
    curl -fsS --max-time 15 "https://api.telegram.org/bot${ALERT_TG_TOKEN}/sendMessage" \
      -d "chat_id=${ALERT_TG_CHAT_ID}" -d "text=$1" >/dev/null 2>&1 || true
  fi
}
if [[ -n "${BACKUP_TG_CHAT_ID:-}" ]]; then
  TG_TOKEN="${BACKUP_TG_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-}}"
  if [[ -z "$TG_TOKEN" ]]; then
    log "TELEGRAM COPY SKIPPED: no BACKUP_TG_BOT_TOKEN / TELEGRAM_BOT_TOKEN"
  elif [[ -z "${BACKUP_GPG_RECIPIENT:-}" && -z "${BACKUP_PASSPHRASE:-}" ]]; then
    # Never send patient data to a third party unencrypted.
    log "TELEGRAM COPY SKIPPED: neither BACKUP_GPG_RECIPIENT nor BACKUP_PASSPHRASE is set"
  else
    TGDIR=$(mktemp -d)
    BUNDLE="${TGDIR}/neurofax-backup-${TS}.tar.gpg"
    BUNDLE_FILES=("$(basename "$DUMP")" "$(basename "$FILES")")
    [[ -f "$KIT" ]] && BUNDLE_FILES+=("$(basename "$KIT")")
    if [[ -n "${BACKUP_GPG_RECIPIENT:-}" ]]; then
      tg_encrypt() { gpg --batch --yes --trust-model always --recipient "$BACKUP_GPG_RECIPIENT" --encrypt --output "$1"; }
    else
      tg_encrypt() { gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --symmetric --cipher-algo AES256 --output "$1" 3<<<"$BACKUP_PASSPHRASE"; }
    fi
    if tar -cf - -C "$DEST" "${BUNDLE_FILES[@]}" | tg_encrypt "$BUNDLE"; then
      split -b 45m -d -a 2 "$BUNDLE" "${BUNDLE}.part"
      PARTS=("${BUNDLE}".part*)
      N=${#PARTS[@]}
      PROXY_ARGS=()
      [[ -n "${BACKUP_TG_PROXY:-}" ]] && PROXY_ARGS=(--proxy "$BACKUP_TG_PROXY")
      HUMAN_DUMP=$(numfmt --to=iec "$DUMP_SIZE" 2>/dev/null || echo "${DUMP_SIZE}B")
      HUMAN_FILES=$(numfmt --to=iec "$FILES_SIZE" 2>/dev/null || echo "${FILES_SIZE}B")
      i=0; sent=0
      for p in "${PARTS[@]}"; do
        i=$((i + 1))
        caption="NeuroFax · бэкап ${DAY} (${TS}) · база ${HUMAN_DUMP}, файлы ${HUMAN_FILES} · часть ${i}/${N} · AES-256"
        # ${arr[@]+...}: an empty array under `set -u` breaks bash 3.2.
        if curl -fsS --max-time 300 ${PROXY_ARGS[@]+"${PROXY_ARGS[@]}"} \
            -F "chat_id=${BACKUP_TG_CHAT_ID}" \
            -F "caption=${caption}" \
            -F "document=@${p};filename=$(basename "$BUNDLE").part$(printf '%02d' $((i - 1)))" \
            "https://api.telegram.org/bot${TG_TOKEN}/sendDocument" >/dev/null 2>/tmp/backup-tg.err; then
          sent=$((sent + 1))
        fi
      done
      if [[ "$sent" -eq "$N" ]]; then
        log "telegram copy OK (${N} part(s))"
      else
        log "TELEGRAM COPY FAILED: ${sent}/${N} part(s) sent. See /tmp/backup-tg.err"
        tg_alert "⚠️ MedBook: Telegram backup copy FAILED on $(hostname): ${sent}/${N} parts sent."
      fi
    else
      log "TELEGRAM COPY FAILED: could not build the encrypted archive"
      tg_alert "⚠️ MedBook: Telegram backup copy FAILED on $(hostname): encryption step."
    fi
    rm -rf "$TGDIR"
  fi
fi

# ── 5. Retention ───────────────────────────────────────────────────────────
# Pruned only after the artefacts of THIS run landed — a failing run must not
# delete history while adding nothing.
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+${BACKUP_RETENTION_DAYS}" \
  -exec rm -rf {} + 2>/dev/null || true

TOTAL=$(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1)
KEPT=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
log "done → ${DEST} (kept ${KEPT} days, ${TOTAL} total)"
