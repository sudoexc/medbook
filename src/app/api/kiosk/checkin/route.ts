import { prisma } from "@/lib/prisma";
import { z } from "zod";

// GET /api/kiosk/checkin?phone=... — find today's pre-booked appointments for this phone
export async function GET(request: Request) {
  const url = new URL(request.url);
  const phone = url.searchParams.get("phone");

  if (!phone) {
    return Response.json({ error: "phone required" }, { status: 400 });
  }

  // Normalize phone
  const normalized = phone.replace(/[\s\-()]/g, "");
  const variants = [normalized];
  if (normalized.startsWith("+998")) variants.push(normalized.slice(4));
  if (normalized.startsWith("998")) variants.push(normalized.slice(3));
  if (!normalized.startsWith("+")) variants.push("+" + normalized);
  if (!normalized.startsWith("+998") && !normalized.startsWith("998") && normalized.length === 9) {
    variants.push("+998" + normalized);
    variants.push("998" + normalized);
  }

  // Find patient by phone
  const patient = await prisma.patient.findFirst({
    where: { phone: { in: variants } },
  });

  if (!patient) {
    return Response.json({ patient: null, appointments: [] });
  }

  // Find today's pre-booked appointments that are still WAITING
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const appointments = await prisma.appointment.findMany({
    where: {
      patientId: patient.id,
      date: { gte: today, lt: tomorrow },
      queueStatus: "WAITING",
      source: "ONLINE", // only pre-booked
    },
    select: {
      id: true,
      date: true,
      service: true,
      queueOrder: true,
      doctor: { select: { id: true, nameRu: true, cabinet: true } },
    },
    orderBy: { date: "asc" },
  });

  return Response.json({
    patient: { id: patient.id, fullName: patient.fullName, phone: patient.phone },
    appointments: appointments.map((a) => ({
      id: a.id,
      doctorName: a.doctor.nameRu,
      cabinet: a.doctor.cabinet,
      service: a.service,
      time: a.date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
      queueOrder: a.queueOrder,
      // Show estimated ticket only once the patient has checked in at the kiosk.
      // Before check-in, queueOrder is null and we render a placeholder.
      ticketNumber: a.queueOrder
        ? `${a.doctor.id.charAt(0).toUpperCase()}-${String(a.queueOrder).padStart(3, "0")}`
        : null,
    })),
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

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
    if (appt.date < today || appt.date >= tomorrow) {
      return { error: "Not scheduled for today", status: 400 as const };
    }

    // Already checked in — return the existing ticket (idempotent).
    if (appt.queueOrder) {
      return { appt };
    }

    const last = await tx.appointment.findFirst({
      where: {
        doctorId: appt.doctorId,
        date: { gte: today, lt: tomorrow },
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
