/**
 * Wave 3c — «Добавить в календарь» (.ics download, Mini App).
 *
 * GET /api/miniapp/appointments/:id/ics
 *
 * Returns a single-VEVENT iCalendar file for the patient's appointment.
 * Opened via `tg.openLink` (external browser), so the URL carries `t`, a
 * link for THIS appointment minted by `POST /api/miniapp/links` (audit
 * MA-07: it used to carry the patient's initData, the key to the whole
 * account, into the browser's history and nginx's log). A request with the
 * initData header is still served.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { err, forbidden, notFound } from "@/server/http";
import {
  createMiniAppListHandler,
  resolveMiniAppLink,
} from "@/server/miniapp/handler";
import { resolveActivePatient } from "@/server/miniapp/active-patient";
import { expiredMiniAppLinkPage } from "@/server/miniapp/link-page";

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

function appointmentIdOf(request: Request): string {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../appointments/<id>/ics
  return segments[segments.length - 2] ?? "";
}

const byHeader = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const appointmentId = appointmentIdOf(request);
  if (!appointmentId) return err("missing_appointment_id", 400);

  const onBehalfOf = new URL(request.url).searchParams.get("onBehalfOf");
  const acting = await resolveActivePatient({
    ctx: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      preferredLang: ctx.patient.preferredLang,
    },
    onBehalfOf,
  });
  if (!acting.ok) return forbidden();
  return renderIcs({
    clinicId: ctx.clinicId,
    appointmentId,
    acting: { patientId: acting.patientId, preferredLang: acting.preferredLang },
  });
});

export async function GET(request: Request): Promise<Response> {
  if (!new URL(request.url).searchParams.has("t")) return byHeader(request);
  const appointmentId = appointmentIdOf(request);
  // The link names the acting patient (the owner or a linked relative) it
  // was minted for, after the family check; see /api/miniapp/links.
  const link = await resolveMiniAppLink(request, {
    scope: "ics",
    resourceId: appointmentId,
  });
  if (!link.ok) return expiredMiniAppLinkPage(link.response.status);
  return runWithTenant({ kind: "SYSTEM" }, () =>
    renderIcs({
      clinicId: link.link.clinicId,
      appointmentId,
      acting: {
        patientId: link.link.patientId,
        preferredLang: link.link.preferredLang,
      },
    }),
  );
}

async function renderIcs({
  clinicId,
  appointmentId,
  acting,
}: {
  clinicId: string;
  appointmentId: string;
  acting: { patientId: string; preferredLang: "RU" | "UZ" };
}): Promise<Response> {
  const appt = await prisma.appointment.findFirst({
    where: { id: appointmentId, clinicId },
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
    where: { id: clinicId },
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
}
