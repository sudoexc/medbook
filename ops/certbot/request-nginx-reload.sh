#!/bin/sh
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — certbot deploy hook (audit INF-03).
# ---------------------------------------------------------------------------
# Runs inside the certbot container after every certificate it renews
# (mounted into /etc/letsencrypt/renewal-hooks/deploy/ by docker-compose.yml).
#
# nginx keeps a renewed certificate's predecessor in memory until it reloads,
# and this container cannot reach Docker to reload it. So the hook only
# leaves a flag in the letsencrypt volume, which the nginx container mounts
# too; the host cron `ops/nginx-reload-on-renew.sh` reloads nginx when it
# finds the flag and clears it.
#
# Idempotent: several certificates renewed in one run leave one flag.
set -eu

FLAG=/etc/letsencrypt/.nginx-reload-requested
date -u +%FT%TZ > "$FLAG"
echo "[certbot-hook] renewed: ${RENEWED_DOMAINS:-?}; nginx reload requested"
