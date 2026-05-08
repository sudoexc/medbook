/**
 * Telegram Bot API client — per-clinic.
 *
 * Phase 3b. All outbound messages flow through here. Each clinic has its own
 * `tgBotToken`; we never reuse a global bot. If a clinic has `tgBotToken=null`
 * (common in dev/test), every call logs and returns a synthetic messageId
 * without touching the network — that keeps the rest of the stack working.
 *
 * Error handling:
 *  - Network-level (fetch reject / abort / timeout) → retry up to
 *    MAX_ATTEMPTS with capped backoff. Necessary on the RU VPS where
 *    egress to api.telegram.org succeeds against ~30% of TG's IP pool per
 *    DNS pick.
 *  - 429 → respect `retry_after`.
 *  - 5xx → exponential backoff.
 *  - Other non-2xx → throw with a readable message so the worker / caller
 *    can mark the message FAILED.
 *
 * This module deliberately has zero business logic: it is the pure I/O layer
 * for the state machine in `state.ts` and the adapter in
 * `src/server/notifications/adapters/tg.ts`.
 */

export type TgInlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
};

export type TgInlineKeyboard = TgInlineButton[][];

export type TgReplyMarkup =
  | { inline_keyboard: TgInlineKeyboard }
  | {
      keyboard: Array<
        Array<{ text: string; request_contact?: boolean; request_location?: boolean }>
      >;
      resize_keyboard?: boolean;
      one_time_keyboard?: boolean;
    }
  | { remove_keyboard: true };

export type SendMessageOptions = {
  parse_mode?: "HTML" | "MarkdownV2";
  reply_markup?: TgReplyMarkup;
  reply_to_message_id?: number;
  disable_web_page_preview?: boolean;
};

export type TgClinicMinimal = {
  id: string;
  slug: string;
  tgBotToken: string | null;
  tgBotUsername: string | null;
};

export type TgApiOk<T> = { ok: true; result: T };
export type TgApiErr = {
  ok: false;
  error_code: number;
  description: string;
  parameters?: { retry_after?: number };
};
export type TgApiResponse<T> = TgApiOk<T> | TgApiErr;

export type TgMessageResult = {
  message_id: number;
  chat: { id: number };
  date: number;
};

const API_ROOT = "https://api.telegram.org";
const MAX_ATTEMPTS = 12;
const PER_ATTEMPT_TIMEOUT_MS = 8000;
const BACKOFF_BASE_MS = 250;
const BACKOFF_CAP_MS = 2000;

/**
 * Low-level POST to the Telegram Bot API. Returns parsed body; throws if
 * the network call fails or times out. Does NOT retry — callers wrap for
 * backoff.
 */
async function tgCall<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<TgApiResponse<T>> {
  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS),
  });
  // Telegram always returns JSON, even for errors.
  return (await res.json()) as TgApiResponse<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * (attempt + 1), BACKOFF_CAP_MS);
}

/**
 * Call Telegram with retries.
 *
 *  - Network-level errors (fetch reject / abort / timeout) → retry with capped
 *    linear backoff. Required on the RU VPS where egress reaches only ~30% of
 *    Telegram's IP pool per DNS pick.
 *  - 429 → respect `retry_after`.
 *  - 5xx (`error_code >= 500`) → capped backoff retry.
 *  - Other non-2xx → throw immediately so the caller can mark the message as
 *    failed.
 */
async function tgCallWithBackoff<T>(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  let lastErrDesc = "";
  let lastNetworkErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let resp: TgApiResponse<T>;
    try {
      resp = await tgCall<T>(token, method, payload);
    } catch (e) {
      lastNetworkErr = e;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new Error(
        `Telegram ${method} network failure after ${MAX_ATTEMPTS} attempts: ${(e as Error).message}`,
      );
    }
    if (resp.ok) return resp.result;
    if (resp.error_code === 429) {
      const wait = Math.max(1, resp.parameters?.retry_after ?? 1);
      await sleep(wait * 1000);
      continue;
    }
    if (resp.error_code >= 500 && attempt < MAX_ATTEMPTS - 1) {
      lastErrDesc = resp.description;
      await sleep(backoffMs(attempt));
      continue;
    }
    throw new Error(
      `Telegram ${method} failed: ${resp.error_code} ${resp.description}`,
    );
  }
  if (lastNetworkErr) {
    throw new Error(
      `Telegram ${method} exhausted retries (network): ${(lastNetworkErr as Error).message}`,
    );
  }
  throw new Error(`Telegram ${method} exhausted retries: ${lastErrDesc}`);
}

function logNoop(
  clinic: TgClinicMinimal,
  method: string,
  payload: Record<string, unknown>,
): TgMessageResult {
  const messageId = Math.floor(Math.random() * 1_000_000);
  console.info(
    `[tg:noop clinic=${clinic.slug}] ${method} payload=${JSON.stringify(payload).slice(0, 200)} -> msgId=${messageId}`,
  );
  return {
    message_id: messageId,
    chat: { id: Number(payload.chat_id) || 0 },
    date: Math.floor(Date.now() / 1000),
  };
}

