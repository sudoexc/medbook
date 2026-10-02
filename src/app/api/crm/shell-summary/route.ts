/**
 * /api/crm/shell-summary — counters that drive the persistent CRM chrome.
 *
 * The sidebar's donut + today-count and the topbar/sidebar channel badges
 * (calls, telegram, notifications) used to be hardcoded mocks
 * (`loadPercent = 83`, `todayCount = 128`, etc). This endpoint replaces
 * those with live data from the tenant-scoped DB. Kept thin on purpose —
 * it runs on every CRM page load, so we want one round-trip with cheap
 * counts, not heavy aggregates.
 *
 * `loadPercent` is `bookedMinutesToday / availableMinutesToday * 100`,
 * clamped to 0..100. Available minutes are active doctors' working time
 * today (`workingMinutesOn`: rows valid today, time off cut out, audit
 * AN-22); booked minutes sum `durationMin` across non-cancelled
 * appointments. If there are no active schedules (clinic isn't operating
 * today / no doctors configured) we return `0` rather than NaN.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import {
  tashkentDayBounds,
  tashkentComponents,
} from "@/lib/booking-validation";
import { ok } from "@/server/http";
import { TODAY_VISIT_STATUSES } from "@/lib/appointments/active-statuses";
import { workingMinutesOn } from "@/lib/doctor-working-windows";
import type { TenantContext } from "@/lib/tenant-context";
import { ONLINE_REQUEST_ROLES } from "@/server/schemas/online-request";
import { pendingMissedCallsWhere } from "@/lib/calls/call-state";

/** Statuses left out of the sidebar's today count (audit CM-22). */
const NOT_TODAY_STATUSES = ["CANCELLED", "NO_SHOW"] as const;

function canWorkLeads(ctx: TenantContext): boolean {
  if (ctx.kind === "SUPER_ADMIN") return true;
  if (ctx.kind !== "TENANT") return false;
  return (
    ctx.role === "SUPER_ADMIN" ||
    (ONLINE_REQUEST_ROLES as readonly string[]).includes(ctx.role)
  );
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
  async ({ ctx }) => {
    // Clinic day (Asia/Tashkent), not server-local — prod runs UTC.
    const now = new Date();
    const { dayStart: todayStart, dayEnd: todayEnd } = tashkentDayBounds(now);
    const { dow: weekday, date: todayDate } = tashkentComponents(now); // 0=Sun … 6=Sat

    const [
      appointmentsToday,
      bookedMinutesAgg,
      schedulesToday,
      timeOffsToday,
      missedCallsToday,
      tgUnread,
      failedNotificationsToday,
      newLeads,
    ] = await Promise.all([
      // «Записей сегодня» in the sidebar footer: today's visits that still
      // stand. A cancelled booking or a no-show is not one, and counting them
      // made the number reception watches all day go up on every cancel
      // (audit CM-22). SKIPPED stays: reception brings the patient back.
      prisma.appointment.count({
        where: {
          date: { gte: todayStart, lt: todayEnd },
          status: { notIn: [...NOT_TODAY_STATUSES] },
        },
      }),
      // Sum of `durationMin` for non-cancelled appointments today — the numerator
      // of the load %. CANCELLED/NO_SHOW/SKIPPED don't consume the chair.
      // CONFIRMED does (UX-02): phone bookings are created CONFIRMED and a
      // patient pressing «Подтверждаю» in Telegram used to drop out of the
      // load, so the sidebar fell exactly when the day filled up.
      prisma.appointment.aggregate({
        where: {
          date: { gte: todayStart, lt: todayEnd },
          status: { in: [...TODAY_VISIT_STATUSES] },
        },
        _sum: { durationMin: true },
      }),
      // Active doctors' schedules for today's weekday — the denominator,
      // with their validity range and today's time off (audit AN-22): a
      // doctor on leave or a schedule that has ended has no minutes to fill.
      prisma.doctorSchedule.findMany({
        where: {
          weekday,
          isActive: true,
          doctor: { isActive: true },
        },
        select: {
          doctorId: true,
          weekday: true,
          startTime: true,
          endTime: true,
          validFrom: true,
          validTo: true,
        },
      }),
      prisma.doctorTimeOff.findMany({
        where: { startAt: { lt: todayEnd }, endAt: { gt: todayStart } },
        select: { doctorId: true, startAt: true, endAt: true },
      }),
      // Missed calls still waiting for a call back (audit CM-13): the badge
      // opens the «Пропущенные» list, and «Перезвонили» takes a call off both.
      prisma.call.count({
        where: pendingMissedCallsWhere(todayStart, todayEnd),
      }),
      prisma.conversation.count({
        where: {
          channel: "TG",
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
      // «Заявки» badge: site requests nobody has called back yet (audit
      // LD-01). Not day-bounded: yesterday's unanswered request is still work.
      // Only the roles that work requests see it; the rest get 0.
      canWorkLeads(ctx)
        ? prisma.lead.count({ where: { status: "NEW" } })
        : Promise.resolve(0),
    ]);

    const rowsByDoctor = new Map<string, typeof schedulesToday>();
    for (const r of schedulesToday) {
      const arr = rowsByDoctor.get(r.doctorId) ?? [];
      arr.push(r);
      rowsByDoctor.set(r.doctorId, arr);
    }
    let availableMinutes = 0;
    for (const [doctorId, rows] of rowsByDoctor) {
      availableMinutes += workingMinutesOn(
        rows,
        todayDate,
        timeOffsToday.filter((t) => t.doctorId === doctorId),
      );
    }
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
        notifications: failedNotificationsToday,
        leads: newLeads,
      },
    });
  },
);
