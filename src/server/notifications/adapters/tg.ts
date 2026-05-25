/**
 * Telegram adapter interface.
 *
 * Real implementation comes from `telegram-bot-developer` (Phase 3b/3d)
 * and hits `https://api.telegram.org/bot{token}/sendMessage`.
 *
 * Stage 2.D — added optional `replyMarkup` so the notifications-send worker
 * can attach an inline confirm keyboard to T-1d / T-2h reminders. The
 * payload shape mirrors Telegram's `reply_markup` schema (`{ inline_keyboard:
 * [[ { text, callback_data } ]] }`), letting the future Stage 3.G webhook
 * route `callback_data="confirm:<appointmentId>"` back through
 * `confirmAppointment({ via: 'TG_BUTTON' })`.
 */

export type TgInlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export type TgReplyMarkupPayload = {
  inline_keyboard: TgInlineKeyboardButton[][];
};

export type TgSendOptions = {
  replyMarkup?: TgReplyMarkupPayload;
};

export type TgSendResult = {
  messageId: number;
};

export interface TgAdapter {
  readonly name: "log-only" | "telegram" | string;
  send(
    chatId: string,
    body: string,
    options?: TgSendOptions,
  ): Promise<TgSendResult>;
}
