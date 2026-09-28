/**
 * A notification template a person inserts into a Telegram chat (audit
 * G6-04).
 *
 * The composer's «Шаблоны» button lists the clinic's notification templates
 * (reminders, cancellations...). It used to paste `bodyRu`/`bodyUz` as is,
 * and the chat send has no render step, so the patient got «{{patient.
 * firstName}}, напоминаем: завтра в {{appointment.time}}...», in the
 * operator's interface language rather than his own.
 *
 * Here the template is filled on the server from real data: the thread's
 * patient card, the visit the template is about, the clinic. The text is in
 * the patient's language (`Patient.preferredLang`; a blank Uzbek text falls
 * back to Russian, as the automated reminders do). Nothing is guessed: a
 * placeholder with no data refuses the whole template with a reason the
 * operator can act on, rather than a sentence with a hole or with braces.
 */
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { UPCOMING_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import { tashkentDateOf, tashkentDayWindow } from "@/lib/tashkent-time";
import {
  extractPlaceholders,
  renderPlainWithReport,
} from "@/server/notifications/template";

export type TemplateFillRefusal =
  /** The template names the patient or his visit; the thread has no card. */
  | "no_patient"
  /** The template names a visit; the patient has no visit of that kind. */
  | "no_appointment"
  /** Some other placeholder has no data (no clinic phone, a payment sum...). */
  | "unresolved";

export type TemplateFillResult =
  | { ok: true; body: string; lang: "ru" | "uz" }
  | { ok: false; reason: TemplateFillRefusal; fields: string[] };

export type FillPatient = {
  fullName: string;
  phone: string;
  preferredLang: string | null;
};

export type FillAppointment = {
  date: Date;
  time: string | null;
  doctor: { nameRu: string; nameUz: string };
  primaryService: { nameRu: string; nameUz: string } | null;
  cabinet: { number: string } | null;
};

export type FillClinic = {
  nameRu: string;
  nameUz: string;
  phone: string | null;
  addressRu: string | null;
  addressUz: string | null;
};

type VisitPick = "upcoming" | "CANCELLED" | "NO_SHOW" | "COMPLETED";

/**
 * Which of the patient's visits a template talks about. A cancellation or a
 * no-show text must quote THAT visit: filling it with the next booking
 * would tell the patient his upcoming visit was cancelled.
 */
export function visitPickFor(trigger: string): VisitPick {
  switch (trigger) {
    case "APPOINTMENT_CANCELLED":
      return "CANCELLED";
    case "APPOINTMENT_MISSED":
      return "NO_SHOW";
    case "APPOINTMENT_COMPLETED":
      return "COMPLETED";
    default:
      return "upcoming";
  }
}

/**
 * The given name in the clinic's «Фамилия Имя Отчество» order: the second
 * word, or the only one. Same reading as the composer's quick replies and
 * the broadcasts, so a chat never greets a patient by his surname.
 */
export function givenNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return parts[1] ?? parts[0] ?? "";
}

