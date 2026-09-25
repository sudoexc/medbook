/**
 * Per-doctor appointment aggregates for a date range, computed in the
 * database (audit DR-01).
 *
 * The doctors page used to download every raw appointment of the period and
 * sum it in the browser. It asked for 500 rows where the API allows 200, got
 * a 400 on every load and showed zeros; even at 200 it would have summed a
 * truncated slice. Two `groupBy` queries answer the same questions exactly,
 * whatever the volume.
 *
 * Revenue of a COMPLETED visit is its priceFinal, or priceService minus the
 * discount when no final price was written: the definition the analytics
 * rollup (`mv_doctor_performance`) uses, so the tiles match /crm/analytics.
 */
import { prisma } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";

export type DoctorStatsRow = {
  doctorId: string;
  /** Every appointment in the range, any status. */
  total: number;
  completed: number;
  noShow: number;
  cancelled: number;
  /** Revenue of COMPLETED visits (see the header for the definition). */
  revenue: number;
  /** Appointments of the range that fall on today (Tashkent day). */
  todayCount: number;
};

type StatusGroup = {
  doctorId: string;
  status: string;
  _count: { _all: number };
  _sum: { priceFinal: number | null };
};
type TodayGroup = { doctorId: string; _count: { _all: number } };
/** COMPLETED visits without a priceFinal, priced from service − discount. */
type UnpricedGroup = {
  doctorId: string;
  _sum: { priceService: number | null; discountAmount: number | null };
};

/** Fold the groupBy results into one row per doctor. Pure. */
export function foldDoctorStats(
  byStatus: ReadonlyArray<StatusGroup>,
  today: ReadonlyArray<TodayGroup>,
  unpriced: ReadonlyArray<UnpricedGroup> = [],
): DoctorStatsRow[] {
  const out = new Map<string, DoctorStatsRow>();
  const row = (doctorId: string): DoctorStatsRow => {
    let r = out.get(doctorId);
    if (!r) {
      r = {
        doctorId,
        total: 0,
        completed: 0,
        noShow: 0,
        cancelled: 0,
        revenue: 0,
        todayCount: 0,
      };
      out.set(doctorId, r);
    }
    return r;
  };
  for (const g of byStatus) {
    const r = row(g.doctorId);
    const n = g._count._all;
    r.total += n;
    if (g.status === "COMPLETED") {
      r.completed += n;
      r.revenue += g._sum.priceFinal ?? 0;
    } else if (g.status === "NO_SHOW") {
      r.noShow += n;
    } else if (g.status === "CANCELLED") {
      r.cancelled += n;
    }
  }
  for (const g of today) row(g.doctorId).todayCount += g._count._all;
  for (const g of unpriced) {
    row(g.doctorId).revenue +=
      (g._sum.priceService ?? 0) - (g._sum.discountAmount ?? 0);
  }
  return [...out.values()];
}

export async function loadDoctorStats(args: {
  from?: Date;
  to?: Date;
  doctorId?: string;
  now?: Date;
}): Promise<DoctorStatsRow[]> {
  const range: Record<string, Date> = {};
  if (args.from) range.gte = args.from;
  if (args.to) range.lte = args.to;
  const where = {
    ...(args.from || args.to ? { date: range } : {}),
    ...(args.doctorId ? { doctorId: args.doctorId } : {}),
  };

  // «Today» is the clinic's day, clipped to the requested range.
  const { dayStart, dayEnd } = tashkentDayBounds(args.now ?? new Date());
  const todayFrom =
    args.from && args.from > dayStart ? args.from : dayStart;
  const todayTo = args.to && args.to < dayEnd ? args.to : null;
  const todayWhere = {
    ...(args.doctorId ? { doctorId: args.doctorId } : {}),
    date: todayTo ? { gte: todayFrom, lte: todayTo } : { gte: todayFrom, lt: dayEnd },
  };

  const [byStatus, today, unpriced] = await Promise.all([
    prisma.appointment.groupBy({
      by: ["doctorId", "status"],
      where,
      _count: { _all: true },
      _sum: { priceFinal: true },
    }),
    prisma.appointment.groupBy({
      by: ["doctorId"],
      where: todayWhere,
      _count: { _all: true },
    }),
    prisma.appointment.groupBy({
      by: ["doctorId"],
      where: { ...where, status: "COMPLETED", priceFinal: null },
      _sum: { priceService: true, discountAmount: true },
    }),
  ]);
  return foldDoctorStats(
    byStatus as unknown as StatusGroup[],
    today as unknown as TodayGroup[],
    unpriced as unknown as UnpricedGroup[],
  );
}
