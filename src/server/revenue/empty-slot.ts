/**
 * Empty Slot Engine — Phase 14, Wave 2.
 *
 * Per (doctor, day): how many revenue-bearing hours did the doctor work
 * vs. how many were actually booked, and what's the estimated revenue
 * lost on the empty hours.
 *
 * Two-layer design:
 *   1. `computeEmptySlot` is a pure setminus + multiplication. No DB. The
 *      bulk of the test surface lives here so the engine is deterministic.
 *   2. `snapshotEmptySlotsForDay` is the side-effecting wrapper. It pulls
 *      `DoctorSchedule`, `Appointment`, and an average price per doctor's
 *      specialty from Prisma, calls `computeEmptySlot`, and writes one
 *      `EmptySlotSnapshot` row per empty (doctor, hour) for the date.
 *
 * Idempotency: each snapshot run for a (clinicId, doctorId, date) clears
 * any prior rows for that triple inside a single transaction so re-running
 * the daily job never double-counts. Subsequent re-runs converge to the
 * latest schedule/booking truth.
 *
 * Tenant context: this is a system-level analytics job. Reads are wrapped
 * in `runWithTenant({ kind: "SYSTEM" }, …)` (mirroring `triggers.ts` and
 * `actions/scheduler.ts`) and the explicit `clinicId` in the WHERE clauses
 * keeps us scoped without depending on the tenant extension.
 *
 * Money units: every UZS value the engine touches is in **tiins** (minor
 * units, ×100 of soum). The schema's `Service.priceBase`, `Appointment
 * .priceFinal`, and `EmptySlotSnapshot.estimatedRevenueLossUzs` are all
 * tiins-typed integers — no floats anywhere in the math.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { TenantScopedPrisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

export type EmptySlotInput = {
  doctorId: string;
  /** A specific calendar day (any timestamp inside it; the engine doesn't care). */
  date: Date;
  /** Hours of day 0..23 that the doctor was scheduled. */
  workingHours: number[];
  /** Hours of day with at least one non-cancelled appointment. */
  bookedHours: number[];
  /** Average service price for the doctor's specialty in tiins. */
  averageServicePriceUzs: number;
};

export type EmptySlotResult = {
  /** workingHours setminus bookedHours, sorted ascending, deduped. */
  emptyHours: number[];
  /** `emptyHours.length * averageServicePriceUzs`, in tiins. Always integer. */
  estimatedRevenueLossUzs: number;
};

/** Restrict to integer hours 0..23 and dedupe. */
function normalizeHours(hours: ReadonlyArray<number>): number[] {
  const seen = new Set<number>();
  for (const h of hours) {
    if (!Number.isFinite(h)) continue;
    const intH = Math.trunc(h);
    if (intH < 0 || intH > 23) continue;
    seen.add(intH);
  }
  return Array.from(seen).sort((a, b) => a - b);
}

/**
 * Pure setminus + revenue multiplication. Exported for unit tests.
 *
 * Contract:
 *   emptyHours = sort(unique(workingHours) \ unique(bookedHours))
 *   estimatedRevenueLossUzs = emptyHours.length * averageServicePriceUzs
 *
 * Negative or non-finite `averageServicePriceUzs` is clamped to 0 so a
 * mis-estimated price never produces a nonsense (negative) loss row.
 */
export function computeEmptySlot(input: EmptySlotInput): EmptySlotResult {
  const working = normalizeHours(input.workingHours);
  const booked = new Set(normalizeHours(input.bookedHours));
  const emptyHours = working.filter((h) => !booked.has(h));
  const avg =
    Number.isFinite(input.averageServicePriceUzs) &&
    input.averageServicePriceUzs > 0
      ? Math.trunc(input.averageServicePriceUzs)
      : 0;
  return {
    emptyHours,
    // Integer × integer → integer. Math.trunc above guarantees that.
    estimatedRevenueLossUzs: emptyHours.length * avg,
  };
}

/**
 * Expand a `DoctorSchedule` `(startTime, endTime)` HH:mm pair into the
 * integer hours it covers on a single day.
 *
 *   "09:00"-"12:00" → [9, 10, 11]
 *   "09:30"-"11:00" → [9, 10]   (any minute occupies the hour)
 *   "09:00"-"09:30" → [9]
 *   "10:00"-"10:00" → []        (zero-length window)
 *   bad input       → []
 *
 * This is forgiving by design: schedule rows that span midnight are not
 * supported by the schema (UI enforces start < end) so we treat them as
 * empty and let the calling job log a no-op.
 */
