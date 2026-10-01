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
  findKioskCards,
  isNumberCard,
  type KioskCard,
} from "@/server/kiosk/phone-cards";
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

const bookingSelect = {
  id: true,
  patientId: true,
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
} satisfies Prisma.AppointmentSelect;

type BookingRow = Prisma.AppointmentGetPayload<{ select: typeof bookingSelect }>;

/** One card's bookings, split into today (check-in) and later days (info). */
function bookingsView(rows: BookingRow[], dayEnd: Date) {
  const today = rows.filter((a) => a.date < dayEnd);
  const upcoming = rows.filter((a) => a.date >= dayEnd);
  return {
    appointments: today.map((a) => ({
      id: a.id,
      doctorName: a.doctor.nameRu,
      cabinet: a.doctor.cabinet?.number ?? null,
      service: a.primaryService?.nameRu ?? null,
      time: tashkentComponents(a.date).time, // "HH:mm" in Tashkent wall clock
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
  };
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

  // Relatives on the same number (audit P1D-02): the son registered under
  // his mother's phone, the child she booked for in the Mini App. Their
  // bookings were invisible, so they could not check in.
  const cards = await runWithTenant({ kind: "SYSTEM" }, () =>
    findKioskCards(prisma, clinic.id, phone),
  );
  if (cards.length === 0) {
    return Response.json({ patient: null, appointments: [], upcoming: [], people: [] });
  }

  const findBookings = (patientId: string | { in: string[] }) =>
    runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.appointment.findMany({
        where: { clinicId: clinic.id, patientId, OR: liveBookings },
        select: bookingSelect,
        orderBy: { date: "asc" },
      }),
    );

  const owners = cards.filter((c) => c.relation === "owner");
  const claim = cards.find((c) => c.relation === "claim") ?? null;
  let patient: KioskCard | null =
    owners.length > 0
      ? await runWithTenant({ kind: "SYSTEM" }, () =>
          pickKioskOwner(clinic.id, owners, liveBookings),
        )
      : claim;
  let mine: BookingRow[];
  let theirs: BookingRow[];
  if (patient) {
    const primaryId = patient.id;
    mine = await findBookings(primaryId);
    // Everyone else on the number, in one query.
    const otherIds = cards.filter((c) => c.id !== primaryId).map((c) => c.id);
    theirs = otherIds.length > 0 ? await findBookings({ in: otherIds }) : [];
  } else {
    // Only relatives hold the number (its owner's card is gone). Like any
    // relative, one is offered only with a booking; with none it is a
    // first visit, and the kiosk reveals no name.
    theirs = await findBookings({ in: cards.map((c) => c.id) });
    patient = cards.find((c) => theirs.some((a) => a.patientId === c.id)) ?? null;
    if (!patient) {
      return Response.json({ patient: null, appointments: [], upcoming: [], people: [] });
    }
    const primaryId = patient.id;
    mine = theirs.filter((a) => a.patientId === primaryId);
  }
  const primaryCard = patient;
  const others = cards.filter((c) => c.id !== primaryCard.id);

  // Masked, no phone: whoever stands at the tablet typed a number, which
  // does not make them that patient.
  const person = (card: KioskCard, rows: BookingRow[]) => ({
    id: card.id,
    fullName: maskPatientName(card.fullName),
    unverified: card.unverified,
    relation: card.relation,
    ...bookingsView(rows, dayEnd),
  });
  const primary = person(primaryCard, mine);
  // The number's own cards are always offered (the two LD-10 owners); a
  // relative only with a booking to check in to or to be told about. One
  // without registers by name, which finds his card (decidePhoneOwner).
  const people = [
    primary,
    ...others
      .map((c) => person(c, theirs.filter((a) => a.patientId === c.id)))
      .filter((p, i) => isNumberCard(others[i]!) || p.appointments.length + p.upcoming.length > 0),
  ];

  return Response.json({
    patient: {
      id: primary.id,
      fullName: primary.fullName,
      unverified: primary.unverified,
    },
    appointments: primary.appointments,
    upcoming: primary.upcoming,
    // More than one: the kiosk asks «Кто пришёл?» before showing bookings.
    people,
  });
}
