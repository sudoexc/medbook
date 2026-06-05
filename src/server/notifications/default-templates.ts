/**
 * TZ-notifications-cancel-sync §4 + §7.3 — canonical default templates for
 * the day-of reminder cascade + cancel / running-late / no-show triggers.
 *
 * The clinic admin can edit any of these in /crm/notifications post-seed;
 * this file is the source-of-truth for "what a freshly-onboarded clinic
 * starts with" so behaviour is identical across deployments.
 *
 * Template `key` is the canonical slug — also matches the legacy
 * `whereForTrigger` slug-fallback in triggers.ts, so a seed row resolves
 * via either the enum + triggerConfig path OR the slug path. This means
 * an admin who renames a row's `key` but keeps the enum still gets fires.
 *
 * Channels: TG is preferred — patients on the mini-app carry a telegramId
 * and almost all texts hit TG. SMS fallback happens implicitly when a row
 * is materialised with channel=SMS for non-TG patients (rules.ts path).
 * For per-trigger consistency we default every row to TG; the rules layer
 * downgrades to SMS automatically.
 */

import type {
  CommunicationChannel,
  NotificationTrigger,
  TemplateCategory,
} from "@/generated/prisma/client";

export type DefaultTemplate = {
  key: string;
  nameRu: string;
  nameUz: string;
  channel: CommunicationChannel;
  category: TemplateCategory;
  bodyRu: string;
  bodyUz: string;
  trigger: NotificationTrigger;
  /** Discriminator JSON. `null` for triggers that have a 1:1 enum mapping. */
  triggerConfig: Record<string, unknown> | null;
  variables: string[];
};

const COMMON_VARS = [
  "patient.firstName",
  "appointment.date",
  "appointment.time",
  "appointment.doctor",
  "clinic.name",
  "clinic.phone",
];

