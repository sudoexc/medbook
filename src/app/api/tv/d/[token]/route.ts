/**
 * GET /api/tv/d/[token]
 *
 * Personal waiting-room TV board for ONE doctor. The unguessable
 * `Doctor.tvToken` is the bearer — no clinic slug needed in the URL, the
 * token resolves both the doctor and the clinic. Trust model matches the
 * clinic-wide `/api/c/[slug]/queue/board`: a screen physically installed at
 * the clinic, PII minimized to initials.
 *
 * Shape:
 *   {
 *     clinic: { slug, nameRu, nameUz },       // slug feeds the SSE connect
 *     doctor: { id, nameRu, nameUz, specializationRu, specializationUz,
 *               photoUrl, color, cabinet },
 *     now: ISO,
 *     queue: {                                 // left panel — live queue
 *       current: { fullName, ticketNumber, startedAt } | null,
 *       waiting: [{ id, fullName, ticketNumber, queueOrder, etaMinutes }],
 *     },
 *     slots: [{                                // right panel — today's bookings
 *       id, time, durationMin, status, fullName,
 *     }],
 *   }
 *
 * Walk-in / kiosk rows are excluded from `slots` — they ARE the live queue on
 * the left; duplicating them right would double-count. CANCELLED/NO_SHOW rows
 * are dropped (a lobby screen shouldn't advertise no-shows).
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { ok } from "@/server/http";
import { getQueueProjection } from "@/server/appointments/queue-projection";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { initials } from "@/lib/format";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Slot-channel statuses a lobby screen may show. */
const SLOT_STATUSES = [
  "BOOKED",
  "CONFIRMED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
] as const;

function readToken(request: Request): string | null {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // /api/tv/d/[token]
  const idx = parts.indexOf("d");
  if (idx >= 0 && parts[idx + 1]) return decodeURIComponent(parts[idx + 1]);
  return null;
}

export async function GET(request: Request): Promise<Response> {
  const token = readToken(request);
  if (!token) {
    return Response.json(
      { error: "BadRequest", reason: "missing_token" },
      { status: 400 },
    );
  }

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const doctor = await prisma.doctor.findUnique({
      where: { tvToken: token },
      select: {
        id: true,
        clinicId: true,
        isActive: true,
        nameRu: true,
        nameUz: true,
        specializationRu: true,
        specializationUz: true,
        photoUrl: true,
        color: true,
        cabinet: { select: { number: true } },
        clinic: {
          select: { slug: true, nameRu: true, nameUz: true, active: true },
        },
      },
    });
    if (!doctor || !doctor.isActive || !doctor.clinic.active) {
      return Response.json(
        { error: "NotFound", reason: "tv_screen" },
        { status: 404 },
      );
    }

    const now = new Date();
    const { dayStart, dayEnd } = tashkentDayBounds(now);

    const [projection, slotRows] = await Promise.all([
      getQueueProjection({
        clinicId: doctor.clinicId,
        doctorIds: [doctor.id],
      }),
      prisma.appointment.findMany({
        where: {
          clinicId: doctor.clinicId,
          doctorId: doctor.id,
          date: { gte: dayStart, lt: dayEnd },
          status: { in: [...SLOT_STATUSES] },
          channel: { notIn: ["WALKIN", "KIOSK"] },
        },
        select: {
          id: true,
          time: true,
          durationMin: true,
          status: true,
          patient: { select: { fullName: true } },
        },
        orderBy: [{ date: "asc" }, { time: "asc" }],
        take: 200,
      }),
    ]);

    const q = projection.get(doctor.id);

    return ok({
      clinic: {
        slug: doctor.clinic.slug,
        nameRu: doctor.clinic.nameRu,
        nameUz: doctor.clinic.nameUz,
      },
      doctor: {
        id: doctor.id,
        nameRu: doctor.nameRu,
        nameUz: doctor.nameUz,
        specializationRu: doctor.specializationRu,
        specializationUz: doctor.specializationUz,
        photoUrl: doctor.photoUrl,
        color: doctor.color,
        cabinet: doctor.cabinet?.number ?? null,
      },
      now: now.toISOString(),
      queue: {
        current: q?.current
          ? {
              fullName: initials(q.current.patientFullName),
              ticketNumber: q.current.ticketNumber,
              startedAt: q.current.startedAt?.toISOString() ?? null,
            }
          : null,
        waiting: (q?.waiting ?? []).map((w) => ({
          id: w.appointmentId,
          fullName: initials(w.patientFullName),
          ticketNumber: w.ticketNumber,
          queueOrder: w.queueOrder,
          etaMinutes: w.etaMinutes,
        })),
      },
      slots: slotRows.map((s) => ({
        id: s.id,
        time: s.time,
        durationMin: s.durationMin,
        status: s.status,
        fullName: initials(s.patient?.fullName),
      })),
    });
  });
}