export function expandScheduleHours(
  startTime: string,
  endTime: string,
): number[] {
  const sm = /^(\d{1,2}):(\d{2})$/.exec(startTime);
  const em = /^(\d{1,2}):(\d{2})$/.exec(endTime);
  if (!sm || !em) return [];
  const sh = Number(sm[1]);
  const smin = Number(sm[2]);
  const eh = Number(em[1]);
  const emin = Number(em[2]);
  if (
    !Number.isFinite(sh) ||
    !Number.isFinite(smin) ||
    !Number.isFinite(eh) ||
    !Number.isFinite(emin)
  )
    return [];
  if (sh < 0 || sh > 23 || eh < 0 || eh > 24) return [];
  const startMin = sh * 60 + smin;
  const endMin = eh * 60 + emin;
  if (endMin <= startMin) return [];

  const out: number[] = [];
  // First hour: include `floor(startMin / 60)` whenever any minute of the
  // hour falls inside the window.
  const firstHour = Math.floor(startMin / 60);
  // Last hour: the window covers any hour `h` such that `h*60 < endMin`.
  // Equivalently the last covered hour is `ceil(endMin/60) - 1`.
  const lastHour = Math.ceil(endMin / 60) - 1;
  for (let h = firstHour; h <= lastHour; h += 1) {
    if (h < 0 || h > 23) continue;
    out.push(h);
  }
  return out;
}

/** Floor `d` to the start of its UTC day. Mirrors `_shared.ts`. */
function startOfUtcDay(d: Date): Date {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

type DoctorRow = {
  id: string;
  specializationRu: string;
  pricePerVisit: number | null;
};

type ScheduleRow = {
  doctorId: string;
  startTime: string;
  endTime: string;
};

type ApptRow = {
  doctorId: string;
  date: Date;
  endDate: Date;
};

type ServiceRow = {
  priceBase: number;
};

/**
 * Status values that DO occupy a slot. Mirrors the convention used by the
 * EMPTY_SLOT_TOMORROW detector (anything except CANCELLED — NO_SHOW still
 * means the slot was booked at the time we're snapshotting). The roadmap
 * spec language ("non-cancelled appointments") is reflected in the
 * detector's `notIn: ["CANCELLED"]`; we keep the same convention.
 */
const SLOT_OCCUPYING_STATUSES = [
  "BOOKED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "SKIPPED",
  "NO_SHOW",
] as const;

/**
 * Tenant-scoped client. Narrowed from `TenantScopedPrisma | PrismaClient`
 * because TS couldn't unify overload signatures across extended/raw
 * clients (TS2349). Mirrors `_shared.ts`. The `$transaction` site casts
 * explicitly to `PrismaClient` to expose the overload it needs.
 */
type PrismaLike = TenantScopedPrisma;

/** Average `Service.priceBase` (tiins) for doctors keyed by id. */
async function loadAveragePriceByDoctor(
  prisma: PrismaLike,
  clinicId: string,
  doctorIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (doctorIds.length === 0) return out;

  // Per-doctor: average of services bound via ServiceOnDoctor (active only).
  const links = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.serviceOnDoctor.findMany({
      where: {
        doctorId: { in: doctorIds },
        service: { clinicId, isActive: true },
      },
      select: {
        doctorId: true,
        service: { select: { priceBase: true, isActive: true } },
      },
    }),
  )) as Array<{
    doctorId: string;
    service: { priceBase: number; isActive: boolean } | null;
  }>;

  const tally = new Map<string, { sum: number; count: number }>();
  for (const link of links) {
    if (!link.service || !link.service.isActive) continue;
    const cur = tally.get(link.doctorId) ?? { sum: 0, count: 0 };
    cur.sum += link.service.priceBase;
    cur.count += 1;
    tally.set(link.doctorId, cur);
  }
  for (const [doctorId, t] of tally.entries()) {
    if (t.count > 0) out.set(doctorId, Math.round(t.sum / t.count));
  }
  return out;
}

/** Clinic-level fallback: average of all active services. */
async function loadClinicAveragePrice(
  prisma: PrismaLike,
  clinicId: string,
): Promise<number> {
  const services = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.service.findMany({
      where: { clinicId, isActive: true },
      select: { priceBase: true },
    }),
  )) as ServiceRow[];
  if (services.length === 0) return 0;
  const sum = services.reduce((acc, s) => acc + s.priceBase, 0);
  return Math.round(sum / services.length);
}

/**
 * Walk every active doctor in `clinicId`, snapshot one row per empty hour
 * on the calendar `date`, and return aggregate stats.
 *
 * The function is idempotent at the (clinicId, doctorId, date) grain:
 * before inserting it deletes any existing rows for the same triple so
 * re-running the snapshot is safe and converges.
 */
