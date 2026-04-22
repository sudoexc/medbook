/**
 * /api/crm/dashboard — reception-dash KPIs. See docs/TZ.md §6.1.
 *
 * Returns { today: { booked, inProgress, completed, revenue }, week, month }.
 * Revenue is sum of PAID payments in clinic currency (UZS tiyin).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay();
  const diff = (day + 6) % 7; // Monday=0
  x.setDate(x.getDate() - diff);
  return x;
}
function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
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
    const todayStart = startOfDay(now);
    const tomorrow = addDays(todayStart, 1);
    const weekStart = startOfWeek(now);
    const nextWeek = addDays(weekStart, 7);
    const monthStart = startOfMonth(now);
    const nextMonth = addDays(startOfMonth(addDays(now, 40)), 0);

    const [today, week, month, newPatients] = await Promise.all([
      kpisFor(todayStart, tomorrow),
      kpisFor(weekStart, nextWeek),
      kpisFor(monthStart, nextMonth),
      prisma.patient.count({
        where: { createdAt: { gte: monthStart, lt: nextMonth } },
      }),
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
    });
  }
);
