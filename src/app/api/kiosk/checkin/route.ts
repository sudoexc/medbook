import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { tashkentDayBounds, tashkentComponents } from "@/lib/booking-validation";
import { rateLimit } from "@/lib/rate-limit";
import {
  authenticateKiosk,
  kioskUnauthorized,
  maskPatientName,
  realClientIp,
} from "@/server/kiosk/device";
import { ticketNumberFor } from "@/server/services/ticket-number";
import { findVerifiedPhoneOwner } from "@/server/patient/phone-identity";
import { z } from "zod";

// GET /api/kiosk/checkin?phone=... — find today's pre-booked appointments for this phone.
// Only the clinic's paired kiosk may ask (audit SEC-01): otherwise anyone
// could enumerate phone numbers and learn who is seen at a neurology clinic.
// Rate limited per real client address (X-Real-IP from nginx — the first
// X-Forwarded-For entry is client-written and used to bypass the limit).
// NOTE: `rateLimit` is in-memory and resets on cold start — switch to KV/Redis
// before real scale. See audit finding MEDIUM #14.
const PhoneQuery = z.string().regex(/^\+?\d{9,15}$/);
export async function GET(request: Request) {
  const device = await authenticateKiosk(request);
  if (!device) return kioskUnauthorized();
  if (!rateLimit(`kiosk-lookup:${device.clinicId}:${realClientIp(request)}`, 20)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const url = new URL(request.url);
  const phoneRaw = url.searchParams.get("phone");
  const parsed = PhoneQuery.safeParse(phoneRaw);
  if (!parsed.success) {
    return Response.json({ error: "Invalid phone" }, { status: 400 });
  }
  const phone = parsed.data;

  const clinic = { id: device.clinicId };

  // Only the VERIFIED owner of the number, scoped to the resolved clinic so
  // an anonymous kiosk request can't probe another tenant's patient base.
  // A number someone typed into the Mini App proves nothing (audit PH-01),
  // and a relative who merely uses this number as a contact is not «you»:
  // the kiosk asks «Это вы? И.И.» about the owner and, on «Нет», registers
  // the person by name (audit Q-03).
  const patient = await runWithTenant({ kind: "SYSTEM" }, () =>
    findVerifiedPhoneOwner(prisma, clinic.id, phone),
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
    // Masked, no phone: whoever stands at the tablet typed a number, which
    // does not make them that patient.
    patient: { id: patient.id, fullName: maskPatientName(patient.fullName) },
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
