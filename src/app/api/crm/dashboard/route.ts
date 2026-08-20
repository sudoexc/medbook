/**
 * /api/crm/dashboard — reception-dash KPIs. See docs/TZ.md §6.1.
 *
 * Returns { today: { booked, inProgress, completed, revenue }, week, month }.
 * Revenue is sum of PAID payments in clinic currency (UZS tiyin).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  tashkentDayBounds,
  tashkentDayBoundsForDateString,
  tashkentComponents,
} from "@/lib/booking-validation";
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

async function kpisFor(fromDate: Date, toDate: Date) {
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
    prisma.payment.aggregate({
      where: {
        status: "PAID",
        paidAt: { gte: fromDate, lt: toDate },
        currency: "UZS",
      },
      _sum: { amount: true },
    }),
  ]);
  return {
    booked,
    inProgress,
    completed,
    cancelled,
    revenue: revenueAgg._sum.amount ?? 0,
  };
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "CALL_OPERATOR"] },
  async () => {
    const now = new Date();
    const { todayStart, tomorrow, weekStart, nextWeek, monthStart, nextMonth } =
      tashkentWindows(now);

    const [
      today,
      week,
      month,
      newPatients,
      missedCallsToday,
      missedRequestsToday,
      avgVisitTiins,
    ] = await Promise.all([
      kpisFor(todayStart, tomorrow),
      kpisFor(weekStart, nextWeek),
      kpisFor(monthStart, nextMonth),
      prisma.patient.count({
        where: { createdAt: { gte: monthStart, lt: nextMonth } },
      }),
      prisma.call.count({
        where: {
          direction: "MISSED",
          createdAt: { gte: todayStart, lt: tomorrow },
        },
      }),
      prisma.onlineRequest.count({
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
