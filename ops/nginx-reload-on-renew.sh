#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — reload the shared nginx after a certificate renewal.
# ---------------------------------------------------------------------------
# Audit INF-03. The certbot sidecar renews certificates on its own, but nginx
# serves the old one from memory until it reloads. Deploys used to hide this
# (each one reloads nginx); a month without a deploy meant a TLS outage for
# the clinic and every neighbour behind this nginx.
#
# The certbot deploy hook (ops/certbot/request-nginx-reload.sh) leaves a flag
# in the letsencrypt volume. This script, run from the host cron, reloads
# nginx when the flag is there, then clears it:
#
#   - `nginx -t` first: a broken vhost must not take every site down; the
#     flag stays and the next run tries again (the watchdog's certificate
#     check warns before anything expires);
#   - `nginx -s reload` is graceful: no dropped connections, no neighbour
#     blip (a container restart would be one).
#
# Cron (hourly, ops/crontab.example):
#   23 * * * * cd /opt/neurofax && ./ops/nginx-reload-on-renew.sh >> /var/log/medbook-nginx-reload.log 2>&1
#
# Manual check without waiting for a renewal:
#   docker compose exec nginx sh -c 'date > /etc/letsencrypt/.nginx-reload-requested'
#   ./ops/nginx-reload-on-renew.sh
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

FLAG=/etc/letsencrypt/.nginx-reload-requested
log() { echo "[nginx-reload] $(date -u +%FT%TZ) $*"; }

if ! docker compose exec -T nginx test -f "$FLAG"; then
  exit 0
fi

if ! docker compose exec -T nginx nginx -t; then
  log "renewal pending, but nginx -t failed: reload skipped, flag kept"
  exit 1
fi

if docker compose exec -T nginx nginx -s reload; then
  docker compose exec -T nginx rm -f "$FLAG"
  log "certificate renewed: nginx reloaded"
else
  log "nginx -s reload failed: flag kept, next run retries"
  exit 1
fi
