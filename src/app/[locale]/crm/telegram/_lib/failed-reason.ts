/**
 * Why a staff message did not reach the patient, as chat text. The server
 * stores a short code on `Message.failedReason` (audit TG-04: such messages
 * used to show two ticks while nothing was sent). Unknown or missing codes,
 * as on rows from before the reason was stored, read as a generic failure.
 */
const FAILED_REASONS = new Set([
  "tg_blocked",
  "tg_not_started",
  "no_telegram",
  "tg_error",
  "channel_unavailable",
  "bot_not_connected",
  "not_sent",
]);

/** `t` is `useTranslations("tgInbox")`. */
export function failedReasonText(
  t: (key: string) => string,
  reason: string | null | undefined,
): string {
  return FAILED_REASONS.has(reason ?? "")
    ? t(`message.failed.${reason}`)
    : t("message.failed.unknown");
}
