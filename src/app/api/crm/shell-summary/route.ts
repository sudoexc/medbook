/**
 * /api/crm/shell-summary — counters that drive the persistent CRM chrome.
 *
 * The sidebar's donut + today-count and the topbar/sidebar channel badges
 * (calls, telegram, sms, notifications) used to be hardcoded mocks
 * (`loadPercent = 83`, `todayCount = 128`, etc). This endpoint replaces
 * those with live data from the tenant-scoped DB. Kept thin on purpose —
 * it runs on every CRM page load, so we want one round-trip with cheap
 * counts, not heavy aggregates.
 *
 * `loadPercent` is `bookedMinutesToday / availableMinutesToday * 100`,
 * clamped to 0..100. Available minutes come from active doctors'
 * `DoctorSchedule` rows for today's weekday; booked minutes sum
 * `durationMin` across non-cancelled appointments. If there are no active
 * schedules (clinic isn't operating today / no doctors configured) we
 * return `0` rather than NaN.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";

function startOfToday(): Date {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfToday(): Date {
  const x = startOfToday();
  x.setDate(x.getDate() + 1);
  return x;
}

/** Convert "HH:MM" → minutes since midnight. Defensive against bad input. */
function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(":").map((n) => parseInt(n, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export const GET = createApiListHandler(
  {
    roles: [
      "ADMIN",
      "RECEPTIONIST",
      "DOCTOR",
      "NURSE",
      "CALL_OPERATOR",
    ],
  },
  async () => {
    const todayStart = startOfToday();
    const todayEnd = endOfToday();
    const weekday = todayStart.getDay(); // 0=Sun … 6=Sat

    const [
      appointmentsToday,
      bookedMinutesAgg,
      schedulesToday,
      missedCallsToday,
      tgUnread,
      smsEmailUnread,
      failedNotificationsToday,
    ] = await Promise.all([
      // Today's appointments — every status, the sidebar wants raw volume.
      prisma.appointment.count({
        where: { date: { gte: todayStart, lt: todayEnd } },
      }),
      // Sum of `durationMin` for non-cancelled appointments today — the numerator
      // of the load %. CANCELLED/NO_SHOW/SKIPPED don't consume the chair.
      prisma.appointment.aggregate({
        where: {
          date: { gte: todayStart, lt: todayEnd },
          status: { in: ["BOOKED", "WAITING", "IN_PROGRESS", "COMPLETED"] },
        },
        _sum: { durationMin: true },
      }),
      // Active doctors' schedules for today's weekday — the denominator.
      prisma.doctorSchedule.findMany({
        where: {
          weekday,
          isActive: true,
          doctor: { isActive: true },
        },
        select: { startTime: true, endTime: true },
      }),
      prisma.call.count({
        where: {
          direction: "MISSED",
          createdAt: { gte: todayStart, lt: todayEnd },
        },
      }),
      prisma.conversation.count({
        where: {
          channel: "TG",
          status: "OPEN",
          unreadCount: { gt: 0 },
        },
      }),
      prisma.conversation.count({
        where: {
          channel: { in: ["SMS", "EMAIL"] },
          status: "OPEN",
          unreadCount: { gt: 0 },
        },
      }),
      // "Notifications" badge surfaces operational issues (FAILED today).
      // QUEUED is system-internal noise; FAILED is something staff can act on.
      prisma.notificationSend.count({
        where: {
          status: "FAILED",
          createdAt: { gte: todayStart, lt: todayEnd },
        },
      }),
    ]);

    const availableMinutes = schedulesToday.reduce(
      (sum, s) => sum + Math.max(0, hhmmToMinutes(s.endTime) - hhmmToMinutes(s.startTime)),
      0,
    );
    const bookedMinutes = bookedMinutesAgg._sum.durationMin ?? 0;
    const loadPercent =
      availableMinutes > 0
        ? Math.min(100, Math.round((bookedMinutes / availableMinutes) * 100))
        : 0;

    return ok({
      today: {
        appointmentsCount: appointmentsToday,
        loadPercent,
      },
      unread: {
        calls: missedCallsToday,
        telegram: tgUnread,
        smsEmail: smsEmailUnread,
        notifications: failedNotificationsToday,
      },
    });
  },
);
