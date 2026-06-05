/**
 * Lightweight Telegram Bot API client used by the per-clinic constructor.
 *
 * Distinct from `send.ts` (which is the message-flow adapter): this module
 * covers the "bot setup" surface — getMe, setMyCommands, setMyDescription,
 * setChatMenuButton, setWebhook, getWebhookInfo, deleteWebhook.
 *
 * Retries: egress from some VPS networks to api.telegram.org is intermittent
 * (TLS handshake completes but the H2/H1 response never arrives). We retry up
 * to TG_API_RETRIES times with a per-attempt timeout, and only fail if every
 * attempt times out. Successful HTTP responses (including 401/400 from
 * Telegram) short-circuit immediately — no retry on a real Telegram error.
 */

const API_ROOT = process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org";
// RU VPS → api.telegram.org reachability is partial (≈30% of TG IPs answer).
// We keep a generous wall budget so the wizard doesn't fail on the first
// unlucky DNS pick. 12 attempts × 8s ≈ 96s worst case, plus capped backoff.
const PER_ATTEMPT_TIMEOUT_MS = 8000;
const TG_API_RETRIES = 12;
const BACKOFF_BASE_MS = 250;
const BACKOFF_CAP_MS = 2000;

export type TgApiOk<T> = { ok: true; result: T };
export type TgApiErr = {
  ok: false;
  error_code: number;
  description: string;
  parameters?: { retry_after?: number };
};
export type TgApiResponse<T> = TgApiOk<T> | TgApiErr;

export type TgBotInfo = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
};

export type TgWebhookInfo = {
  url: string;
  has_custom_certificate: boolean;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  ip_address?: string;
  allowed_updates?: string[];
};

export type TgBotCommand = { command: string; description: string };

async function call<T>(
  token: string,
  method: string,
  payload?: Record<string, unknown>,
  opts?: { perAttemptTimeoutMs?: number; retries?: number },
): Promise<TgApiResponse<T>> {
  const url = `${API_ROOT}/bot${token}/${method}`;
  const body = payload ? JSON.stringify(payload) : "{}";
  const perAttemptTimeout = opts?.perAttemptTimeoutMs ?? PER_ATTEMPT_TIMEOUT_MS;
  const retries = opts?.retries ?? TG_API_RETRIES;

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(perAttemptTimeout),
      });
      return (await res.json()) as TgApiResponse<T>;
    } catch (e) {
      lastErr = e;
      // Only timeouts/abort/network errors are worth retrying. Anything that
      // came back as an HTTP response (even 4xx) already returned above.
      if (attempt < retries) {
        const wait = Math.min(BACKOFF_BASE_MS * attempt, BACKOFF_CAP_MS);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("telegram_unreachable");
}

export type TgUpdate = {
  update_id: number;
  message?: unknown;
  edited_message?: unknown;
  callback_query?: unknown;
  my_chat_member?: unknown;
};

/**
 * Long-poll getUpdates. Used by the polling worker on RU VPS where Telegram
 * cannot reliably push webhooks to us.
 *
 * `timeoutSec` is the long-poll wait — Telegram holds the connection open up
 * to that long if there are no updates. Our per-attempt timeout must be a few
 * seconds longer so we don't abort an idle long-poll prematurely.
 */
export async function getUpdates(
  token: string,
  params: {
    offset?: number;
    timeoutSec?: number;
    allowedUpdates?: string[];
  } = {},
): Promise<TgApiResponse<TgUpdate[]>> {
  const timeoutSec = params.timeoutSec ?? 25;
  return call<TgUpdate[]>(
    token,
    "getUpdates",
    {
      ...(params.offset !== undefined ? { offset: params.offset } : {}),
      timeout: timeoutSec,
      ...(params.allowedUpdates ? { allowed_updates: params.allowedUpdates } : {}),
    },
    {
      // Hold the socket open through the full long-poll, plus headroom for
      // network latency back. Fewer retries because each attempt is heavy.
      perAttemptTimeoutMs: (timeoutSec + 10) * 1000,
      retries: 3,
    },
  );
}

export async function getMe(token: string): Promise<TgApiResponse<TgBotInfo>> {
  return call<TgBotInfo>(token, "getMe");
}

export async function setMyCommands(
  token: string,
  commands: TgBotCommand[],
  languageCode?: string,
): Promise<TgApiResponse<true>> {
  return call<true>(token, "setMyCommands", {
    commands,
    ...(languageCode ? { language_code: languageCode } : {}),
  });
}

export async function setMyDescription(
  token: string,
  description: string,
  languageCode?: string,
): Promise<TgApiResponse<true>> {
  return call<true>(token, "setMyDescription", {
    description,
    ...(languageCode ? { language_code: languageCode } : {}),
  });
}

export async function setMyShortDescription(
  token: string,
  shortDescription: string,
  languageCode?: string,
): Promise<TgApiResponse<true>> {
  return call<true>(token, "setMyShortDescription", {
    short_description: shortDescription,
    ...(languageCode ? { language_code: languageCode } : {}),
  });
}

export async function setChatMenuButton(
  token: string,
  menuButton:
    | { type: "default" }
    | { type: "commands" }
    | { type: "web_app"; text: string; web_app: { url: string } },
): Promise<TgApiResponse<true>> {
  return call<true>(token, "setChatMenuButton", { menu_button: menuButton });
}

export async function setWebhook(
  token: string,
  params: {
    url: string;
    secret_token?: string;
    allowed_updates?: string[];
    max_connections?: number;
    drop_pending_updates?: boolean;
  },
): Promise<TgApiResponse<true>> {
  return call<true>(token, "setWebhook", params);
}

export async function getWebhookInfo(
  token: string,
): Promise<TgApiResponse<TgWebhookInfo>> {
  return call<TgWebhookInfo>(token, "getWebhookInfo");
}

export async function deleteWebhook(
  token: string,
  dropPendingUpdates = false,
): Promise<TgApiResponse<true>> {
  return call<true>(token, "deleteWebhook", {
    drop_pending_updates: dropPendingUpdates,
  });
}

export type TgFile = {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
};

/**
 * Phase 15 Wave 5 — fetch a file's `file_path` so the worker can construct
 * `https://api.telegram.org/file/bot<TOKEN>/<file_path>` and stream the
 * audio bytes directly into Whisper. The response URL is short-lived
 * (~1h), so we never persist it — we use it once and forget.
 */
export async function getFile(
  token: string,
  fileId: string,
): Promise<TgApiResponse<TgFile>> {
  return call<TgFile>(token, "getFile", { file_id: fileId });
}

/**
 * Construct the public download URL for a file_path returned by `getFile`.
 * Telegram's file proxy at `api.telegram.org/file/bot<TOKEN>/<file_path>`
 * accepts a one-shot GET with no auth header beyond the path token itself.
 */
export function buildFileDownloadUrl(token: string, filePath: string): string {
  return `${API_ROOT}/file/bot${token}/${filePath}`;
}
