#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# MedBook / NeuroFax — health watchdog.
# ---------------------------------------------------------------------------
# Polls /api/health and shouts when the deployment is unhealthy. Runs from
# cron every 5 minutes on the deploy host.
#
# Why this exists: prod had no monitoring at all. With a live doctor using the
# system, "the site is down" must not be something we learn from the client.
#
# Alerting is deliberately dumb — a Telegram message via the clinic bot. Set
# WATCHDOG_TG_CHAT_ID in .env (your own chat id; message @userinfobot to get
# it). Without it the watchdog still records state to the log, so there is a
# history to read after the fact.
#
# State machine: alerts fire on TRANSITIONS only (ok→bad, bad→ok), so a long
# outage produces two messages, not one every five minutes.
#
# Cron:
#   */5 * * * * cd /opt/neurofax && ./ops/watchdog.sh >> /var/log/medbook-watchdog.log 2>&1
#
set -uo pipefail   # NB: no -e; a failing curl is the thing we are measuring.

cd "$(dirname "$0")/.." || exit 1

if [[ -f .env ]]; then
  # shellcheck disable=SC2046,SC1091
  set -a; . ./.env; set +a
fi

: "${WATCHDOG_URL:=https://neurofax.uz/api/health}"
: "${WATCHDOG_TIMEOUT:=20}"
: "${WATCHDOG_STATE:=/var/lib/medbook-watchdog.state}"
: "${WATCHDOG_TG_CHAT_ID:=}"

log() { echo "[watchdog] $(date -u +%FT%TZ) $*"; }

notify() {
  local text="$1"
  [[ -z "$WATCHDOG_TG_CHAT_ID" || -z "${TELEGRAM_BOT_TOKEN:-}" ]] && return 0
  curl -s -m 15 -o /dev/null \
    "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${WATCHDOG_TG_CHAT_ID}" \
    --data-urlencode "text=${text}" \
    --data-urlencode "disable_notification=false" || true
}

BODY=$(curl -s -m "$WATCHDOG_TIMEOUT" -w '\n%{http_code}' "$WATCHDOG_URL" 2>/dev/null)
CODE=$(printf '%s' "$BODY" | tail -1)
JSON=$(printf '%s' "$BODY" | sed '$d')

PROBLEM=""
if [[ "$CODE" != "200" ]]; then
  PROBLEM="HTTP ${CODE:-нет ответа}"
else
  # Report every failing subsystem, not just the first — "db + redis down"
  # and "redis down" are different incidents.
  for svc in db redis minio workers; do
    if ! printf '%s' "$JSON" | grep -q "\"${svc}\":{\"status\":\"ok\""; then
      PROBLEM="${PROBLEM}${PROBLEM:+, }${svc}"
    fi
  done
  [[ -n "$PROBLEM" ]] && PROBLEM="проблемы: ${PROBLEM}"
fi

PREV=$(cat "$WATCHDOG_STATE" 2>/dev/null || echo "ok")

if [[ -n "$PROBLEM" ]]; then
  log "UNHEALTHY — $PROBLEM"
  if [[ "$PREV" != "bad" ]]; then
    notify "🔴 NeuroFax недоступен
${PROBLEM}
$(date -u +'%F %T') UTC

Проверить: ssh root@167.233.142.75 'cd /opt/neurofax && docker compose ps && docker compose logs --tail 50 app'"
    echo "bad" > "$WATCHDOG_STATE"
  fi
else
  log "ok"
  if [[ "$PREV" == "bad" ]]; then
    notify "✅ NeuroFax снова работает
$(date -u +'%F %T') UTC"
    echo "ok" > "$WATCHDOG_STATE"
  fi
fi
