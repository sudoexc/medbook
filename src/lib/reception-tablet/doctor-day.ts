/**
 * What the reception tablet shows per doctor and per booking, derived from
 * the two live lists the desk already reads: today's appointments
 * (`GET /api/crm/appointments`, the reception panels' query) and the
 * schedule-aware «today» per doctor (`GET /api/crm/doctors/today`).
 *
 * Pure: shared by the page and the unit tests. The lane rules come from
 * `lib/queue-ordering` and the «Пришёл» rule from `lib/appointments/lifecycle`,
 * so the tablet can never disagree with the desktop reception.
 */
import {
  getQuickActions,
  type LifecycleRole,
} from "@/lib/appointments/lifecycle";
import type { AppointmentStatus } from "@/lib/appointment-transitions";
import { compareQueue, isLiveLane, isLiveWaiting } from "@/lib/queue-ordering";
import { addTashkentDays, tashkentDateOf } from "@/lib/tashkent-time";

/** The slice of an appointments-list row the tablet reads. */
export type TabletApptRow = {
  id: string;
  date: string;
  time?: string | null;
  durationMin: number;
  status: AppointmentStatus;
  queueStatus: AppointmentStatus;
  channel: string;
  queuePriority: number;
  queuedAt: string | null;
  ticketSeq: number | null;
  queueOrder: number | null;
  startedAt: string | null;
  autoNoShow?: boolean;
  patient: { id: string; fullName: string; phone?: string | null };
  doctor: { id: string };
};

/** The slice of a `/api/crm/doctors/today` row the tablet reads. */
export type DoctorTodayLike = {
  doctorId: string;
  workingMinutes: number;
  status: "busy" | "free" | "off";
  nextFree: string | null;
  /**
   * First day of the next 15 he can be booked on (server/doctors/today).
   * Optional: an older server does not send it.
   */
  nextWorkDay?: string | null;
};

/** A doctor as the tablet lists them (the doctors list endpoint's row). */
export type TabletDoctorLike = {
  id: string;
  nameRu: string;
  nameUz: string;
  ticketPrefix: string | null;
  cabinet: { number: string } | null;
};

/** A visit with no length on it is planned at the booking grid's step. */
export const DEFAULT_VISIT_MIN = 20;

export type DoctorDaySummary = {
  doctorId: string;
  /** Everyone WAITING for this doctor now: walk-ins and arrived bookings. */
  waiting: number;
  /** The patient on the table, if any. */
  inside: { patientName: string; startedAt: string | null } | null;
  /** Rough minutes a patient joining the queue now would wait. */
  waitMin: number;
  /** Bookings of today still ahead (BOOKED / CONFIRMED). */
  bookedAhead: number;
  /** Working time by the schedule today, time off cut out. */
  scheduled: boolean;
  /** Shown on the tablet's home: scheduled, or already busy with patients. */
  onDuty: boolean;
  status: "busy" | "free" | "off";
  /** First free booking slot today, «HH:mm». */
  nextFree: string | null;
  /** First day of the booking calendar's 15 he works, «YYYY-MM-DD», or null. */
  nextWorkDay: string | null;
  /**
   * «Записать на время» offers him: on duty today, or working on one of
   * the next 15 days. A doctor off today but in tomorrow is bookable.
   */
  bookable: boolean;
};

function laneStatus(r: Pick<TabletApptRow, "queueStatus" | "status">): AppointmentStatus {
  return (r.queueStatus ?? r.status) as AppointmentStatus;
}

function plannedMin(r: Pick<TabletApptRow, "durationMin">, fallback: number): number {
  return r.durationMin > 0 ? r.durationMin : fallback;
}

/**
 * Rough wait for a patient joining a doctor's queue now: what is left of the
 * visit on the table plus the planned length of every visit waiting ahead.
 * Bookings due meanwhile are not counted, so the real wait can be longer;
 * the tablet says «≈».
 */
