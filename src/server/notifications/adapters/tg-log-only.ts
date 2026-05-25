/**
 * LogOnly Telegram adapter — no external call.
 * Produces a fake `message_id` so downstream metrics work.
 */
import type { TgAdapter, TgSendOptions, TgSendResult } from "./tg";

export class LogOnlyTgAdapter implements TgAdapter {
  readonly name = "log-only";

  async send(
    chatId: string,
    body: string,
    options?: TgSendOptions,
  ): Promise<TgSendResult> {
    const messageId = Math.floor(Math.random() * 1_000_000);
    const kbSummary = options?.replyMarkup
      ? ` kb=${JSON.stringify(options.replyMarkup).slice(0, 80)}`
      : "";
    console.info(
      `[tg:log-only] chatId=${chatId} body=${body.slice(0, 80)}${body.length > 80 ? "..." : ""}${kbSummary} msgId=${messageId}`,
    );
    return { messageId };
  }
}