export async function snapshotEmptySlotsForDay(
  prisma: PrismaLike,
  clinicId: string,
  date: Date,
): Promise<{ snapshotsWritten: number; totalLossUzs: number }> {
  const dayStart = startOfUtcDay(date);
  const dayEnd = addDays(dayStart, 1);
  // JS getUTCDay: Sun=0..Sat=6 — DoctorSchedule uses the same convention.
  const weekday = dayStart.getUTCDay();

  const doctors = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.doctor.findMany({
      where: { clinicId, isActive: true },
      select: { id: true, specializationRu: true, pricePerVisit: true },
    }),
  )) as DoctorRow[];
  if (doctors.length === 0) {
    return { snapshotsWritten: 0, totalLossUzs: 0 };
  }
  const doctorIds = doctors.map((d) => d.id);

  const schedules = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.doctorSchedule.findMany({
      where: {
        clinicId,
        doctorId: { in: doctorIds },
        weekday,
        isActive: true,
        OR: [
          { validFrom: null, validTo: null },
          { validFrom: { lte: dayEnd }, validTo: null },
          { validFrom: null, validTo: { gte: dayStart } },
          { validFrom: { lte: dayEnd }, validTo: { gte: dayStart } },
        ],
      },
      select: { doctorId: true, startTime: true, endTime: true },
    }),
  )) as ScheduleRow[];

  const appts = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        clinicId,
        doctorId: { in: doctorIds },
        date: { gte: dayStart, lt: dayEnd },
        status: { in: [...SLOT_OCCUPYING_STATUSES] },
      },
      select: { doctorId: true, date: true, endDate: true },
    }),
  )) as ApptRow[];

  const avgByDoctor = await loadAveragePriceByDoctor(prisma, clinicId, doctorIds);
  const clinicAvg = await loadClinicAveragePrice(prisma, clinicId);

  const schedByDoctor = new Map<string, ScheduleRow[]>();
  for (const s of schedules) {
    const arr = schedByDoctor.get(s.doctorId) ?? [];
    arr.push(s);
    schedByDoctor.set(s.doctorId, arr);
  }

  const apptsByDoctor = new Map<string, ApptRow[]>();
  for (const a of appts) {
    const arr = apptsByDoctor.get(a.doctorId) ?? [];
    arr.push(a);
    apptsByDoctor.set(a.doctorId, arr);
  }

  type Insert = {
    clinicId: string;
    doctorId: string;
    date: Date;
    hour: number;
    estimatedRevenueLossUzs: number;
  };
  const inserts: Insert[] = [];
  let totalLossUzs = 0;

  for (const doctor of doctors) {
    const rows = schedByDoctor.get(doctor.id) ?? [];
    if (rows.length === 0) continue;
    const workingHours: number[] = [];
    for (const r of rows) workingHours.push(...expandScheduleHours(r.startTime, r.endTime));
    if (workingHours.length === 0) continue;

    const bookedHours: number[] = [];
    for (const a of apptsByDoctor.get(doctor.id) ?? []) {
      // An appointment occupies every UTC hour it overlaps. We use UTC
      // because the snapshot's `date` is UTC-anchored and the schedule
      // hours were derived in UTC too.
      const startMs = a.date.getTime();
      const endMs = a.endDate.getTime();
      const dayStartMs = dayStart.getTime();
      const dayEndMs = dayEnd.getTime();
      const lo = Math.max(startMs, dayStartMs);
      const hi = Math.min(endMs, dayEndMs);
      if (hi <= lo) continue;
      const startHour = Math.floor((lo - dayStartMs) / (60 * 60 * 1000));
      const endHourExclusive = Math.ceil((hi - dayStartMs) / (60 * 60 * 1000));
      for (let h = startHour; h < endHourExclusive; h += 1) {
        if (h >= 0 && h < 24) bookedHours.push(h);
      }
    }

    const avg =
      avgByDoctor.get(doctor.id) ??
      (doctor.pricePerVisit && doctor.pricePerVisit > 0
        ? doctor.pricePerVisit
        : clinicAvg);

    const result = computeEmptySlot({
      doctorId: doctor.id,
      date: dayStart,
      workingHours,
      bookedHours,
      averageServicePriceUzs: avg,
    });

    for (const hour of result.emptyHours) {
      inserts.push({
        clinicId,
        doctorId: doctor.id,
        date: dayStart,
        hour,
        estimatedRevenueLossUzs: avg,
      });
    }
    totalLossUzs += result.estimatedRevenueLossUzs;
  }

  // Idempotent rewrite: delete prior snapshots for the same (clinicId, date)
  // and insert the new set in one transaction.
  //
  // The tenant-scoped wrapper widens `$transaction`'s callback shape, so
  // we cast `tx` through a structural type to keep the engine portable
  // (PrismaClient | TenantScopedPrisma).
  type Tx = Prisma.TransactionClient;
  await runWithTenant({ kind: "SYSTEM" }, () =>
    (prisma as PrismaClient).$transaction(async (tx: Tx) => {
      await tx.emptySlotSnapshot.deleteMany({
        where: {
          clinicId,
          doctorId: { in: doctorIds },
          date: dayStart,
        },
      });
      if (inserts.length > 0) {
        await tx.emptySlotSnapshot.createMany({
          data: inserts as unknown as Prisma.EmptySlotSnapshotCreateManyInput[],
        });
      }
    }),
  );

  return { snapshotsWritten: inserts.length, totalLossUzs };
}
