import { prisma } from "@/lib/prisma";
import { phoneSearchVariants } from "@/lib/phone";
import { tashkentDayBounds, tashkentComponents } from "@/lib/booking-validation";
import { z } from "zod";

// GET /api/kiosk/checkin?phone=... — find today's pre-booked appointments for this phone
export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get("phone");

  if (!phone) {
    return Response.json({ error: "phone required" }, { status: 400 });
  }

  // Find patient by any known phone representation (shared helper)
  const variants = phoneSearchVariants(phone);
  const patient = await prisma.patient.findFirst({
    where: { phone: { in: variants } },
  });

  if (!patient) {
    return Response.json({ patient: null, appointments: [], upcoming: [] });
  }

  // Pull all upcoming appointments for this patient in [today, today+7 days).
  // Intentionally permissive:
  //  - any source (ONLINE booking, WALKIN already at kiosk, etc.)
  //  - WAITING or IN_PROGRESS (skip CANCELLED/SKIPPED/COMPLETED)
  // The frontend splits these into "today" (check-in flow) vs "upcoming"
  // (info-only) so the receptionist's confirmed lead is always visible
  // even if it was booked for a different day than the kiosk visit.
  const { dayStart, dayEnd } = tashkentDayBounds();
  const weekEnd = new Date(dayStart.getTime() + 7 * 24 * 60 * 60 * 1000);

  const all = await prisma.appointment.findMany({
    where: {
      patientId: patient.id,
      date: { gte: dayStart, lt: weekEnd },
      queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
    },
    select: {
      id: true,
      date: true,
      service: true,
      queueOrder: true,
      queueStatus: true,
      doctor: { select: { id: true, nameRu: true, cabinet: true } },
    },
    orderBy: { date: "asc" },
  });

  const today: typeof all = [];
  const upcoming: typeof all = [];
  for (const a of all) {
    if (a.date < dayEnd) today.push(a);
    else upcoming.push(a);
  }

  const formatTime = (d: Date) => {
    const c = tashkentComponents(d);
    return c.time; // "HH:mm" in Tashkent wall clock
  };

  return Response.json({
    patient: { id: patient.id, fullName: patient.fullName, phone: patient.phone },
    appointments: today.map((a) => ({
      id: a.id,
      doctorName: a.doctor.nameRu,
      cabinet: a.doctor.cabinet,
      service: a.service,
      time: formatTime(a.date),
      queueOrder: a.queueOrder,
      queueStatus: a.queueStatus,
      ticketNumber: a.queueOrder
        ? `${a.doctor.id.charAt(0).toUpperCase()}-${String(a.queueOrder).padStart(3, "0")}`
        : null,
    })),
    upcoming: upcoming.map((a) => {
      const c = tashkentComponents(a.date);
      return {
        id: a.id,
        doctorName: a.doctor.nameRu,
        cabinet: a.doctor.cabinet,
        service: a.service,
        date: c.date, // YYYY-MM-DD Tashkent
        time: c.time, // HH:mm Tashkent
      };
    }),
  });
}

// POST /api/kiosk/checkin — claim a queue position for an existing online booking.
// Called when the patient taps their appointment on the kiosk.
const CheckinSchema = z.object({ appointmentId: z.string().min(1) });

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = CheckinSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const { dayStart, dayEnd } = tashkentDayBounds();

  // Transaction: re-read + assign next queueOrder atomically so two concurrent
  // check-ins can't claim the same number.
  const result = await prisma.$transaction(async (tx) => {
    const appt = await tx.appointment.findUnique({
      where: { id: parsed.data.appointmentId },
      select: {
        id: true,
        doctorId: true,
        date: true,
        queueStatus: true,
        queueOrder: true,
        doctor: { select: { id: true, nameRu: true, cabinet: true } },
      },
    });

    if (!appt) return { error: "Appointment not found", status: 404 as const };
    if (appt.queueStatus !== "WAITING") {
      return { error: "Already processed", status: 409 as const };
    }
    if (appt.date < dayStart || appt.date >= dayEnd) {
      return { error: "Not scheduled for today", status: 400 as const };
    }

    // Already checked in — return the existing ticket (idempotent).
    if (appt.queueOrder) {
      return { appt };
    }

    const last = await tx.appointment.findFirst({
      where: {
        doctorId: appt.doctorId,
        date: { gte: dayStart, lt: dayEnd },
        queueOrder: { not: null },
      },
      orderBy: { queueOrder: "desc" },
      select: { queueOrder: true },
    });

    const nextOrder = (last?.queueOrder ?? 0) + 1;

    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: { queueOrder: nextOrder },
      select: {
        id: true,
        queueOrder: true,
        doctor: { select: { id: true, nameRu: true, cabinet: true } },
      },
    });

    return { appt: { ...appt, queueOrder: updated.queueOrder, doctor: updated.doctor } };
  });

  if ("error" in result) {
    return Response.json({ error: result.error }, { status: result.status });
  }

  const a = result.appt;
  return Response.json({
    id: a.id,
    doctorName: a.doctor.nameRu,
    cabinet: a.doctor.cabinet,
    queueOrder: a.queueOrder,
    ticketNumber: `${a.doctor.id.charAt(0).toUpperCase()}-${String(a.queueOrder).padStart(3, "0")}`,
  });
}
