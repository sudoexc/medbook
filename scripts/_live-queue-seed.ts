/**
 * Shared live-queue seeder — builds TODAY's live queue for the neurofax demo
 * the way the real walk-in / check-in paths do, so the TV board, the kiosk
 * doctor list and the patient ticket all render a believable mid-shift clinic.
 *
 * Every row it writes is correct under the serveAt EDF model
 * (see src/lib/queue-ordering.ts):
 *
 *   - `time` is the Tashkent wall-clock string the board displays. Prod runs UTC;
 *     a naive `new Date().getHours()` would skew the column −5h.
 *   - `queueOrder` + `ticketSeq` are a per-doctor-per-day 1-based sequence in the
 *     order patients JOINED the queue (COMPLETED → IN_PROGRESS → WAITING by
 *     arrival), exactly what `allocateQueueOrder` would have handed out.
 *     `ticketSeq` is the immutable ticket number; the board re-sorts by
 *     `compareQueue`, so display order ≠ join order on purpose (срочно floats up,
 *     a late arrival sinks down).
 *   - `queuedAt` is the serveAt anchor: walk-ins are served FIFO from arrival;
 *     scheduled visits at `max(slot, arrival)`.
 *   - Walk-ins (channel WALKIN) are exempt from the `Appointment_*_no_overlap`
 *     exclusion constraints (migration 20260627120000), so several can sit at
 *     ~now for one doctor. Scheduled rows get distinct 30-min grid slots so they
 *     never collide on (doctorId|cabinetId, time-range).
 *
 * Scenarios baked into each scheduled doctor's queue so the boss sees them all:
 *   COMPLETED earlier today (+ PAID payment) · one freed NO_SHOW + one CANCELLED ·
 *   one IN_PROGRESS (current patient, startedAt set) · walk-ins from the street ·
 *   a scheduled patient who arrived on time · a «срочно» bump (queuePriority=1
 *   floats to the top) · a late arrival that demotes below the on-time crowd ·
 *   later BOOKED/CONFIRMED rows not yet arrived (no ticket yet).
 *
 * The board only shows doctors with an active DoctorSchedule for today's
 * weekday, so the caller passes exactly those doctors.
 */
import type { PrismaClient } from "../src/generated/prisma/client";
import {
  tashkentComponents,
  tashkentDayBounds,
  toTashkentDate,
} from "../src/lib/booking-validation";

/** The worker-script client (full PrismaClient or an interactive tx handle). */
type Db = Pick<
  PrismaClient,
  | "appointment"
  | "appointmentService"
  | "payment"
  | "doctorSchedule"
  | "doctor"
  | "document"
  | "notificationSend"
  | "reminder"
  | "visitNote"
  | "labResult"
  | "labOrder"
  | "ePrescription"
  | "sickLeave"
  | "cdsOverride"
  | "conversation"
>;

// ─── tiny utils (kept local so the seed has no runtime deps) ─────────────────
const rand = (n: number) => Math.floor(Math.random() * n);
const TICKET_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
function randomTicketCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += TICKET_ALPHABET[rand(TICKET_ALPHABET.length)];
  return out;
}
function shuffle<T>(arr: readonly T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}
function parseHM(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h ?? 9) * 60 + (m ?? 0);
}
/** Tashkent minutes-since-midnight → "HH:MM". */
function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const SLOT_MIN = 30;

// ─── public types ────────────────────────────────────────────────────────────
export type SeedDoctor = {
  id: string;
  cabinetId: string | null;
  pricePerVisit: number | null;
  scheduleStart?: string; // "HH:MM" — defaults to 09:00
  scheduleEnd?: string; // "HH:MM" — defaults to 18:00
};
export type SeedService = { id: string; durationMin: number; priceBase: number };
export type SeedPatientRef = { id: string };

type Channel = "WALKIN" | "PHONE" | "TELEGRAM" | "WEBSITE" | "KIOSK";
type Status =
  | "BOOKED"
  | "CONFIRMED"
  | "WAITING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "SKIPPED"
  | "CANCELLED"
  | "NO_SHOW";

/**
 * Build one row. Centralises the field defaults so every scenario is consistent:
 * `time` always Tashkent wall-clock, `queueStatus` mirrors `status`, the price
 * pair is filled, and overlap-relevant rows carry a real cabinet.
 */
