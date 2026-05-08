/**
 * Phase 17 Wave 1 — SMS STOP keyword detector.
 *
 * Recognised opt-out keywords (case-insensitive, whitespace-trimmed):
 *   - STOP            (English / international)
 *   - СТОП            (Russian)
 *   - TO'XTAT         (Uzbek STOP — apostrophe + Uzbek)
 *   - TOXTAT          (Latin variant without apostrophe)
 *   - T0XTAT          (Common typo — zero instead of "O")
 *   - ОТПИСАТЬСЯ      (Russian "unsubscribe")
 *
 * Match policy: the message body MUST consist of the keyword alone (after
 * trimming). "stop the spam" → false; "  STOP  " → true. Loose matching
 * would risk silently muting legitimate inbound messages.
 *
 * Pure helper. The webhook calls this before doing patient-by-phone lookup
 * + flag flip.
 */

const KEYWORDS = new Set<string>([
  "STOP",
  "СТОП",
  "TO'XTAT",
  "TOXTAT",
  "T0XTAT",
  "ОТПИСАТЬСЯ",
]);

export function isStopKeyword(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  return KEYWORDS.has(trimmed.toUpperCase());
}

/** Pre-rendered confirmation reply per supported language. */
export const STOP_REPLY_RU =
  "Вы отписались от маркетинговых сообщений. Транзакционные напоминания о визитах продолжат приходить.";
export const STOP_REPLY_UZ =
  "Siz marketing xabarlardan obunani bekor qildingiz. Tashriflar haqidagi tranzaksion eslatmalar kelishda davom etadi.";

export function stopReply(lang: "RU" | "UZ" | null | undefined): string {
  return lang === "UZ" ? STOP_REPLY_UZ : STOP_REPLY_RU;
}
