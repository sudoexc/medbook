/**
 * Tell the patient that the doctor corrected his signed conclusion
 * (audit G3-03).
 *
 * An amendment used to reach the patient only inside the re-rendered PDF in
 * «Документы»: nobody told him, and the visit screen he actually reads kept
 * the old dose. The Mini App screen now shows the correction (visit-summary
 * + the `visit-note.amended` event); this queues the message that sends him
 * there: Telegram when the card has a Telegram account, and the Mini App
 * inbox either way.
 *
 * A correction of a medical document the patient holds is part of the
 * service he received, so it is transactional: only a deleted card is
 * skipped, never a marketing opt-out. Best-effort: a failure here must not
 * undo the amendment, so the caller swallows it.
 */
import { createTranslator } from "next-intl";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { formatDate } from "@/lib/format";
import { isAllowedToReceive } from "@/server/notifications/consent-gate";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

function firstNameOf(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  // Cards are «Фамилия Имя Отчество»; a single word is the name itself.
  return (parts.length >= 2 ? parts[1] : parts[0]) ?? "";
}

/** The message text in the patient's language. Pure, for the tests. */
export function amendmentNoticeText(args: {
  locale: "ru" | "uz";
  patientName: string;
  doctorName: string | null;
  visitDate: Date;
}): string {
  const t = createTranslator({
    locale: args.locale,
    messages: args.locale === "uz" ? uz : ru,
    namespace: "doctor.conclusions.amendments",
  });
  return t("patientNotice", {
    name: firstNameOf(args.patientName),
    doctor: args.doctorName ?? "",
    date: formatDate(args.visitDate, args.locale, "short"),
  });
}

export async function queueAmendmentNotice(args: {
  clinicId: string;
  visitNoteId: string;
}): Promise<{ queued: number }> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const note = await prisma.visitNote.findFirst({
      where: { id: args.visitNoteId, clinicId: args.clinicId },
      select: {
        appointmentId: true,
        finalizedAt: true,
        patient: {
          select: {
            id: true,
            fullName: true,
            telegramId: true,
            preferredLang: true,
            marketingOptOut: true,
            deletedAt: true,
          },
        },
        doctor: { select: { nameRu: true, nameUz: true } },
        appointment: { select: { date: true } },
      },
    });
    if (!note) return { queued: 0 };
    if (!isAllowedToReceive(note.patient, "transactional").allowed) {
      return { queued: 0 };
    }
    const locale = note.patient.preferredLang === "UZ" ? "uz" : "ru";
    const body = amendmentNoticeText({
      locale,
      patientName: note.patient.fullName,
      doctorName: note.doctor
        ? locale === "uz"
          ? note.doctor.nameUz
          : note.doctor.nameRu
        : null,
      visitDate: note.appointment?.date ?? note.finalizedAt ?? new Date(),
    });
    const base = {
      clinicId: args.clinicId,
      patientId: note.patient.id,
      appointmentId: note.appointmentId,
      body,
      scheduledFor: new Date(),
      status: "QUEUED" as const,
    };
    const rows = [
      // The inbox banner in the Mini App.
      { ...base, channel: "INAPP" as const, recipient: note.patient.id },
      ...(note.patient.telegramId
        ? [{ ...base, channel: "TG" as const, recipient: note.patient.telegramId }]
        : []),
    ];
    await prisma.notificationSend.createMany({ data: rows });
    return { queued: rows.length };
  });
}