async function makeAppointment(
  prisma: Db,
  args: {
    clinicId: string;
    doctor: SeedDoctor;
    service: SeedService;
    patientId: string;
    operatorId: string | null;
    dateStr: string;
    /** Slot/arrival instant in Tashkent minutes-since-midnight. */
    atMin: number;
    status: Status;
    channel: Channel;
    queueOrder: number | null;
    queuePriority?: number;
    /** serveAt anchor in Tashkent minutes; null → mirrors the slot. */
    queuedAtMin?: number | null;
    arrivedAtMin?: number | null;
    startedAtMin?: number | null;
    completedAtMin?: number | null;
    cancelledAtMin?: number | null;
    confirmed?: boolean;
  },
): Promise<{ id: string; status: Status; price: number }> {
  const toDate = (min: number) => toTashkentDate(args.dateStr, hhmm(min));
  const date = toDate(args.atMin);
  const time = tashkentComponents(date).time;
  const endDate = new Date(date.getTime() + SLOT_MIN * 60_000);
  const price = args.service.priceBase || args.doctor.pricePerVisit || 0;

  const appt = await prisma.appointment.create({
    data: {
      clinicId: args.clinicId,
      patientId: args.patientId,
      doctorId: args.doctor.id,
      // Left null: the cabinet overlap guard fires on any cabinetId match, so a
      // shared room across two doctors would crash the seed. The doctor-level
      // overlap guard (the one that protects queue correctness) still applies,
      // and the board reads each doctor's room from the Doctor record anyway.
      cabinetId: null,
      serviceId: args.service.id,
      date,
      time,
      durationMin: SLOT_MIN,
      endDate,
      status: args.status,
      queueStatus: args.status,
      queueOrder: args.queueOrder,
      ticketSeq: args.queueOrder,
      queuePriority: args.queuePriority ?? 0,
      queuedAt:
        args.queuedAtMin == null
          ? args.channel === "WALKIN"
            ? date
            : null
          : toDate(args.queuedAtMin),
      arrivedAt: args.arrivedAtMin == null ? null : toDate(args.arrivedAtMin),
      startedAt: args.startedAtMin == null ? null : toDate(args.startedAtMin),
      completedAt: args.completedAtMin == null ? null : toDate(args.completedAtMin),
      cancelledAt: args.cancelledAtMin == null ? null : toDate(args.cancelledAtMin),
      cancelledBy: args.status === "NO_SHOW" ? "no-show" : args.status === "CANCELLED" ? "patient" : null,
      confirmedAt: args.confirmed ? toDate(Math.max(0, args.atMin - 120)) : null,
      confirmedVia: args.confirmed ? "BOOKING_AUTO" : null,
      channel: args.channel,
      ticketCode: randomTicketCode(),
      createdById: args.channel === "WALKIN" || args.channel === "PHONE" ? args.operatorId : null,
      priceService: price,
      priceBase: price,
      priceFinal: price,
    },
  });

  await prisma.appointmentService.create({
    data: {
      clinicId: args.clinicId,
      appointmentId: appt.id,
      serviceId: args.service.id,
      priceSnap: price,
      quantity: 1,
    },
  });

  return { id: appt.id, status: args.status, price };
}

/**
 * Seed today's live queue for every board-visible doctor. Consumes patients
 * from a shared shuffled pool so no patient sits in two doctors' queues at once.
 */
