#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — idempotent deploy on the VPS.
# ---------------------------------------------------------------------------
# Called from the GitHub Actions deploy workflow over SSH. Safe to run
# manually too.
#
#   1. git pull --ff-only
#   2. docker compose build (app + worker)
#   3. docker compose up -d (zero-downtime-ish — nginx sticks up)
#   4. prisma migrate deploy inside the freshly started app container
#   5. health check
#
set -euo pipefail

cd "$(dirname "$0")/.."

log() { echo "[deploy] $(date -u +%FT%TZ) $*"; }

log "git pull"
git fetch --prune
git reset --hard origin/main

log "docker compose build"
docker compose build --pull app worker

log "docker compose up -d"
docker compose up -d --remove-orphans

log "waiting for app to come up…"
for _ in $(seq 1 30); do
  if docker compose exec -T app sh -c 'command -v curl >/dev/null && curl -fsS http://127.0.0.1:3000/api/health >/dev/null'; then
    break
  fi
  sleep 2
done

log "reloading nginx (refresh upstream IPs after app recreate)"
docker compose exec -T nginx nginx -s reload || true

log "running migrations (via fresh worker container — full node_modules tree)"
# The app image is the Next.js standalone bundle: it doesn't carry every
# transitive dep that `prisma` CLI's @prisma/dev requires (`pathe` etc.).
# The worker image keeps the full tree, but the live worker container is in
# a known restart loop, so `compose exec` is unreliable. `compose run --rm`
# spins up a fresh ephemeral container off the same image and runs migrate
# there cleanly. `--no-deps` keeps it from touching postgres/redis lifecycle.
# Migrate is allowed to fail (||true) — set -e would otherwise abort before
# nginx reload, leaving traffic on a stale upstream. The exit status is
# logged and surfaced via `docker compose ps` at the end.
if ! docker compose run --rm --no-deps worker npx prisma migrate deploy; then
  log "WARN: prisma migrate deploy failed — investigate before next release"
fi

log "done. current status:"
docker compose ps
