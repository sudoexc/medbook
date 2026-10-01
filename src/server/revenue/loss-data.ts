/**
 * Server-side data loaders for the Loss Analytics dashboard
 * (/crm/analytics/loss). Pulls each of the three loss sources from Prisma,
 * normalises them into `LossEntry` rows, and returns aggregated totals via
 * the pure `loss-aggregation` helpers, plus the dormant base beside them.
 *
 * Heuristic notes (documented for Wave 4):
 *
 *   - **No-show / cancellation valuation**
 *     We use `Appointment.priceFinal` when present, falling back to
 *     `Service.priceBase` of the primary service, falling back to a
 *     clinic-level average price (sum of active service prices / count).
 *     This avoids double-counting `AppointmentService` rows when
 *     `priceFinal` is already a multi-service total.
 *
 *   - **Late cancellations**
 *     Only `Appointment.cancelledAt` is reliable for the "last 24h before
 *     start" check. When `cancelledAt` is null but `status = CANCELLED`,
 *     we fall back to `updatedAt` because the schema doesn't enforce a
 *     non-null cancelledAt. Rows whose fallback timestamp is also missing
 *     are skipped (treated as 0 loss to avoid inventing data).
 *
 *   - **Dormant patients** (audit AN-17)
 *     A stock reported beside the period, never inside its total or chart:
 *     patients whose last completed visit is 90 days old or more and who
 *     have nothing booked ahead, by `lastVisitAt` (kept current by
 *     `refreshPatientVisitStats`), not by the `dormantSince` stamp. The
 *     value per patient is the last 90 days' payments over the active
 *     patients, and only when the clinic has recorded every payment for
 *     those whole 90 days (`paymentsRecordedSince`); otherwise null, shown
 *     as «нет данных».
 *
 *   - **Top-by-doctor breakdown**
 *     We aggregate empty-slot snapshots and no-show appointments per
 *     doctor; cancellations are folded into the no-show bucket for the
 *     UI's purposes (both reflect "doctor whose patients didn't show").
 *     Dormant patients have no doctor scope so they're absent from the
 *     drill-down table; the segment table next to it covers them.
 */
