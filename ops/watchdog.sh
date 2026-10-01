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
# Delivery: egress from a VPS to api.telegram.org is not always reliable (the
# app retries 12 times for the same reason), and one lost request used to be
# the only alert of an outage. The message goes to ALERT_TG_API_BASE (default:
# the app's TELEGRAM_API_BASE, else api.telegram.org), through ALERT_TG_PROXY
# when set (any curl proxy URL, e.g. socks5h://127.0.0.1:40000 for a WARP
# client in proxy mode), with WATCHDOG_TG_ATTEMPTS tries and doubling backoff,
# and counts only when Telegram answers "ok":true.
#
# State machine: the state file holds the problems the operator was last TOLD
# about, one "class|key|text" line each ("ok" when none). An alert goes out
# when that set of keys changes: a new problem, an escalation, a partial or a
# full recovery. A long outage is still two messages, not one every five
# minutes, but a standing soft problem (a dead-lettered event for 24h, a
# certificate inside its 14 days) can no longer swallow a later hard outage,
# as the single ok/bad state did. The state is written only after the alert
# was delivered, so an alert Telegram did not confirm is sent again next run.
#
# What counts as a problem:
#   hard  /api/health not answering 200 (db down answers 503), or db not ok:
#         the clinic cannot work.
#   soft  the site answers, but redis, minio or workers is not ok. The
#         workers check is real since audit INF-01: a stopped worker
#         container, a late loop or a stuck outbox shows as workers != ok
#         within two minutes, and "degraded" and "down" are separate keys.
#         Also a TLS certificate of WATCHDOG_CERT_HOSTS (default: the clinic
#         domain) that expires in less than WATCHDOG_CERT_MIN_DAYS (14) days,
#         as served by nginx right now (audit INF-03: a renewed certificate
#         nginx never reloaded still shows its old date here), or that cannot
#         be read.
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
# Own name first: the app's TELEGRAM_API_BASE may be a docker-internal host
# the deploy host cannot resolve.
: "${ALERT_TG_API_BASE:=${TELEGRAM_API_BASE:-https://api.telegram.org}}"
: "${ALERT_TG_PROXY:=}"
: "${WATCHDOG_TG_ATTEMPTS:=5}"
: "${WATCHDOG_TG_BACKOFF:=2}"
: "${WATCHDOG_CERT_HOSTS:=neurofax.uz}"
: "${WATCHDOG_CERT_MIN_DAYS:=14}"

log() { echo "[watchdog] $(date -u +%FT%TZ) $*"; }

# Sends one Telegram message. Returns 0 when Telegram confirmed it, or when
# alerting is not configured (no retry can fix that; the log keeps the
# history). Returns 1 when it was not confirmed, so the caller keeps the old
# state and the next run sends the transition again.
notify() {
  local text="$1" resp desc attempt=1 delay="$WATCHDOG_TG_BACKOFF"
  local client_error='"error_code":4[0-9][0-9]'
  local -a proxy=()
  if [[ -z "$ALERT_TG_CHAT_ID" || -z "$ALERT_TG_TOKEN" ]]; then
    log "alert not sent (ALERT_TG_TOKEN / ALERT_TG_CHAT_ID unset): ${text%%$'\n'*}"
    return 0
  fi
  [[ -n "$ALERT_TG_PROXY" ]] && proxy=(--proxy "$ALERT_TG_PROXY")
  while :; do
    resp=$(curl -sS -m 15 ${proxy[@]+"${proxy[@]}"} \
      "${ALERT_TG_API_BASE%/}/bot${ALERT_TG_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${ALERT_TG_CHAT_ID}" \
      --data-urlencode "text=${text}" \
      --data-urlencode "disable_notification=false" 2>&1)
    if [[ "$resp" == *'"ok":true'* || "$resp" == *'"ok": true'* ]]; then
      return 0
    fi
    desc=$(printf '%s' "$resp" | sed -n 's/.*"description":"\([^"]*\)".*/\1/p' | head -1)
    [[ -z "$desc" ]] && desc=$(printf '%s' "$resp" | head -1 | cut -c1-200)
    log "alert attempt ${attempt}/${WATCHDOG_TG_ATTEMPTS} failed: ${desc//"$ALERT_TG_TOKEN"/***}"
    # A 4xx other than 429 (bad token, unknown chat) does not heal by retrying.
    if [[ $resp =~ $client_error && "$resp" != *'"error_code":429'* ]]; then
      break
    fi
    (( attempt >= WATCHDOG_TG_ATTEMPTS )) && break
    sleep "$delay"
    delay=$(( delay * 2 ))
    attempt=$(( attempt + 1 ))
  done
  log "alert NOT delivered, state kept for the next run: ${text%%$'\n'*}"
  return 1
}

# One "class|key|text" line per problem. The key is what runs compare, so it
# names the failure, not a value that wobbles inside it.
ITEMS=""
add_item() { ITEMS="${ITEMS}$1|$2|$3"$'\n'; }

# Days-left check of the certificate nginx serves now (not the file on disk).
# `-checkend` avoids parsing dates; an unreachable host is reported too.
cert_problems() {
  local host out
  for host in $WATCHDOG_CERT_HOSTS; do
    out=$(echo | timeout 15 openssl s_client -connect "${host}:443" -servername "$host" 2>/dev/null \
      | openssl x509 -noout -checkend $(( WATCHDOG_CERT_MIN_DAYS * 86400 )) 2>/dev/null)
    case "$out" in
      *"will not expire"*) ;;
      *"will expire"*) echo "soft|tls-expiring:${host}|TLS ${host}: истекает менее чем через ${WATCHDOG_CERT_MIN_DAYS} дн." ;;
      *) echo "soft|tls-unreadable:${host}|TLS ${host}: сертификат не прочитан" ;;
    esac
  done
}

