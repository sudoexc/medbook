/**
 * Telegram adapter interface.
 *
 * Real implementation comes from `telegram-bot-developer` (Phase 3b/3d)
 * and hits `https://api.telegram.org/bot{token}/sendMessage`.
 */

export type TgSendResult = {
  messageId: number;
};

export interface TgAdapter {
  readonly name: "log-only" | "telegram" | string;
  send(chatId: string, body: string): Promise<TgSendResult>;
}
