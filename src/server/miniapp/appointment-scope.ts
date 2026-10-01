/**
 * Which of the patient's visits the Mini App files under «Предстоящие» and
 * which under «Прошедшие» (audit MA-20).
 *
 * The split used to be `date >= now`. A live-queue visit is created with
 * `date = now` (registerWalkin), so a second after reception printed the
 * ticket it was already «past»: the home screen never showed the queue
 * position, and the «Прошедшие» tab carried a visit «В очереди». A booking
 * for 10:00 left the home screen at 10:00 sharp, taking «Я на месте» with it
 * from the patient who was five minutes late.
 *
 * A visit is still ahead while it is not finished (cancelled, completed,
 * no-show) and either falls on today's clinic day or has not reached its
 * scheduled end. A late booking therefore stays on the home screen until
 * the lifecycle sweep marks it NO_SHOW, which is what reception sees too;
 * a WAITING row left over from an earlier day is history, not a live queue.
 * «Прошедшие» is exactly the rest, so no visit is in both tabs or in none.
 */
import type { Prisma } from "@/generated/prisma/client";
import { tashkentDayBounds } from "@/lib/booking-validation";

export type MiniAppAppointmentScope = "upcoming" | "past";

/** Statuses after which a visit can only be history. */
export const MINIAPP_FINISHED_STATUSES = ["CANCELLED", "COMPLETED", "NO_SHOW"] as const;

export function miniAppAppointmentScopeWhere(
  scope: MiniAppAppointmentScope,
  now: Date,
): Prisma.AppointmentWhereInput {
  const { dayStart } = tashkentDayBounds(now);
  if (scope === "upcoming") {
    return {
      status: { notIn: [...MINIAPP_FINISHED_STATUSES] },
      OR: [{ date: { gte: dayStart } }, { endDate: { gte: now } }],
    };
  }
  return {
    OR: [
      { status: { in: [...MINIAPP_FINISHED_STATUSES] } },
      { date: { lt: dayStart }, endDate: { lt: now } },
    ],
  };
}

/**
 * The same rule for one row, for code that already holds the visit (and for
 * the tests that pin the two halves to each other).
 */
export function isMiniAppUpcoming(
  row: { status: string; date: Date; endDate: Date },
  now: Date,
): boolean {
  if ((MINIAPP_FINISHED_STATUSES as readonly string[]).includes(row.status)) return false;
  const { dayStart } = tashkentDayBounds(now);
  return row.date.getTime() >= dayStart.getTime() || row.endDate.getTime() >= now.getTime();
}
