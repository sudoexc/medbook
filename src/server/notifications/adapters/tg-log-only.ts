/**
 * LogOnly Telegram adapter: the clinic has no bot token, so no external call.
 *
 * Outside production it logs and returns a made-up `message_id`, which keeps
 * dev and test stacks running end to end. In production that made-up id got
 * the send recorded as delivered while nobody received anything (audit
 * ST-02: a token cleared in the settings silenced the bot and every reminder
 * still read «отправлено»). There it refuses instead, and the send worker
 * files the row as FAILED with this reason.
 */
import type { TgAdapter, TgSendOptions, TgSendResult } from "./tg";

/** `NotificationSend.failedReason` when the clinic has no bot connected. */
export const TG_BOT_NOT_CONNECTED = "Telegram bot is not connected";

export class LogOnlyTgAdapter implements TgAdapter {
  readonly name = "log-only";

  async send(
    chatId: string,
    body: string,
    options?: TgSendOptions,
  ): Promise<TgSendResult> {
    if (process.env.NODE_ENV === "production") {
      throw new Error(TG_BOT_NOT_CONNECTED);
    }
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
