import { prisma } from "@/lib/prisma";
import { initials } from "@/lib/format";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { getQueueProjection } from "@/server/appointments/queue-projection";
import { isLiveLane } from "@/lib/queue-ordering";

// GET /api/queue/status/:id — public endpoint for patient queue status (QR code page)
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const appointment = await prisma.appointment.findUnique({
    where: { id },
    select: {
      id: true,
      clinicId: true,
      doctorId: true,
      queueStatus: true,
      queueOrder: true,
      ticketSeq: true,
      channel: true,
      time: true,
      patient: { select: { fullName: true } },
      doctor: {
        select: {
          id: true,
          nameRu: true,
          cabinet: { select: { number: true } },
        },
      },
      primaryService: { select: { nameRu: true } },
      clinic: { select: { nameRu: true, slug: true } },
    },
  });

  if (!appointment) {
    return Response.json({ error: "Not found" }, { status: 404 });
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
    appointment.doctor.id,
    appointment.ticketSeq ?? appointment.queueOrder,
  );

  // Public endpoint (patients reach it via QR link). Strip PII — initials only,
  // no phone / passport / notes / email. Doctor name and cabinet are public
  // clinic info, safe to return. clinicSlug + doctorId let the page subscribe to
  // the clinic SSE stream and react to its own doctor's queue.updated pushes.
  return Response.json({
    patientName: initials(appointment.patient.fullName),
    doctorName: appointment.doctor.nameRu,
    clinicName: appointment.clinic?.nameRu ?? null,
    clinicSlug: appointment.clinic?.slug ?? null,
    doctorId: appointment.doctorId,
    cabinet: appointment.doctor.cabinet?.number ?? null,
    service: appointment.primaryService?.nameRu ?? null,
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
}
