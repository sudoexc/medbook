#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — idempotent deploy on the VPS.
# ---------------------------------------------------------------------------
# Safe to run manually. Production deploys through `_deploy.sh` (see
# docs/operations/DEPLOY.md): the same build, migrate, precheck, recreate
# order.
#
#   1. git pull --ff-only
#   2. docker compose build (app + worker)
#   3. prisma migrate deploy in a fresh worker container (new image)
#   4. subscription precheck in a fresh worker container (new image)
#   5. docker compose up -d (zero-downtime-ish, nginx stays up)
#   6. health check, nginx restart
#
# Steps 3 and 4 run BEFORE the new app and worker start, and a failure in
# either stops here with the old containers still serving. The precheck
# (scripts/subscription-lifecycle-dryrun.ts) prints what the subscription
# scheduler's first tick will do to every clinic and exits 2 unless the live
# clinic is an open-ended ACTIVE subscription on a paying plan: otherwise
# the new worker would start a grace period on it and cancel it 14 days
# later, and a cancelled subscription gets Basic limits, so reception's
# patient create, booking and walk-in answer 402 (final review of P5). The
# script's output says how to pin the clinic (APPLY=1 CLINIC=… PLAN=…);
# then run this again.
#
# A brand-new database with no clinic yet fails the precheck too (clinic
# not found). Only for that first install: SKIP_SUBSCRIPTION_PRECHECK=1.
#
set -euo pipefail

cd "$(dirname "$0")/.."

log() { echo "[deploy] $(date -u +%FT%TZ) $*"; }

log "git pull"
git fetch --prune
git reset --hard origin/main

log "docker compose build"
docker compose build --pull app worker

log "running migrations (via a fresh worker container: full node_modules tree)"
# The app image is the Next.js standalone bundle: it doesn't carry every
# transitive dep that `prisma` CLI's @prisma/dev requires (`pathe` etc.).
# The worker image keeps the full tree. `compose run --rm` spins up a fresh
# ephemeral container off the NEW image (just built) and runs migrate there.
# `--no-deps` keeps it from touching postgres/redis lifecycle. A failure
# stops the deploy: nothing new has started yet, the old app keeps serving.
if ! docker compose run --rm --no-deps worker npx prisma migrate deploy; then
  log "FAIL: prisma migrate deploy failed. Nothing restarted; the old app and worker keep serving."
  exit 1
fi

if [ "${SKIP_SUBSCRIPTION_PRECHECK:-}" = "1" ]; then
  log "WARN: subscription precheck skipped (SKIP_SUBSCRIPTION_PRECHECK=1, first install only)"
else
  log "subscription precheck (scripts/subscription-lifecycle-dryrun.ts, writes nothing)"
  set +e
  docker compose run --rm --no-deps worker npx tsx scripts/subscription-lifecycle-dryrun.ts
  precheck=$?
  set -e
  if [ "$precheck" -ne 0 ]; then
    if [ "$precheck" -eq 2 ]; then
      log "FAIL: the live clinic is not an open-ended ACTIVE subscription (exit 2). Pin it as the output above says, then deploy again."
    else
      log "FAIL: the subscription precheck crashed (exit $precheck)."
    fi
    log "Nothing restarted; the old app and worker keep serving."
    exit 1
  fi
fi

log "docker compose up -d"
docker compose up -d --remove-orphans

log "waiting for app to come up…"
for _ in $(seq 1 30); do
  if docker compose exec -T app sh -c 'command -v curl >/dev/null && curl -fsS http://127.0.0.1:3000/api/health >/dev/null'; then
    break
  fi
  sleep 2
done

log "restarting nginx (refresh upstream IPs after app recreate)"
# `nginx -s reload` re-reads config but doesn't re-resolve upstream
# hostnames cached by the Docker resolver at process startup, so a fresh
# app container with a new IP keeps 502'ing. Full restart re-resolves.
docker compose restart nginx || true

log "done. current status:"
docker compose ps
