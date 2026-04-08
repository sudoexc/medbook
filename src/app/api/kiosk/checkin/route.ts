import { prisma } from "@/lib/prisma";

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
      queueStatus: { in: ["WAITING"] },
      source: "ONLINE", // only pre-booked
    },
    include: { doctor: true },
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
      ticketNumber: `${a.doctor.id.charAt(0).toUpperCase()}-${String(a.queueOrder || 0).padStart(3, "0")}`,
    })),
  });
}
