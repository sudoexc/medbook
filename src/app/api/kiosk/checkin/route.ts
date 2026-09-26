import type { Prisma } from "@/generated/prisma/client";
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
import {
  KIOSK_TODAY_STATUSES,
  KIOSK_UPCOMING_STATUSES,
} from "@/server/kiosk/checkin-statuses";
import {
  findPhoneClaim,
  findVerifiedPhoneOwners,
} from "@/server/patient/phone-identity";
import { z } from "zod";

// GET /api/kiosk/checkin?phone=... — find today's pre-booked appointments for this phone.
// Only the clinic's paired kiosk may ask (audit SEC-01): otherwise anyone
// could enumerate phone numbers and learn who is seen at a neurology clinic.
// Rate limited per real client address (X-Real-IP from nginx — the first
// X-Forwarded-For entry is client-written and used to bypass the limit).
// NOTE: `rateLimit` is in-memory and resets on cold start — switch to KV/Redis
// before real scale. See audit finding MEDIUM #14.
const PhoneQuery = z.string().regex(/^\+?\d{9,15}$/);

/**
 * Which verified card the kiosk asks «Это вы?» about. Usually there is one.
 * Two cards can hold the two shapes of one number (LD-10, see
 * findVerifiedPhoneOwners), often a mother and her son; the kiosk knows no
 * name yet, only that someone came to check in, so the card with a live
 * booking (the earliest) is the one to show. The oldest otherwise: on «Нет»
 * the walk-in by name finds the other card itself (decidePhoneOwner).
 */
async function pickKioskOwner<T extends { id: string }>(
  clinicId: string,
  owners: T[],
  liveBookings: Prisma.AppointmentWhereInput[],
): Promise<T> {
  if (owners.length === 1) return owners[0]!;
  const booked = await prisma.appointment.findFirst({
    where: {
      clinicId,
      patientId: { in: owners.map((o) => o.id) },
      OR: liveBookings,
    },
    orderBy: { date: "asc" },
    select: { patientId: true },
  });
  return owners.find((o) => o.id === booked?.patientId) ?? owners[0]!;
}

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

  // The VERIFIED owner of the number, scoped to the resolved clinic so an
  // anonymous kiosk request can't probe another tenant's patient base. A
  // relative who merely uses this number as a contact is not «you»: the
  // kiosk asks «Это вы? И.И.» about the owner and, on «Нет», registers the
  // person by name (audit Q-03).
  //
  // With no verified owner, the card that only CLAIMS the number (typed
  // into the Mini App) goes through the same question, flagged so the
  // kiosk says the number came from a Telegram booking. A claim proves
  // nothing on its own (PH-01), but hiding it stranded every returning
  // Mini App patient: «first visit», her booking invisible, and the walk-in
  // created a second card that took her number away. «Да» keeps her on her
  // own card; «Нет» registers the person by name and the claim loses the
  // number.
  //
  // The patient's live bookings are those in [today, today+7 days), any
  // source (ONLINE booking, WALKIN already at the kiosk, …). The frontend
  // splits them into "today" (check-in flow) vs "upcoming" (info-only), so
  // the receptionist's confirmed booking is visible even for another day.
  // Pre-arrival BOOKED/CONFIRMED rows are the point of the lookup: see
  // `checkin-statuses.ts` for why a WAITING-only filter broke it (Q-01).
  const { dayStart, dayEnd } = tashkentDayBounds();
  const weekEnd = new Date(dayStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const liveBookings: Prisma.AppointmentWhereInput[] = [
    {
      date: { gte: dayStart, lt: dayEnd },
      queueStatus: { in: [...KIOSK_TODAY_STATUSES] },
    },
    {
      date: { gte: dayEnd, lt: weekEnd },
      queueStatus: { in: [...KIOSK_UPCOMING_STATUSES] },
    },
  ];

  const found = await runWithTenant({ kind: "SYSTEM" }, async () => {
    const owners = await findVerifiedPhoneOwners(prisma, clinic.id, phone);
    if (owners.length > 0) {
      return {
        card: await pickKioskOwner(clinic.id, owners, liveBookings),
        unverified: false,
      };
    }
    const claim = await findPhoneClaim(prisma, clinic.id, phone);
    return claim ? { card: claim, unverified: true } : null;
  });
  const patient = found?.card ?? null;

  if (!patient) {
    return Response.json({ patient: null, appointments: [], upcoming: [] });
  }

  const all = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        clinicId: clinic.id,
        patientId: patient.id,
        OR: liveBookings,
      },
      select: {
        id: true,
        date: true,
        primaryService: { select: { nameRu: true } },
        queueOrder: true,
        ticketSeq: true,
        queueStatus: true,
        doctor: {
          select: {
            id: true,
            nameRu: true,
            ticketPrefix: true,
            cabinet: { select: { number: true } },
          },
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
    patient: {
      id: patient.id,
      fullName: maskPatientName(patient.fullName),
      unverified: found!.unverified,
    },
    appointments: today.map((a) => ({
      id: a.id,
      doctorName: a.doctor.nameRu,
      cabinet: a.doctor.cabinet?.number ?? null,
      service: a.primaryService?.nameRu ?? null,
      time: formatTime(a.date),
      queueOrder: a.queueOrder,
      queueStatus: a.queueStatus,
      ticketNumber: ticketNumberFor(a.doctor, a.ticketSeq ?? a.queueOrder),
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
