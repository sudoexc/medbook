/**
 * Wave 3c — «Добавить в календарь» (.ics download, Mini App).
 *
 * GET /api/miniapp/appointments/:id/ics
 *
 * Returns a single-VEVENT iCalendar file for the patient's appointment.
 * Opened via `tg.openLink` (external browser), so auth rides on the
 * `?initData=` query fallback — the global header path can't be used for
 * a plain link navigation.
 */
import { prisma } from "@/lib/prisma";
import { err, forbidden, notFound } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";
import { resolveActivePatient } from "@/server/miniapp/active-patient";

/** RFC 5545 §3.3.11 TEXT escaping. */
function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** UTC basic format: 20260612T093000Z. */
function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const segments = url.pathname.split("/").filter(Boolean);
  // .../appointments/<id>/ics
  const appointmentId = segments[segments.length - 2] ?? "";
  if (!appointmentId) return err("missing_appointment_id", 400);

  const onBehalfOf = url.searchParams.get("onBehalfOf");
  const acting = await resolveActivePatient({
    ctx: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      preferredLang: ctx.patient.preferredLang,
    },
    onBehalfOf,
  });
  if (!acting.ok) return forbidden();

  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId: ctx.clinicId },
    select: {
      id: true,
      patientId: true,
      date: true,
      endDate: true,
      status: true,
      ticketCode: true,
      doctor: {
        select: {
          nameRu: true,
          nameUz: true,
          specializationRu: true,
          specializationUz: true,
        },
      },
    },
  });
  if (!appt) return notFound();
  if (appt.patientId !== acting.patientId) return forbidden();
  if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") {
    return err("not_schedulable", 409);
  }

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { nameRu: true, nameUz: true, addressRu: true, addressUz: true },
  });
  if (!clinic) return notFound();

  const uz = acting.preferredLang === "UZ";
  const doctorName = uz ? appt.doctor.nameUz : appt.doctor.nameRu;
  const specialization = uz
    ? appt.doctor.specializationUz
    : appt.doctor.specializationRu;
  const clinicName = (uz ? clinic.nameUz : clinic.nameRu) || clinic.nameRu;
  const address = (uz ? clinic.addressUz : clinic.addressRu) ?? clinic.addressRu;

  const summary = uz ? `Qabul — ${doctorName}` : `Приём — ${doctorName}`;
  const descriptionLines = [
    specialization,
    appt.ticketCode
      ? uz
        ? `Talon kodi: ${appt.ticketCode}`
        : `Код талона: ${appt.ticketCode}`
      : null,
    clinicName,
  ].filter(Boolean) as string[];
  const location = address ? `${clinicName}, ${address}` : clinicName;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MedBook//MiniApp//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${appt.id}@medbook`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(appt.date)}`,
    `DTEND:${icsDate(appt.endDate)}`,
    `SUMMARY:${esc(summary)}`,
    `LOCATION:${esc(location)}`,
    `DESCRIPTION:${esc(descriptionLines.join("\n"))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return new Response(lines.join("\r\n") + "\r\n", {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="appointment.ics"',
      "Cache-Control": "no-store",
    },
  });
});
