import { prisma } from "@/lib/prisma";
import { sendMessage, escapeHtml } from "@/lib/telegram";
import { z } from "zod";

const BookingSchema = z.object({
  name: z.string().min(2).max(200),
  phone: z.string().min(9).max(20),
  doctorId: z.string(),
  service: z.string().optional(),
  date: z.string(), // ISO datetime
});

// GET /api/booking/available?doctorId=&date=YYYY-MM-DD
export async function GET(request: Request) {
  const url = new URL(request.url);
  const doctorId = url.searchParams.get("doctorId");
  const dateStr = url.searchParams.get("date");

  if (!doctorId || !dateStr) {
    return Response.json({ error: "doctorId and date required" }, { status: 400 });
  }

  // Get doctor schedule for this day
  const d = new Date(dateStr + "T12:00:00");
  const dow = d.getDay();

  const schedule = await prisma.doctorSchedule.findUnique({
    where: { doctorId_dayOfWeek: { doctorId, dayOfWeek: dow } },
  });

  if (!schedule || !schedule.isActive) {
    return Response.json({ slots: [] });
  }

  // Check day off
  const dayOff = await prisma.doctorDayOff.findUnique({
    where: { doctorId_date: { doctorId, date: new Date(dateStr + "T00:00:00") } },
  });

  if (dayOff) {
    return Response.json({ slots: [] });
  }

  // Generate 30-min slots
  const [startH, startM] = schedule.startTime.split(":").map(Number);
  const [endH, endM] = schedule.endTime.split(":").map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  const allSlots: string[] = [];
  for (let m = startMinutes; m < endMinutes; m += 30) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    allSlots.push(`${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
  }

  // Get existing appointments for this date
  const dayStart = new Date(dateStr + "T00:00:00");
  const dayEnd = new Date(dateStr + "T23:59:59");

  const existing = await prisma.appointment.findMany({
    where: {
      doctorId,
      date: { gte: dayStart, lte: dayEnd },
      queueStatus: { not: "CANCELLED" },
    },
  });

  const takenSlots = new Set(
    existing.map((a) => {
      const h = a.date.getHours();
      const m = a.date.getMinutes();
      return `${String(h).padStart(2, "0")}:${m < 30 ? "00" : "30"}`;
    })
  );

  // Filter out past slots if date is today
  const now = new Date();
  const isToday = dateStr === now.toISOString().split("T")[0];
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const availableSlots = allSlots.filter((slot) => {
    if (takenSlots.has(slot)) return false;
    if (isToday) {
      const [sh, sm] = slot.split(":").map(Number);
      if (sh * 60 + sm <= currentMinutes) return false;
    }
    return true;
  });

  return Response.json({ slots: availableSlots });
}

// POST /api/booking — create booking from landing page
export async function POST(request: Request) {
  const body = await request.json();
  const parsed = BookingSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { name, phone, doctorId, service, date } = parsed.data;

  // Upsert patient
  let patient = await prisma.patient.findUnique({ where: { phone } });
  if (!patient) {
    patient = await prisma.patient.create({
      data: { fullName: name, phone },
    });
  }

  // Create appointment
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId,
      service,
      date: new Date(date),
      source: "ONLINE",
      queueStatus: "WAITING",
    },
    include: { doctor: true },
  });

  // Notify via Telegram if patient has chat linked
  if (patient.telegramChatId) {
    const dateObj = new Date(date);
    const dateStr = dateObj.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const timeStr = dateObj.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    sendMessage(
      patient.telegramChatId,
      `✅ <b>Запись подтверждена!</b>\n\n📅 ${dateStr} в ${timeStr}\n👨‍⚕️ ${escapeHtml(appointment.doctor.nameRu)}\nКабинет: ${appointment.doctor.cabinet}\n${service ? `Услуга: ${escapeHtml(service)}` : ""}`
    ).catch(() => {});
  }

  // Also create lead for tracking
  await prisma.lead.create({
    data: {
      name,
      phone,
      doctorId,
      service,
      date: new Date(date).toISOString(),
      status: "CONVERTED",
    },
  });

  return Response.json({ ok: true, appointmentId: appointment.id }, { status: 201 });
}
