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
# Alerting is deliberately dumb — a Telegram message. Set ALERT_TG_TOKEN (a
# bot token; the clinic bots live in the database, so there is no global one)
# and ALERT_TG_CHAT_ID (your own chat id; message @userinfobot to get it) in
# .env. The older TELEGRAM_BOT_TOKEN / WATCHDOG_TG_CHAT_ID names still work.
# Without them the watchdog still records state to the log, so there is a
# history to read after the fact.
#
# State machine: alerts fire on TRANSITIONS only (ok→bad, bad→ok), so a long
# outage produces two messages, not one every five minutes.
#
# What counts as a problem:
#   - /api/health not answering 200, or any subsystem not "ok". The workers
#     check is real since audit INF-01: a stopped worker container, a late
#     loop or a stuck outbox shows as workers != ok within two minutes.
#   - a TLS certificate of WATCHDOG_CERT_HOSTS (default: the clinic domain)
#     that expires in less than WATCHDOG_CERT_MIN_DAYS (14) days, as served
#     by nginx right now (audit INF-03: a renewed certificate nginx never
#     reloaded still shows its old date here).
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
: "${ALERT_TG_TOKEN:=${TELEGRAM_BOT_TOKEN:-}}"
: "${ALERT_TG_CHAT_ID:=${WATCHDOG_TG_CHAT_ID:-}}"
: "${WATCHDOG_CERT_HOSTS:=neurofax.uz}"
: "${WATCHDOG_CERT_MIN_DAYS:=14}"

log() { echo "[watchdog] $(date -u +%FT%TZ) $*"; }

notify() {
  local text="$1"
  if [[ -z "$ALERT_TG_CHAT_ID" || -z "$ALERT_TG_TOKEN" ]]; then
    log "alert not sent (ALERT_TG_TOKEN / ALERT_TG_CHAT_ID unset): ${text%%$'\n'*}"
    return 0
  fi
  curl -s -m 15 -o /dev/null \
    "https://api.telegram.org/bot${ALERT_TG_TOKEN}/sendMessage" \
    --data-urlencode "chat_id=${ALERT_TG_CHAT_ID}" \
    --data-urlencode "text=${text}" \
    --data-urlencode "disable_notification=false" || true
}

# Days-left check of the certificate nginx serves now (not the file on disk).
# `-checkend` avoids parsing dates; an unreachable host is reported too.
cert_problems() {
  local host out
  for host in $WATCHDOG_CERT_HOSTS; do
    out=$(echo | timeout 15 openssl s_client -connect "${host}:443" -servername "$host" 2>/dev/null \
      | openssl x509 -noout -checkend $(( WATCHDOG_CERT_MIN_DAYS * 86400 )) 2>/dev/null)
    case "$out" in
      *"will not expire"*) ;;
      *"will expire"*) printf '%s' "TLS ${host}: истекает менее чем через ${WATCHDOG_CERT_MIN_DAYS} дн.; " ;;
      *) printf '%s' "TLS ${host}: сертификат не прочитан; " ;;
    esac
  done
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

CERT=$(cert_problems)
if [[ -n "$CERT" ]]; then
  PROBLEM="${PROBLEM}${PROBLEM:+; }${CERT%; }"
fi

PREV=$(cat "$WATCHDOG_STATE" 2>/dev/null || echo "ok")

if [[ -n "$PROBLEM" ]]; then
  log "UNHEALTHY — $PROBLEM"
  if [[ "$PREV" != "bad" ]]; then
    notify "🔴 NeuroFax: проблема
${PROBLEM}
$(date -u +'%F %T') UTC

Проверить: ssh root@167.233.142.75 'cd /opt/neurofax && docker compose ps && docker compose logs --tail 50 app worker'"
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
