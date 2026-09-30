/**
 * The KPI tiles above the patients list (audit PT-13), counted on the
 * server over the clinic's whole base.
 *
 * The tiles used to be counted in the browser from the rows the infinite
 * list had loaded so far (50 per page) and divided by the server's total:
 * «Активные: 12 (1,5%)» became 35 after a scroll, and «Средний чек» was the
 * average lifetime value of those rows, not a check at all.
 *
 * Definitions (live patients only, `deletedAt` null):
 *   total        every patient;
 *   newThisWeek  registered since the start of the Tashkent day 7 days ago,
 *                the same window the «Новые за неделю» page lists;
 *   active       segment ACTIVE, the «Активные» tab and page;
 *   dormant      segment DORMANT, the «Остывают» tab and page (the
 *                segments follow `src/lib/patients/segment-rules.ts`);
 *   avgCheck     the average PAID payment per paid visit over the last 30
 *                days (the analytics «Путь пациента» figure for «Месяц»),
 *                only while the clinic records payments in the CRM
 *                (`paymentsTracked`); null when no visit is paid. Shown to
 *                the roles the analytics money is shown to (ADMIN, DOCTOR
 *                for his own visits), hidden for the rest.
 *
 * Checking by hand:
 *   SELECT count(*) FILTER (WHERE true)                       AS total,
 *          count(*) FILTER (WHERE "createdAt" >= $weekStart)  AS new_week,
 *          count(*) FILTER (WHERE segment = 'ACTIVE')         AS active,
 *          count(*) FILTER (WHERE segment = 'DORMANT')        AS dormant
 *     FROM "Patient" WHERE "clinicId" = $c AND "deletedAt" IS NULL;
 */
import type { prisma as prismaClient } from "@/lib/prisma";
import { tashkentDayBounds } from "@/lib/booking-validation";

export interface PatientTiles {
  total: number;
  newThisWeek: number;
  active: number;
  dormant: number;
  avgCheck: {
    /** The caller's role sees clinic money. */
    visible: boolean;
    /** The clinic records payments in the CRM. */
    paymentsTracked: boolean;
    /** Tiins; null without a paid visit (or not visible / not tracked). */
    value: number | null;
  };
}

const DAY_MS = 86_400_000;

/** Start of the Tashkent day seven days before today. */
export function newThisWeekFrom(now: Date): Date {
  return new Date(tashkentDayBounds(now).dayStart.getTime() - 7 * DAY_MS);
}

type Db = Pick<typeof prismaClient, "patient">;

export async function loadPatientCounts(
  db: Db,
  args: { clinicId: string; now?: Date },
): Promise<Pick<PatientTiles, "total" | "newThisWeek" | "active" | "dormant">> {
  const now = args.now ?? new Date();
  const live = { clinicId: args.clinicId, deletedAt: null };
  const [total, newThisWeek, bySegment] = await Promise.all([
    db.patient.count({ where: live }),
    db.patient.count({ where: { ...live, createdAt: { gte: newThisWeekFrom(now) } } }),
    db.patient.groupBy({
      by: ["segment"],
      where: { ...live, segment: { in: ["ACTIVE", "DORMANT"] } },
      _count: { _all: true },
    }),
  ]);
  const countOf = (segment: string) =>
    (bySegment as Array<{ segment: string; _count: { _all: number } }>).find(
      (g) => g.segment === segment,
    )?._count._all ?? 0;
  return {
    total,
    newThisWeek,
    active: countOf("ACTIVE"),
    dormant: countOf("DORMANT"),
  };
}
