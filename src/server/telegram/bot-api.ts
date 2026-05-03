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

const API_ROOT = "https://api.telegram.org";
const PER_ATTEMPT_TIMEOUT_MS = 5000;
const TG_API_RETRIES = 7;

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
): Promise<TgApiResponse<T>> {
  const url = `${API_ROOT}/bot${token}/${method}`;
  const body = payload ? JSON.stringify(payload) : "{}";

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= TG_API_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS),
      });
      return (await res.json()) as TgApiResponse<T>;
    } catch (e) {
      lastErr = e;
      // Only timeouts/abort/network errors are worth retrying. Anything that
      // came back as an HTTP response (even 4xx) already returned above.
      if (attempt < TG_API_RETRIES) {
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error("telegram_unreachable");
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
