import { prisma } from "@/lib/prisma";
import { sendMessage, escapeHtml } from "@/lib/telegram";
import {
  validateBookingSlot,
  toTashkentDate,
  tashkentNow,
  tashkentDayBoundsForDateString,
  tashkentSlotKey,
} from "@/lib/booking-validation";
import { normalizePhone } from "@/lib/phone";
import { rateLimit } from "@/lib/rate-limit";
import { z } from "zod";

const BookingSchema = z.object({
  name: z.string().min(2).max(200),
  phone: z.string().min(9).max(20),
  doctorId: z.string(),
  service: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "time must be HH:mm"),
});

// GET /api/booking/available?doctorId=&date=YYYY-MM-DD
export async function GET(request: Request) {
  const url = new URL(request.url);
  const doctorId = url.searchParams.get("doctorId");
  const dateStr = url.searchParams.get("date");

  if (!doctorId || !dateStr) {
    return Response.json({ error: "doctorId and date required" }, { status: 400 });
  }

  // Day-of-week from the date string itself (UTC noon avoids any local-tz skew).
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  const { dayStart, dayEnd } = tashkentDayBoundsForDateString(dateStr);

  const [schedule, dayOff, existing] = await Promise.all([
    prisma.doctorSchedule.findUnique({
      where: { doctorId_dayOfWeek: { doctorId, dayOfWeek: dow } },
      select: { startTime: true, endTime: true, isActive: true },
    }),
    prisma.doctorDayOff.findFirst({
      where: { doctorId, date: { gte: dayStart, lt: dayEnd } },
      select: { id: true },
    }),
    prisma.appointment.findMany({
      where: {
        doctorId,
        date: { gte: dayStart, lt: dayEnd },
        queueStatus: { not: "CANCELLED" },
      },
      select: { date: true },
    }),
  ]);

  if (!schedule || !schedule.isActive) return Response.json({ slots: [] });
  if (dayOff) return Response.json({ slots: [] });

  // Generate 30-min slots within working hours.
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

  // Snap each appointment to its Tashkent-wall-clock 30-min slot.
  const takenSlots = new Set(existing.map((a) => tashkentSlotKey(a.date)));

  // Filter out past slots if date is today (Tashkent wall clock)
  const tNow = tashkentNow();
  const isToday = dateStr === tNow.date;

  const availableSlots = allSlots.filter((slot) => {
    if (takenSlots.has(slot)) return false;
    if (isToday) {
      const [sh, sm] = slot.split(":").map(Number);
      if (sh * 60 + sm <= tNow.minutes) return false;
    }
    return true;
  });

  return Response.json({ slots: availableSlots });
}

// POST /api/booking — create booking from landing page
export async function POST(request: Request) {
  // Rate limit: 10 submissions per minute per IP
  const ip = request.headers.get("x-forwarded-for") || "unknown";
  if (!rateLimit(ip)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await request.json();
  const parsed = BookingSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const { name, doctorId, service, date, time } = parsed.data;
  const phone = normalizePhone(parsed.data.phone);
  if (!phone) {
    return Response.json({ error: { phone: ["Invalid phone"] } }, { status: 400 });
  }
  const appointmentDate = toTashkentDate(date, time);

  const validation = await validateBookingSlot({ doctorId, date: appointmentDate });
  if (!validation.ok) {
    return Response.json(
      { error: validation.message, code: validation.code, messageUz: validation.messageUz },
      { status: 400 }
    );
  }

  const patient = await prisma.patient.upsert({
    where: { phone },
    update: { fullName: name },
    create: { fullName: name, phone },
  });

  // Create appointment
  const appointment = await prisma.appointment.create({
    data: {
      patientId: patient.id,
      doctorId,
      service,
      date: appointmentDate,
      source: "ONLINE",
      queueStatus: "WAITING",
    },
    include: { doctor: true },
  });

  // Notify via Telegram if patient has chat linked
  if (patient.telegramChatId) {
    const dateStrRu = appointmentDate.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "Asia/Tashkent",
    });
    const timeStrRu = appointmentDate.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Tashkent",
    });
    sendMessage(
      patient.telegramChatId,
      `✅ <b>Запись подтверждена!</b>\n\n📅 ${dateStrRu} в ${timeStrRu}\n👨‍⚕️ ${escapeHtml(appointment.doctor.nameRu)}\nКабинет: ${appointment.doctor.cabinet}\n${service ? `Услуга: ${escapeHtml(service)}` : ""}`
    ).catch((err) => console.error("[telegram]", err));
  }

  // Also create lead for tracking
  await prisma.lead.create({
    data: {
      name,
      phone,
      doctorId,
      service,
      date: appointmentDate.toISOString(),
      status: "CONVERTED",
    },
  });

  return Response.json({ ok: true, appointmentId: appointment.id }, { status: 201 });
}
