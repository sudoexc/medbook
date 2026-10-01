/**
 * /api/crm/dashboard — reception-dash KPIs. See docs/TZ.md §6.1.
 *
 * Returns { today: { booked, inProgress, completed, revenue }, week, month }.
 * Revenue is sum of PAID payments in clinic currency (UZS tiyin).
 *
 * Revenue is finance (audit AN-20): only the roles that may open the
 * financial dashboard get it (`canSeeClinicRevenue`); everyone else gets
 * `revenue: null`. The payments list already refused a clinic-wide dump to
 * DOCTOR / CALL_OPERATOR, while this summary handed them the monthly take.
 * `Payment` is not branch-scoped, so with a branch selected the counts were
 * the branch's and the revenue the whole network's; it is now the payments
 * filed under that branch's visits.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  tashkentDayBounds,
  tashkentDayBoundsForDateString,
  tashkentComponents,
} from "@/lib/booking-validation";
import { canSeeClinicRevenue } from "@/lib/reception-kpi";
import { paymentScopeWhere } from "@/server/analytics/payment-scope";
import { getClinicAvgVisitTiins } from "@/server/revenue/avg-visit";
import { ok } from "@/server/http";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Day/week/month windows in clinic time (Asia/Tashkent, no DST) — the old
 * `setHours(0,0,0,0)` variant used server-local midnight, which on the UTC
 * prod box shifted every window by 5 hours vs. the clinic's day.
 * Tashkent has no DST, so N×24h arithmetic on a Tashkent midnight stays on
 * Tashkent midnights.
 */
function tashkentWindows(now: Date) {
  const comp = tashkentComponents(now);
  const { dayStart: todayStart, dayEnd: tomorrow } = tashkentDayBounds(now);
  const weekStart = new Date(todayStart.getTime() - ((comp.dow + 6) % 7) * DAY_MS); // Monday
  const nextWeek = new Date(weekStart.getTime() + 7 * DAY_MS);
  const [y, m] = comp.date.split("-").map(Number);
  const monthStart = tashkentDayBoundsForDateString(
    `${comp.date.slice(0, 7)}-01`,
  ).dayStart;
  const nextMonthFirst =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const nextMonth = tashkentDayBoundsForDateString(nextMonthFirst).dayStart;
  return { todayStart, tomorrow, weekStart, nextWeek, monthStart, nextMonth };
}

async function kpisFor(
  fromDate: Date,
  toDate: Date,
  revenue: { branchId: string | null } | null,
) {
  const [booked, inProgress, completed, cancelled, revenueAgg] = await Promise.all([
    prisma.appointment.count({
      where: { date: { gte: fromDate, lt: toDate }, status: "BOOKED" },
    }),
    prisma.appointment.count({
      where: { date: { gte: fromDate, lt: toDate }, status: "IN_PROGRESS" },
    }),
    prisma.appointment.count({
      where: { date: { gte: fromDate, lt: toDate }, status: "COMPLETED" },
    }),
    prisma.appointment.count({
      where: { date: { gte: fromDate, lt: toDate }, status: "CANCELLED" },
    }),
    revenue
      ? prisma.payment.aggregate({
          where: {
            status: "PAID",
            paidAt: { gte: fromDate, lt: toDate },
            currency: "UZS",
            ...paymentScopeWhere({ branchId: revenue.branchId }),
          },
          _sum: { amount: true },
        })
      : null,
  ]);
  return {
    booked,
    inProgress,
    completed,
    cancelled,
    revenue: revenueAgg ? (revenueAgg._sum.amount ?? 0) : null,
  };
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "CALL_OPERATOR"] },
  async ({ ctx }) => {
    const now = new Date();
    const { todayStart, tomorrow, weekStart, nextWeek, monthStart, nextMonth } =
      tashkentWindows(now);
    const revenue =
      ctx.kind === "TENANT" && canSeeClinicRevenue(ctx.role)
        ? { branchId: ctx.branchId ?? null }
        : null;

    const [
      today,
      week,
      month,
      newPatients,
      missedCallsToday,
      missedRequestsToday,
      avgVisitTiins,
    ] = await Promise.all([
      kpisFor(todayStart, tomorrow, revenue),
      kpisFor(weekStart, nextWeek, revenue),
      kpisFor(monthStart, nextMonth, revenue),
      prisma.patient.count({
        where: { createdAt: { gte: monthStart, lt: nextMonth } },
      }),
      prisma.call.count({
        where: {
          direction: "MISSED",
          createdAt: { gte: todayStart, lt: tomorrow },
        },
      }),
      // Site requests land in `Lead` (audit LD-01); `OnlineRequest` has no
      // writer, so counting it always showed zero.
      prisma.lead.count({
        where: {
          status: "NEW",
          createdAt: { gte: todayStart, lt: tomorrow },
        },
      }),
      getClinicAvgVisitTiins(now),
    ]);

    // Queue snapshot (live): how many appointments are in each queueStatus today
    const queue = await prisma.appointment.groupBy({
      by: ["queueStatus"],
      where: { date: { gte: todayStart, lt: tomorrow } },
      _count: { _all: true },
    });

    return ok({
      today,
      week,
      month,
      newPatientsThisMonth: newPatients,
      queue: queue.map((q) => ({ status: q.queueStatus, count: q._count._all })),
      missedToday: { calls: missedCallsToday, requests: missedRequestsToday },
      avgVisitTiins,
    });
  }
);