/** Send a text message. */
export async function sendMessage(
  clinic: TgClinicMinimal,
  chatId: string | number,
  text: string,
  opts: SendMessageOptions = {},
): Promise<TgMessageResult> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text,
    ...(opts.parse_mode ? { parse_mode: opts.parse_mode } : {}),
    ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
    ...(opts.reply_to_message_id
      ? { reply_to_message_id: opts.reply_to_message_id }
      : {}),
    ...(opts.disable_web_page_preview !== undefined
      ? { disable_web_page_preview: opts.disable_web_page_preview }
      : {}),
  };
  if (!clinic.tgBotToken) return logNoop(clinic, "sendMessage", payload);
  return tgCallWithBackoff<TgMessageResult>(
    clinic.tgBotToken,
    "sendMessage",
    payload,
  );
}

/** Send a photo (by URL or file_id). */
export async function sendPhoto(
  clinic: TgClinicMinimal,
  chatId: string | number,
  photo: string,
  caption?: string,
  opts: SendMessageOptions = {},
): Promise<TgMessageResult> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    photo,
    ...(caption ? { caption } : {}),
    ...(opts.parse_mode ? { parse_mode: opts.parse_mode } : {}),
    ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
  };
  if (!clinic.tgBotToken) return logNoop(clinic, "sendPhoto", payload);
  return tgCallWithBackoff<TgMessageResult>(
    clinic.tgBotToken,
    "sendPhoto",
    payload,
  );
}

/** Edit an existing message's text. */
export async function editMessageText(
  clinic: TgClinicMinimal,
  chatId: string | number,
  messageId: number,
  text: string,
  opts: SendMessageOptions = {},
): Promise<TgMessageResult | boolean> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(opts.parse_mode ? { parse_mode: opts.parse_mode } : {}),
    ...(opts.reply_markup ? { reply_markup: opts.reply_markup } : {}),
  };
  if (!clinic.tgBotToken) return logNoop(clinic, "editMessageText", payload);
  return tgCallWithBackoff<TgMessageResult | boolean>(
    clinic.tgBotToken,
    "editMessageText",
    payload,
  );
}

/** Acknowledge a callback_query. Best-effort — errors are logged only. */
export async function answerCallbackQuery(
  clinic: TgClinicMinimal,
  callbackQueryId: string,
  text?: string,
  showAlert?: boolean,
): Promise<void> {
  const payload: Record<string, unknown> = {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    ...(showAlert ? { show_alert: true } : {}),
  };
  if (!clinic.tgBotToken) {
    console.info(`[tg:noop clinic=${clinic.slug}] answerCallbackQuery id=${callbackQueryId}`);
    return;
  }
  try {
    await tgCallWithBackoff<boolean>(
      clinic.tgBotToken,
      "answerCallbackQuery",
      payload,
    );
  } catch (e) {
    console.warn(`[tg] answerCallbackQuery failed: ${(e as Error).message}`);
  }
}

/**
 * Phase 17 Wave 3 — send a document (file upload via multipart/form-data).
 *
 * Used by the DSAR data-export worker to deliver the encrypted ZIP back
 * to the patient's TG chat (or the admin's chat for CRM-initiated
 * exports). All other telegram calls use JSON payloads, but file uploads
 * require multipart — node 20+ has native `FormData` + `Blob`, so no
 * dependency is needed.
 *
 * Network/backoff behaviour mirrors `tgCallWithBackoff` but the body is
 * a multipart payload. We do NOT reuse that helper because it serialises
 * payloads as JSON.
 */
export type SendDocumentOptions = {
  caption?: string;
  parse_mode?: "HTML" | "MarkdownV2";
  filename?: string;
  contentType?: string;
};

export async function sendDocument(
  clinic: TgClinicMinimal,
  chatId: string | number,
  document: Buffer,
  opts: SendDocumentOptions = {},
): Promise<TgMessageResult> {
  const filename = opts.filename ?? "document.bin";
  const contentType = opts.contentType ?? "application/octet-stream";

  if (!clinic.tgBotToken) {
    return logNoop(clinic, "sendDocument", {
      chat_id: chatId,
      filename,
      size: document.length,
      ...(opts.caption ? { caption: opts.caption } : {}),
    });
  }

  const url = `${API_ROOT}/bot${clinic.tgBotToken}/sendDocument`;

  let lastErr: unknown = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    if (opts.caption) form.append("caption", opts.caption);
    if (opts.parse_mode) form.append("parse_mode", opts.parse_mode);
    const blob = new Blob([new Uint8Array(document)], { type: contentType });
    form.append("document", blob, filename);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(PER_ATTEMPT_TIMEOUT_MS * 4), // bigger files
      });
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new Error(
        `Telegram sendDocument network failure after ${MAX_ATTEMPTS} attempts: ${(e as Error).message}`,
      );
    }
    const body = (await resp.json()) as TgApiResponse<TgMessageResult>;
    if (body.ok) return body.result;
    if (body.error_code === 429) {
      const wait = Math.max(1, body.parameters?.retry_after ?? 1);
      await sleep(wait * 1000);
      continue;
    }
    if (body.error_code >= 500 && attempt < MAX_ATTEMPTS - 1) {
      await sleep(backoffMs(attempt));
      continue;
    }
    throw new Error(
      `Telegram sendDocument failed: ${body.error_code} ${body.description}`,
    );
  }
  throw new Error(
    `Telegram sendDocument exhausted retries: ${(lastErr as Error)?.message ?? "unknown"}`,
  );
}

export const __private = { tgCallWithBackoff };
