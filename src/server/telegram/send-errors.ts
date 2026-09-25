/**
 * Reading a failed Telegram send.
 *
 * `send.ts` throws `Telegram <method> failed: <code> <description>` for a
 * hard error. Callers need two answers from that text: is the patient gone
 * for good (blocked the bot, deleted the account, the chat does not exist),
 * and what short reason to store so staff see why a message did not arrive.
 */

/** A staff message's `Message.failedReason` code for a Telegram failure. */
export type TgFailReason = "tg_blocked" | "tg_not_started" | "tg_error";

/**
 * Telegram hard-fail errors that mean the patient can no longer receive the
 * bot's messages: they blocked it, deleted their account, or the chat is gone.
 */
export function isTgBlockedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("bot was blocked") ||
    m.includes("user is deactivated") ||
    m.includes("chat not found")
  );
}

export function tgFailReason(message: string): TgFailReason {
  if (isTgBlockedError(message)) return "tg_blocked";
  // The patient opened the Mini App but never pressed Start in the bot chat:
  // a bot may not write first.
  if (message.toLowerCase().includes("bot can't initiate conversation")) {
    return "tg_not_started";
  }
  return "tg_error";
}