export function fillTemplate(input: {
  template: { bodyRu: string; bodyUz: string };
  patient: FillPatient | null;
  appointment: FillAppointment | null;
  clinic: FillClinic;
  /** The operator's language, used only when the thread has no card. */
  fallbackLang: "ru" | "uz";
}): TemplateFillResult {
  const { template, patient, appointment, clinic } = input;
  const wanted = patient
    ? patient.preferredLang === "UZ"
      ? "uz"
      : "ru"
    : input.fallbackLang;
  const lang = wanted === "uz" && template.bodyUz.trim() !== "" ? "uz" : "ru";
  const pick = <T,>(ru: T, uz: T): T => (lang === "uz" ? uz : ru);

  const context = {
    ...(patient
      ? {
          patient: {
            name: patient.fullName,
            firstName: givenNameOf(patient.fullName),
            phone: patient.phone,
          },
        }
      : {}),
    ...(appointment
      ? {
          appointment: {
            date: formatDate(appointment.date, lang, "long"),
            time: appointment.time ?? formatDate(appointment.date, lang, "time"),
            doctor: pick(appointment.doctor.nameRu, appointment.doctor.nameUz),
            service: appointment.primaryService
              ? pick(
                  appointment.primaryService.nameRu,
                  appointment.primaryService.nameUz,
                )
              : "",
            cabinet: appointment.cabinet?.number ?? "",
          },
        }
      : {}),
    clinic: {
      name: pick(clinic.nameRu, clinic.nameUz),
      phone: clinic.phone ?? "",
      address: pick(clinic.addressRu, clinic.addressUz ?? clinic.addressRu) ?? "",
    },
  };

  const { output, unresolved } = renderPlainWithReport(
    pick(template.bodyRu, template.bodyUz),
    context,
  );
  if (unresolved.length === 0) return { ok: true, body: output, lang };

  const aboutPatient = unresolved.some(
    (k) => k.startsWith("patient.") || k.startsWith("appointment."),
  );
  if (!patient && aboutPatient) {
    return { ok: false, reason: "no_patient", fields: unresolved };
  }
  if (!appointment && unresolved.some((k) => k.startsWith("appointment."))) {
    return { ok: false, reason: "no_appointment", fields: unresolved };
  }
  return { ok: false, reason: "unresolved", fields: unresolved };
}

const APPOINTMENT_FILL_SELECT = {
  date: true,
  time: true,
  doctor: { select: { nameRu: true, nameUz: true } },
  primaryService: { select: { nameRu: true, nameUz: true } },
  cabinet: { select: { number: true } },
} as const;

async function loadVisit(
  clinicId: string,
  patientId: string,
  kind: VisitPick,
  now: Date,
): Promise<FillAppointment | null> {
  if (kind === "upcoming") {
    // From the start of the clinic's day: a patient due at 09:00 who is
    // still in the waiting room at 10:00 is today's visit, not a past one.
    const { from } = tashkentDayWindow(tashkentDateOf(now));
    return prisma.appointment.findFirst({
      where: {
        clinicId,
        patientId,
        status: { in: [...UPCOMING_VISIT_STATUSES] },
        date: { gte: from },
      },
      orderBy: { date: "asc" },
      select: APPOINTMENT_FILL_SELECT,
    });
  }
  return prisma.appointment.findFirst({
    where: { clinicId, patientId, status: kind },
    orderBy: { date: "desc" },
    select: APPOINTMENT_FILL_SELECT,
  });
}

/**
 * Fill a clinic template for one thread. Null when the thread or the
 * template is not this clinic's.
 */
export async function fillTemplateForConversation(input: {
  clinicId: string;
  conversationId: string;
  templateId: string;
  fallbackLang: "ru" | "uz";
  now?: Date;
}): Promise<TemplateFillResult | null> {
  const { clinicId } = input;
  const conv = await prisma.conversation.findFirst({
    where: { id: input.conversationId, clinicId },
    select: { patientId: true },
  });
  if (!conv) return null;
  const template = await prisma.notificationTemplate.findFirst({
    where: { id: input.templateId, clinicId },
    select: { bodyRu: true, bodyUz: true, trigger: true },
  });
  if (!template) return null;
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      nameRu: true,
      nameUz: true,
      phone: true,
      addressRu: true,
      addressUz: true,
    },
  });
  if (!clinic) return null;

  const patient = conv.patientId
    ? await prisma.patient.findFirst({
        where: { id: conv.patientId, clinicId, deletedAt: null },
        select: { id: true, fullName: true, phone: true, preferredLang: true },
      })
    : null;
  const namesVisit = [template.bodyRu, template.bodyUz].some((b) =>
    extractPlaceholders(b).some((k) => k.startsWith("appointment.")),
  );
  const appointment =
    patient && namesVisit
      ? await loadVisit(
          clinicId,
          patient.id,
          visitPickFor(template.trigger),
          input.now ?? new Date(),
        )
      : null;

  return fillTemplate({
    template,
    patient,
    appointment,
    clinic,
    fallbackLang: input.fallbackLang,
  });
}