PREV=$(cat "$WATCHDOG_STATE" 2>/dev/null)
case "$PREV" in
  ""|ok) PREV="" ;;
  # Written by the single ok/bad watchdog: what failed then is unknown.
  bad) PREV="soft|legacy|" ;;
esac

BODY=$(curl -s -m "$WATCHDOG_TIMEOUT" -w '\n%{http_code}' "$WATCHDOG_URL" 2>/dev/null)
CODE=$(printf '%s' "$BODY" | tail -1)
JSON=$(printf '%s' "$BODY" | sed '$d')

if [[ "$CODE" != "200" ]]; then
  # Keyed "http", not by code: a 502 one run and no answer the next is the
  # same outage, not two.
  [[ -z "$CODE" || "$CODE" == "000" ]] && CODE="нет ответа"
  add_item hard http "HTTP ${CODE}"
  # Without a health body the subsystems are unknown, not fixed: keep what the
  # operator was told about them, so the alert does not report them as gone
  # and the recovery message still names the ones that remain.
  CARRIED=$(printf '%s\n' "$PREV" | grep -E '^[a-z]+\|(db|redis|minio|workers):')
  [[ -n "$CARRIED" ]] && ITEMS="${ITEMS}${CARRIED}"$'\n'
else
  # Report every failing subsystem with its status, not just the first:
  # "db + redis down" and "redis down" are different incidents, and so are
  # "workers degraded" (an old DEAD row) and "workers down" (no worker).
  for svc in db redis minio workers; do
    st=$(printf '%s' "$JSON" | grep -o "\"${svc}\":{\"status\":\"[a-z_]*\"" | head -1 | sed 's/.*:"//; s/"$//')
    [[ "$st" == "ok" ]] && continue
    key=${st:-missing}
    [[ "$st" == "timeout" ]] && key=down
    class=soft
    [[ "$svc" == "db" ]] && class=hard
    add_item "$class" "${svc}:${key}" "${svc}: ${st:-нет данных}"
  done
fi

CERT=$(cert_problems)
[[ -n "$CERT" ]] && ITEMS="${ITEMS}${CERT}"$'\n'

# Sorted keys of a list of "class|key|text" lines.
keys_of() { printf '%s' "$1" | sed '/^$/d' | cut -d'|' -f2 | sort -u; }
# The lines of $1 whose key is not among the keys in $2.
without_keys() {
  local line key
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    key=$(printf '%s' "$line" | cut -d'|' -f2)
    printf '%s\n' "$2" | grep -qxF -- "$key" || printf '%s\n' "$line"
  done <<< "$1"
}
bullets() { printf '%s' "$1" | sed '/^$/d' | cut -d'|' -f3- | sed 's/^/• /'; }

CUR_KEYS=$(keys_of "$ITEMS")
PREV_KEYS=$(keys_of "$PREV")

if [[ -n "$ITEMS" ]]; then
  log "UNHEALTHY: $(printf '%s' "$ITEMS" | sed '/^$/d' | cut -d'|' -f3- | paste -sd ';' -)"
else
  log "ok"
fi

[[ "$CUR_KEYS" == "$PREV_KEYS" ]] && exit 0

NOW="$(date -u +'%F %T') UTC"
GONE=$(without_keys "$PREV" "$CUR_KEYS" | grep -v '^[a-z]*|legacy|')

if [[ -z "$ITEMS" ]]; then
  MSG="✅ NeuroFax снова в порядке"
  [[ -n "$GONE" ]] && MSG="${MSG}
Прошло:
$(bullets "$GONE")"
  MSG="${MSG}
${NOW}"
else
  if printf '%s' "$ITEMS" | grep -q '^hard|'; then
    MSG="🔴 NeuroFax: сайт не работает"
  else
    MSG="🟠 NeuroFax: сайт работает, но есть сбой"
  fi
  if [[ -z "$PREV_KEYS" || "$PREV_KEYS" == "legacy" ]]; then
    MSG="${MSG}
$(bullets "$ITEMS")"
  else
    ADDED=$(without_keys "$ITEMS" "$PREV_KEYS")
    STAYING=$(without_keys "$ITEMS" "$(keys_of "$ADDED")")
    [[ -n "$ADDED" ]] && MSG="${MSG}
Новое:
$(bullets "$ADDED")"
    [[ -n "$GONE" ]] && MSG="${MSG}
Прошло:
$(bullets "$GONE")"
    [[ -n "$STAYING" ]] && MSG="${MSG}
Остаётся:
$(bullets "$STAYING")"
  fi
  MSG="${MSG}
${NOW}

Проверить: ssh root@167.233.142.75 'cd /opt/neurofax && docker compose ps && docker compose logs --tail 50 app worker'"
fi

if notify "$MSG"; then
  if [[ -z "$ITEMS" ]]; then
    echo "ok" > "$WATCHDOG_STATE" || log "state not written: $WATCHDOG_STATE"
  else
    printf '%s' "$ITEMS" > "$WATCHDOG_STATE" || log "state not written: $WATCHDOG_STATE"
  fi
fi
