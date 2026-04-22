#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — first-run Let's Encrypt issuance.
# ---------------------------------------------------------------------------
# Run ONCE after the first `docker compose up -d`, once DNS points at the box.
#
# Flow:
#   1. Point `LETSENCRYPT_DOMAIN` A record at the VPS IPv4.
#   2. Make sure nginx is serving /.well-known/acme-challenge/ over port 80
#      (the default `nginx/nginx.conf` in this repo does).
#   3. Run `./ops/certbot-init.sh`.
#   4. `docker compose restart nginx` to pick up the new cert paths.
#
# Afterwards the certbot sidecar renews automatically every 12h.
#
set -euo pipefail

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

: "${LETSENCRYPT_EMAIL:?LETSENCRYPT_EMAIL required in .env}"
: "${LETSENCRYPT_DOMAIN:?LETSENCRYPT_DOMAIN required in .env}"

STAGING_FLAG="${LE_STAGING:+--staging}"

docker compose run --rm --entrypoint "" certbot \
  certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --email "$LETSENCRYPT_EMAIL" \
    --agree-tos \
    --no-eff-email \
    --non-interactive \
    -d "$LETSENCRYPT_DOMAIN" \
    ${STAGING_FLAG}

echo "[certbot-init] issued. Reloading nginx…"
docker compose exec nginx nginx -s reload
echo "[certbot-init] done."
