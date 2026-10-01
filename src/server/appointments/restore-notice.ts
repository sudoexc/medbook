/**
 * «Ваша запись восстановлена» (audit AP-11).
 *
 * When the doctor undoes a cancellation or a no-show, the patient has been
 * told the opposite (the cancellation or no-show message) and his queued
 * reminders were cancelled. The visit came back without a word, and he did
 * not come. This is the clinic's message for it, sent through the clinic's
 * notification template like every other patient message
 * (`onAppointmentRestored` in triggers.ts).
 *
 * Patient Telegram messages are switched on one at a time, by the clinic, so
 * the row is created switched OFF, like the amendment notice (G3-03): the
 * admin finds it in /crm/settings/notifications and turns it on. The default
 * text is the next-intl message with the template's placeholders in place of
 * the values, so it stays editable like the others.
 *
 * Imports nothing from triggers.ts: triggers.ts imports this. Nor next-intl:
 * triggers.ts runs in the worker process too, and the messages here are
 * plain `{name}` strings, so the placeholders are swapped by hand.
 */
import type { DefaultTemplate } from "@/server/notifications/default-templates";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

export const APPOINTMENT_RESTORED_KEY = "appointment.restored";

function messages(locale: "ru" | "uz") {
  return (locale === "uz" ? uz : ru).doctor.myDay.restoreNotice;
}

/** Message argument → the template placeholder the renderer fills. */
const PLACEHOLDERS: Record<string, string> = {
  name: "{{patient.firstName}}",
  date: "{{appointment.date}}",
  time: "{{appointment.time}}",
  doctor: "{{appointment.doctor}}",
};

function noticeBody(locale: "ru" | "uz"): string {
  return messages(locale).patient.replace(
    /\{(\w+)\}/g,
    (whole, arg: string) => PLACEHOLDERS[arg] ?? whole,
  );
}

/** The clinic's default row for this message. Pure, for the tests. */
export function restoreNoticeTemplate(): DefaultTemplate {
  return {
    key: APPOINTMENT_RESTORED_KEY,
    nameRu: messages("ru").templateName,
    nameUz: messages("uz").templateName,
    channel: "TG",
    category: "TRANSACTIONAL",
    bodyRu: noticeBody("ru"),
    bodyUz: noticeBody("uz"),
    // Fired from code, not by a schedule: no offset, so the send worker's
    // cascade checks never apply to it.
    trigger: "MANUAL",
    triggerConfig: null,
    variables: [
      "patient.firstName",
      "appointment.date",
      "appointment.time",
      "appointment.doctor",
    ],
  };
}