import { ACTIVE_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import { tashkentDayBounds } from "@/lib/booking-validation";
import { SEGMENT_ACTIVE_DAYS } from "@/lib/patients/segment-rules";
import { prisma } from "@/lib/prisma";
import {
  type DormantStock,
  type LossEntry,
  type LossTotals,
  type DailyLossPoint,
  aggregateDaily,
  aggregateLoss,
  estimateAverageVisitValue,
  isLateCancellation,
  summarizeDormantStock,
  toDateKey,
} from "@/lib/revenue/loss-aggregation";
import { paymentsRecordedSince } from "@/server/patient/finance";

export interface LossDoctorRow {
  doctorId: string;
  nameRu: string;
  nameUz: string;
  emptySlotUzs: number;
  noShowUzs: number;
  cancellationUzs: number;
  totalUzs: number;
}

export interface LossDashboardData {
  fromKey: string;
  toKeyExcl: string;
  /** Empty slots, no-shows and late cancellations of the period. */
  totals: LossTotals;
  daily: DailyLossPoint[];
  topDoctors: LossDoctorRow[];
  /** The dormant base right now; not part of `totals` or `daily`. */
  dormant: DormantStock;
  /** True when the engines have written zero data into the range. */
  hasAnyData: boolean;
  /** Value per patient used for the dormant estimate (tiins), or null. */
  averageVisitValueUzs: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Load all four loss sources for `clinicId` over `[from, to)` and return
 * the aggregated dashboard payload. Caller MUST be inside `runWithTenant`
 * with this clinic's TenantContext (the page wraps it via createApiHandler-
 * equivalent server-component plumbing).
 *
 * `from`/`to` are Tashkent-midnight instants (see `resolveAnalyticsRange`);
 * day keys are Tashkent civil dates, matching the empty-slot engine's
 * Tashkent-anchored snapshot `date` values.
 */
export async function loadLossDashboard(
  clinicId: string,
  from: Date,
  to: Date,
  now: Date = new Date(),
): Promise<LossDashboardData> {
  const fromKey = toDateKey(from);
  const toKeyExcl = toDateKey(to);

  // Empty-slot snapshots — pre-computed by the daily worker. One row per
  // (doctor, hour) tuple.
  const slotRows = await prisma.emptySlotSnapshot.findMany({
    where: {
      clinicId,
      date: { gte: from, lt: to },
    },
    select: {
      date: true,
      doctorId: true,
      estimatedRevenueLossUzs: true,
    },
  });

  // No-show + cancellation appointments. We pull both in one query and
  // bucket them client-side.
  const apptRows = await prisma.appointment.findMany({
    where: {
      clinicId,
      // We filter by `date` (the scheduled start). Cancellations whose
      // `cancelledAt` falls in the range but whose appointment was outside
      // are excluded — that's deliberate. The dashboard reports loss
      // attributable to the *appointment's* day so daily totals line up
      // with the analytics revenue-by-day chart.
      date: { gte: from, lt: to },
      status: { in: ["NO_SHOW", "CANCELLED"] },
    },
    select: {
      id: true,
      date: true,
      status: true,
      cancelledAt: true,
      updatedAt: true,
      doctorId: true,
      priceFinal: true,
      primaryService: { select: { priceBase: true } },
    },
  });

  // Clinic-average service price as a last-resort fallback for appointments
  // with no priceFinal AND no primaryService.
  const services = await prisma.service.findMany({
    where: { clinicId, isActive: true },
    select: { priceBase: true },
  });
  const clinicAvg =
    services.length > 0
      ? Math.round(
          services.reduce((acc, s) => acc + s.priceBase, 0) / services.length,
        )
      : 0;

  // Dormant patients: the last completed visit 90 days ago or earlier, by
  // `lastVisitAt`. A patient with a visit booked ahead is coming back and
  // is not dormant (the patient segments' rule, segment-rules.ts).
  const lapseCutoff = new Date(now.getTime() - SEGMENT_ACTIVE_DAYS * DAY_MS);
  const [lapsed, upcoming, activePatientCount, trackedSince] = await Promise.all([
    prisma.patient.findMany({
      where: { clinicId, deletedAt: null, lastVisitAt: { lte: lapseCutoff } },
      select: { id: true, lastVisitAt: true },
    }),
    prisma.appointment.findMany({
      where: {
        clinicId,
        status: { in: [...ACTIVE_VISIT_STATUSES] },
        date: { gte: tashkentDayBounds(now).dayStart },
      },
      select: { patientId: true },
    }),
    prisma.patient.count({
      where: { clinicId, deletedAt: null, lastVisitAt: { gt: lapseCutoff } },
    }),
    paymentsRecordedSince(clinicId),
  ]);
  const comingBack = new Set(upcoming.map((a) => a.patientId));

  // Value per patient: the last 90 days' payments over the active patients,
  // only when every payment of those 90 days was recorded. Before that, or
  // with payments not recorded at all, a handful of entered payments would
  // pass for the clinic's revenue, so there is no estimate.
  let averageVisitValueUzs: number | null = null;
  if (trackedSince && trackedSince.getTime() <= lapseCutoff.getTime()) {
    const recentPayments = await prisma.payment.findMany({
      where: {
        clinicId,
        status: "PAID",
        paidAt: { gte: lapseCutoff, lte: now },
      },
      select: { amount: true },
    });
    const totalPaymentsUzs = recentPayments.reduce((a, p) => a + p.amount, 0);
    const value = estimateAverageVisitValue({ totalPaymentsUzs, activePatientCount });
    averageVisitValueUzs = value > 0 ? value : null;
  }
  const dormant = summarizeDormantStock(
    lapsed.flatMap((p) =>
      p.lastVisitAt && !comingBack.has(p.id) ? [p.lastVisitAt] : [],
    ),
    now,
    averageVisitValueUzs,
  );

  // Doctor-name lookup, used for the drill-down table.
  const doctorIds = new Set<string>();
  for (const r of slotRows) doctorIds.add(r.doctorId);
  for (const a of apptRows) doctorIds.add(a.doctorId);
  const doctors =
    doctorIds.size > 0
      ? await prisma.doctor.findMany({
          where: { id: { in: [...doctorIds] } },
          select: { id: true, nameRu: true, nameUz: true },
        })
      : [];
  const doctorMap = new Map(doctors.map((d) => [d.id, d]));

  // ---------------------------------------------------------------------------
  // Build LossEntry stream
  // ---------------------------------------------------------------------------
  const entries: LossEntry[] = [];

  // Per-doctor running totals for the drill-down table.
  const perDoctor = new Map<
    string,
    { emptySlotUzs: number; noShowUzs: number; cancellationUzs: number }
  >();
  function bumpDoctor(
    id: string,
    bucket: "emptySlotUzs" | "noShowUzs" | "cancellationUzs",
    amount: number,
  ) {
    const cur =
      perDoctor.get(id) ??
      ({ emptySlotUzs: 0, noShowUzs: 0, cancellationUzs: 0 } as const);
    perDoctor.set(id, { ...cur, [bucket]: cur[bucket] + amount });
  }

  // 1. Empty slots
  for (const r of slotRows) {
    if (r.estimatedRevenueLossUzs <= 0) continue;
    entries.push({
      dateKey: toDateKey(r.date),
      source: "emptySlot",
      amountUzs: r.estimatedRevenueLossUzs,
    });
    bumpDoctor(r.doctorId, "emptySlotUzs", r.estimatedRevenueLossUzs);
  }

  // 2 + 3. No-shows and late cancellations
  // We use `priceFinal` first, then primaryService.priceBase, then the
  // clinic average. This intentionally avoids walking AppointmentService
  // rows: when priceFinal is set it already reflects the final multi-
  // service total at booking time, and using priceBase as fallback keeps
  // the math monotonic (never higher than what the patient would have paid).
  for (const a of apptRows) {
    const valueUzs =
      a.priceFinal && a.priceFinal > 0
        ? a.priceFinal
        : a.primaryService?.priceBase && a.primaryService.priceBase > 0
          ? a.primaryService.priceBase
          : clinicAvg;
    if (valueUzs <= 0) continue;

    if (a.status === "NO_SHOW") {
      entries.push({
        dateKey: toDateKey(a.date),
        source: "noShow",
        amountUzs: valueUzs,
      });
      bumpDoctor(a.doctorId, "noShowUzs", valueUzs);
    } else if (a.status === "CANCELLED") {
      // Only "late" cancellations (within 24h of start) count. We fall
      // back to `updatedAt` if `cancelledAt` is null — see file header.
      const cancelledAt = a.cancelledAt ?? a.updatedAt ?? null;
      if (
        isLateCancellation({
          startsAt: a.date,
          cancelledAt,
        })
      ) {
        entries.push({
          dateKey: toDateKey(a.date),
          source: "cancellation",
          amountUzs: valueUzs,
        });
        bumpDoctor(a.doctorId, "cancellationUzs", valueUzs);
      }
    }
  }

  const totals = aggregateLoss(entries, fromKey, toKeyExcl);
  const daily = aggregateDaily(entries, fromKey, toKeyExcl);

  const topDoctors: LossDoctorRow[] = [...perDoctor.entries()]
    .map(([doctorId, v]) => {
      const d = doctorMap.get(doctorId);
      return {
        doctorId,
        nameRu: d?.nameRu ?? doctorId,
        nameUz: d?.nameUz ?? doctorId,
        emptySlotUzs: v.emptySlotUzs,
        noShowUzs: v.noShowUzs,
        cancellationUzs: v.cancellationUzs,
        totalUzs: v.emptySlotUzs + v.noShowUzs + v.cancellationUzs,
      };
    })
    .sort((a, b) => b.totalUzs - a.totalUzs)
    .slice(0, 10);

  const hasAnyData = entries.length > 0 || dormant.patientCount > 0;

  return {
    fromKey,
    toKeyExcl,
    totals,
    daily,
    topDoctors,
    dormant,
    hasAnyData,
    averageVisitValueUzs,
  };
}
