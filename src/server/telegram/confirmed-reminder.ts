/**
 * The reminder a patient confirmed with its «✅ Подтверждаю» button (audit
 * TG-34).
 *
 * The webhook replaced the whole message with «✅ Подтверждено · спасибо!»
 * to drop the keyboard, and the patient lost the date, the time and the
 * doctor he had just confirmed: the next day he called the desk to ask. The
 * text now stays as it was, with the confirmation added under it in the
 * language of the button he tapped. Formatting is kept by sending the
 * message's own entities back: appending leaves their offsets valid.
 */
import { patientTexts, type PatientLang } from "@/server/notifications/patient-texts";

type TgButton = { text?: string; callback_data?: string };

export type ConfirmedMessage = {
  text?: string;
  entities?: unknown[];
  reply_markup?: { inline_keyboard?: TgButton[][] };
};

/** Telegram's limit on a message text. */
const TG_TEXT_LIMIT = 4096;

/**
 * The reader's language, read off the confirm button he tapped: the worker
 * wrote it in his language (a relayed reminder in the family owner's).
 */
export function confirmButtonLang(
  message: ConfirmedMessage | undefined,
  fallback: PatientLang,
): PatientLang {
  const button = message?.reply_markup?.inline_keyboard
    ?.flat()
    .find((b) => b?.callback_data?.startsWith("confirm:"));
  if (button?.text === patientTexts("uz")("confirmButton")) return "uz";
  if (button?.text === patientTexts("ru")("confirmButton")) return "ru";
  return fallback;
}

/**
 * The confirmed reminder's new text: the original with the mark under it.
 * Null when there is no text to keep (a caption), the mark is already there
 * (a second tap) or the result would be over Telegram's limit; the caller
 * then only drops the keyboard.
 */
export function confirmedReminderEdit(
  message: ConfirmedMessage | undefined,
  lang: PatientLang,
): { text: string; entities?: unknown[] } | null {
  const text = message?.text;
  if (!text) return null;
  const mark = patientTexts(lang)("confirmedMark");
  if (text.trimEnd().endsWith(mark)) return null;
  const next = `${text}\n\n${mark}`;
  if (next.length > TG_TEXT_LIMIT) return null;
  return message?.entities && message.entities.length > 0
    ? { text: next, entities: message.entities }
    : { text: next };
}
