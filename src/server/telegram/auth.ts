/**
 * Telegram authentication verifiers.
 *
 * Two flows live in TZ §8.1:
 *
 *  1. **Login Widget** — user presses "Login with Telegram" on the public site.
 *     Telegram returns a JSON blob; we must verify its `hash` field against
 *     HMAC_SHA256(dataCheckString, secret) where secret = SHA256(botToken).
 *     Spec: https://core.telegram.org/widgets/login#checking-authorization
 *
 *  2. **Mini App init_data** — the WebApp JS bridge hands us a URL-encoded
 *     query string. Verification uses HMAC_SHA256 with the secret
 *     HMAC_SHA256("WebAppData", botToken).
 *     Spec: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Both verifiers are pure and synchronous — no I/O — so they can run at the
 * edge. They only need the clinic's bot token, not a full Clinic row.
 *
 * Staleness: both verifiers accept an optional `maxAgeSec` that rejects
 * payloads whose `auth_date` is older than the given window (default 86400s
 * per Telegram's recommendation).
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type LoginWidgetData = {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
};

export type VerifyResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: string };

const DEFAULT_MAX_AGE_SEC = 86400;

function safeEqualHex(a: string, b: string): boolean {
  // Both strings are lowercase hex; pad to equal length for a constant-time
  // compare. If the lengths differ, this is a mismatch by definition but we
  // still run a constant-time compare on dummies to avoid leaking length.
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ba.length !== bb.length) {
    // Run a dummy compare to keep the timing signal flat.
    const dummy = Buffer.alloc(Math.max(ba.length, bb.length, 1));
    try {
      timingSafeEqual(dummy, dummy);
    } catch {
      /* ignore */
    }
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/**
 * Verify Telegram Login Widget payload.
 *
 * @param data    Full payload as received from Telegram (has `hash`).
 * @param botToken Clinic bot token.
 * @param maxAgeSec Optional freshness window (default 24h).
 */
export function verifyLoginWidget(
  data: Record<string, unknown>,
  botToken: string,
  maxAgeSec: number = DEFAULT_MAX_AGE_SEC,
): VerifyResult<LoginWidgetData> {
  if (!data || typeof data !== "object") {
    return { ok: false, reason: "invalid_payload" };
  }
  const hash = data["hash"];
  if (typeof hash !== "string" || hash.length === 0) {
    return { ok: false, reason: "missing_hash" };
  }
  if (!botToken) return { ok: false, reason: "missing_token" };

  // data-check-string = sorted(key=value) joined by \n, excluding `hash`.
  const entries = Object.entries(data)
    .filter(([k, v]) => k !== "hash" && v !== undefined && v !== null)
    .map(([k, v]) => [k, String(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  if (!safeEqualHex(expected, hash.toLowerCase())) {
    return { ok: false, reason: "bad_hash" };
  }

  const authDateRaw = data["auth_date"];
  const authDate =
    typeof authDateRaw === "number"
      ? authDateRaw
      : typeof authDateRaw === "string"
        ? Number.parseInt(authDateRaw, 10)
        : NaN;
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: "bad_auth_date" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (maxAgeSec > 0 && nowSec - authDate > maxAgeSec) {
    return { ok: false, reason: "stale" };
  }

  return { ok: true, data: data as unknown as LoginWidgetData };
}

export type MiniAppInitData = {
  user?: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
    photo_url?: string;
  };
  auth_date: number;
  query_id?: string;
  start_param?: string;
  chat_type?: string;
  chat_instance?: string;
  hash: string;
  raw: Record<string, string>;
};

/**
 * Verify a Telegram Mini App `initData` string.
 *
 * The string is exactly what `window.Telegram.WebApp.initData` yields —
 * a URL-encoded query string that includes `hash=...`. The signing key is
 * HMAC_SHA256("WebAppData", botToken).
 *
 * @param initData The raw URL-encoded payload.
 * @param botToken The clinic's bot token.
 * @param maxAgeSec Optional freshness window (default 24h).
 */
export function verifyMiniAppInitData(
  initData: string,
  botToken: string,
  maxAgeSec: number = DEFAULT_MAX_AGE_SEC,
): VerifyResult<MiniAppInitData> {
  if (!initData) return { ok: false, reason: "empty" };
  if (!botToken) return { ok: false, reason: "missing_token" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };
  params.delete("hash");

  // Collect remaining fields as-is (URL-decoded by URLSearchParams).
  const entries: Array<[string, string]> = [];
  for (const [k, v] of params.entries()) entries.push([k, v]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  if (!safeEqualHex(expected, hash.toLowerCase())) {
    return { ok: false, reason: "bad_hash" };
  }

  const authDateRaw = params.get("auth_date") ?? "";
  const authDate = Number.parseInt(authDateRaw, 10);
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: "bad_auth_date" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (maxAgeSec > 0 && nowSec - authDate > maxAgeSec) {
    return { ok: false, reason: "stale" };
  }

  const raw: Record<string, string> = {};
  for (const [k, v] of entries) raw[k] = v;

  let user: MiniAppInitData["user"];
  if (raw.user) {
    try {
      user = JSON.parse(raw.user) as MiniAppInitData["user"];
    } catch {
      return { ok: false, reason: "bad_user_json" };
    }
  }

  return {
    ok: true,
    data: {
      user,
      auth_date: authDate,
      query_id: raw.query_id,
      start_param: raw.start_param,
      chat_type: raw.chat_type,
      chat_instance: raw.chat_instance,
      hash,
      raw,
    },
  };
}
