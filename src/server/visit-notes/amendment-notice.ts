/**
 * Tell the patient that the doctor corrected his signed conclusion
 * (audit G3-03).
 *
 * An amendment used to reach the patient only inside the re-rendered PDF in
 * «Документы»: nobody told him, and the visit screen he actually reads kept
 * the old dose. The Mini App screen now shows the correction (visit-summary
 * + the `visit-note.amended` event) whatever the clinic chooses here; this
 * queues the message that sends him there.
 *
 * The message goes through the clinic's notification template
 * `visit-note.amended`, like every other patient message, so the admin
 * switches it on or off in /crm/settings/notifications. Patient Telegram
 * messages are switched on one at a time, so the row is created switched
 * OFF: an amendment the doctor adds sends nothing until the clinic turns
 * the message on. The default text is the next-intl message, rendered with
 * the template's placeholders, so it stays editable like the others.
 *
 * A correction of a medical document the patient holds is part of the
 * service he received, so it is transactional: only a deleted card is
 * skipped, never a marketing opt-out. Best-effort: a failure here must not
 * undo the amendment, so the caller swallows it.
 */
import { createTranslator } from "next-intl";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { isAllowedToReceive } from "@/server/notifications/consent-gate";
import {
  type DefaultTemplate,
  VISIT_NOTE_AMENDED_KEY,
} from "@/server/notifications/default-templates";
import {
  ensureClinicTemplate,
  onVisitNoteAmended,
  type VisitNoteAmendedResult,
} from "@/server/notifications/triggers";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

function translator(locale: "ru" | "uz") {
  return createTranslator({
    locale,
    messages: locale === "uz" ? uz : ru,
    namespace: "doctor.conclusions.amendments",
  });
}

/** The message text with the template's placeholders in place of the values. */
function noticeBody(locale: "ru" | "uz"): string {
  return translator(locale)("patientNotice", {
    name: "{{patient.firstName}}",
    doctor: "{{appointment.doctor}}",
    date: "{{appointment.date}}",
  });
}

/** The clinic's default row for this message. Pure, for the tests. */
export function amendmentNoticeTemplate(): DefaultTemplate {
  return {
    key: VISIT_NOTE_AMENDED_KEY,
    nameRu: translator("ru")("patientNoticeTemplateName"),
    nameUz: translator("uz")("patientNoticeTemplateName"),
    channel: "TG",
    category: "TRANSACTIONAL",
    bodyRu: noticeBody("ru"),
    bodyUz: noticeBody("uz"),
    // Fired from code, not by a schedule: no offset, so the send worker's
    // cascade checks never apply to it.
    trigger: "MANUAL",
    triggerConfig: null,
    variables: ["patient.firstName", "appointment.doctor", "appointment.date"],
  };
}

/**
 * Creates the clinic's row, switched off, when it has none yet, so the
 * message shows up in the settings for the admin to turn on. Never touches
 * an existing row (the admin's text and switch stay).
 */
export function ensureAmendmentNoticeTemplate(clinicId: string) {
  return ensureClinicTemplate(clinicId, amendmentNoticeTemplate(), {
    activeOnCreate: false,
  });
}

export async function queueAmendmentNotice(args: {
  clinicId: string;
  visitNoteId: string;
}): Promise<VisitNoteAmendedResult> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const note = await prisma.visitNote.findFirst({
      where: { id: args.visitNoteId, clinicId: args.clinicId },
      select: {
        appointmentId: true,
        patient: { select: { marketingOptOut: true, deletedAt: true } },
      },
    });
    if (!note) return { queued: 0 };
    await ensureAmendmentNoticeTemplate(args.clinicId);
    if (!isAllowedToReceive(note.patient, "transactional").allowed) {
      return { queued: 0 };
    }
    return onVisitNoteAmended(note.appointmentId);
  });
}
