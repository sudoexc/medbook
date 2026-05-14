/**
 * /api/crm/doctors/me/sidebar-stats — single-shot aggregate that backs the
 * doctor sidebar (`doctor-sidebar.tsx`):
 *
 *   - `todayBadge`     → number on the "Мой день" menu item
 *   - `unreadMessages` → number on the "Сообщения" menu item
 *   - `loadPercent`    → arc of the donut gauge at the bottom
 *   - `todayCount`     → big number next to the donut
 *
 * Why one endpoint and not four:
 *   The sidebar is mounted on every doctor page. Four separate hooks would
 *   mean four parallel network calls on every navigation between routes
 *   (TanStack will refetch on focus / staleTime expiry independently).
 *   One handler returns all four numbers in a single ~3-query call.
 *
 * Capacity heuristic for `loadPercent`:
 *   The Doctor model has no `dailySlotCapacity` column. Capacity is derived
 *   from today's `DoctorSchedule` rows (weekday match, validFrom/To window).
 *   We treat the doctor's working minutes as the denominator and assume a
 *   standard 30-minute slot to convert to "slot count". `loadPercent` is
 *   then `(appointments_today / capacity) * 100`, capped at 100. If the
 *   doctor has no schedule for today (weekend, day off), capacity is 0 and
 *   the percent is reported as 0 — the UI renders a zero donut.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/server/http";

const DEFAULT_SLOT_MINUTES = 30;

type SidebarStatsResponse = {
  todayBadge: number;
  unreadMessages: number;
  loadPercent: number;
  todayCount: number;
};

function startOfLocalDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfLocalDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

function parseHHMM(value: string): number {
  // DoctorSchedule.{start,end}Time are stored as "HH:MM" strings. Failing
  // to parse → 0 so a malformed row contributes no working minutes rather
  // than NaN-poisoning the whole sum.
  const [h, m] = value.split(":").map((s) => Number.parseInt(s, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true, userId: true },
    });
    if (!doctor) {
      return err("DoctorProfileMissing", 403, {
        reason: "no_doctor_row_for_user",
      });
    }

    const now = new Date();
    const start = startOfLocalDay(now);
    const end = endOfLocalDay(now);
    const weekday = now.getDay();

    const [todayAppointments, unreadAgg, schedule] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          doctorId: doctor.id,
          date: { gte: start, lte: end },
          status: { not: "CANCELLED" },
        },
        select: { status: true },
      }),
      // Doctor scope mirrors /api/crm/conversations: a conversation belongs
      // to a doctor if EITHER an appointment links it OR the doctor's user
      // is the explicit assignee. We aggregate unreadCount across both.
      prisma.conversation.aggregate({
        where: {
          unreadCount: { gt: 0 },
          OR: [
            { appointment: { doctorId: doctor.id } },
            ...(doctor.userId ? [{ assignedToId: doctor.userId }] : []),
          ],
        },
        _sum: { unreadCount: true },
      }),
      prisma.doctorSchedule.findMany({
        where: {
          doctorId: doctor.id,
          weekday,
          isActive: true,
          AND: [
            { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
            { OR: [{ validTo: null }, { validTo: { gte: now } }] },
          ],
        },
        select: { startTime: true, endTime: true },
      }),
    ]);

    // "Мой день" badge = appointments that still need the doctor's
    // attention today. COMPLETED / SKIPPED / NO_SHOW are removed so the
    // number drops as the day progresses.
    const todayBadge = todayAppointments.filter(
      (a) =>
        a.status === "BOOKED" ||
        a.status === "WAITING" ||
        a.status === "IN_PROGRESS",
    ).length;

    const todayCount = todayAppointments.length;

    let workingMinutes = 0;
    for (const slot of schedule) {
      const s = parseHHMM(slot.startTime);
      const e = parseHHMM(slot.endTime);
      if (e > s) workingMinutes += e - s;
    }
    const capacity =
      workingMinutes > 0 ? Math.ceil(workingMinutes / DEFAULT_SLOT_MINUTES) : 0;
    const loadPercent =
      capacity > 0
        ? Math.min(100, Math.round((todayCount / capacity) * 100))
        : 0;

    const unreadMessages = unreadAgg._sum.unreadCount ?? 0;

    const payload: SidebarStatsResponse = {
      todayBadge,
      unreadMessages,
      loadPercent,
      todayCount,
    };
    return ok(payload);
  },
);
