#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — `git pull` on the VPS that keeps the production configs.
# ---------------------------------------------------------------------------
# /opt/neurofax marks docker-compose.yml, nginx/nginx.conf and the rtxshop /
# orientatravel vhosts skip-worktree (docs/operations/DEPLOY.md §2): they hold
# prod-only edits and the neighbours' sites. As soon as a commit changes one of
# them, a plain `git pull --ff-only` stops with "Your local changes to the
# following files would be overwritten by merge" and the whole deploy is stuck
# at step 1 (P3 changed nginx.conf and docker-compose.yml, audit INF-07).
#
# This script fast-forwards anyway and keeps every production copy:
#   1. copies each skip-worktree file to $BACKUP_ROOT/<ts>/;
#   2. un-flags and resets only the ones the incoming commits change;
#   3. `git merge --ff-only` to the upstream branch;
#   4. writes the production copies back and flags them again;
#   5. prints the upstream diff of those files. That diff is NOT applied to
#      the server: port what is needed by hand (DEPLOY.md §3).
# If anything fails on the way, the production copies are put back and
# re-flagged, and HEAD stays where it was.
#
# Exit codes:
#   0      pulled (or already up to date), no protected config changed upstream
#   3      pulled, but a protected config changed upstream: port it by hand
#          before `_deploy.sh` (a new env var in compose, say, would be missing)
#   other  nothing pulled (diverged history, merge refused, ...)
#
#   cd /opt/neurofax && bash ops/pull-keep-prod-configs.sh
#
# The first time, before the script itself is on the server:
#   cd /opt/neurofax && git fetch && \
#     git show '@{u}:ops/pull-keep-prod-configs.sh' > /tmp/pull-keep-prod-configs.sh && \
#     bash /tmp/pull-keep-prod-configs.sh
#
# Written for bash 3.2 as well (the unit test runs it on macOS).
set -euo pipefail

# The backups carry the neighbours' vhosts and the compose file.
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/root/prod-conf-bak}"

log() { echo "[pull] $*"; }

cd "$(git rev-parse --show-toplevel)"

git fetch --prune --quiet
upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}')"
old="$(git rev-parse HEAD)"
new="$(git rev-parse '@{u}')"

if [ "$old" = "$new" ]; then
  log "already up to date with $upstream ($old)"
  exit 0
fi
if ! git merge-base --is-ancestor "$old" "$new"; then
  log "REFUSED: $upstream is not a fast-forward of HEAD (history diverged). Nothing changed."
  exit 1
fi

# Every skip-worktree file, and the ones the incoming commits change.
protected="$(git ls-files -v | sed -n 's/^S //p')"
changed=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if ! git diff --quiet "$old" "$new" -- "$f"; then
    changed="$changed$f
"
  fi
done <<EOF
$protected
EOF

if [ -z "$changed" ]; then
  git merge --ff-only --quiet "$new"
  log "pulled ${old:0:7}..${new:0:7} from $upstream (no protected config changed upstream)"
  exit 0
fi

while IFS= read -r f; do
  [ -n "$f" ] || continue
  if [ ! -f "$f" ]; then
    log "REFUSED: protected file $f is missing on disk, there is no production copy to keep. Nothing changed."
    exit 1
  fi
done <<EOF
$changed
EOF

bak="$BACKUP_ROOT/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$bak"
while IFS= read -r f; do
  [ -n "$f" ] && [ -f "$f" ] || continue
  mkdir -p "$bak/$(dirname "$f")"
  cp -p "$f" "$bak/$f"
done <<EOF
$protected
EOF
log "production configs saved to $bak"

# Copy each production file back over the path (cp keeps the inode of the
# file now at the path) and re-flag it. Safe to run twice.
restore() {
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    cp -p "$bak/$f" "$f"
    git update-index --skip-worktree -- "$f"
  done <<EOF
$changed
EOF
}

finished=0
on_exit() {
  if [ "$finished" -ne 1 ]; then
    log "FAILED: putting the production configs back from $bak"
    restore || log "restore FAILED too: copy them back by hand from $bak"
  fi
}
trap on_exit EXIT

while IFS= read -r f; do
  [ -n "$f" ] || continue
  git update-index --no-skip-worktree -- "$f"
  git checkout -- "$f"
done <<EOF
$changed
EOF

git merge --ff-only --quiet "$new"
restore
finished=1

diff_file="$bak/upstream.diff"
while IFS= read -r f; do
  [ -n "$f" ] || continue
  git --no-pager diff "$old" "$new" -- "$f"
done > "$diff_file" <<EOF
$changed
EOF

log "pulled ${old:0:7}..${new:0:7} from $upstream"
log "ACTION NEEDED: the commits change these production configs, and the"
log "server kept its own copies (skip-worktree). Port what is needed by hand:"
printf '%s' "$changed" | sed 's/^/[pull]   /'
log "upstream diff (also in $diff_file):"
cat "$diff_file"
case "$changed" in
  *nginx/nginx.conf*)
    log "nginx.conf now sits on a new inode and the running container still reads"
    log "the old one: after editing, test and RECREATE nginx, a reload is not enough"
    log "(DEPLOY.md §3, step 1b)."
    ;;
esac
exit 3