export const DEFAULT_APPOINTMENT_TEMPLATES: DefaultTemplate[] = [
  // ── Reminder cascade (24h / 5h / 3h / 1h) ─────────────────────────────
  {
    key: "appointment.reminder-24h",
    nameRu: "Напоминание за 24 часа",
    nameUz: "24 soat oldin eslatma",
    channel: "TG",
    category: "REMINDER",
    bodyRu:
      "{{patient.firstName}}, напоминаем: завтра в {{appointment.time}} вы записаны к {{appointment.doctor}} в {{clinic.name}}. Если планы изменились — отмените через приложение или позвоните {{clinic.phone}}.",
    bodyUz:
      "{{patient.firstName}}, eslatamiz: ertaga soat {{appointment.time}} da {{appointment.doctor}} qabuliga yozilgansiz ({{clinic.name}}). Rejalar o'zgargan bo'lsa — ilovadan bekor qiling yoki {{clinic.phone}} ga qo'ng'iroq qiling.",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -1440 },
    variables: COMMON_VARS,
  },
  {
    key: "appointment.reminder-5h",
    nameRu: "Напоминание за 5 часов",
    nameUz: "5 soat oldin eslatma",
    channel: "TG",
    category: "REMINDER",
    bodyRu:
      "{{patient.firstName}}, через 5 часов в {{appointment.time}} — ваш приём у {{appointment.doctor}}. До встречи.",
    bodyUz:
      "{{patient.firstName}}, 5 soatdan keyin soat {{appointment.time}} da — {{appointment.doctor}} bilan qabulingiz. Ko'rishguncha.",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -300 },
    variables: COMMON_VARS,
  },
  {
    key: "appointment.reminder-3h",
    nameRu: "Напоминание за 3 часа",
    nameUz: "3 soat oldin eslatma",
    channel: "TG",
    category: "REMINDER",
    bodyRu:
      "{{patient.firstName}}, через 3 часа в {{appointment.time}} ждём вас у {{appointment.doctor}}. Если что-то изменилось — отмените в приложении.",
    bodyUz:
      "{{patient.firstName}}, 3 soatdan keyin {{appointment.time}} da {{appointment.doctor}} sizni kutmoqda. Reja o'zgarsa — ilovadan bekor qiling.",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -180 },
    variables: COMMON_VARS,
  },
  {
    key: "appointment.reminder-1h",
    nameRu: "Напоминание за 1 час",
    nameUz: "1 soat oldin eslatma",
    channel: "TG",
    category: "REMINDER",
    bodyRu:
      "{{patient.firstName}}, через час в {{appointment.time}} — ваш приём у {{appointment.doctor}}. Выходите заранее.",
    bodyUz:
      "{{patient.firstName}}, bir soatdan keyin {{appointment.time}} da — {{appointment.doctor}} bilan qabulingiz. Oldindan yo'lga chiqing.",
    trigger: "APPOINTMENT_BEFORE",
    triggerConfig: { offsetMin: -60 },
    variables: COMMON_VARS,
  },

  // ── Cancellation — surface-aware variants ─────────────────────────────
  {
    key: "appointment.cancelled.by-staff",
    nameRu: "Отмена приёма (со стороны клиники)",
    nameUz: "Qabul bekor qilindi (klinika tomonidan)",
    channel: "TG",
    category: "TRANSACTIONAL",
    bodyRu:
      "{{patient.firstName}}, ваш приём {{appointment.date}} в {{appointment.time}} к {{appointment.doctor}} отменён. Извините за неудобство. Перезаписаться можно в приложении или по телефону {{clinic.phone}}.",
    bodyUz:
      "{{patient.firstName}}, {{appointment.date}} kuni {{appointment.time}} dagi {{appointment.doctor}} bilan qabulingiz bekor qilindi. Noqulaylik uchun uzr. Qayta yozilish — ilovadan yoki {{clinic.phone}}.",
    trigger: "APPOINTMENT_CANCELLED",
    triggerConfig: { audience: "staff" },
    variables: COMMON_VARS,
  },
  {
    key: "appointment.cancelled.by-patient",
    nameRu: "Отмена приёма (пациентом)",
    nameUz: "Qabul bekor qilindi (bemor tomonidan)",
    channel: "TG",
    category: "TRANSACTIONAL",
    bodyRu:
      "Приём {{appointment.date}} в {{appointment.time}} отменён. Если передумаете — мы рядом, перезаписаться можно в любое время.",
    bodyUz:
      "{{appointment.date}} kuni {{appointment.time}} dagi qabul bekor qilindi. Fikringizni o'zgartirsangiz — biz yondamiz, istalgan vaqt qayta yozilishingiz mumkin.",
    trigger: "APPOINTMENT_CANCELLED",
    triggerConfig: { audience: "patient" },
    variables: COMMON_VARS,
  },

  // ── Running late ──────────────────────────────────────────────────────
  {
    key: "appointment.running-late",
    nameRu: "Пациент опаздывает",
    nameUz: "Bemor kechikmoqda",
    channel: "TG",
    category: "TRANSACTIONAL",
    bodyRu:
      "{{patient.firstName}}, вас ждут в {{clinic.name}} — приём был назначен на {{appointment.time}} к {{appointment.doctor}}. Если опаздываете, позвоните {{clinic.phone}}, постараемся сохранить слот.",
    bodyUz:
      "{{patient.firstName}}, {{clinic.name}} da kutishyapti — qabul {{appointment.time}} ga {{appointment.doctor}} ga belgilangan edi. Kechiksangiz, {{clinic.phone}} ga qo'ng'iroq qiling, slotni saqlashga harakat qilamiz.",
    trigger: "APPOINTMENT_RUNNING_LATE",
    triggerConfig: null,
    variables: COMMON_VARS,
  },

  // ── No-show ───────────────────────────────────────────────────────────
  {
    key: "appointment.no-show",
    nameRu: "Пропуск приёма",
    nameUz: "Qabul o'tkazib yuborildi",
    channel: "TG",
    category: "TRANSACTIONAL",
    bodyRu:
      "{{patient.firstName}}, жаль, что приём {{appointment.date}} не состоялся. Хотите перенести? Подберём удобное время — откройте приложение или позвоните {{clinic.phone}}.",
    bodyUz:
      "{{patient.firstName}}, {{appointment.date}} dagi qabul bo'lib o'tmagani uchun afsus. Boshqa vaqtga ko'chiramizmi? Qulay vaqtni tanlaymiz — ilovani oching yoki {{clinic.phone}} ga qo'ng'iroq qiling.",
    trigger: "APPOINTMENT_MISSED",
    triggerConfig: null,
    variables: COMMON_VARS,
  },
];

/** Idempotent upsert array shaped for `prisma.notificationTemplate.create`. */
export function defaultAppointmentTemplatesForClinic(
  clinicId: string,
): Array<DefaultTemplate & { clinicId: string }> {
  return DEFAULT_APPOINTMENT_TEMPLATES.map((t) => ({ ...t, clinicId }));
}
