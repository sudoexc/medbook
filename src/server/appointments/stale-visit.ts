/**
 * IN_PROGRESS visits left over from an earlier clinic day (audit Q-13).
 *
 * Pure on purpose (no prisma import): the start guard, the lifecycle sweep
 * and the backfill script (`scripts/close-stale-in-progress-visits.ts`) all
 * read the same two rules from here, so they cannot drift apart.
 */

/**
 * A visit slotted before today (Tashkent) and not started today either. The
 * doctor forgot to close it; it is not a visit on the table right now.
 *
 * The single definition behind both sides of the rule: the start guard
 * ignores these rows (`findOtherActiveVisit`, which asks for the exact
 * complement), and the lifecycle sweep closes them
 * (`closeStaleInProgressVisits`), so no row can be neither "active" nor
 * "stale".
 */
export function staleInProgressWhere(dayStart: Date) {
  return {
    status: "IN_PROGRESS" as const,
    date: { lt: dayStart },
    OR: [{ startedAt: null }, { startedAt: { lt: dayStart } }],
  };
}

/**
 * When a forgotten visit is taken to have ended: its start plus the booked
 * length. Not "now": the sweep runs after midnight, and a visit stamped as
 * finished at 00:10 the next day would read as a 15-hour consultation in
 * the duration stats and land on the wrong day in daily reports.
 */
export function staleVisitCompletedAt(row: {
  date: Date;
  startedAt: Date | null;
  durationMin: number;
}): Date {
  const start = row.startedAt ?? row.date;
  return new Date(start.getTime() + Math.max(0, row.durationMin) * 60_000);
}