export function estimateWaitMinutes(args: {
  current: Pick<TabletApptRow, "durationMin" | "startedAt"> | null;
  waiting: ReadonlyArray<Pick<TabletApptRow, "durationMin">>;
  now: Date;
  fallbackMin?: number;
}): number {
  const fallback = args.fallbackMin ?? DEFAULT_VISIT_MIN;
  let total = 0;
  if (args.current) {
    const planned = plannedMin(args.current, fallback);
    if (args.current.startedAt) {
      const elapsed = (args.now.getTime() - new Date(args.current.startedAt).getTime()) / 60_000;
      total += Math.max(0, planned - Math.max(0, elapsed));
    } else {
      total += planned;
    }
  }
  for (const w of args.waiting) total += plannedMin(w, fallback);
  return Math.round(total);
}

/** One doctor's day on the tablet. `rows` may hold every doctor's rows. */
export function summarizeDoctorDay(args: {
  doctorId: string;
  rows: ReadonlyArray<TabletApptRow>;
  today: DoctorTodayLike | undefined;
  /** The schedule summary could not be loaded: keep the doctor on screen. */
  scheduleUnknown?: boolean;
  now: Date;
}): DoctorDaySummary {
  const day = tashkentDateOf(args.now);
  const own = args.rows.filter(
    (r) => r.doctor.id === args.doctorId && tashkentDateOf(r.date) === day,
  );
  const current = own.find((r) => laneStatus(r) === "IN_PROGRESS") ?? null;
  const waiting = own.filter((r) => laneStatus(r) === "WAITING");
  const bookedAhead = own.filter(
    (r) =>
      !isLiveLane(r) &&
      (laneStatus(r) === "BOOKED" || laneStatus(r) === "CONFIRMED") &&
      new Date(r.date).getTime() >= args.now.getTime(),
  ).length;
  const scheduled = (args.today?.workingMinutes ?? 0) > 0;
  const nextFree = args.today?.nextFree ?? null;
  const status: DoctorDaySummary["status"] = current
    ? "busy"
    : (args.today?.status ?? "off");
  const onDuty =
    args.scheduleUnknown === true ||
    scheduled ||
    nextFree !== null ||
    current !== null ||
    waiting.length > 0 ||
    bookedAhead > 0;
  const nextWorkDay = args.today?.nextWorkDay ?? null;
  return {
    doctorId: args.doctorId,
    waiting: waiting.length,
    inside: current
      ? { patientName: current.patient.fullName, startedAt: current.startedAt }
      : null,
    waitMin: estimateWaitMinutes({ current, waiting, now: args.now }),
    bookedAhead,
    scheduled,
    // A doctor with no schedule rows at all still takes bookings (the slot
    // finder's 09:00-19:00 fallback), and one who came in outside his
    // schedule is on duty the moment he has a patient: both stay on screen.
    onDuty,
    status,
    nextFree,
    nextWorkDay,
    // An older server without `nextWorkDay` leaves booking as it was:
    // whoever is on duty today.
    bookable: onDuty || nextWorkDay !== null,
  };
}

/** «101», «12a», «7» compare as people read cabinet numbers. */
const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

/**
 * The tiles in a fixed order: by cabinet, then by name. Never by load or
 * status: a tile that moves while the receptionist reaches for it is a
 * patient put in the wrong queue. Off-duty doctors go last, and only when
 * the receptionist asked for everyone.
 *
 * `forBooking` («Записать на время»): a booking is for a day of the next
 * 15, so after today's doctors come those who work later in that window
 * (WHY: the step used to show today's doctors only, and a patient for a
 * doctor in on Thursday could not be booked from the tablet at all
 * without «Показать всех»). Still a fixed order: today's first, then the
 * rest, each by cabinet.
 */
export function orderTabletDoctors<D extends TabletDoctorLike>(
  doctors: ReadonlyArray<D>,
  summaries: ReadonlyMap<string, DoctorDaySummary>,
  opts: { showAll: boolean; forBooking?: boolean },
): D[] {
  const byPlace = (a: D, b: D) => {
    const ca = a.cabinet?.number ?? "";
    const cb = b.cabinet?.number ?? "";
    if (ca && cb && ca !== cb) return collator.compare(ca, cb);
    if (ca !== cb) return ca ? -1 : 1;
    return collator.compare(a.nameRu, b.nameRu);
  };
  const onDuty = doctors.filter((d) => summaries.get(d.id)?.onDuty).sort(byPlace);
  const later = opts.forBooking
    ? doctors
        .filter((d) => !summaries.get(d.id)?.onDuty && summaries.get(d.id)?.bookable)
        .sort(byPlace)
    : [];
  const shown = [...onDuty, ...later];
  if (!opts.showAll) return shown;
  const ids = new Set(shown.map((d) => d.id));
  const rest = doctors.filter((d) => !ids.has(d.id)).sort(byPlace);
  return [...shown, ...rest];
}

