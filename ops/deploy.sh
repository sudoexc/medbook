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

log "running migrations"
docker compose exec -T app npx prisma migrate deploy

log "reloading nginx"
docker compose exec -T nginx nginx -s reload || true

log "done. current status:"
docker compose ps
