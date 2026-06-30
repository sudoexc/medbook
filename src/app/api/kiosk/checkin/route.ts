import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { resolvePublicClinic } from "@/lib/public-clinic";
import { phoneSearchVariants } from "@/lib/phone";
import { tashkentDayBounds, tashkentComponents } from "@/lib/booking-validation";
import { rateLimit } from "@/lib/rate-limit";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { z } from "zod";

function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// GET /api/kiosk/checkin?phone=... — find today's pre-booked appointments for this phone.
// Rate limited to prevent scraping the patient base by enumerating phone numbers.
// NOTE: `rateLimit` is in-memory and resets on cold start — switch to KV/Redis
// before real scale. See audit finding MEDIUM #14.
const PhoneQuery = z.string().regex(/^\+?\d{9,15}$/);
export async function GET(request: Request) {
  if (!rateLimit(clientIp(request))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const url = new URL(request.url);
  const phoneRaw = url.searchParams.get("phone");
  const parsed = PhoneQuery.safeParse(phoneRaw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid phone" }, { status: 400 });
  }
  const phone = parsed.data;

  const clinic = await resolvePublicClinic(request);
  if (!clinic) {
    return Response.json({ patient: null, appointments: [], upcoming: [] });
  }

  // Find patient by any known phone representation (shared helper), scoped to
  // the resolved clinic so an anonymous kiosk request can't probe another
  // tenant's patient base by enumerating phone numbers.
  const variants = phoneSearchVariants(phone);
  const patient = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.patient.findFirst({
      where: { clinicId: clinic.id, phone: { in: variants } },
    }),
  );

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

  const all = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        clinicId: clinic.id,
        patientId: patient.id,
        date: { gte: dayStart, lt: weekEnd },
        queueStatus: { in: ["WAITING", "IN_PROGRESS"] },
      },
      select: {
        id: true,
        date: true,
        primaryService: { select: { nameRu: true } },
        queueOrder: true,
        ticketSeq: true,
        queueStatus: true,
        doctor: {
          select: { id: true, nameRu: true, cabinet: { select: { number: true } } },
        },
      },
      orderBy: { date: "asc" },
    }),
  );

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
      cabinet: a.doctor.cabinet?.number ?? null,
      service: a.primaryService?.nameRu ?? null,
      time: formatTime(a.date),
      queueOrder: a.queueOrder,
      queueStatus: a.queueStatus,
      ticketNumber:
        (a.ticketSeq ?? a.queueOrder) != null
          ? ticketNumberFor(a.doctor.id, a.ticketSeq ?? a.queueOrder)
          : null,
    })),
    upcoming: upcoming.map((a) => {
      const c = tashkentComponents(a.date);
      return {
        id: a.id,
        doctorName: a.doctor.nameRu,
        cabinet: a.doctor.cabinet?.number ?? null,
        service: a.primaryService?.nameRu ?? null,
        date: c.date, // YYYY-MM-DD Tashkent
        time: c.time, // HH:mm Tashkent
      };
    }),
  });
}