export async function seedTodayLiveQueue(
  prisma: Db,
  opts: {
    clinicId: string;
    doctors: SeedDoctor[];
    services: SeedService[];
    patients: SeedPatientRef[];
    operatorId: string | null;
    now?: Date;
  },
): Promise<{ created: number; payments: number; perDoctor: Map<string, number> }> {
  const { clinicId, doctors, services, operatorId } = opts;
  const now = opts.now ?? new Date();
  const pool = shuffle(opts.patients);
  let cursor = 0;
  const nextPatient = (): string => {
    const p = pool[cursor % pool.length]!;
    cursor++;
    return p.id;
  };
  const pickSvc = () => services[rand(services.length)]!;

  const perDoctor = new Map<string, number>();
  let created = 0;
  let payments = 0;

  for (const doctor of doctors) {
    const openMin = parseHM(doctor.scheduleStart ?? "09:00");
    const closeMin = parseHM(doctor.scheduleEnd ?? "18:00");

    // Synthetic shift clock: real Tashkent "now" when it lands mid-shift,
    // otherwise a believable mid-morning anchor so COMPLETED rows sit in the
    // past and BOOKED rows in the future regardless of when the seed runs.
    const nowMin = tashkentComponents(now).minutes;
    const clockMin = clamp(nowMin, openMin + 150, closeMin - 90);
    const dateStr = tashkentComponents(now).date;
    // Current 30-min grid slot.
    const gridMin = Math.floor(clockMin / SLOT_MIN) * SLOT_MIN;

    // Per-doctor join sequence (the ticket number source).
    let seq = 0;
    let count = 0;

    // 1) COMPLETED earlier today — distinct past grid slots, counted in seq.
    const completedSlots = [gridMin - 180, gridMin - 150, gridMin - 120, gridMin - 90, gridMin - 60].filter(
      (m) => m >= openMin,
    );
    for (const slot of completedSlots) {
      const svc = pickSvc();
      const pid = nextPatient();
      const r = await makeAppointment(prisma, {
        clinicId,
        doctor,
        service: svc,
        patientId: pid,
        operatorId,
        dateStr,
        atMin: slot,
        status: "COMPLETED",
        channel: (["WALKIN", "PHONE", "TELEGRAM"] as const)[rand(3)],
        queueOrder: ++seq,
        queuedAtMin: slot - 10,
        arrivedAtMin: slot - 10,
        completedAtMin: slot + SLOT_MIN,
      });
      await prisma.payment.create({
        data: {
          clinicId,
          appointmentId: r.id,
          patientId: pid,
          currency: "UZS",
          amount: r.price,
          method: (["CASH", "CARD", "PAYME", "CLICK"] as const)[rand(4)],
          status: "PAID",
          paidAt: toTashkentDate(dateStr, hhmm(slot + SLOT_MIN)),
        },
      });
      created++;
      count++;
      payments++;
    }

    // 2) One freed NO_SHOW + one CANCELLED (exempt from overlap; slot reusable).
    await makeAppointment(prisma, {
      clinicId,
      doctor,
      service: pickSvc(),
      patientId: nextPatient(),
      operatorId,
      dateStr,
      atMin: gridMin - 30,
      status: "NO_SHOW",
      channel: "TELEGRAM",
      queueOrder: null,
    });
    await makeAppointment(prisma, {
      clinicId,
      doctor,
      service: pickSvc(),
      patientId: nextPatient(),
      operatorId,
      dateStr,
      atMin: gridMin - 45,
      status: "CANCELLED",
      channel: "PHONE",
      queueOrder: null,
      cancelledAtMin: gridMin - 90,
    });
    created += 2;
    count += 2;

    // 3) IN_PROGRESS — the current patient at the live slot.
    await makeAppointment(prisma, {
      clinicId,
      doctor,
      service: pickSvc(),
      patientId: nextPatient(),
      operatorId,
      dateStr,
      atMin: gridMin,
      status: "IN_PROGRESS",
      channel: (["WALKIN", "PHONE", "TELEGRAM"] as const)[rand(3)],
      queueOrder: ++seq,
      queuedAtMin: gridMin - 12,
      arrivedAtMin: gridMin - 18,
      startedAtMin: clockMin - 9,
    });
    created++;
    count++;

    // 4) WAITING queue. Each entry declares its arrival (serveAt anchor); we
    // assign queueOrder in arrival order so the immutable ticket reflects join
    // order while the board re-sorts by serveAt + priority.
    type Waiter = {
      channel: Channel;
      arriveMin: number; // queuedAt
      slotMin: number; // appointment date
      priority: number;
    };
    const waiters: Waiter[] = [
      // walk-ins off the street, served FIFO from arrival
      { channel: "WALKIN", arriveMin: clockMin - 26, slotMin: clockMin - 26, priority: 0 },
      { channel: "WALKIN", arriveMin: clockMin - 19, slotMin: clockMin - 19, priority: 0 },
      { channel: "WALKIN", arriveMin: clockMin - 11, slotMin: clockMin - 11, priority: 0 },
      // scheduled booking that arrived on time — serves at its (near-future) slot
      { channel: "PHONE", arriveMin: clockMin - 5, slotMin: gridMin + 30, priority: 0 },
      // «срочно» bump — floats to the very top regardless of arrival
      { channel: "WALKIN", arriveMin: clockMin - 7, slotMin: clockMin - 7, priority: 1 },
      // late arrival: booked for ~30 min ago, walks in now. serveAt = arrival,
      // so it sinks below the walk-ins who actually waited. Its slot sits in the
      // free [gridMin-30, gridMin) gap (NO_SHOW there is overlap-exempt) so the
      // scheduled-row doctor-overlap guard stays satisfied.
      { channel: "PHONE", arriveMin: clockMin - 3, slotMin: gridMin - 30, priority: 0 },
    ];
    // queueOrder = arrival order (earliest arrival → lowest ticket number).
    const byArrival = [...waiters].sort((a, b) => a.arriveMin - b.arriveMin);
    const orderOf = new Map<Waiter, number>();
    for (const w of byArrival) orderOf.set(w, ++seq);

    for (const w of waiters) {
      await makeAppointment(prisma, {
        clinicId,
        doctor,
        service: pickSvc(),
        patientId: nextPatient(),
        operatorId,
        dateStr,
        atMin: w.slotMin,
        status: "WAITING",
        channel: w.channel,
        queueOrder: orderOf.get(w)!,
        queuePriority: w.priority,
        queuedAtMin: w.arriveMin,
        arrivedAtMin: w.arriveMin,
      });
      created++;
      count++;
    }

    // 5) Later BOOKED / CONFIRMED — not yet arrived, so no ticket allocated.
    const futureSlots = [gridMin + 60, gridMin + 90, gridMin + 120].filter((m) => m + SLOT_MIN <= closeMin);
    for (const slot of futureSlots) {
      const isPhone = rand(2) === 0;
      await makeAppointment(prisma, {
        clinicId,
        doctor,
        service: pickSvc(),
        patientId: nextPatient(),
        operatorId,
        dateStr,
        atMin: slot,
        status: isPhone ? "CONFIRMED" : "BOOKED",
        channel: isPhone ? "PHONE" : "TELEGRAM",
        queueOrder: null,
        confirmed: isPhone,
      });
      created++;
      count++;
    }

    perDoctor.set(doctor.id, count);
  }

  return { created, payments, perDoctor };
}

