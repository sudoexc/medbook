/**
 * Lifecycle of one medication reminder (`MedicationReminderSend`), audit
 * MA-13.
 *
 *   PENDING   the push went out, the patient has not answered;
 *   SNOOZED   «Отложить»: the row comes back as PENDING, with a fresh push,
 *             once `snoozeUntil` has passed;
 *   TAKEN / SKIPPED  the patient's answer;
 *   EXPIRED   no answer within the open window: the dose is history.
 *
 * Nothing wrote SNOOZED back or EXPIRED before: «Отложить на 30 минут» never
 * reminded again, unanswered rows piled up forever (three doses a day, 30+
 * in ten days), and the Mini App home took the OLDEST of them as «Пора
 * принять Карбамазепин 08:00» from a week ago, a double-dose risk.
 *
 * Client-safe: the worker, the list endpoint and the home screen share it.
 */

/** How long a dose stays answerable. Older unanswered rows expire. */
export const MEDICATION_REMINDER_OPEN_HOURS = 24;

const OPEN_WINDOW_MS = MEDICATION_REMINDER_OPEN_HOURS * 60 * 60 * 1000;

/** Rows scheduled before this instant are past the open window. */
export function medicationReminderOpenSince(now: Date | number): Date {
  const ms = typeof now === "number" ? now : now.getTime();
  return new Date(ms - OPEN_WINDOW_MS);
}

type ReminderLike = {
  status: string;
  scheduledFor: string | Date;
  snoozeUntil: string | Date | null;
};

function ms(v: string | Date): number {
  return typeof v === "string" ? new Date(v).getTime() : v.getTime();
}

/** Unanswered and past the open window: the worker marks it EXPIRED. */
export function isMedicationReminderExpired(r: ReminderLike, now: Date | number): boolean {
  if (r.status !== "PENDING" && r.status !== "SNOOZED") return false;
  return ms(r.scheduledFor) < medicationReminderOpenSince(now).getTime();
}

/** A snooze that has run out, on a dose still inside the open window. */
export function isMedicationSnoozeElapsed(r: ReminderLike, now: Date | number): boolean {
  const nowMs = typeof now === "number" ? now : now.getTime();
  return (
    r.status === "SNOOZED" &&
    r.snoozeUntil !== null &&
    ms(r.snoozeUntil) <= nowMs &&
    !isMedicationReminderExpired(r, now)
  );
}

/** Waiting for the patient's answer right now. */
export function isMedicationReminderDue(r: ReminderLike, now: Date | number): boolean {
  if (isMedicationReminderExpired(r, now)) return false;
  return r.status === "PENDING" || isMedicationSnoozeElapsed(r, now);
}

/**
 * The dose the home screen asks about: the most recent one due, never an
 * old one a newer dose has overtaken.
 */
export function pickDueMedicationReminder<T extends ReminderLike>(
  list: readonly T[],
  now: Date | number,
): T | null {
  let best: T | null = null;
  for (const r of list) {
    if (!isMedicationReminderDue(r, now)) continue;
    if (best === null || ms(r.scheduledFor) > ms(best.scheduledFor)) best = r;
  }
  return best;
}
