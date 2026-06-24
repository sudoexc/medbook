/**
 * Escape user-supplied text for Telegram HTML `parse_mode`.
 *
 * Outbound Telegram I/O lives in the per-clinic client at
 * `@/server/telegram/send` — there is no global bot token here.
 */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
