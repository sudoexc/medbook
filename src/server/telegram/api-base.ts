/**
 * Bot API origin for every app and worker Telegram call (send.ts,
 * bot-api.ts, the CRM set-webhook and webhook-status routes).
 *
 * Read with `||`, not `??`: .env.example ships `TELEGRAM_API_BASE=` and
 * docker compose's `env_file: .env` hands that to the containers as "",
 * which `??` keeps, so every call became fetch("/bot<token>/...") and threw
 * ERR_INVALID_URL. Empty or blank now means the public endpoint, as the
 * template says.
 *
 * Trailing slashes are dropped so a relay URL pasted with one does not
 * produce "//bot..." (scripts/tg-relay-worker.js answers 404 to that path),
 * the same trim ops/watchdog.sh does with `${ALERT_TG_API_BASE%/}`.
 */
export const DEFAULT_TELEGRAM_API_BASE = "https://api.telegram.org";

export function telegramApiBase(
  raw: string | undefined = process.env.TELEGRAM_API_BASE,
): string {
  return raw?.trim().replace(/\/+$/, "") || DEFAULT_TELEGRAM_API_BASE;
}
