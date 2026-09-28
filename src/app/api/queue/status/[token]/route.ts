import { prisma } from "@/lib/prisma";
import { initials } from "@/lib/format";
import { runUnscoped } from "@/lib/tenant-context";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { getQueueProjection } from "@/server/appointments/queue-projection";
import {
  parseQueueTicketToken,
  ticketDayState,
} from "@/server/appointments/public-ticket";
import { isLiveLane } from "@/lib/queue-ordering";

// GET /api/queue/status/:token — public queue status behind the QR on the
// patient's ticket (and the Mini App's own queue card).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Audit INF-10: the raw appointment id is no longer a capability. It used
  // to be, while the anonymous board stream handed out every id of the clinic,
  // so anybody could read who was waiting for which doctor. Only a server
  // minted ticket token opens this endpoint; a bare id (the QR printed before
  // the change) is a 404 without even a lookup, so the page can say the link
  // is outdated.
  const parsed = parseQueueTicketToken(token);
  if (parsed.kind !== "token") {
    return Response.json(
      {
        error: "Not found",
        reason: parsed.kind === "legacy" ? "legacy_link" : "not_found",
      },
      { status: 404 },
    );
  }
  const appointmentId = parsed.appointmentId;

  // Anonymous capability-URL endpoint: the clinic is unknown until the
  // appointment row resolves, so the lookup and the queue projection run with
  // an explicit unscoped bypass. The signed token is the authorization; the
  // response masks the patient to initials.
  return runUnscoped("public queue status: lookup appointment by signed ticket token", async () => {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        clinicId: true,
        doctorId: true,
        date: true,
        queueStatus: true,
        queueOrder: true,
        ticketSeq: true,
        channel: true,
        time: true,
        patient: { select: { fullName: true, preferredLang: true } },
        doctor: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            ticketPrefix: true,
            cabinet: { select: { number: true } },
          },
        },
        clinic: { select: { nameRu: true, nameUz: true, slug: true } },
      },
    });

    if (!appointment) {
      return Response.json({ error: "Not found", reason: "not_found" }, { status: 404 });
    }

    // A ticket is a same-day thing. Yesterday's paper found in the bin, or a
    // stub printed for next week, shows nothing beyond «not today».
    const day = ticketDayState(appointment.date);
    if (day !== "today") {
      return Response.json(
        { error: "Gone", reason: day === "past" ? "expired" : "not_today" },
        { status: 410 },
      );
    }

    // Read the patient's own slot from the SAME projection the board and kiosk
    // use, so position / ETA / ticket can never disagree across surfaces. The
    // projection honours queuePriority (the old per-queueOrder count here did
    // not) and sources per-visit minutes doctor-wide (not service-filtered).
    const projection = await getQueueProjection({
      clinicId: appointment.clinicId,
      doctorIds: [appointment.doctorId],
    });
    const q = projection.get(appointment.doctorId);
    const waiting = q?.waiting ?? [];
    const mine = waiting.find((w) => w.appointmentId === appointment.id);

    // Two-lanes (docs/TZ-two-lanes.md): only live-lane rows (walk-ins) hold a
    // queue position. An arrived booking waits on the schedule axis — the UI
    // shows its slot time, not a fake "you're 0th in line".
    const live = isLiveLane(appointment);
    const position = !live
      ? null
      : appointment.queueStatus === "WAITING"
        ? (mine?.position ?? 0)
        : appointment.queueStatus === "IN_PROGRESS"
          ? 0
          : -1;
    const etaMinutes = live ? (mine?.etaMinutes ?? 0) : null;
    const ticketNumber = ticketNumberFor(
      appointment.doctor,
      appointment.ticketSeq ?? appointment.queueOrder,
    );

    // Public endpoint. Strip PII — initials only, no phone / passport / notes
    // / email, and no service name (INF-10: «ЭЭГ» next to initials is a
    // medical fact). Doctor name and cabinet are public clinic info.
    // clinicSlug + doctorId let the page subscribe to the clinic SSE stream
    // and react to its own doctor's queue.updated pushes.
    return Response.json({
      patientName: initials(appointment.patient.fullName),
      // UX-06 — the page speaks the patient's language; the Uzbek names ride
      // along so its RU/UZ switch needs no second request.
      lang: appointment.patient.preferredLang === "UZ" ? "uz" : "ru",
      doctorName: appointment.doctor.nameRu,
      doctorNameUz: appointment.doctor.nameUz || null,
      clinicName: appointment.clinic?.nameRu ?? null,
      clinicNameUz: appointment.clinic?.nameUz || null,
      clinicSlug: appointment.clinic?.slug ?? null,
      doctorId: appointment.doctorId,
      cabinet: appointment.doctor.cabinet?.number ?? null,
      status: appointment.queueStatus,
      /** "live" = walk-in with a queue position; "schedule" = booking (slot time). */
      lane: live ? "live" : "schedule",
      slotTime: appointment.time ?? null,
      position: position !== null && position > 0 ? position : live ? 0 : null,
      totalWaiting: waiting.length,
      etaMinutes,
      etaConfidence: q?.etaConfidence ?? "low",
      etaSource: q?.etaSource ?? "fallback",
      ticketNumber,
    });
  });
}
