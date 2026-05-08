/**
 * Server-side data loaders for the Loss Analytics dashboard
 * (/crm/analytics/loss). Pulls each of the four loss sources from Prisma,
 * normalises them into `LossEntry` rows, and returns aggregated totals via
 * the pure `loss-aggregation` helpers.
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
 *   - **Dormant patients**
 *     Count of `Patient.dormantSince != null` × an estimated average
 *     lifetime visit value. The estimate is conservative: total payments
 *     in the last 90 days divided by `max(activePatients, 1)`. The result
 *     is dated to "today" (the snapshot date) since this is a forward-
 *     looking risk number, not a per-day historical loss.
 *
 *   - **Top-by-doctor breakdown**
 *     We aggregate empty-slot snapshots and no-show appointments per
 *     doctor; cancellations are folded into the no-show bucket for the
 *     UI's purposes (both reflect "doctor whose patients didn't show").
 *     Dormant patients have no doctor scope so they're absent from the
 *     drill-down table — that's fine, the segment table next to it
 *     covers them.
 */
import { prisma } from "@/lib/prisma";
import {
  type LossEntry,
  type LossTotals,
  type DailyLossPoint,
  aggregateDaily,
  aggregateLoss,
  estimateAverageVisitValue,
  isLateCancellation,
  toDateKey,
} from "@/lib/revenue/loss-aggregation";

export interface LossDoctorRow {
  doctorId: string;
  nameRu: string;
  nameUz: string;
  emptySlotUzs: number;
  noShowUzs: number;
  cancellationUzs: number;
  totalUzs: number;
}

export interface LossSegmentRow {
  segment: "recent_lapse" | "mid_lapse" | "deep_lapse";
  patientCount: number;
  estimatedRevenueUzs: number;
}

export interface LossDashboardData {
  fromKey: string;
  toKeyExcl: string;
  totals: LossTotals;
  daily: DailyLossPoint[];
  topDoctors: LossDoctorRow[];
  dormantSegments: LossSegmentRow[];
  /** True when the engines have written zero data into the range. */
  hasAnyData: boolean;
  /** Average visit value used for the dormant calc (tiins). */
  averageVisitValueUzs: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function utcMidnight(d: Date): Date {
  const c = new Date(d);
  c.setUTCHours(0, 0, 0, 0);
  return c;
}

/**
 * Load all four loss sources for `clinicId` over `[from, to)` and return
 * the aggregated dashboard payload. Caller MUST be inside `runWithTenant`
 * with this clinic's TenantContext (the page wraps it via createApiHandler-
 * equivalent server-component plumbing).
 */
export async function loadLossDashboard(
  clinicId: string,
  from: Date,
  to: Date,
): Promise<LossDashboardData> {
  const fromKey = toDateKey(utcMidnight(from));
  const toKeyExcl = toDateKey(utcMidnight(to));

  // Empty-slot snapshots — pre-computed by the daily worker. One row per
  // (doctor, hour) tuple.
  const slotRows = await prisma.emptySlotSnapshot.findMany({
    where: {
      clinicId,
      date: { gte: utcMidnight(from), lt: utcMidnight(to) },
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

  // Dormant patients — count + segments. We classify by lapse buckets so
  // the drill-down table can split the total.
  const dormant = await prisma.patient.findMany({
    where: { clinicId, dormantSince: { not: null } },
    select: { id: true, dormantSince: true, lastVisitAt: true },
  });

  // Average lifetime visit value: payments in the last 90d / active patients.
  const ninetyDaysAgo = new Date(Date.now() - 90 * DAY_MS);
  const recentPayments = await prisma.payment.findMany({
    where: {
      clinicId,
      status: "PAID",
      paidAt: { gte: ninetyDaysAgo },
    },
    select: { amount: true },
  });
  const totalPaymentsUzs = recentPayments.reduce((a, p) => a + p.amount, 0);
  const activePatientCount = await prisma.patient.count({
    where: { clinicId, dormantSince: null },
  });
  const averageVisitValueUzs = estimateAverageVisitValue({
    totalPaymentsUzs,
    activePatientCount,
  });

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

  // 4. Dormant patients — single dated entry on the snapshot's first day
  // so the area chart shows it as a constant baseline. The KPI card uses
  // `totals.dormant`, which is the sum of those daily entries; we use the
  // first day so the totals number equals (count × averageValue) exactly.
  // (Spreading across many days would only complicate the math.)
  const dormantSegments: LossSegmentRow[] = [];
  if (dormant.length > 0 && averageVisitValueUzs > 0) {
    const totalDormantLoss = dormant.length * averageVisitValueUzs;
    entries.push({
      dateKey: fromKey,
      source: "dormant",
      amountUzs: totalDormantLoss,
    });

    // Segment classification — mirrors `classifyLapse` from the engine
    // but inlined here to avoid pulling the engine's heavy imports into a
    // page module.
    const now = new Date();
    const segmentBuckets: Record<
      LossSegmentRow["segment"],
      { count: number }
    > = {
      recent_lapse: { count: 0 },
      mid_lapse: { count: 0 },
      deep_lapse: { count: 0 },
    };
    for (const p of dormant) {
      const ref = p.lastVisitAt ?? p.dormantSince;
      if (!ref) continue;
      const days = Math.floor((now.getTime() - ref.getTime()) / DAY_MS);
      let bucket: LossSegmentRow["segment"] | null = null;
      if (days < 90) bucket = null;
      else if (days < 180) bucket = "recent_lapse";
      else if (days <= 365) bucket = "mid_lapse";
      else bucket = "deep_lapse";
      if (bucket) segmentBuckets[bucket].count += 1;
    }
    for (const segment of ["recent_lapse", "mid_lapse", "deep_lapse"] as const) {
      const b = segmentBuckets[segment];
      dormantSegments.push({
        segment,
        patientCount: b.count,
        estimatedRevenueUzs: b.count * averageVisitValueUzs,
      });
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

  const hasAnyData = entries.length > 0;

  return {
    fromKey,
    toKeyExcl,
    totals,
    daily,
    topDoctors,
    dormantSegments,
    hasAnyData,
    averageVisitValueUzs,
  };
}