/**
 * The day «Записать на время» opens on for a doctor: the day already
 * picked, unless that is before his first working day of the window, which
 * then takes its place (he has no slot before it, the strip would only
 * answer «нет свободного времени»).
 */
export function openingBookingDay(
  current: string | null,
  nextWorkDay: string | null | undefined,
): string | null {
  if (!nextWorkDay) return current;
  if (!current || current < nextWorkDay) return nextWorkDay;
  return current;
}

/** Minutes a booking is past its slot start (0 while it is still ahead). */
export function lateMinutes(row: Pick<TabletApptRow, "date">, now: Date): number {
  const diff = Math.floor((now.getTime() - new Date(row.date).getTime()) / 60_000);
  return diff > 0 ? diff : 0;
}

/**
 * «Пришли по записи»: today's bookings the desk can check in now, by slot
 * time. Same rule as the reception panels' «Пришёл» button
 * (`getQuickActions`): today only, BOOKED or CONFIRMED, and a no-show the
 * sweep set for a patient who came late.
 */
export function arrivalsFor(
  rows: ReadonlyArray<TabletApptRow>,
  role: LifecycleRole,
  now: Date,
): TabletApptRow[] {
  const day = tashkentDateOf(now);
  return rows
    .filter((r) => !isLiveLane(r) && tashkentDateOf(r.date) === day)
    .filter((r) =>
      getQuickActions(laneStatus(r), role, new Date(r.date), now, {
        autoNoShow: r.autoNoShow === true,
      }).some((a) => a.kind === "ARRIVED"),
    )
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Where a walk-in stands in his doctor's live queue: 1 is next. Null when
 * the row is not (or no longer) waiting there.
 */
export function queuePlace(
  rows: ReadonlyArray<TabletApptRow>,
  appointmentId: string,
  doctorId: string,
): number | null {
  const live = rows
    .filter((r) => r.doctor.id === doctorId && isLiveWaiting(r))
    .slice()
    .sort(compareQueue);
  const idx = live.findIndex((r) => r.id === appointmentId);
  return idx >= 0 ? idx + 1 : null;
}

/**
 * Walk-ins waiting in a doctor's live queue: the people a ticket issued now
 * stands behind, until the refreshed list gives its exact place.
 */
export function liveWaitingCount(
  rows: ReadonlyArray<TabletApptRow>,
  doctorId: string,
): number {
  return rows.filter((r) => r.doctor.id === doctorId && isLiveWaiting(r)).length;
}

/** Days the booking strip offers: today and the next `count - 1`. */
export function dayStrip(today: string, count = 15): string[] {
  return Array.from({ length: count }, (_, i) => addTashkentDays(today, i));
}

export type SlotGroups = { morning: string[]; afternoon: string[]; evening: string[] };

/** Slots split into before 12:00, 12:00 to 17:00 and from 17:00. */
export function groupSlots(slots: ReadonlyArray<string>): SlotGroups {
  const out: SlotGroups = { morning: [], afternoon: [], evening: [] };
  for (const s of slots) {
    const hour = Number(s.slice(0, 2));
    if (hour < 12) out.morning.push(s);
    else if (hour < 17) out.afternoon.push(s);
    else out.evening.push(s);
  }
  return out;
}

/** The instant the slots API and the booking route read a Tashkent day from. */
export function tashkentNoonIso(day: string): string {
  return new Date(`${day}T12:00:00+05:00`).toISOString();
}

/** «1 ч 25 мин»-style split for the rough wait. */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  const t = Math.max(0, Math.round(total));
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}