/**
 * Doctors the live board will actually show today: those with an active
 * DoctorSchedule for today's Tashkent weekday. The board hides everyone else,
 * so the live queue must only be built for these.
 */
export async function todayScheduledDoctors(
  prisma: Db,
  clinicId: string,
  now: Date = new Date(),
): Promise<SeedDoctor[]> {
  const weekday = tashkentComponents(now).dow;
  const scheds = await prisma.doctorSchedule.findMany({
    where: { clinicId, weekday, isActive: true },
    select: { doctorId: true, startTime: true, endTime: true },
  });
  const byDoctor = new Map<string, { startTime: string; endTime: string }>();
  for (const s of scheds) if (!byDoctor.has(s.doctorId)) byDoctor.set(s.doctorId, s);
  if (byDoctor.size === 0) return [];

  const docs = await prisma.doctor.findMany({
    where: { clinicId, isActive: true, id: { in: [...byDoctor.keys()] } },
    select: { id: true, cabinetId: true, pricePerVisit: true },
  });
  return docs.map((d) => ({
    id: d.id,
    cabinetId: d.cabinetId,
    pricePerVisit: d.pricePerVisit,
    scheduleStart: byDoctor.get(d.id)?.startTime,
    scheduleEnd: byDoctor.get(d.id)?.endTime,
  }));
}

/**
 * Delete every appointment dated today (Tashkent) for this clinic, child rows
 * first, so the live queue can be rebuilt from scratch. Past/future days are
 * left untouched. Returns the number of appointments removed.
 */
export async function clearTodayAppointments(
  prisma: Db,
  clinicId: string,
  now: Date = new Date(),
): Promise<number> {
  const { dayStart, dayEnd } = tashkentDayBounds(now);
  const ids = (
    await prisma.appointment.findMany({
      where: { clinicId, date: { gte: dayStart, lt: dayEnd } },
      select: { id: true },
    })
  ).map((a) => a.id);
  if (ids.length === 0) return 0;

  const where = { appointmentId: { in: ids } };
  await prisma.payment.deleteMany({ where });
  await prisma.appointmentService.deleteMany({ where });
  await prisma.document.deleteMany({ where });
  await prisma.notificationSend.deleteMany({ where });
  await prisma.reminder.deleteMany({ where });
  await prisma.visitNote.deleteMany({ where });
  await prisma.labResult.deleteMany({ where });
  await prisma.labOrder.deleteMany({ where });
  await prisma.ePrescription.deleteMany({ where });
  await prisma.sickLeave.deleteMany({ where });
  await prisma.cdsOverride.deleteMany({ where });
  await prisma.conversation.deleteMany({ where });
  await prisma.appointment.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}
