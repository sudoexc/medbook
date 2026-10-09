/**
 * The ticket slip for the network receipt printer (owner request
 * 09.10.2026): the same content as the browser stub (`/ticket/<id>`, see
 * src/app/ticket/[id]/page.tsx), written as ESC/POS so a print agent sends
 * it straight to the printer with no dialog.
 */
import { createTranslator } from "next-intl";

import { prisma } from "@/lib/prisma";
import { runUnscoped } from "@/lib/tenant-context";
import { formatClinicDateTime, formatDate, formatPhone, initials, type Locale } from "@/lib/format";
import { isLiveLane } from "@/lib/queue-ordering";
import { getQueueProjection } from "@/server/appointments/queue-projection";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { mintOrReuseInviteUrl } from "@/server/telegram/invite-token";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

import { EscPos, LINE_WIDTH, wrap } from "./escpos";

export type TicketSlip = {
  locale: Locale;
  clinicName: string;
  clinicAddress: string;
  clinicPhone: string;
  ticketNumber: string | null;
  slotTime: string;
  patient: string;
  doctorName: string;
  cabinet: string | null;
  serviceName: string;
  issuedAt: string;
  waitingAhead: number | null;
  botUrl: string | null;
};

/** What the slip of one of the clinic's appointments says, or null. */
export async function loadTicketSlip(
  appointmentId: string,
  clinicId: string,
): Promise<TicketSlip | null> {
  const appointment = await runUnscoped("print agent: ticket slip for the clinic's appointment", () =>
    prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId },
      select: {
        queueOrder: true,
        ticketSeq: true,
        clinicId: true,
        date: true,
        time: true,
        channel: true,
        doctorId: true,
        patientId: true,
        patient: { select: { fullName: true, preferredLang: true } },
        doctor: {
          select: { nameRu: true, nameUz: true, ticketPrefix: true, cabinet: { select: { number: true } } },
        },
        primaryService: { select: { nameRu: true, nameUz: true } },
        clinic: {
          select: {
            nameRu: true,
            nameUz: true,
            phone: true,
            addressRu: true,
            addressUz: true,
            tgBotUsername: true,
          },
        },
      },
    }),
  );
  if (!appointment) return null;

  const locale: Locale = appointment.patient.preferredLang === "UZ" ? "uz" : "ru";
  const pick = (ruText: string | null, uzText: string | null) =>
    (locale === "uz" ? uzText?.trim() || ruText : ruText?.trim() || uzText) ?? "";

  let waitingAhead: number | null = null;
  if (isLiveLane(appointment)) {
    const projection = await runUnscoped("print agent: queue projection for the slip", () =>
      getQueueProjection({ clinicId: appointment.clinicId, doctorIds: [appointment.doctorId] }),
    );
    const mine = projection.get(appointment.doctorId)?.waiting.find((w) => w.appointmentId === appointmentId);
    waitingAhead = mine ? mine.position - 1 : 0;
  }

  const bot = appointment.clinic.tgBotUsername;
  const invite = bot
    ? await runUnscoped("print agent: Telegram invite for the slip", () =>
        mintOrReuseInviteUrl({ patientId: appointment.patientId, createdByUserId: null }),
      ).catch(() => null)
    : null;

  return {
    locale,
    clinicName: pick(appointment.clinic.nameRu, appointment.clinic.nameUz),
    clinicAddress: pick(appointment.clinic.addressRu, appointment.clinic.addressUz),
    clinicPhone: formatPhone(appointment.clinic.phone),
    ticketNumber: ticketNumberFor(appointment.doctor, appointment.ticketSeq ?? appointment.queueOrder),
    slotTime: appointment.time ?? formatDate(appointment.date, locale, "time"),
    patient: initials(appointment.patient.fullName),
    doctorName: pick(appointment.doctor.nameRu, appointment.doctor.nameUz),
    cabinet: appointment.doctor.cabinet?.number ?? null,
    serviceName: appointment.primaryService
      ? pick(appointment.primaryService.nameRu, appointment.primaryService.nameUz)
      : "",
    issuedAt: formatClinicDateTime(appointment.date, locale),
    waitingAhead,
    botUrl: bot ? (invite?.url ?? `https://t.me/${bot}`) : null,
  };
}

/** The slip as ESC/POS bytes for an 80mm printer. */
export function renderTicketEscPos(slip: TicketSlip, codePage = 17): Buffer {
  const t = createTranslator({
    locale: slip.locale,
    messages: slip.locale === "uz" ? uz : ru,
    namespace: "ticketStub",
  });
  const p = new EscPos(codePage);

  p.align("center").bold(true).size(2, 2);
  for (const l of wrap(slip.clinicName, LINE_WIDTH / 2)) p.line(l);
  p.size(1, 1).bold(false);
  if (slip.clinicAddress) for (const l of wrap(slip.clinicAddress, LINE_WIDTH)) p.line(l);
  p.rule();

  p.bold(true).line((slip.ticketNumber ? t("yourNumber") : t("yourTime")).toUpperCase());
  p.size(4, 4).line(slip.ticketNumber ?? slip.slotTime).size(1, 1).bold(false);
  p.rule();

  p.align("left");
  p.pair(t("patient"), slip.patient);
  p.pair(t("doctor"), slip.doctorName);
  if (slip.cabinet) p.bold(true).pair(t("cabinet"), slip.cabinet).bold(false);
  if (slip.serviceName) p.pair(t("service"), slip.serviceName);
  p.pair(t("date"), slip.issuedAt);
  if (slip.waitingAhead !== null) {
    p.bold(true).pair(t("ahead"), t("aheadCount", { count: slip.waitingAhead })).bold(false);
  } else {
    p.bold(true).pair(t("booked"), slip.slotTime).bold(false);
  }
  p.rule();

  if (slip.botUrl) {
    p.align("center").qr(slip.botUrl, 7).feed(1);
    p.bold(true).size(1, 2).line(t("botTitle")).size(1, 1).bold(false);
    for (const l of wrap(t("botScan"), LINE_WIDTH)) p.line(l);
    p.rule();
  }

  p.align("center").line(t("thanks"));
  if (slip.clinicPhone) p.bold(true).line(slip.clinicPhone).bold(false);
  return p.feed(3).cut().toBuffer();
}
