/**
 * Words the workers put in front of a patient themselves, outside any
 * template: the «✅ Подтверждаю» button, the Mini App buttons, the family
 * relay line, the DSAR archive messages (audit INF-11). They were Russian
 * literals in the worker code, so a patient who reads Uzbek got a button
 * they could not read and the visit stayed unconfirmed. They live in the
 * message files (`notifications.patientMessages`) like every other UI string
 * and are picked by the patient's `preferredLang`.
 */
import { createTranslator } from "next-intl";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

export type PatientLang = "ru" | "uz";

/** `Patient.preferredLang` (RU / UZ, or nothing) → the message-file locale. */
export function patientLocale(lang: string | null | undefined): PatientLang {
  return lang === "UZ" || lang === "uz" ? "uz" : "ru";
}

export function patientTexts(lang: string | null | undefined) {
  const locale = patientLocale(lang);
  return createTranslator({
    locale,
    messages: locale === "uz" ? uz : ru,
    namespace: "notifications.patientMessages",
  });
}
